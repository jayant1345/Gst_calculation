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
});

