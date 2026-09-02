/**
 * Income & Output GST Working Sheet Management
 * Naimish N. Shah & Co. - GST Compliance Portal
 */

document.addEventListener('DOMContentLoaded', () => {
    let currentClientId = sessionStorage.getItem('active_client_id') || 'nutan_nagrik';
    let currentBranch = 'ALL';
    let allIncomeEntries = [];
    let masterBranches = [];
    let reviewOnlyFilter = false;
    const selectedIncomeIds = new Set();

    // Elements
    const clientTabs = document.querySelectorAll('.client-tab-btn[data-client-id]');
    const branchTabsBar = document.getElementById('branchTabsBar');
    const incomeTableBody = document.getElementById('incomeTableBody');
    const searchIncomeInput = document.getElementById('searchIncomeInput');
    const filterTaxable = document.getElementById('filterTaxable');
    const incomeDropZone = document.getElementById('incomeDropZone');
    const incomeFileInput = document.getElementById('incomeFileInput');
    const incomeFolderInput = document.getElementById('incomeFolderInput');
    const uploadProgress = document.getElementById('uploadIncomeProgress');
    const incomeProgressText = document.getElementById('incomeProgressText');
    const incomeProgressCount = document.getElementById('incomeProgressCount');
    const incomeProgressBarFill = document.getElementById('incomeProgressBarFill');
    const btnExportWorkingSheet = document.getElementById('btnExportWorkingSheet');
    const selectAllIncome = document.getElementById('selectAllIncome');
    const btnDeleteSelectedIncome = document.getElementById('btnDeleteSelectedIncome');
    const selectedIncomeCount = document.getElementById('selectedIncomeCount');

    // Needs-Review Banner & GL/PL Code Management (admin-only elements may be null)
    const incomeReviewBanner = document.getElementById('incomeReviewBanner');
    const incomeReviewBannerTitle = document.getElementById('incomeReviewBannerTitle');
    const btnFilterReview = document.getElementById('btnFilterReview');
    const btnManageCodes = document.getElementById('btnManageCodes');
    const codesModalOverlay = document.getElementById('codesModalOverlay');
    const codesModalClose = document.getElementById('codesModalClose');
    const codesModalCancel = document.getElementById('codesModalCancel');
    const codeInputCode = document.getElementById('codeInputCode');
    const codeInputParticulars = document.getElementById('codeInputParticulars');
    const codeInputTaxable = document.getElementById('codeInputTaxable');
    const codeInputRate = document.getElementById('codeInputRate');
    const codeInputCategory = document.getElementById('codeInputCategory');
    const codeRateHint = document.getElementById('codeRateHint');
    const codeFormMsg = document.getElementById('codeFormMsg');
    const codesTableBody = document.getElementById('codesTableBody');
    const btnSaveCode = document.getElementById('btnSaveCode');

    // KPI Card Elements
    const cardTotalRevenue = document.getElementById('card-total-revenue');
    const cardTaxableRevenue = document.getElementById('card-taxable-revenue');
    const cardExemptRevenue = document.getElementById('card-exempt-revenue');
    const cardOutputGst = document.getElementById('card-output-gst');
    const cardGstBreakup = document.getElementById('card-gst-breakup');
    const cardRevenueCount = document.getElementById('card-revenue-count');

    // GSTR-3B Tax Offset Elements
    const boxOutputGst = document.getElementById('box-output-gst');
    const boxEligibleItc = document.getElementById('box-eligible-itc');
    const boxNetPayable = document.getElementById('box-net-payable');
    const boxActualDeposit = document.getElementById('box-actual-deposit');
    const inputCashLedgerBalance = document.getElementById('inputCashLedgerBalance');
    const btnSaveCashLedger = document.getElementById('btnSaveCashLedger');
    const cashLedgerSavedNote = document.getElementById('cashLedgerSavedNote');
    let currentNetPayable = 0;

    function formatINR(val) {
        if (val === null || val === undefined || isNaN(val)) return '₹0.00';
        return '₹' + Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // 1. Initialize Client Tabs
    function updateClientTabUI() {
        clientTabs.forEach(btn => {
            const cid = btn.getAttribute('data-client-id');
            if (cid === currentClientId) {
                btn.classList.add('active');
                let badge = btn.querySelector('.badge-active-client, .badge-sub-client');
                if (badge) {
                    badge.className = 'badge-active-client';
                    badge.textContent = 'ACTIVE CLIENT';
                }
            } else {
                btn.classList.remove('active');
                let badge = btn.querySelector('.badge-active-client, .badge-sub-client');
                if (badge) {
                    badge.className = 'badge-sub-client';
                    badge.textContent = cid === 'sun_builders' ? 'CLIENT 2' : 'CLIENT';
                }
            }
        });
    }

    clientTabs.forEach(btn => {
        btn.addEventListener('click', () => {
            const cid = btn.getAttribute('data-client-id');
            if (cid && cid !== currentClientId) {
                currentClientId = cid;
                sessionStorage.setItem('active_client_id', cid);
                selectedIncomeIds.clear();
                updateBulkDeleteUI();
                updateClientTabUI();
                loadIncomeData();
            }
        });
    });

    // 2. Load Branch Pills
    function renderBranchPills(branches) {
        masterBranches = branches || [];
        branchTabsBar.innerHTML = '';
        
        const allBtn = document.createElement('button');
        allBtn.className = `branch-pill ${currentBranch === 'ALL' ? 'active' : ''}`;
        allBtn.setAttribute('data-branch', 'ALL');
        allBtn.textContent = 'All Branches';
        allBtn.addEventListener('click', () => {
            currentBranch = 'ALL';
            document.querySelectorAll('.branch-pill').forEach(p => p.classList.remove('active'));
            allBtn.classList.add('active');
            renderTableRows();
        });
        branchTabsBar.appendChild(allBtn);

        masterBranches.forEach(b => {
            const pill = document.createElement('button');
            pill.className = `branch-pill ${currentBranch === b ? 'active' : ''}`;
            pill.setAttribute('data-branch', b);
            pill.textContent = b;
            pill.addEventListener('click', () => {
                currentBranch = b;
                document.querySelectorAll('.branch-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                renderTableRows();
            });
            branchTabsBar.appendChild(pill);
        });
    }

    // 3. Load Income Summary & Table Entries
    async function loadIncomeData() {
        try {
            const sumRes = await fetch(`/api/income-summary?client_id=${currentClientId}`);
            const sumData = await sumRes.json();
            
            if (sumData && sumData.income) {
                const inc = sumData.income;
                const itc = sumData.itc;
                const netPayable = sumData.net_gst_payable;
                currentNetPayable = netPayable || 0;

                cardTotalRevenue.textContent = formatINR(inc.total_income);
                cardTaxableRevenue.textContent = formatINR(inc.taxable_income);
                cardExemptRevenue.textContent = formatINR(inc.exempt_income);
                cardOutputGst.textContent = formatINR(inc.total_output_gst);
                cardGstBreakup.textContent = `CGST: ${formatINR(inc.total_cgst)} | SGST: ${formatINR(inc.total_sgst)}`;
                cardRevenueCount.textContent = `${inc.total_entries || 0} statement records`;

                boxOutputGst.textContent = formatINR(inc.total_output_gst);
                boxEligibleItc.textContent = formatINR(itc ? itc.eligible_itc : 0);
                boxNetPayable.textContent = formatINR(netPayable);

                if (document.activeElement !== inputCashLedgerBalance) {
                    inputCashLedgerBalance.value = sumData.cash_ledger_balance
                        ? Number(sumData.cash_ledger_balance).toFixed(2) : '';
                }
                boxActualDeposit.textContent = formatINR(sumData.actual_cash_to_deposit);

                const reviewCount = inc.review_count || 0;
                if (reviewCount > 0) {
                    incomeReviewBannerTitle.textContent = `${reviewCount} ${reviewCount === 1 ? 'entry needs' : 'entries need'} manual review`;
                    incomeReviewBanner.style.display = 'flex';
                } else {
                    incomeReviewBanner.style.display = 'none';
                    reviewOnlyFilter = false;
                }
            }

            const entriesRes = await fetch(`/api/get-income-entries?client_id=${currentClientId}`);
            const entriesData = await entriesRes.json();
            
            allIncomeEntries = entriesData.entries || [];
            if (entriesData.branches && entriesData.branches.length > 0) {
                renderBranchPills(entriesData.branches);
            }
            renderTableRows();
        } catch (e) {
            console.error('Error loading income data:', e);
        }
    }

    // 4. Render Table Rows with Search & Filters
    function renderTableRows() {
        const query = (searchIncomeInput.value || '').trim().toLowerCase();
        const taxFilter = filterTaxable.value;

        let filtered = allIncomeEntries.filter(e => {
            if (currentBranch !== 'ALL' && e.branch.toUpperCase() !== currentBranch.toUpperCase()) {
                return false;
            }
            if (taxFilter === 'TAXABLE' && !e.is_taxable) return false;
            if (taxFilter === 'EXEMPT' && e.is_taxable) return false;
            if (reviewOnlyFilter && !e.needs_review) return false;

            if (query) {
                const matchCode = (e.gl_code || '').toLowerCase().includes(query);
                const matchPart = (e.particulars || '').toLowerCase().includes(query);
                const matchBranch = (e.branch || '').toLowerCase().includes(query);
                if (!matchCode && !matchPart && !matchBranch) return false;
            }
            return true;
        });

        if (filtered.length === 0) {
            incomeTableBody.innerHTML = `
                <tr>
                    <td colspan="11" style="text-align: center; padding: 36px; color: #94a3b8;">
                        <i class="fa-solid fa-folder-open" style="font-size: 28px; margin-bottom: 8px; display: block;"></i>
                        ${reviewOnlyFilter ? 'No entries currently need review.' : 'No income statement records match the selected branch or search filter.'}
                    </td>
                </tr>
            `;
            selectAllIncome.checked = false;
            return;
        }

        incomeTableBody.innerHTML = filtered.map(e => {
            const isChecked = selectedIncomeIds.has(e.id);
            const docBadge = e.has_file ? 
                `<a href="/api/income-file/${e.id}" target="_blank" style="display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 6px; background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; font-size: 11.5px; font-weight: 600; text-decoration: none; transition: all 0.2s ease;" title="View uploaded bank voucher / statement">
                    <i class="fa-solid fa-file-pdf"></i> View Voucher
                </a>` : 
                `<span style="color: #94a3b8; font-size: 12px; font-style: italic;">No file</span>`;

            return `
            <tr style="border-bottom: 1px solid var(--border-color); font-size: 13px; ${isChecked ? 'background-color: #f0f7ff;' : ''}">
                <td style="text-align: center; padding: 12px 10px;">
                    <input type="checkbox" class="income-row-check" data-id="${e.id}" ${isChecked ? 'checked' : ''} style="cursor: pointer; width: 16px; height: 16px;">
                </td>
                <td style="padding: 12px 14px; font-weight: 700; color: #1e3a8a;">${e.branch}</td>
                <td style="padding: 12px 14px; font-weight: 600; font-family: monospace; color: #0f172a;">${e.gl_code}</td>
                <td style="padding: 12px 14px; color: #334155;">${e.particulars || 'Bank Revenue'}</td>
                <td style="padding: 12px 14px; text-align: right; font-weight: 700; color: #0f172a;">${formatINR(e.income_amount)}</td>
                <td style="padding: 12px 14px; text-align: right; color: #64748b;">${formatINR(e.sgst)}</td>
                <td style="padding: 12px 14px; text-align: right; color: #64748b;">${formatINR(e.cgst)}</td>
                <td style="padding: 12px 14px; text-align: right; color: #64748b;">${formatINR(e.igst)}</td>
                <td style="padding: 12px 14px; text-align: center;">
                    ${e.is_taxable ?
                        '<span style="display:inline-block; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 700; background: #dcfce7; color: #15803d;">18% Taxable</span>' :
                        '<span style="display:inline-block; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 700; background: #f1f5f9; color: #475569;">Exempt</span>'}
                    ${e.needs_review ? `<button type="button" class="btn-review-flag" data-code="${e.gl_code}" title="${(e.review_reason || 'Needs manual review').replace(/"/g, '&quot;')}" style="display:block; margin: 6px auto 0; padding: 3px 8px; border-radius: 10px; font-size: 10px; font-weight: 700; background: #fef3c7; color: #92400e; border: 1px solid #fde68a; cursor: pointer;"><i class="fa-solid fa-triangle-exclamation"></i> Needs Review</button>` : ''}
                </td>
                <td style="padding: 12px 14px; text-align: center;">
                    ${docBadge}
                </td>
                <td style="padding: 12px 14px; text-align: center;">
                    <button type="button" class="btn-delete-single-income" data-id="${e.id}" data-desc="${e.branch} - ${e.gl_code}" style="background: none; border: none; color: #ef4444; cursor: pointer; padding: 4px 8px; font-size: 14px; border-radius: 6px;" title="Delete this income entry">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </td>
            </tr>
            `;
        }).join('');

        // Attach Checkbox Listeners
        document.querySelectorAll('.income-row-check').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const id = parseInt(e.target.getAttribute('data-id'));
                if (e.target.checked) {
                    selectedIncomeIds.add(id);
                } else {
                    selectedIncomeIds.delete(id);
                }
                updateBulkDeleteUI();
                renderTableRows();
            });
        });

        // Attach Review-Flag Listeners - clicking opens Manage Codes pre-filled
        // with this GL code (admin only; the modal doesn't exist for others)
        document.querySelectorAll('.btn-review-flag').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const code = btn.getAttribute('data-code');
                if (codesModalOverlay && window.openCodesModal) {
                    window.openCodesModal(code);
                } else {
                    alert(btn.getAttribute('title') || 'This entry needs manual review.');
                }
            });
        });

        // Attach Single Delete Listeners
        document.querySelectorAll('.btn-delete-single-income').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = parseInt(btn.getAttribute('data-id'));
                const desc = btn.getAttribute('data-desc');
                if (confirm(`Are you sure you want to delete income entry: ${desc}?`)) {
                    try {
                        const res = await fetch('/api/delete-income-entry', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: id })
                        });
                        const data = await res.json();
                        if (data.success) {
                            selectedIncomeIds.delete(id);
                            updateBulkDeleteUI();
                            loadIncomeData();
                        } else {
                            alert(data.error || 'Failed to delete entry');
                        }
                    } catch (err) {
                        console.error('Error deleting entry:', err);
                        alert('Network error while deleting entry');
                    }
                }
            });
        });

        // Update Select All Checkbox state
        const allFilteredIds = filtered.map(e => e.id);
        const allSelected = allFilteredIds.length > 0 && allFilteredIds.every(id => selectedIncomeIds.has(id));
        selectAllIncome.checked = allSelected;
    }

    // 5. Checkbox & Bulk Delete Management
    selectAllIncome.addEventListener('change', () => {
        const query = (searchIncomeInput.value || '').trim().toLowerCase();
        const taxFilter = filterTaxable.value;

        let filtered = allIncomeEntries.filter(e => {
            if (currentBranch !== 'ALL' && e.branch.toUpperCase() !== currentBranch.toUpperCase()) return false;
            if (taxFilter === 'TAXABLE' && !e.is_taxable) return false;
            if (taxFilter === 'EXEMPT' && e.is_taxable) return false;
            if (query) {
                const matchCode = (e.gl_code || '').toLowerCase().includes(query);
                const matchPart = (e.particulars || '').toLowerCase().includes(query);
                const matchBranch = (e.branch || '').toLowerCase().includes(query);
                if (!matchCode && !matchPart && !matchBranch) return false;
            }
            return true;
        });

        if (selectAllIncome.checked) {
            filtered.forEach(e => selectedIncomeIds.add(e.id));
        } else {
            filtered.forEach(e => selectedIncomeIds.delete(e.id));
        }
        updateBulkDeleteUI();
        renderTableRows();
    });

    function updateBulkDeleteUI() {
        const count = selectedIncomeIds.size;
        if (count > 0) {
            btnDeleteSelectedIncome.style.display = 'inline-flex';
            selectedIncomeCount.textContent = count;
        } else {
            btnDeleteSelectedIncome.style.display = 'none';
            selectedIncomeCount.textContent = '0';
        }
    }

    btnDeleteSelectedIncome.addEventListener('click', async () => {
        const count = selectedIncomeIds.size;
        if (count === 0) return;

        if (confirm(`Are you sure you want to PERMANENTLY DELETE ${count} selected income statement entries?`)) {
            try {
                const res = await fetch('/api/delete-income-batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: Array.from(selectedIncomeIds) })
                });
                const data = await res.json();
                if (data.success) {
                    alert(`Successfully deleted ${data.deleted_count} income entries.`);
                    selectedIncomeIds.clear();
                    updateBulkDeleteUI();
                    loadIncomeData();
                } else {
                    alert(data.error || 'Failed to delete entries');
                }
            } catch (err) {
                console.error('Error during bulk delete:', err);
                alert('Network error during bulk delete.');
            }
        }
    });

    searchIncomeInput.addEventListener('input', renderTableRows);
    filterTaxable.addEventListener('change', renderTableRows);

    btnFilterReview.addEventListener('click', () => {
        reviewOnlyFilter = !reviewOnlyFilter;
        btnFilterReview.textContent = reviewOnlyFilter ? 'Show all entries' : 'Show these entries';
        renderTableRows();
    });

    // 6. Recursive Folder File Reader
    const SUPPORTED_EXTS = ['pdf', 'xlsx', 'xls', 'csv', 'zip'];

    function isSupportedIncomeFile(file) {
        if (!file || !file.name) return false;
        if (file.name.startsWith('.') || file.name.startsWith('~$') || file.name.endsWith('.db')) return false;
        const ext = file.name.split('.').pop().toLowerCase();
        return SUPPORTED_EXTS.includes(ext);
    }

    async function getFilesFromDataTransfer(dataTransfer) {
        const files = [];
        const items = dataTransfer.items;

        if (items && items.length > 0 && items[0].webkitGetAsEntry) {
            const entries = [];
            for (let i = 0; i < items.length; i++) {
                const entry = items[i].webkitGetAsEntry();
                if (entry) entries.push(entry);
            }

            async function readEntry(entry, path = '') {
                if (entry.isFile) {
                    return new Promise((resolve) => {
                        entry.file((file) => {
                            const relPath = path ? `${path}/${file.name}` : file.name;
                            Object.defineProperty(file, 'webkitRelativePath', {
                                value: relPath,
                                writable: true
                            });
                            files.push(file);
                            resolve();
                        }, () => resolve());
                    });
                } else if (entry.isDirectory) {
                    const dirReader = entry.createReader();
                    const readBatch = async () => {
                        return new Promise((resolve) => {
                            dirReader.readEntries(async (subEntries) => {
                                if (!subEntries || subEntries.length === 0) {
                                    resolve();
                                } else {
                                    for (const subEntry of subEntries) {
                                        await readEntry(subEntry, path ? `${path}/${entry.name}` : entry.name);
                                    }
                                    await readBatch();
                                    resolve();
                                }
                            }, () => resolve());
                        });
                    };
                    await readBatch();
                }
            }

            for (const entry of entries) {
                await readEntry(entry);
            }
        } else if (dataTransfer.files && dataTransfer.files.length > 0) {
            for (let i = 0; i < dataTransfer.files.length; i++) {
                files.push(dataTransfer.files[i]);
            }
        }

        return files.filter(isSupportedIncomeFile);
    }

    // 7. Drag & Drop Handlers
    incomeDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        incomeDropZone.style.borderColor = '#2563eb';
        incomeDropZone.style.background = '#eff6ff';
    });

    incomeDropZone.addEventListener('dragleave', () => {
        incomeDropZone.style.borderColor = '#93c5fd';
        incomeDropZone.style.background = '#f8fafc';
    });

    incomeDropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        incomeDropZone.style.borderColor = '#93c5fd';
        incomeDropZone.style.background = '#f8fafc';
        const files = await getFilesFromDataTransfer(e.dataTransfer);
        if (files.length > 0) {
            handleFileUpload(files);
        } else {
            alert('No supported income files (PDF, XLSX, XLS, CSV, ZIP) were found in the dropped item.');
        }
    });

    incomeFileInput.addEventListener('change', () => {
        if (incomeFileInput.files && incomeFileInput.files.length > 0) {
            const files = Array.from(incomeFileInput.files).filter(isSupportedIncomeFile);
            if (files.length > 0) handleFileUpload(files);
        }
        incomeFileInput.value = '';
    });

    if (incomeFolderInput) {
        incomeFolderInput.addEventListener('change', () => {
            if (incomeFolderInput.files && incomeFolderInput.files.length > 0) {
                const files = Array.from(incomeFolderInput.files).filter(isSupportedIncomeFile);
                if (files.length > 0) {
                    handleFileUpload(files);
                } else {
                    alert('No supported income files (PDF, XLSX, XLS, CSV) were found in that folder.');
                }
            }
            incomeFolderInput.value = '';
        });
    }

    // 8. Chunked Multi-File Upload to Prevent Timeout
    async function handleFileUpload(files) {
        if (!files || files.length === 0) return;

        uploadProgress.style.display = 'block';
        const totalFiles = files.length;
        let processedCount = 0;
        let totalSaved = 0;
        let totalReview = 0;
        const unrecognizedFiles = new Set();
        const duplicateWarnings = [];

        const CHUNK_SIZE = 30;
        const chunks = [];
        for (let i = 0; i < files.length; i += CHUNK_SIZE) {
            chunks.push(files.slice(i, i + CHUNK_SIZE));
        }

        incomeProgressText.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Ingesting ${totalFiles} income files...`;
        incomeProgressCount.textContent = `0 / ${totalFiles}`;
        incomeProgressBarFill.style.width = '0%';

        for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
            const currentChunk = chunks[cIdx];
            const formData = new FormData();
            formData.append('client_id', currentClientId);
            
            currentChunk.forEach(file => {
                const uploadName = file.webkitRelativePath || file.name;
                formData.append('income_files', file, uploadName);
            });

            try {
                const res = await fetch('/api/upload-income', {
                    method: 'POST',
                    body: formData
                });
                const data = await res.json();
                if (data.success) {
                    totalSaved += data.saved_count || currentChunk.length;
                    totalReview += data.review_count || 0;
                    (data.unrecognized_branch_files || []).forEach(f => unrecognizedFiles.add(f));
                    (data.duplicate_warnings || []).forEach(w => duplicateWarnings.push(w));
                }
            } catch (err) {
                console.error('Error during chunk upload:', err);
            }

            processedCount += currentChunk.length;
            const pct = Math.min(100, Math.round((processedCount / totalFiles) * 100));
            incomeProgressCount.textContent = `${processedCount} / ${totalFiles}`;
            incomeProgressBarFill.style.width = `${pct}%`;
        }

        uploadProgress.style.display = 'none';

        let summary = `Upload Complete!\nSuccessfully processed and saved ${totalSaved} income statement records across branches.`;
        if (totalReview > 0) {
            summary += `\n\n⚠ ${totalReview} of them need manual review (new GL/PL code not yet classified, or a possible locker/guarantee reclass) - see the yellow banner on the page.`;
        }
        if (unrecognizedFiles.size > 0) {
            summary += `\n\n⚠ ${unrecognizedFiles.size} file(s) could NOT be matched to a branch and were skipped entirely - nothing from these was saved:\n` +
                Array.from(unrecognizedFiles).slice(0, 10).join('\n') +
                (unrecognizedFiles.size > 10 ? `\n...and ${unrecognizedFiles.size - 10} more` : '') +
                `\nRename the file to include the branch name and re-upload.`;
        }
        if (duplicateWarnings.length > 0) {
            summary += `\n\n⚠ ${duplicateWarnings.length} duplicate GL/PL code(s) were seen more than once in this upload for the same branch - only the first file for each was kept.`;
        }
        alert(summary);
        loadIncomeData();
    }

    // 9. Export CA Working Sheet
    btnExportWorkingSheet.addEventListener('click', () => {
        window.location.href = `/api/export-income-working-sheet?client_id=${currentClientId}&financial_year=2026-27&month=July`;
    });

    // 10. Cash Ledger Balance - manual credit adjustment
    // Live preview as the auditor types, before saving.
    inputCashLedgerBalance.addEventListener('input', () => {
        const typed = parseFloat(inputCashLedgerBalance.value);
        const balance = isNaN(typed) ? 0 : typed;
        const actual = Math.max(0, currentNetPayable - balance);
        boxActualDeposit.textContent = formatINR(actual);
        cashLedgerSavedNote.style.display = 'none';
    });

    btnSaveCashLedger.addEventListener('click', async () => {
        const typed = parseFloat(inputCashLedgerBalance.value);
        const balance = isNaN(typed) ? 0 : typed;
        if (balance < 0) {
            alert('Cash ledger balance cannot be negative.');
            return;
        }
        btnSaveCashLedger.disabled = true;
        btnSaveCashLedger.textContent = 'Saving…';
        try {
            const res = await fetch(`/api/cash-ledger-balance?client_id=${currentClientId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ balance })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Save failed');
            cashLedgerSavedNote.textContent = `Saved. Check the GST portal again before next month's filing — this figure doesn't update on its own.`;
            cashLedgerSavedNote.style.display = 'block';
            loadIncomeData();
        } catch (e) {
            alert('Could not save the cash ledger balance: ' + e.message);
        } finally {
            btnSaveCashLedger.disabled = false;
            btnSaveCashLedger.textContent = 'Save';
        }
    });

    // 11. Manage GL/PL Codes (admin-only - elements are absent for non-admins)
    if (btnManageCodes) {
        function escapeHtml(s) {
            return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        }

        function showCodeFormMsg(text, isError) {
            codeFormMsg.textContent = text;
            codeFormMsg.style.display = 'block';
            codeFormMsg.style.background = isError ? '#fef2f2' : '#f0fdf4';
            codeFormMsg.style.color = isError ? '#991b1b' : '#166534';
            codeFormMsg.style.border = `1px solid ${isError ? '#fca5a5' : '#bbf7d0'}`;
        }

        function resetCodeForm(prefillCode) {
            codeInputCode.value = prefillCode || '';
            codeInputParticulars.value = '';
            codeInputTaxable.value = 'true';
            codeInputRate.value = '18';
            codeInputRate.disabled = false;
            codeInputCategory.value = '';
            codeFormMsg.style.display = 'none';
        }

        async function loadCodesTable() {
            codesTableBody.innerHTML = `<tr><td colspan="4" style="padding:14px; text-align:center; color:#94a3b8;">Loading...</td></tr>`;
            try {
                const res = await fetch('/api/income-codes-master');
                const data = await res.json();
                const codes = (data.codes || []).slice().sort((a, b) => String(a.code).localeCompare(String(b.code)));
                if (codes.length === 0) {
                    codesTableBody.innerHTML = `<tr><td colspan="4" style="padding:14px; text-align:center; color:#94a3b8;">No codes in the catalog yet.</td></tr>`;
                    return;
                }
                codesTableBody.innerHTML = codes.map(c => `
                    <tr style="border-top: 1px solid var(--border-color);">
                        <td style="padding: 7px 10px; font-family: monospace; font-weight: 700;">${escapeHtml(c.code)}</td>
                        <td style="padding: 7px 10px;">${escapeHtml(c.particulars)}</td>
                        <td style="padding: 7px 10px;">${c.is_taxable ? (c.gst_rate + '%') : 'Exempt'}</td>
                        <td style="padding: 7px 10px; text-align: right;">
                            <button type="button" class="btn-edit-code" data-code="${escapeHtml(c.code)}" style="background:none; border:none; color:#2563eb; cursor:pointer; font-size:12px;">Edit</button>
                        </td>
                    </tr>
                `).join('');
                document.querySelectorAll('.btn-edit-code').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const c = codes.find(x => String(x.code) === btn.getAttribute('data-code'));
                        if (!c) return;
                        codeInputCode.value = c.code;
                        codeInputParticulars.value = c.particulars || '';
                        codeInputTaxable.value = c.is_taxable ? 'true' : 'false';
                        codeInputRate.value = c.gst_rate || 0;
                        codeInputRate.disabled = !c.is_taxable;
                        codeInputCategory.value = c.category || '';
                        codeFormMsg.style.display = 'none';
                        codeInputParticulars.focus();
                    });
                });
            } catch (e) {
                codesTableBody.innerHTML = `<tr><td colspan="4" style="padding:14px; text-align:center; color:#ef4444;">Failed to load codes.</td></tr>`;
            }
        }

        function openCodesModal(prefillCode) {
            resetCodeForm(prefillCode);
            codesModalOverlay.style.display = 'flex';
            loadCodesTable();
            if (prefillCode) {
                codeInputParticulars.focus();
            } else {
                codeInputCode.focus();
            }
        }
        window.openCodesModal = openCodesModal; // used by the row-level "Needs Review" buttons above

        function closeCodesModal() {
            codesModalOverlay.style.display = 'none';
        }

        btnManageCodes.addEventListener('click', () => openCodesModal());
        codesModalClose.addEventListener('click', closeCodesModal);
        codesModalCancel.addEventListener('click', closeCodesModal);
        codesModalOverlay.addEventListener('click', (e) => {
            if (e.target === codesModalOverlay) closeCodesModal();
        });

        codeInputTaxable.addEventListener('change', () => {
            const taxable = codeInputTaxable.value === 'true';
            codeInputRate.disabled = !taxable;
            codeRateHint.textContent = taxable ? '' : ' (locked at 0% for exempt)';
            if (!taxable) codeInputRate.value = '0';
            else if (codeInputRate.value === '0') codeInputRate.value = '18';
        });

        btnSaveCode.addEventListener('click', async () => {
            const code = codeInputCode.value.trim();
            const particulars = codeInputParticulars.value.trim();
            if (!code || !particulars) {
                showCodeFormMsg('GL/PL code and particulars are both required.', true);
                return;
            }
            const is_taxable = codeInputTaxable.value === 'true';
            const gst_rate = parseFloat(codeInputRate.value) || 0;
            const category = codeInputCategory.value.trim();

            btnSaveCode.disabled = true;
            btnSaveCode.textContent = 'Saving…';
            try {
                const res = await fetch('/api/income-codes-master', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code, particulars, is_taxable, gst_rate, category })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Save failed');
                let msg = `Saved code ${code}.`;
                if (data.entries_fixed > 0) {
                    msg += ` ${data.entries_fixed} already-uploaded entr${data.entries_fixed === 1 ? 'y' : 'ies'} using this code ${data.entries_fixed === 1 ? 'was' : 'were'} corrected.`;
                }
                showCodeFormMsg(msg, false);
                loadCodesTable();
                loadIncomeData();
            } catch (e) {
                showCodeFormMsg('Could not save: ' + e.message, true);
            } finally {
                btnSaveCode.disabled = false;
                btnSaveCode.textContent = 'Save Code';
            }
        });
    }

    // Initialize
    updateClientTabUI();
    loadIncomeData();
});
