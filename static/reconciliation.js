document.addEventListener('DOMContentLoaded', function() {
    // State variables
    let reconData = [];
    let activeFilter = 'all';

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
    const statusBtns = document.querySelectorAll('.filter-status-btn');
    const reconTableBody = document.getElementById('recon-table-body');
    const reconCardList = document.getElementById('recon-card-list');
    const reconCountText = document.getElementById('recon-count');
    
    // GSTR-2B Upload Elements
    const gstr2bFileInput = document.getElementById('gstr2b-file-input');
    const gstr2bDropZone = document.getElementById('gstr2b-drop-zone');
    const uploadMonthSelect = document.getElementById('upload-month');
    const uploadStatusDiv = document.getElementById('gstr2b-upload-status');

    // Trigger reconciliation on filter parameter change
    fySelect.addEventListener('change', fetchReconciliationData);
    monthChecks.forEach(cb => cb.addEventListener('change', fetchReconciliationData));
    reconSearch.addEventListener('input', applyFilters);

    // Annual Export Button
    const btnExportAnnual = document.getElementById('btn-export-annual');
    if (btnExportAnnual) {
        btnExportAnnual.addEventListener('click', function() {
            const fy = fySelect.value;
            window.location.href = `/api/export-annual-report?financial_year=${fy}`;
        });
    }

    // Filter Buttons
    statusBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            statusBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            activeFilter = this.getAttribute('data-status');
            applyFilters();
        });
    });

    // File Drag & Drop for GSTR-2B
    gstr2bDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        gstr2bDropZone.classList.add('dragover');
    });

    gstr2bDropZone.addEventListener('dragleave', () => {
        gstr2bDropZone.classList.remove('dragover');
    });

    gstr2bDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        gstr2bDropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleGstr2bUpload(e.dataTransfer.files[0]);
        }
    });

    gstr2bFileInput.addEventListener('change', function() {
        if (this.files.length > 0) {
            handleGstr2bUpload(this.files[0]);
        }
    });

    // Handle GSTR-2B Upload
    function handleGstr2bUpload(file) {
        const month = uploadMonthSelect.value;
        const fy = fySelect.value;

        if (!month) {
            showUploadStatus('Please select a GSTR-2B month first.', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('financial_year', fy);
        formData.append('month', month);

        showUploadStatus('Uploading and parsing GSTR-2B...', 'info');

        fetch('/api/upload-gstr2b', {
            method: 'POST',
            body: formData
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                showUploadStatus(`Success! Imported ${data.count} portal entries for ${month} (${fy}).`, 'success');
                // Check the checkbox for this month to trigger auto-reconcile
                const matchingCheckbox = Array.from(monthChecks).find(cb => cb.value === month);
                if (matchingCheckbox && !matchingCheckbox.checked) {
                    matchingCheckbox.checked = true;
                }
                fetchReconciliationData();
            } else {
                showUploadStatus(data.error || 'Failed to upload GSTR-2B file.', 'error');
            }
        })
        .catch(err => {
            showUploadStatus('Network error occurred during upload.', 'error');
            console.error(err);
        });
    }

    function showUploadStatus(msg, type) {
        uploadStatusDiv.style.display = 'block';
        uploadStatusDiv.innerText = msg;
        uploadStatusDiv.className = `upload-status-message ${type}`;
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
            updateKPIs(data.summary);
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

    // Apply Filter state and Search Query
    function applyFilters() {
        const searchQuery = reconSearch.value.toLowerCase().trim();
        
        const filtered = reconData.filter(item => {
            // 1. Status Filter
            if (activeFilter !== 'all' && item.status !== activeFilter) {
                return false;
            }
            
            // 2. Search Text Query (Fuzzy check supplier, gstin, or inv number)
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
            } else if (item.status === 'Missing in GSTR-2B' || item.status === 'Value Mismatched') {
                actionBtn = `<button class="btn-action-small notify" data-action="notify" title="Notify Vendor"><i class="fa-solid fa-envelope"></i></button>`;
            } else {
                actionBtn = `<button class="btn-action-small hold" data-action="hold" title="Hold"><i class="fa-solid fa-pause"></i></button>`;
            }

            tr.innerHTML = `
                <td>
                    <div class="supplier-info">
                        <strong>${escapeHtml(supplier)}</strong>
                        <span class="gstin-sub">${escapeHtml(gstin)}</span>
                    </div>
                </td>
                <td>${escapeHtml(bBranch)}</td>
                <td class="${item.status === 'Value Mismatched' ? 'value-diff' : ''}">${escapeHtml(bInv)}</td>
                <td>${escapeHtml(bDate)}</td>
                <td class="text-right ${item.status === 'Value Mismatched' ? 'value-diff' : ''}">${bGst}</td>

                <td class="${item.status === 'Value Mismatched' ? 'value-diff' : ''}">${escapeHtml(pInv)}</td>
                <td>${escapeHtml(pDate)}</td>
                <td class="text-right ${item.status === 'Value Mismatched' ? 'value-diff' : ''}">${pGst}</td>
                <td class="text-right">${pTaxable}</td>

                <td>${statusBadge}</td>
                <td><div class="action-btn-cell">${actionBtn}</div></td>
            `;

            const actionEl = tr.querySelector('[data-action]');
            if (actionEl) {
                actionEl.addEventListener('click', () => {
                    const kind = actionEl.dataset.action;
                    if (kind === 'approve') alert('ITC Approved!');
                    else if (kind === 'notify') alert(`Sending follow-up to vendor: ${supplier}`);
                    else alert('Put invoice on hold.');
                });
            }

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
            const actionHtml = isMatched
                ? `<button class="mobile-action-btn approve" data-action="approve"><i class="fa-solid fa-check"></i> Approve</button>`
                : `<button class="mobile-action-btn notify" data-action="notify"><i class="fa-solid fa-envelope"></i> Send Notice</button>`;

            card.innerHTML = `
                <div class="card-mobile-header">
                    <div class="mobile-supplier">
                        <h4>${escapeHtml(supplier)}</h4>
                        <span>${escapeHtml(gstin)}</span>
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

            const cardActionEl = card.querySelector('[data-action]');
            if (cardActionEl) {
                cardActionEl.addEventListener('click', () => {
                    if (cardActionEl.dataset.action === 'approve') alert('ITC Approved!');
                    else alert(`Notifying vendor: ${supplier}`);
                });
            }

            reconCardList.appendChild(card);
        });
    }

    function getStatusBadgeClass(status) {
        if (status === 'Matched') return 'badge-green';
        if (status === 'Value Mismatched') return 'badge-yellow';
        if (status === 'Missing in GSTR-2B') return 'badge-red';
        return 'badge-blue';
    }

    function renderEmptyLedger(msg) {
        const safeMsg = escapeHtml(msg);
        reconTableBody.innerHTML = `
            <tr class="empty-state-row">
                <td colspan="11">
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
});
