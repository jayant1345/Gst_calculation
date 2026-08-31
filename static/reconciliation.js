document.addEventListener('DOMContentLoaded', function() {
    // State variables
    let reconData = [];
    let activeFilter = 'all';
    let activeStateFilter = 'all';

    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Dom Elements
    const fySelect = document.getElementById('fy-select');
    const monthChecks = document.querySelectorAll('input[name="months"]');
    const reconSearch = document.getElementById('recon-search');
    const statusBtns = document.querySelectorAll('#status-filters .filter-status-btn');
    const stateFilterBtns = document.querySelectorAll('#state-filters .filter-status-btn');
    const reconTableBody = document.getElementById('recon-table-body');
    const reconCardList = document.getElementById('recon-card-list');
    const reconCountText = document.getElementById('recon-count');

    // Trigger reconciliation on filter parameter change
    fySelect.addEventListener('change', () => {
        loadGstr2bStatus();
        fetchReconciliationData();
    });
    monthChecks.forEach(cb => cb.addEventListener('change', fetchReconciliationData));
    reconSearch.addEventListener('input', applyFilters);

    // Export Filtered Reconciliation Ledger Button
    const btnExportFiltered = document.getElementById('btn-export-filtered');
    if (btnExportFiltered) {
        btnExportFiltered.addEventListener('click', function() {
            const fy = fySelect.value;
            const selectedMonths = Array.from(monthChecks)
                .filter(cb => cb.checked)
                .map(cb => cb.value);
            const monthsQuery = selectedMonths.join(',');
            const search = encodeURIComponent(reconSearch.value.trim());
            const url = `/api/export-filtered-reconciliation?financial_year=${fy}&months=${monthsQuery}&state=${activeStateFilter}&status=${activeFilter}&search=${search}`;
            window.location.href = url;
        });
    }

    // Annual Export Button (All Books + Portal sheets)
    const btnExportAnnual = document.getElementById('btn-export-annual');
    if (btnExportAnnual) {
        btnExportAnnual.addEventListener('click', function() {
            const fy = fySelect.value;
            window.location.href = `/api/export-annual-report?financial_year=${fy}`;
        });
    }

    // Status Filter Buttons
    statusBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            statusBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            activeFilter = this.getAttribute('data-status');
            syncKpiCardHighlights();
            applyFilters();
        });
    });

    // Interactive KPI Cards (Click to Filter Ledger)
    const kpiCards = document.querySelectorAll('.clickable-kpi');
    kpiCards.forEach(card => {
        card.addEventListener('click', function() {
            const targetStatus = this.getAttribute('data-kpi-status');
            if (activeFilter === targetStatus) {
                activeFilter = 'all';
            } else {
                activeFilter = targetStatus;
            }

            // Sync status filter buttons
            statusBtns.forEach(btn => {
                if (btn.getAttribute('data-status') === activeFilter) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });

            syncKpiCardHighlights();
            applyFilters();
        });
    });

    function syncKpiCardHighlights() {
        kpiCards.forEach(card => {
            const status = card.getAttribute('data-kpi-status');
            if (activeFilter === status) {
                card.style.transform = 'translateY(-2px)';
                card.style.boxShadow = '0 6px 14px rgba(37, 99, 235, 0.2)';
                card.style.outline = '2px solid var(--accent-blue)';
            } else {
                card.style.transform = 'none';
                card.style.boxShadow = 'none';
                card.style.outline = 'none';
            }
        });
    }

    // State Filter Buttons -- also drives the KPI cards, since KPIs should
    // reflect whichever state (or "All States") is currently selected.
    stateFilterBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            stateFilterBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            activeStateFilter = this.getAttribute('data-state');
            updateKPIsForActiveState();
            applyFilters();
        });
    });

    // ---- GSTR-2B Upload: one independent facility per state (Gujarat /
    // Maharashtra), since each files its own separate GSTR-2B return and
    // must never share or overwrite the other's uploaded data. ----
    const GSTR2B_PANELS = [
        { state: 'Gujarat', suffix: 'gj' },
        { state: 'Maharashtra', suffix: 'mh' }
    ];

    GSTR2B_PANELS.forEach(panel => {
        const fileInput = document.getElementById(`gstr2b-file-input-${panel.suffix}`);
        const dropZone = document.getElementById(`gstr2b-drop-zone-${panel.suffix}`);
        const monthSelect = document.getElementById(`upload-month-${panel.suffix}`);
        const statusDiv = document.getElementById(`gstr2b-upload-status-${panel.suffix}`);
        const deleteBtn = document.querySelector(`.btn-delete-gstr2b[data-state="${panel.state}"]`);
        if (!fileInput || !dropZone || !monthSelect || !statusDiv) return;

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) {
                handleGstr2bUpload(e.dataTransfer.files[0], panel.state, monthSelect, statusDiv);
            }
        });
        fileInput.addEventListener('change', function() {
            if (this.files.length > 0) {
                handleGstr2bUpload(this.files[0], panel.state, monthSelect, statusDiv);
            }
        });

        // Removes a wrongly-uploaded or duplicate GSTR-2B batch for the FY +
        // month + state currently selected. Re-uploading only replaces the
        // exact same FY+month+state combo, so this is the only way to clear
        // one imported under the wrong month/FY without a blank replacement file.
        if (deleteBtn) {
            deleteBtn.addEventListener('click', function() {
                const fy = fySelect.value;
                const month = monthSelect.value;

                if (!month) {
                    showUploadStatus(statusDiv, 'Select a month above first, to know which GSTR-2B batch to delete.', 'error');
                    return;
                }

                const typed = prompt(
                    `This will PERMANENTLY delete all ${panel.state} GSTR-2B entries imported for ${month} (FY ${fy}). ` +
                    `This cannot be undone.\n\nType DELETE to confirm.`
                );
                if (typed === null) return;
                if (typed.trim().toUpperCase() !== 'DELETE') {
                    showUploadStatus(statusDiv, 'Confirmation text did not match "DELETE". Nothing was deleted.', 'error');
                    return;
                }

                fetch('/api/delete-gstr2b', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ financial_year: fy, month: month, state: panel.state })
                })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        showUploadStatus(statusDiv, `Deleted ${data.count} ${panel.state} GSTR-2B entr${data.count === 1 ? 'y' : 'ies'} for ${month} (${fy}).`, 'success');
                        loadGstr2bStatus();
                        fetchReconciliationData();
                        if (activeStage === 3) loadStage3Data();
                    } else {
                        showUploadStatus(statusDiv, data.error || 'Failed to delete GSTR-2B entries.', 'error');
                    }
                })
                .catch(err => {
                    showUploadStatus(statusDiv, 'Network error while deleting GSTR-2B entries.', 'error');
                    console.error(err);
                });
            });
        }
    });

    const ALL_MONTH_NAMES = ['April', 'May', 'June', 'July', 'August', 'September',
        'October', 'November', 'December', 'January', 'February', 'March'];

    function loadGstr2bStatus() {
        const fy = fySelect ? fySelect.value : '';
        if (!fy) return;

        fetch(`/api/gstr2b-status?financial_year=${fy}`)
            .then(res => res.json())
            .then(data => {
                const batches = data.batches || [];
                const gjBatches = batches.filter(b => b.state === 'Gujarat');
                const mhBatches = batches.filter(b => b.state === 'Maharashtra');

                updateStateGstr2bPanel('Gujarat', 'gj', gjBatches);
                updateStateGstr2bPanel('Maharashtra', 'mh', mhBatches);
                updateMonthPillsWithGstr2b(batches);
            })
            .catch(err => console.error('Error fetching GSTR-2B status:', err));
    }

    function updateStateGstr2bPanel(stateName, suffix, stateBatches) {
        const monthSelect = document.getElementById(`upload-month-${suffix}`);
        const summaryContainer = document.getElementById(`gstr2b-loaded-summary-${suffix}`);
        const countBadge = document.getElementById(`gstr2b-badge-count-${suffix}`);
        if (!monthSelect || !summaryContainer) return;

        const batchMap = new Map();
        stateBatches.forEach(b => batchMap.set(b.month, b));

        // 1. Update month dropdown options with clear indicators
        const currentVal = monthSelect.value;
        let optionsHtml = '<option value="">-- Select Month --</option>';
        ALL_MONTH_NAMES.forEach(m => {
            const batch = batchMap.get(m);
            if (batch && batch.count > 0) {
                optionsHtml += `<option value="${m}" style="font-weight: 700; color: #047857;">${m} (✓ ${batch.count} bills loaded)</option>`;
            } else {
                optionsHtml += `<option value="${m}">${m}</option>`;
            }
        });
        monthSelect.innerHTML = optionsHtml;
        monthSelect.value = currentVal;

        // 2. Update summary badges list
        if (stateBatches.length === 0) {
            if (countBadge) countBadge.textContent = 'No Data';
            summaryContainer.innerHTML = `<span style="font-size: 12px; color: #94a3b8; font-style: italic;">No GSTR-2B files uploaded for ${stateName} in FY ${fySelect.value}</span>`;
        } else {
            const totalCount = stateBatches.reduce((acc, b) => acc + (b.count || 0), 0);
            if (countBadge) countBadge.textContent = `${stateBatches.length} Month${stateBatches.length === 1 ? '' : 's'} (${totalCount} bills)`;
            
            summaryContainer.innerHTML = stateBatches.map(b => `
                <div class="gstr2b-batch-chip" style="display: inline-flex; align-items: center; gap: 6px; background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600;">
                    <i class="fa-solid fa-circle-check" style="color: #16a34a; font-size: 10px;"></i>
                    <span><strong>${b.month}:</strong> ${b.count} bill${b.count === 1 ? '' : 's'} (₹${(b.total_gst || 0).toFixed(2)})</span>
                    <button type="button" class="btn-quick-del-gstr2b" data-state="${stateName}" data-month="${b.month}" title="Delete ${b.month} GSTR-2B data" style="background: none; border: none; color: #dc2626; cursor: pointer; padding: 0 2px; margin-left: 2px; font-size: 12px;">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            `).join('');

            // Attach quick delete listeners
            summaryContainer.querySelectorAll('.btn-quick-del-gstr2b').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const state = btn.dataset.state;
                    const month = btn.dataset.month;
                    const fy = fySelect.value;
                    if (confirm(`Delete uploaded GSTR-2B data for ${state} - ${month} (${fy})?`)) {
                        fetch('/api/delete-gstr2b', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ financial_year: fy, month: month, state: state })
                        })
                        .then(res => res.json())
                        .then(data => {
                            if (data.success) {
                                loadGstr2bStatus();
                                fetchReconciliationData();
                                if (activeStage === 3) loadStage3Data();
                            } else {
                                alert(data.error || 'Failed to delete GSTR-2B data.');
                            }
                        })
                        .catch(err => {
                            console.error('Error deleting GSTR-2B:', err);
                            alert('Network error while deleting GSTR-2B data.');
                        });
                    }
                });
            });
        }
    }

    function updateMonthPillsWithGstr2b(batches) {
        const loadedMonths = new Set(batches.map(b => b.month));
        monthChecks.forEach(cb => {
            const pillSpan = cb.parentElement.querySelector('span');
            if (!pillSpan) return;
            const originalShort = cb.value.slice(0, 3);
            if (loadedMonths.has(cb.value)) {
                pillSpan.innerHTML = `${originalShort} <span style="display: inline-block; width: 6px; height: 6px; background-color: #22c55e; border-radius: 50%; margin-left: 2px;" title="GSTR-2B Uploaded for ${cb.value}"></span>`;
            } else {
                pillSpan.textContent = originalShort;
            }
        });
    }

    // Handle GSTR-2B Upload for one state's panel
    function handleGstr2bUpload(file, state, monthSelect, statusDiv) {
        const month = monthSelect.value;
        const fy = fySelect.value;

        if (!month) {
            showUploadStatus(statusDiv, 'Please select a GSTR-2B month first.', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('financial_year', fy);
        formData.append('month', month);
        formData.append('state', state);

        showUploadStatus(statusDiv, `Uploading and parsing ${state} GSTR-2B...`, 'info');

        fetch('/api/upload-gstr2b', {
            method: 'POST',
            body: formData
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                showUploadStatus(statusDiv, `Success! Imported ${data.count} ${state} portal entries for ${month} (${fy}).`, 'success');
                // Check the checkbox for this month to trigger auto-reconcile
                const matchingCheckbox = Array.from(monthChecks).find(cb => cb.value === month);
                if (matchingCheckbox && !matchingCheckbox.checked) {
                    matchingCheckbox.checked = true;
                }
                loadGstr2bStatus();
                fetchReconciliationData();
            } else {
                showUploadStatus(statusDiv, data.error || 'Failed to upload GSTR-2B file.', 'error');
            }
        })
        .catch(err => {
            showUploadStatus(statusDiv, 'Network error occurred during upload.', 'error');
            console.error(err);
        });
    }

    function showUploadStatus(statusDiv, msg, type) {
        statusDiv.style.display = 'block';
        statusDiv.innerText = msg;
        statusDiv.className = `upload-status-message ${type}`;
    }

    // Fetch Reconciliation Data
    function fetchReconciliationData() {
        const fy = fySelect.value;
        const selectedMonths = Array.from(monthChecks)
            .filter(cb => cb.checked)
            .map(cb => cb.value);

        if (selectedMonths.length === 0) {
            renderEmptyLedger("Select at least one month to run reconciliation.");
            return;
        }

        const monthsQuery = selectedMonths.join(',');
        
        fetch(`/api/reconcile-data?financial_year=${fy}&months=${monthsQuery}`)
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                renderEmptyLedger(`Error: ${data.error}`);
                return;
            }
            reconData = data.items || [];
            updateKPIsForActiveState();
            applyFilters();
        })
        .catch(err => {
            renderEmptyLedger("Failed to load reconciliation dataset.");
            console.error(err);
        });
    }

    // Update KPI UI Elements
    function updateKPIs(summary) {
        if (!summary) return;
        document.getElementById('kpi-matched').innerText = `${summary.matched} Invoices`;
        document.getElementById('kpi-mismatched').innerText = `${summary.mismatched} Invoices`;
        document.getElementById('kpi-missing-portal').innerText = `${summary.missing_in_portal} Invoices`;
        document.getElementById('kpi-missing-books').innerText = `${summary.missing_in_books} Invoices`;
    }

    // KPI cards reflect whichever state is currently selected (or the total
    // across all states) -- computed client-side from the already-fetched
    // reconData rather than the backend's unfiltered summary, so the cards
    // stay in sync with the State filter the same way the ledger rows do.
    function updateKPIsForActiveState() {
        const subset = activeStateFilter === 'all'
            ? reconData
            : reconData.filter(item => (item.state || 'Unassigned') === activeStateFilter);

        const counts = { matched: 0, mismatched: 0, missing_in_portal: 0, missing_in_books: 0 };
        subset.forEach(item => {
            if (item.status === 'Matched') counts.matched++;
            else if (item.status === 'Value Mismatched') counts.mismatched++;
            else if (item.status === 'Missing in GSTR-2B') counts.missing_in_portal++;
            else if (item.status === 'Missing in Books') counts.missing_in_books++;
        });
        updateKPIs(counts);
    }

    // Apply Filter state and Search Query
    function applyFilters() {
        const searchQuery = reconSearch.value.toLowerCase().trim();

        const filtered = reconData.filter(item => {
            // 1. State Filter
            if (activeStateFilter !== 'all' && (item.state || 'Unassigned') !== activeStateFilter) {
                return false;
            }

            // 2. Status Filter
            if (activeFilter !== 'all' && item.status !== activeFilter) {
                return false;
            }

            // 3. Search Text Query (Fuzzy check supplier, gstin, or inv number)
            if (searchQuery) {
                const bookGstin = item.book?.gstin || '';
                const bookVendor = item.book?.vendor_name || '';
                const bookInv = item.book?.invoice_number || '';
                const portalGstin = item.portal?.gstin || '';
                const portalVendor = item.portal?.vendor_name || '';
                const portalInv = item.portal?.invoice_number || '';
                
                const searchStr = `${bookGstin} ${bookVendor} ${bookInv} ${portalGstin} ${portalVendor} ${portalInv}`.toLowerCase();
                if (!searchStr.includes(searchQuery)) {
                    return false;
                }
            }
            return true;
        });

        reconCountText.innerText = `${filtered.length} items found`;
        renderLedger(filtered);
    }

    // Render Ledger (Desktop & Mobile)
    function renderLedger(items) {
        if (items.length === 0) {
            renderEmptyLedger("No records match the current filter parameters.");
            return;
        }

        // Render Desktop Rows
        reconTableBody.innerHTML = '';
        items.forEach(item => {
            const tr = document.createElement('tr');
            tr.className = `recon-row status-${item.status.toLowerCase().replace(/ /g, '-')}`;
            
            const supplier = item.book ? item.book.vendor_name : item.portal.vendor_name;
            const gstin = item.book ? item.book.gstin : item.portal.gstin;

            // Books Side
            const bBranch = item.book ? item.book.branch : '-';
            const bInv = item.book ? item.book.invoice_number : '-';
            const bDate = item.book ? item.book.invoice_date : '-';
            const bGst = item.book ? `₹${item.book.total_gst.toFixed(2)}` : '-';

            // Portal Side
            const pInv = item.portal ? item.portal.invoice_number : '-';
            const pDate = item.portal ? item.portal.invoice_date : '-';
            const pGst = item.portal ? `₹${item.portal.total_gst.toFixed(2)}` : '-';
            const pTaxable = item.portal ? `₹${item.portal.taxable_value.toFixed(2)}` : '-';

            // Status Badge
            const statusBadge = `<span class="badge ${getStatusBadgeClass(item.status)}">${escapeHtml(item.status)}</span>`;

            // Actions Button (kind stored on a data attribute; listener attached after insert)
            let actionBtn = '';
            if (item.status === 'Matched') {
                actionBtn = `<button class="btn-action-small approve" data-action="approve" title="Approve ITC"><i class="fa-solid fa-check"></i></button>`;
            } else if (item.status === 'Possible Match') {
                actionBtn = `<button class="btn-action-small approve" data-action="confirm-match" title="Confirm this is the same invoice"><i class="fa-solid fa-code-compare"></i></button>`;
                if (item.book && item.book.has_file) {
                    actionBtn += `<button class="btn-action-small hold" data-action="rescan" title="Re-scan original bill with AI"><i class="fa-solid fa-arrows-rotate"></i></button>`;
                }
            } else if (item.status === 'Missing in GSTR-2B' || item.status === 'Value Mismatched') {
                actionBtn = `<button class="btn-action-small notify" data-action="notify" title="Notify Vendor"><i class="fa-solid fa-envelope"></i></button>`;
            } else if (item.status === 'Missing in Books') {
                actionBtn = `
                    <button class="btn-action-small hold" data-action="hold" title="Put on Hold"><i class="fa-solid fa-pause"></i></button>
                    <button class="btn-action-small delete" data-action="delete-portal-entry" data-id="${item.portal ? item.portal.id : ''}" title="Delete GSTR-2B Entry" style="background: #fef2f2; color: #dc2626; border: 1px solid #fca5a5;"><i class="fa-solid fa-trash"></i></button>
                `;
            } else {
                actionBtn = `<button class="btn-action-small hold" data-action="hold" title="Hold"><i class="fa-solid fa-pause"></i></button>`;
            }

            const highlightDiff = item.status === 'Value Mismatched' || item.status === 'Possible Match';

            tr.innerHTML = `
                <td>${escapeHtml(item.state || 'Unassigned')}</td>
                <td>
                    <div class="supplier-info">
                        <strong>${escapeHtml(supplier)}</strong>
                        <span class="gstin-sub">${escapeHtml(gstin)}</span>
                    </div>
                </td>
                <td>${escapeHtml(bBranch)}</td>
                <td class="${highlightDiff ? 'value-diff' : ''}">${escapeHtml(bInv)}</td>
                <td>${escapeHtml(bDate)}</td>
                <td class="text-right ${item.status === 'Value Mismatched' ? 'value-diff' : ''}">${bGst}</td>

                <td class="${highlightDiff ? 'value-diff' : ''}">${escapeHtml(pInv)}</td>
                <td>${escapeHtml(pDate)}</td>
                <td class="text-right ${item.status === 'Value Mismatched' ? 'value-diff' : ''}">${pGst}</td>
                <td class="text-right">${pTaxable}</td>

                <td>${statusBadge}</td>
                <td><div class="action-btn-cell">${actionBtn}</div></td>
            `;

            tr.querySelectorAll('[data-action]').forEach(actionEl => {
                actionEl.addEventListener('click', () => {
                    const kind = actionEl.dataset.action;
                    if (kind === 'approve') alert('ITC Approved!');
                    else if (kind === 'confirm-match') confirmPossibleMatch(item.book.id, item.portal.invoice_number, item.portal.gstin, supplier);
                    else if (kind === 'rescan') rescanInvoice(item.book.id, actionEl);
                    else if (kind === 'notify') alert(`Sending follow-up to vendor: ${supplier}`);
                    else if (kind === 'delete-portal-entry') {
                        const entryId = actionEl.dataset.id;
                        if (!entryId) return;
                        if (confirm(`Delete GSTR-2B entry for "${supplier}"? This will permanently remove it from reconciliation.`)) {
                            fetch('/api/delete-gstr2b-entry', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: parseInt(entryId) })
                            })
                            .then(res => res.json())
                            .then(data => {
                                if (data.success) {
                                    runReconciliation();
                                } else {
                                    alert(data.error || 'Failed to delete GSTR-2B entry.');
                                }
                            })
                            .catch(err => {
                                console.error('Error deleting GSTR-2B entry:', err);
                                alert('Failed to delete GSTR-2B entry.');
                            });
                        }
                    }
                    else alert('Put invoice on hold.');
                });
            });

            reconTableBody.appendChild(tr);
        });

        // Render Mobile Comparison Cards
        reconCardList.innerHTML = '';
        items.forEach(item => {
            const card = document.createElement('div');
            card.className = `mobile-recon-card status-${item.status.toLowerCase().replace(/ /g, '-')}`;
            
            const supplier = item.book ? item.book.vendor_name : item.portal.vendor_name;
            const gstin = item.book ? item.book.gstin : item.portal.gstin;

            // Books details
            const bInv = item.book ? item.book.invoice_number : 'N/A';
            const bDate = item.book ? item.book.invoice_date : '-';
            const bGst = item.book ? `₹${item.book.total_gst.toFixed(2)}` : '-';

            // Portal details
            const pInv = item.portal ? item.portal.invoice_number : 'N/A';
            const pDate = item.portal ? item.portal.invoice_date : '-';
            const pGst = item.portal ? `₹${item.portal.total_gst.toFixed(2)}` : '-';

            const statusBadge = `<span class="badge ${getStatusBadgeClass(item.status)}">${escapeHtml(item.status)}</span>`;

            const isMatched = item.status === 'Matched';
            const isPossibleMatch = item.status === 'Possible Match';
            let actionHtml;
            if (isMatched) {
                actionHtml = `<button class="mobile-action-btn approve" data-action="approve"><i class="fa-solid fa-check"></i> Approve</button>`;
            } else if (isPossibleMatch) {
                actionHtml = `<button class="mobile-action-btn approve" data-action="confirm-match"><i class="fa-solid fa-code-compare"></i> Confirm Match</button>`;
                if (item.book && item.book.has_file) {
                    actionHtml += `<button class="mobile-action-btn notify" data-action="rescan"><i class="fa-solid fa-arrows-rotate"></i> Re-scan Bill</button>`;
                }
            } else if (item.status === 'Missing in Books') {
                actionHtml = `
                    <button class="mobile-action-btn hold" data-action="hold"><i class="fa-solid fa-pause"></i> Hold</button>
                    <button class="mobile-action-btn delete" data-action="delete-portal-entry" data-id="${item.portal ? item.portal.id : ''}" style="background: #fef2f2; color: #dc2626; border-color: #fca5a5;"><i class="fa-solid fa-trash"></i> Delete Entry</button>
                `;
            } else {
                actionHtml = `<button class="mobile-action-btn notify" data-action="notify"><i class="fa-solid fa-envelope"></i> Send Notice</button>`;
            }

            card.innerHTML = `
                <div class="card-mobile-header">
                    <div class="mobile-supplier">
                        <h4>${escapeHtml(supplier)}</h4>
                        <span>${escapeHtml(gstin)} &middot; ${escapeHtml(item.state || 'Unassigned')}</span>
                    </div>
                    ${statusBadge}
                </div>

                <div class="mobile-card-comparison">
                    <div class="comp-column books-col">
                        <h5>Books</h5>
                        <div class="comp-row"><span>Inv No:</span> <strong>${escapeHtml(bInv)}</strong></div>
                        <div class="comp-row"><span>Date:</span> <span>${escapeHtml(bDate)}</span></div>
                        <div class="comp-row"><span>Tax:</span> <strong>${bGst}</strong></div>
                    </div>
                    <div class="comp-divider"></div>
                    <div class="comp-column portal-col">
                        <h5>GSTR-2B</h5>
                        <div class="comp-row"><span>Inv No:</span> <strong>${escapeHtml(pInv)}</strong></div>
                        <div class="comp-row"><span>Date:</span> <span>${escapeHtml(pDate)}</span></div>
                        <div class="comp-row"><span>Tax:</span> <strong>${pGst}</strong></div>
                    </div>
                </div>

                <div class="mobile-card-actions">
                    ${actionHtml}
                </div>
            `;

            card.querySelectorAll('[data-action]').forEach(cardActionEl => {
                cardActionEl.addEventListener('click', () => {
                    const kind = cardActionEl.dataset.action;
                    if (kind === 'approve') alert('ITC Approved!');
                    else if (kind === 'confirm-match') confirmPossibleMatch(item.book.id, item.portal.invoice_number, item.portal.gstin, supplier);
                    else if (kind === 'rescan') rescanInvoice(item.book.id, cardActionEl);
                    else if (kind === 'delete-portal-entry') {
                        const entryId = cardActionEl.dataset.id;
                        if (!entryId) return;
                        if (confirm(`Delete GSTR-2B entry for "${supplier}"? This will permanently remove it from reconciliation.`)) {
                            fetch('/api/delete-gstr2b-entry', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: parseInt(entryId) })
                            })
                            .then(res => res.json())
                            .then(data => {
                                if (data.success) {
                                    runReconciliation();
                                } else {
                                    alert(data.error || 'Failed to delete GSTR-2B entry.');
                                }
                            })
                            .catch(err => {
                                console.error('Error deleting GSTR-2B entry:', err);
                                alert('Failed to delete GSTR-2B entry.');
                            });
                        }
                    }
                    else if (kind === 'hold') alert('Put invoice on hold.');
                    else alert(`Notifying vendor: ${supplier}`);
                });
            });

            reconCardList.appendChild(card);
        });
    }

    function getStatusBadgeClass(status) {
        if (status === 'Matched') return 'badge-green';
        if (status === 'Value Mismatched') return 'badge-yellow';
        if (status === 'Possible Match') return 'badge-purple';
        if (status === 'Missing in GSTR-2B') return 'badge-red';
        return 'badge-blue';
    }

    // Stage 3 review action: the human has confirmed a "Possible Match" row
    // really is the same invoice (identical amounts, one OCR-misread
    // character), so overwrite the book entry's GSTIN/invoice number with
    // the portal's values and re-run reconciliation to fold it into
    // "Matched" on the next fetch.
    function confirmPossibleMatch(bookId, portalInvoiceNumber, portalGstin, supplier) {
        if (!confirm(`Confirm this is the same invoice as "${supplier}"?\n\nThis will update the book entry to:\nInvoice #: ${portalInvoiceNumber}\nGSTIN: ${portalGstin}`)) {
            return;
        }
        fetch('/api/apply-book-correction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ book_id: bookId, invoice_number: portalInvoiceNumber, gstin: portalGstin })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                fetchReconciliationData();
                if (activeStage === 3) loadStage3Data();
            } else {
                alert(data.error || 'Failed to apply correction.');
            }
        })
        .catch(err => {
            alert('Network error while applying correction.');
            console.error(err);
        });
    }

    // Alternative to confirmPossibleMatch: instead of trusting the portal's
    // values outright, re-run AI vision extraction on the bill's originally
    // stored file for a fresh, careful read. Manual/on-demand -- this calls
    // the paid vision API, so it only runs when a human explicitly asks.
    function rescanInvoice(bookId, btnEl) {
        if (!confirm('Re-scan the original bill with AI? This re-reads the stored file and may take a few seconds.')) {
            return;
        }
        const originalHtml = btnEl.innerHTML;
        btnEl.disabled = true;
        btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

        fetch('/api/rescan-invoice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ book_id: bookId })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                alert(`Re-scan complete.\n\nInvoice #: ${data.invoice_number}\nGSTIN: ${data.gstin}`);
                fetchReconciliationData();
                if (activeStage === 3) loadStage3Data();
            } else {
                alert(data.error || 'Failed to re-scan bill.');
                btnEl.disabled = false;
                btnEl.innerHTML = originalHtml;
            }
        })
        .catch(err => {
            alert('Network error while re-scanning bill.');
            console.error(err);
            btnEl.disabled = false;
            btnEl.innerHTML = originalHtml;
        });
    }

    function renderEmptyLedger(msg) {
        const safeMsg = escapeHtml(msg);
        reconTableBody.innerHTML = `
            <tr class="empty-state-row">
                <td colspan="12">
                    <div class="empty-state">
                        <i class="fa-solid fa-scale-balanced"></i>
                        <p>${safeMsg}</p>
                    </div>
                </td>
            </tr>
        `;
        reconCardList.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-scale-balanced"></i>
                <p>${safeMsg}</p>
            </div>
        `;
        reconCountText.innerText = "0 items found";
    }

    // Run reconciliation on load
    fetchReconciliationData();

    // STAGE SWITCHER TABS
    const tabBtnStage2 = document.getElementById('tab-btn-stage2');
    const tabBtnStage3 = document.getElementById('tab-btn-stage3');
    const viewStage2 = document.getElementById('view-stage2');
    const viewStage3 = document.getElementById('view-stage3');

    let activeStage = 2;

    if (tabBtnStage2 && tabBtnStage3) {
        tabBtnStage2.addEventListener('click', () => {
            activeStage = 2;
            tabBtnStage2.classList.add('active');
            tabBtnStage3.classList.remove('active');
            viewStage2.style.display = 'block';
            viewStage3.style.display = 'none';
        });

        tabBtnStage3.addEventListener('click', () => {
            activeStage = 3;
            tabBtnStage3.classList.add('active');
            tabBtnStage2.classList.remove('active');
            viewStage2.style.display = 'none';
            viewStage3.style.display = 'block';
            loadStage3Data();
        });
    }

    // Wrap parameter change to load Stage 3 data if active
    fySelect.addEventListener('change', () => {
        if (activeStage === 3) loadStage3Data();
    });

    monthChecks.forEach(cb => cb.addEventListener('change', () => {
        if (activeStage === 3) loadStage3Data();
    }));

    // STAGE 3 DATA FETCHERS
    function loadStage3Data() {
        fetchVendorDiscrepancies();
        fetchGstr3bSummary();
    }

    function fetchVendorDiscrepancies() {
        const fy = fySelect.value;
        const selectedMonths = Array.from(monthChecks).filter(cb => cb.checked).map(cb => cb.value);
        if (selectedMonths.length === 0) return;

        const monthsQuery = selectedMonths.join(',');
        fetch(`/api/vendor-discrepancies?financial_year=${fy}&months=${monthsQuery}`)
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    renderVendorTable(data.vendors || []);
                }
            })
            .catch(err => console.error("Error fetching vendor discrepancies:", err));
    }

    function renderVendorTable(vendors) {
        const vendorBody = document.getElementById('vendor-table-body');
        const vendorCount = document.getElementById('vendor-count');
        if (!vendorBody) return;

        if (vendors.length === 0) {
            vendorBody.innerHTML = `
                <tr class="empty-state-row">
                    <td colspan="6">
                        <div class="empty-state">
                            <i class="fa-solid fa-circle-check"></i>
                            <p>No vendor discrepancies found! All invoices are fully matched.</p>
                        </div>
                    </td>
                </tr>
            `;
            if (vendorCount) vendorCount.innerText = "0 Vendors Need Action";
            return;
        }

        if (vendorCount) vendorCount.innerText = `${vendors.length} Vendors Need Action`;
        vendorBody.innerHTML = '';

        vendors.forEach(v => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${escapeHtml(v.gstin)}</strong></td>
                <td><strong>${escapeHtml(v.vendor_name)}</strong></td>
                <td><span class="badge badge-red">${v.missing_invoices.length} Missing</span></td>
                <td><span class="badge badge-yellow">${v.mismatched_invoices.length} Mismatched</span></td>
                <td class="text-right text-red font-bold">₹${v.total_tax_on_hold.toFixed(2)}</td>
                <td class="text-center">
                    <div class="action-btn-cell" style="justify-content: center; gap: 8px;">
                        <button class="btn btn-secondary btn-sm btn-generate-notice" data-gstin="${escapeHtml(v.gstin)}" data-vname="${escapeHtml(v.vendor_name)}" title="Generate Email Notice">
                            <i class="fa-solid fa-envelope"></i> Notice
                        </button>
                        <button class="btn btn-action-small wa btn-wa-notice" data-gstin="${escapeHtml(v.gstin)}" data-vname="${escapeHtml(v.vendor_name)}" title="WhatsApp Notice">
                            <i class="fa-brands fa-whatsapp"></i>
                        </button>
                    </div>
                </td>
            `;
            vendorBody.appendChild(tr);
        });

        // Add event listeners to buttons
        vendorBody.querySelectorAll('.btn-generate-notice, .btn-wa-notice').forEach(btn => {
            btn.addEventListener('click', function() {
                const gstin = this.dataset.gstin;
                const vname = this.dataset.vname;
                const isWa = this.classList.contains('btn-wa-notice');
                openNoticeModal(gstin, vname, isWa);
            });
        });
    }

    function fetchGstr3bSummary() {
        const fy = fySelect.value;
        const selectedMonths = Array.from(monthChecks).filter(cb => cb.checked).map(cb => cb.value);
        if (selectedMonths.length === 0) return;

        const monthsQuery = selectedMonths.join(',');
        fetch(`/api/gstr3b-summary?financial_year=${fy}&months=${monthsQuery}`)
            .then(res => res.json())
            .then(data => {
                if (data.success && data.gstr3b) {
                    updateGstr3bUI(data.gstr3b);
                }
            })
            .catch(err => console.error("Error fetching GSTR-3B summary:", err));
    }

    function updateGstr3bUI(g3b) {
        const a5 = g3b.table_4a5_all_other_itc || {};
        const b2 = g3b.table_4b2_ineligible_itc || {};
        const d1 = g3b.table_4d1_pending_itc || {};

        document.getElementById('gstr3b-4a5-taxable').innerText = `₹${(a5.taxable||0).toFixed(2)}`;
        document.getElementById('gstr3b-4a5-cgst').innerText = `₹${(a5.cgst||0).toFixed(2)}`;
        document.getElementById('gstr3b-4a5-sgst').innerText = `₹${(a5.sgst||0).toFixed(2)}`;
        document.getElementById('gstr3b-4a5-igst').innerText = `₹${(a5.igst||0).toFixed(2)}`;
        document.getElementById('gstr3b-4a5-total').innerHTML = `<strong>₹${(a5.total||0).toFixed(2)}</strong>`;

        document.getElementById('gstr3b-4b2-taxable').innerText = `₹${(b2.taxable||0).toFixed(2)}`;
        document.getElementById('gstr3b-4b2-cgst').innerText = `₹${(b2.cgst||0).toFixed(2)}`;
        document.getElementById('gstr3b-4b2-sgst').innerText = `₹${(b2.sgst||0).toFixed(2)}`;
        document.getElementById('gstr3b-4b2-igst').innerText = `₹${(b2.igst||0).toFixed(2)}`;
        document.getElementById('gstr3b-4b2-total').innerHTML = `<strong>₹${(b2.total||0).toFixed(2)}</strong>`;

        document.getElementById('gstr3b-4d1-taxable').innerText = `₹${(d1.taxable||0).toFixed(2)}`;
        document.getElementById('gstr3b-4d1-cgst').innerText = `₹${(d1.cgst||0).toFixed(2)}`;
        document.getElementById('gstr3b-4d1-sgst').innerText = `₹${(d1.sgst||0).toFixed(2)}`;
        document.getElementById('gstr3b-4d1-igst').innerText = `₹${(d1.igst||0).toFixed(2)}`;
        document.getElementById('gstr3b-4d1-total').innerHTML = `<strong>₹${(d1.total||0).toFixed(2)}</strong>`;

        // Also update Stage 3 KPI cards. "Missing" and "Mismatched" are split
        // apart here for actionability (different vendor follow-up needed),
        // even though GSTR-3B Table 4D(1) above reports them combined, which
        // is how the actual return works.
        document.getElementById('stg3-kpi-claimable').innerText = `₹${(a5.total||0).toFixed(2)}`;
        document.getElementById('stg3-kpi-blocked').innerText = `₹${(b2.total||0).toFixed(2)}`;
        document.getElementById('stg3-kpi-missing').innerText = `₹${(g3b.missing_only_total||0).toFixed(2)}`;
        document.getElementById('stg3-kpi-mismatched').innerText = `₹${(g3b.mismatched_only_total||0).toFixed(2)}`;
    }

    // Also update total invoices in Stage 3 KPIs when recon data loads
    const originalUpdateKPIs = updateKPIs;
    updateKPIs = function(summary) {
        originalUpdateKPIs(summary);
        if (summary) {
            document.getElementById('stg3-kpi-total').innerText = `${summary.total_books} Invoices`;
        }
    };

    // Export Vendor Discrepancies Excel Button
    const btnExportVendor = document.getElementById('btn-export-vendor-discrepancies');
    if (btnExportVendor) {
        btnExportVendor.addEventListener('click', function() {
            const fy = fySelect.value;
            const selectedMonths = Array.from(monthChecks).filter(cb => cb.checked).map(cb => cb.value);
            if (selectedMonths.length === 0) {
                alert("Please select at least one month.");
                return;
            }
            window.location.href = `/api/export-vendor-discrepancies?financial_year=${fy}&months=${selectedMonths.join(',')}`;
        });
    }

    // NOTICE MODAL LOGIC
    const noticeModal = document.getElementById('notice-modal');
    const modalVendorName = document.getElementById('modal-vendor-name');
    const modalVendorGstin = document.getElementById('modal-vendor-gstin');
    const modalEmailSubject = document.getElementById('modal-email-subject');
    const modalEmailBody = document.getElementById('modal-email-body');
    const modalWaBody = document.getElementById('modal-wa-body');
    const modalTabEmail = document.getElementById('modal-tab-email');
    const modalTabWa = document.getElementById('modal-tab-wa');
    const modalEmailView = document.getElementById('modal-email-view');
    const modalWaView = document.getElementById('modal-wa-view');
    const modalBtnWaLink = document.getElementById('modal-btn-wa-link');
    const modalBtnCopy = document.getElementById('modal-btn-copy');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const modalBtnClose = document.getElementById('modal-btn-close');

    let activeModalTab = 'email';

    function openNoticeModal(gstin, vendorName, isWa = false) {
        const fy = fySelect.value;
        const selectedMonths = Array.from(monthChecks).filter(cb => cb.checked).map(cb => cb.value);

        fetch('/api/generate-vendor-notice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                gstin: gstin,
                vendor_name: vendorName,
                financial_year: fy,
                months: selectedMonths
            })
        })
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                alert(data.error);
                return;
            }
            modalVendorName.innerText = data.vendor_name;
            modalVendorGstin.innerText = `GSTIN: ${data.gstin}`;

            modalEmailSubject.value = data.email_subject;
            modalEmailBody.value = data.email_body;
            modalWaBody.value = data.whatsapp_text;

            const encodedWa = encodeURIComponent(data.whatsapp_text);
            modalBtnWaLink.href = `https://wa.me/?text=${encodedWa}`;

            if (isWa) {
                switchModalTab('wa');
            } else {
                switchModalTab('email');
            }

            noticeModal.style.display = 'flex';
        })
        .catch(err => {
            alert("Error generating notice draft.");
            console.error(err);
        });
    }

    function switchModalTab(tab) {
        activeModalTab = tab;
        if (tab === 'email') {
            modalTabEmail.classList.add('active');
            modalTabWa.classList.remove('active');
            modalEmailView.style.display = 'block';
            modalWaView.style.display = 'none';
            modalBtnWaLink.style.display = 'none';
        } else {
            modalTabWa.classList.add('active');
            modalTabEmail.classList.remove('active');
            modalEmailView.style.display = 'none';
            modalWaView.style.display = 'block';
            modalBtnWaLink.style.display = 'inline-flex';
        }
    }

    if (modalTabEmail) modalTabEmail.addEventListener('click', () => switchModalTab('email'));
    if (modalTabWa) modalTabWa.addEventListener('click', () => switchModalTab('wa'));

    function closeNoticeModal() {
        if (noticeModal) noticeModal.style.display = 'none';
    }

    if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeNoticeModal);
    if (modalBtnClose) modalBtnClose.addEventListener('click', closeNoticeModal);

    if (modalBtnCopy) {
        modalBtnCopy.addEventListener('click', () => {
            const textToCopy = activeModalTab === 'email' 
                ? `Subject: ${modalEmailSubject.value}\n\n${modalEmailBody.value}` 
                : modalWaBody.value;
            navigator.clipboard.writeText(textToCopy).then(() => {
                alert("Notice text copied to clipboard!");
            });
        });
    }

    // Initial load on page ready
    loadGstr2bStatus();
    fetchReconciliationData();
});

