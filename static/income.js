/**
 * Income & Output GST Working Sheet Management
 * Naimish N. Shah & Co. - GST Compliance Portal
 */

document.addEventListener('DOMContentLoaded', () => {
    let currentClientId = sessionStorage.getItem('active_client_id') || 'nutan_nagrik';
    let currentBranch = 'ALL';
    let allIncomeEntries = [];
    let masterBranches = [];

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

                cardTotalRevenue.textContent = formatINR(inc.total_income);
                cardTaxableRevenue.textContent = formatINR(inc.taxable_income);
                cardExemptRevenue.textContent = formatINR(inc.exempt_income);
                cardOutputGst.textContent = formatINR(inc.total_output_gst);
                cardGstBreakup.textContent = `CGST: ${formatINR(inc.total_cgst)} | SGST: ${formatINR(inc.total_sgst)}`;
                cardRevenueCount.textContent = `${inc.total_entries || 0} statement records`;

                boxOutputGst.textContent = formatINR(inc.total_output_gst);
                boxEligibleItc.textContent = formatINR(itc ? itc.eligible_itc : 0);
                boxNetPayable.textContent = formatINR(netPayable);
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
                    <td colspan="8" style="text-align: center; padding: 36px; color: #94a3b8;">
                        <i class="fa-solid fa-folder-open" style="font-size: 28px; margin-bottom: 8px; display: block;"></i>
                        No income statement records match the selected branch or search filter.
                    </td>
                </tr>
            `;
            return;
        }

        incomeTableBody.innerHTML = filtered.map(e => `
            <tr style="border-bottom: 1px solid var(--border-color); font-size: 13px;">
                <td style="padding: 12px 16px; font-weight: 700; color: #1e3a8a;">${e.branch}</td>
                <td style="padding: 12px 16px; font-weight: 600; font-family: monospace; color: #0f172a;">${e.gl_code}</td>
                <td style="padding: 12px 16px; color: #334155;">${e.particulars || 'Bank Revenue'}</td>
                <td style="padding: 12px 16px; text-align: right; font-weight: 700; color: #0f172a;">${formatINR(e.income_amount)}</td>
                <td style="padding: 12px 16px; text-align: right; color: #64748b;">${formatINR(e.sgst)}</td>
                <td style="padding: 12px 16px; text-align: right; color: #64748b;">${formatINR(e.cgst)}</td>
                <td style="padding: 12px 16px; text-align: right; color: #64748b;">${formatINR(e.igst)}</td>
                <td style="padding: 12px 16px; text-align: center;">
                    ${e.is_taxable ? 
                        '<span style="display:inline-block; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 700; background: #dcfce7; color: #15803d;">18% Taxable</span>' : 
                        '<span style="display:inline-block; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 700; background: #f1f5f9; color: #475569;">Exempt</span>'}
                </td>
            </tr>
        `).join('');
    }

    searchIncomeInput.addEventListener('input', renderTableRows);
    filterTaxable.addEventListener('change', renderTableRows);

    // 5. Recursive Folder File Reader
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

    // 6. Drag & Drop Handlers
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

    // 7. Chunked Multi-File Upload to Prevent Timeout
    async function handleFileUpload(files) {
        if (!files || files.length === 0) return;

        uploadProgress.style.display = 'block';
        const totalFiles = files.length;
        let processedCount = 0;
        let totalSaved = 0;

        const CHUNK_SIZE = 30; // Upload in batches of 30 files
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
        alert(`Upload Complete!\nSuccessfully processed and saved ${totalSaved} income statement records across branches.`);
        loadIncomeData();
    }

    // 8. Export CA Working Sheet
    btnExportWorkingSheet.addEventListener('click', () => {
        window.location.href = `/api/export-income-working-sheet?client_id=${currentClientId}&financial_year=2026-27&month=July`;
    });

    // Initialize
    updateClientTabUI();
    loadIncomeData();
});
