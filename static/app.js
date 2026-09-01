document.addEventListener('DOMContentLoaded', () => {
    // State management
    let invoices = [];
    let currentAuditFilter = 'all';
    const columnFilters = {};
    let activeFilterPopup = null;
    
    // DOM Elements
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const cameraInput = document.getElementById('camera-input');
    const folderInput = document.getElementById('folder-input');
    const progressContainer = document.getElementById('progress-container');
    const progressHeading = document.getElementById('progress-heading');
    const progressList = document.getElementById('progress-list');
    const tableBody = document.getElementById('invoice-table-body');
    const searchInput = document.getElementById('table-search');
    const fyFilter = document.getElementById('fy-filter');
    const monthFilter = document.getElementById('month-filter');
    const invoiceCountText = document.getElementById('invoice-count');
    const branchInput = document.getElementById('branch-input');
    const stateInput = document.getElementById('state-input');
    
    // Metric & Top Period Elements
    const billingMetric = document.getElementById('metric-total-billing');
    const taxableMetric = document.getElementById('metric-total-taxable');
    const eligibleMetric = document.getElementById('metric-eligible-itc');
    const ineligibleMetric = document.getElementById('metric-ineligible-itc');
    const metricsPeriodLabel = document.getElementById('metrics-period-label');
    const btnResetPeriod = document.getElementById('btn-reset-period');
    
    // Button Elements
    const btnClearAll = document.getElementById('btn-clear-all');
    const btnExportExcel = document.getElementById('btn-export-excel');
    const btnAddManual = document.getElementById('btn-add-manual');
    const btnDeleteSelected = document.getElementById('btn-delete-selected');
    const deleteSelectedCountText = document.getElementById('delete-selected-count');
    const selectAllCheckbox = document.getElementById('select-all-invoices');

    // Delete Selected Modal Elements
    const deleteSelectedOverlay = document.getElementById('delete-selected-modal-overlay');
    const deleteSelectedCloseBtn = document.getElementById('delete-selected-modal-close');
    const deleteSelectedCancelBtn = document.getElementById('delete-selected-cancel-btn');
    const deleteSelectedConfirmBtn = document.getElementById('delete-selected-confirm-btn');
    const deleteSelectedWarningCount = document.getElementById('delete-selected-warning-count');
    const deleteSelectedBtnCount = document.getElementById('delete-selected-btn-count');
    const selectedInvoiceIds = new Set();

    // Manual Bill Modal Elements
    const manualBillOverlay = document.getElementById('manual-bill-overlay');
    const manualBillForm = document.getElementById('manual-bill-form');
    const manualBillClose = document.getElementById('manual-bill-close');
    const manualBillCancel = document.getElementById('manual-bill-cancel');
    const mbDirectFields = document.getElementById('mb-direct-fields');
    const mbAutoFields = document.getElementById('mb-auto-fields');
    const mbPreview = document.getElementById('mb-preview');
    const mbRate = document.getElementById('mb-rate');
    const mbCustomRateField = document.getElementById('mb-custom-rate-field');

    // High Accuracy Scan Elements
    const highAccuracyToggle = document.getElementById('high-accuracy-toggle');
    const haPasswordOverlay = document.getElementById('ha-password-overlay');
    const haPasswordForm = document.getElementById('ha-password-form');
    const haPasswordInput = document.getElementById('ha-password-input');
    const haPasswordError = document.getElementById('ha-password-error');
    const haPasswordClose = document.getElementById('ha-password-close');
    const haPasswordCancel = document.getElementById('ha-password-cancel');
    const haPasswordConfirmBtn = document.getElementById('ha-password-confirm');
    let pendingHighAccuracyFiles = null;
    let pendingHighAccuracyFolderGroups = null;
    let hideProgressTimeoutId = null;

    function loadInvoices() {
        fetch('/api/get-invoices')
            .then(response => {
                if (!response.ok) throw new Error('Failed to fetch invoices');
                return response.json();
            })
            .then(data => {
                if (data.invoices) {
                    invoices = data.invoices;
                    populateFilters();
                    calculateAuditCounts();
                    renderTable();
                    updateMetrics();
                    updateBranchSuggestions();
                }
            })
            .catch(error => {
                console.error('Error fetching invoices from database:', error);
            });
    }

    // Master Branches & Vendors Directory
    let masterBranches = [];
    let masterVendors = [];

    function loadMasterData() {
        fetch('/api/master-data')
            .then(res => res.json())
            .then(data => {
                if (data.branches) masterBranches = data.branches;
                if (data.vendors) masterVendors = data.vendors;
                initAutocompletes();
            })
            .catch(err => console.error("Error loading master data:", err));
    }
    loadMasterData();

    function getAllBranches() {
        const branchMap = new Map();
        masterBranches.forEach(b => {
            const cleanName = b.name.trim().toUpperCase();
            if (cleanName) branchMap.set(cleanName, b.state);
        });
        invoices.forEach(inv => {
            if (inv.branch && inv.branch !== 'Unassigned') {
                const cleanName = inv.branch.trim().toUpperCase();
                if (cleanName && !branchMap.has(cleanName)) {
                    branchMap.set(cleanName, inv.state || 'Gujarat');
                }
            }
        });
        return Array.from(branchMap.entries()).map(([name, state]) => ({ name, state }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    function initAutocompletes() {
        // 1. Main toolbar Branch input
        const mainBranchInput = document.getElementById('branch-input');
        const mainBranchDropdown = document.getElementById('branch-dropdown-list');
        if (mainBranchInput && mainBranchDropdown) {
            setupAutocomplete({
                inputEl: mainBranchInput,
                dropdownEl: mainBranchDropdown,
                getItems: (query) => {
                    let branches = getAllBranches();
                    const currentState = stateInput ? stateInput.value.trim() : '';
                    if (currentState) {
                        branches = branches.filter(b => b.state === currentState);
                    }
                    if (query) {
                        branches = branches.filter(b => b.name.toLowerCase().includes(query));
                    }
                    return branches.map(b => ({
                        text: b.name,
                        subtext: '',
                        badge: b.state,
                        badgeClass: b.state.toLowerCase()
                    }));
                },
                onSelect: (item) => {
                    if (stateInput) stateInput.value = item.badge;
                }
            });

            if (stateInput) {
                stateInput.addEventListener('change', () => {
                    const st = stateInput.value.trim();
                    if (st && mainBranchInput.value.trim()) {
                        const val = mainBranchInput.value.trim().toUpperCase();
                        const bObj = getAllBranches().find(b => b.name === val);
                        if (bObj && bObj.state !== st) {
                            mainBranchInput.value = '';
                        }
                    }
                });
            }
        }

        // 2. Manual Bill modal Branch input
        const mbBranchInput = document.getElementById('mb-branch');
        const mbBranchDropdown = document.getElementById('mb-branch-dropdown');
        const mbStateSelect = document.getElementById('mb-state');
        if (mbBranchInput && mbBranchDropdown) {
            setupAutocomplete({
                inputEl: mbBranchInput,
                dropdownEl: mbBranchDropdown,
                getItems: (query) => {
                    let branches = getAllBranches();
                    const currentMbState = mbStateSelect ? mbStateSelect.value.trim() : '';
                    if (currentMbState) {
                        branches = branches.filter(b => b.state === currentMbState);
                    }
                    if (query) {
                        branches = branches.filter(b => b.name.toLowerCase().includes(query));
                    }
                    return branches.map(b => ({
                        text: b.name,
                        subtext: '',
                        badge: b.state,
                        badgeClass: b.state.toLowerCase()
                    }));
                },
                onSelect: (item) => {
                    if (mbStateSelect) mbStateSelect.value = item.badge;
                }
            });

            if (mbStateSelect) {
                mbStateSelect.addEventListener('change', () => {
                    const st = mbStateSelect.value.trim();
                    if (st && mbBranchInput.value.trim()) {
                        const val = mbBranchInput.value.trim().toUpperCase();
                        const bObj = getAllBranches().find(b => b.name === val);
                        if (bObj && bObj.state !== st) {
                            mbBranchInput.value = '';
                        }
                    }
                });
            }
        }

        // 3. Manual Bill modal Party Name input
        const mbPartyInput = document.getElementById('mb-party');
        const mbPartyDropdown = document.getElementById('mb-party-dropdown');
        const mbGstinInput = document.getElementById('mb-gstin');
        if (mbPartyInput && mbPartyDropdown) {
            setupAutocomplete({
                inputEl: mbPartyInput,
                dropdownEl: mbPartyDropdown,
                getItems: (query) => {
                    if (!query) return masterVendors.slice(0, 15).map(v => ({
                        text: v.name,
                        subtext: `GST: ${v.gstin}`,
                        badge: 'Master Vendor',
                        badgeClass: 'gujarat',
                        data: v
                    }));
                    return masterVendors
                        .filter(v => v.name.toLowerCase().includes(query) || v.gstin.toLowerCase().includes(query))
                        .map(v => ({
                            text: v.name,
                            subtext: `GST: ${v.gstin}`,
                            badge: 'Master Vendor',
                            badgeClass: 'gujarat',
                            data: v
                        }));
                },
                onSelect: (item) => {
                    if (mbGstinInput && item.data && item.data.gstin) {
                        mbGstinInput.value = item.data.gstin;
                    }
                }
            });
        }
    }

    function setupAutocomplete({ inputEl, dropdownEl, getItems, onSelect }) {
        let activeIndex = -1;
        let currentItems = [];

        function render(query = '') {
            const q = query.trim().toLowerCase();
            currentItems = getItems(q);
            if (currentItems.length === 0) {
                dropdownEl.style.display = 'none';
                return;
            }

            activeIndex = -1;
            dropdownEl.innerHTML = currentItems.map((item, idx) => {
                let highlightedText = escapeHtml(item.text);
                if (q) {
                    const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
                    highlightedText = highlightedText.replace(regex, '<mark>$1</mark>');
                }
                const subHtml = item.subtext ? `<div class="autocomplete-sub">${escapeHtml(item.subtext)}</div>` : '';
                const badgeHtml = item.badge ? `<span class="autocomplete-badge ${item.badgeClass || ''}">${escapeHtml(item.badge)}</span>` : '';
                return `
                    <li class="autocomplete-item" data-index="${idx}">
                        <div>
                            <div class="autocomplete-main">${highlightedText}</div>
                            ${subHtml}
                        </div>
                        ${badgeHtml}
                    </li>
                `;
            }).join('');
            dropdownEl.style.display = 'block';
        }

        inputEl.addEventListener('input', () => {
            render(inputEl.value);
        });

        inputEl.addEventListener('focus', () => {
            render(inputEl.value);
        });

        dropdownEl.addEventListener('mousedown', (e) => {
            const itemEl = e.target.closest('.autocomplete-item');
            if (!itemEl) return;
            const idx = parseInt(itemEl.dataset.index, 10);
            if (currentItems[idx]) {
                selectItem(currentItems[idx]);
            }
        });

        inputEl.addEventListener('keydown', (e) => {
            if (dropdownEl.style.display !== 'block') {
                if (e.key === 'ArrowDown') {
                    render(inputEl.value);
                }
                return;
            }

            const items = dropdownEl.querySelectorAll('.autocomplete-item');
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                activeIndex = (activeIndex + 1) % items.length;
                updateActive(items);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                activeIndex = (activeIndex - 1 + items.length) % items.length;
                updateActive(items);
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                if (activeIndex >= 0 && currentItems[activeIndex]) {
                    e.preventDefault();
                    selectItem(currentItems[activeIndex]);
                }
            } else if (e.key === 'Escape') {
                dropdownEl.style.display = 'none';
            }
        });

        function updateActive(items) {
            items.forEach((it, idx) => {
                if (idx === activeIndex) {
                    it.classList.add('active');
                    it.scrollIntoView({ block: 'nearest' });
                } else {
                    it.classList.remove('active');
                }
            });
        }

        function selectItem(item) {
            inputEl.value = item.text;
            dropdownEl.style.display = 'none';
            if (onSelect) onSelect(item);
        }

        document.addEventListener('click', (e) => {
            if (!inputEl.contains(e.target) && !dropdownEl.contains(e.target)) {
                dropdownEl.style.display = 'none';
            }
        });
    }

    function updateBranchSuggestions() {
        initAutocompletes();
    }

    function updateVendorSuggestions() {
        initAutocompletes();
    }

    // Auto-fill State when Branch is entered on main upload strip
    if (branchInput && stateInput) {
        branchInput.addEventListener('input', () => {
            const val = branchInput.value.trim().toUpperCase();
            const mb = masterBranches.find(b => b.name.toUpperCase() === val);
            if (mb) {
                stateInput.value = mb.state;
            } else if (val.includes('ANDHERI') || val.includes('MAHARASHTRA') || val.includes('MAHARASTRA')) {
                stateInput.value = 'Maharashtra';
            } else if (val) {
                stateInput.value = 'Gujarat';
            }
        });
    }

    // Financial year runs April -> March; used to sort the month filter
    // dropdown in FY order rather than plain alphabetical/calendar order.
    const FY_MONTH_ORDER = ['April', 'May', 'June', 'July', 'August', 'September',
        'October', 'November', 'December', 'January', 'February', 'March'];

    // Rebuild the FY and Month filter dropdowns from whatever financial
    // years/months are actually present in the currently loaded invoices,
    // so they always reflect real data.
    function populateFilters() {
        const years = [...new Set(invoices.map(inv => inv.financial_year).filter(Boolean))]
            .sort((a, b) => b.localeCompare(a));

        const currentFy = fyFilter.value;
        fyFilter.innerHTML = '<option value="">All Years</option>' +
            years.map(fy => `<option value="${fy}">FY ${fy}</option>`).join('');
        if (years.includes(currentFy)) {
            fyFilter.value = currentFy;
        }

        const selectedFy = fyFilter.value;
        const months = [...new Set(
            invoices
                .filter(inv => !selectedFy || inv.financial_year === selectedFy)
                .map(inv => inv.month)
                .filter(Boolean)
        )].sort((a, b) => FY_MONTH_ORDER.indexOf(a) - FY_MONTH_ORDER.indexOf(b));

        const currentMonth = monthFilter.value;
        monthFilter.innerHTML = '<option value="">All Months</option>' +
            months.map(m => `<option value="${m}">${m}</option>`).join('');
        if (months.includes(currentMonth)) {
            monthFilter.value = currentMonth;
        }
    }

    function escapeHtml(text) {
        if (!text) return '';
        return String(text).replace(/[&<>"']/g, function(m) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
        });
    }

    // Setup drag and drop listeners
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('dragging');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('dragging');
        }, false);
    });

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

        return files.filter(isSupportedBillFile);
    }

    dropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('dragging');

        const files = await getFilesFromDataTransfer(e.dataTransfer);
        if (files.length > 0) {
            const hasBranchFolders = files.some(f => f.webkitRelativePath && f.webkitRelativePath.includes('/'));
            if (hasBranchFolders) {
                const groups = groupFilesByBranchFolder(files, '');
                triggerFolderUpload(groups);
            } else {
                triggerUpload(files);
            }
        } else {
            alert('No supported bill files (PDF, JPG, PNG, WEBP, XLSX, XLS, CSV, ZIP) were found.');
        }
    });

    dropZone.addEventListener('click', (e) => {
        if (e.target.closest('label')) return;
        fileInput.click();
    });

    // "Select Folder" -- webkitdirectory, so this always returns every file
    // found anywhere under the chosen folder (recursively). Filter down to
    // supported bill types before handing off, since a real-world folder
    // will often contain unrelated files (Thumbs.db, .DS_Store, etc.).
    fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files.length > 0) {
            const supportedFiles = Array.from(fileInput.files).filter(isSupportedBillFile);
            if (supportedFiles.length === 0) {
                alert('No supported bill files (PDF, JPG, PNG, WEBP, XLSX, XLS, CSV) were found in that folder.');
            } else {
                triggerUpload(supportedFiles);
            }
        }
        fileInput.value = '';
    });

    cameraInput.addEventListener('change', () => {
        if (cameraInput.files && cameraInput.files.length > 0) {
            triggerUpload(cameraInput.files);
        }
        cameraInput.value = '';
    });

    // Progress UI Elements
    const progressTimer = document.getElementById('progress-timer');
    const progressCounter = document.getElementById('progress-counter');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const uploadSummaryBanner = document.getElementById('upload-summary-banner');
    const summaryBannerText = document.getElementById('summary-banner-text');
    const dismissSummaryBtn = document.getElementById('dismiss-summary-btn');

    // Scanning Stopwatch / Live Timer
    let scanStartTime = null;
    let scanTimerIntervalId = null;

    function startScanTimer() {
        if (scanTimerIntervalId) {
            clearInterval(scanTimerIntervalId);
            scanTimerIntervalId = null;
        }
        scanStartTime = performance.now();
        if (progressTimer) {
            progressTimer.style.display = 'inline-flex';
            progressTimer.className = 'progress-timer-badge active';
            progressTimer.innerHTML = '<i class="fa-solid fa-stopwatch fa-spin"></i> 0.0s';
        }
        scanTimerIntervalId = setInterval(() => {
            if (!scanStartTime) return;
            const elapsed = ((performance.now() - scanStartTime) / 1000).toFixed(1);
            if (progressTimer) {
                progressTimer.innerHTML = `<i class="fa-solid fa-stopwatch fa-spin"></i> ${elapsed}s`;
            }
        }, 100);
    }

    function stopScanTimer() {
        if (scanTimerIntervalId) {
            clearInterval(scanTimerIntervalId);
            scanTimerIntervalId = null;
        }
        let elapsed = '0.0';
        if (scanStartTime) {
            elapsed = ((performance.now() - scanStartTime) / 1000).toFixed(2);
            scanStartTime = null;
        }
        if (progressTimer) {
            progressTimer.className = 'progress-timer-badge done';
            progressTimer.innerHTML = `<i class="fa-solid fa-bolt" style="color: #eab308;"></i> ${elapsed}s`;
        }
        return elapsed;
    }

    if (dismissSummaryBtn) {
        dismissSummaryBtn.addEventListener('click', () => {
            if (progressContainer) progressContainer.style.display = 'none';
            if (uploadSummaryBanner) uploadSummaryBanner.style.display = 'none';
        });
    }

    // Optional bulk path: pick one main folder containing a subfolder per
    // branch (e.g. Bills/Andheri/, Bills/Borivali/) and every subfolder is
    // scanned automatically, tagged with its own branch name.
    if (folderInput) {
        folderInput.addEventListener('change', () => {
            if (folderInput.files && folderInput.files.length > 0) {
                const files = Array.from(folderInput.files);

                // Some browser/Windows combinations don't honor webkitdirectory
                // and silently fall back to a plain multi-file picker instead
                // of a real folder walk (no file gets a "/" in its relative
                // path). Rather than silently dumping everything into
                // "Unassigned" and losing the point of the feature, ask once
                // for a branch name to apply to the whole selection -- keeps
                // this button useful as a "pick several files, tag them as
                // one branch" shortcut even where true folder-picking doesn't
                // work, while still doing a real per-subfolder split
                // automatically wherever the browser does support it.
                const hasRealFolderStructure = files.some(f => f.webkitRelativePath && f.webkitRelativePath.includes('/'));
                let fallbackBranch = '';
                if (!hasRealFolderStructure) {
                    const input = prompt(
                        `Your browser selected ${files.length} individual file(s) rather than a folder ` +
                        `(this can happen depending on your Chrome/Windows setup). ` +
                        `Enter one branch name to apply to all of them, or leave blank for "Unassigned":`
                    );
                    if (input === null) {
                        folderInput.value = '';
                        return;
                    }
                    fallbackBranch = input.trim();
                }

                const groups = groupFilesByBranchFolder(files, fallbackBranch);
                if (groups.size === 0) {
                    alert('No supported bill files (PDF, JPG, PNG, WEBP, XLSX, XLS, CSV) were found in that selection.');
                } else {
                    triggerFolderUpload(groups);
                }
            }
            folderInput.value = '';
        });
    }

    const SUPPORTED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'xlsx', 'xls', 'csv'];

    // Shared by both folder-based upload paths: ignores system/temp files
    // (Thumbs.db, .DS_Store, Office lock files) and anything not a
    // recognized bill format.
    function isSupportedBillFile(file) {
        if (file.name.startsWith('.') || file.name.startsWith('~$')) return false;
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        return SUPPORTED_EXTENSIONS.includes(ext);
    }

    // Groups a webkitdirectory FileList by its branch subfolder.
    // Supports direct branch folder selection ("Andheri/inv1.pdf" -> "Andheri")
    // as well as container folder selection ("Bills/Andheri/inv1.pdf" -> "Andheri").
    function groupFilesByBranchFolder(fileList, fallbackBranch) {
        const groups = new Map();
        Array.from(fileList).forEach(file => {
            if (!isSupportedBillFile(file)) return;

            const relPath = file.webkitRelativePath || '';
            const parts = relPath.split('/').filter(p => p.trim().length > 0);

            let branch;
            if (parts.length === 2) {
                // Direct branch folder: "Andheri/invoice1.pdf" -> "Andheri"
                branch = parts[0];
            } else if (parts.length > 2) {
                // Container folder: "Bills/Andheri/invoice1.pdf" -> "Andheri"
                // Or nested: "Bills/2024/Andheri/invoice1.pdf" -> "Andheri"
                branch = (parts[parts.length - 2] !== parts[0]) ? parts[parts.length - 2] : parts[1];
            } else {
                // No real folder structure for this file (plain multi-file
                // fallback) -- use the branch name gathered up front.
                branch = fallbackBranch || 'Unassigned';
            }

            branch = (branch || '').trim();
            if (!branch) branch = 'Unassigned';

            if (!groups.has(branch)) groups.set(branch, []);
            groups.get(branch).push(file);
        });
        return groups;
    }

    // Routes uploads through a password-confirm gate when High Accuracy Scan
    // is enabled (slower, forces a full AI vision pass on every field).
    function triggerUpload(files) {
        if (!files || files.length === 0) return;
        if (highAccuracyToggle && highAccuracyToggle.checked) {
            pendingHighAccuracyFiles = files;
            if (haPasswordInput) haPasswordInput.value = '';
            if (haPasswordError) haPasswordError.style.display = 'none';
            if (haPasswordOverlay) haPasswordOverlay.style.display = 'flex';
            if (haPasswordInput) haPasswordInput.focus();
        } else {
            handleFileUpload(files);
        }
    }

    function triggerFolderUpload(branchGroups) {
        if (highAccuracyToggle && highAccuracyToggle.checked) {
            pendingHighAccuracyFolderGroups = branchGroups;
            haPasswordInput.value = '';
            haPasswordError.style.display = 'none';
            haPasswordOverlay.style.display = 'flex';
            haPasswordInput.focus();
        } else {
            uploadFolderGroupsSequentially(branchGroups, {});
        }
    }

    // Global batch state for progress tracking
    let globalBatchState = {
        totalFiles: 0,
        processedFiles: 0,
        successFiles: 0,
        errorFiles: 0,
        itemIndexCounter: 0
    };

    function updateProgressBar() {
        if (globalBatchState.totalFiles > 0) {
            const percent = Math.min(100, Math.round((globalBatchState.processedFiles / globalBatchState.totalFiles) * 100));
            if (progressBarFill) progressBarFill.style.width = `${percent}%`;
            if (progressCounter) progressCounter.textContent = `${globalBatchState.processedFiles} / ${globalBatchState.totalFiles} files`;
        }
    }

    function uploadFolderGroupsSequentially(branchGroups, options) {
        const entries = Array.from(branchGroups.entries());
        const totalBranches = entries.length;
        let totalFiles = 0;
        entries.forEach(([_, files]) => { totalFiles += files.length; });

        // Reset progress UI for batch folder upload
        if (hideProgressTimeoutId) {
            clearTimeout(hideProgressTimeoutId);
            hideProgressTimeoutId = null;
        }
        progressContainer.style.display = 'block';
        if (uploadSummaryBanner) uploadSummaryBanner.style.display = 'none';
        progressList.innerHTML = '';
        
        globalBatchState = {
            totalFiles: totalFiles,
            processedFiles: 0,
            successFiles: 0,
            errorFiles: 0,
            duplicateFiles: 0,
            itemIndexCounter: 0
        };
        updateProgressBar();
        startScanTimer();

        if (progressHeading) {
            progressHeading.innerHTML = `<i class="fa-solid fa-folder-tree" style="color: var(--accent-blue);"></i> Uploading Branch Folder: ${totalBranches} Branch(es), ${totalFiles} File(s)...`;
        }

        let index = 0;
        function next() {
            if (index >= totalBranches) {
                // Complete! Show summary report banner with total elapsed time
                const elapsedSec = stopScanTimer();
                const avgPerBill = (parseFloat(elapsedSec) / Math.max(1, globalBatchState.processedFiles)).toFixed(2);
                if (progressHeading) {
                    progressHeading.innerHTML = `<i class="fa-solid fa-circle-check" style="color: var(--accent-green);"></i> Branch Folder Upload Complete • ${elapsedSec}s`;
                }
                if (uploadSummaryBanner && summaryBannerText) {
                    const errCount = globalBatchState.errorFiles;
                    const dupCount = globalBatchState.duplicateFiles || 0;
                    uploadSummaryBanner.className = errCount > 0 ? 'upload-summary-card error' : (globalBatchState.successFiles === 0 && dupCount > 0 ? 'upload-summary-card duplicate-warning' : 'upload-summary-card');
                    let summaryMsg = `<strong>Upload Finished:</strong> Processed ${globalBatchState.processedFiles} bill(s) across ${totalBranches} branch(es) in <strong>${elapsedSec}s</strong> (${avgPerBill}s/bill) &mdash; ${globalBatchState.successFiles} added`;
                    if (dupCount > 0) summaryMsg += `, <span style="color: #b45309; font-weight: 600;">${dupCount} duplicate(s) skipped</span>`;
                    if (errCount > 0) summaryMsg += `, <span style="color: #b91c1c; font-weight: 600;">${errCount} failed</span>`;
                    summaryMsg += '.';
                    summaryBannerText.innerHTML = summaryMsg;
                    uploadSummaryBanner.style.display = 'flex';
                }

                if (options.onSuccess) options.onSuccess();
                loadInvoices();
                return;
            }

            const [branch, files] = entries[index];
            index++;
            
            handleFileUpload(files, {
                ...options,
                branch: branch,
                appendProgress: true,
                skipTimerStart: true,
                onSuccess: next,
                onError: (err) => {
                    console.error(`Folder upload failed for branch "${branch}":`, err);
                    next();
                }
            });
        }
        next();
    }

    function closeHaPasswordModal() {
        haPasswordOverlay.style.display = 'none';
        pendingHighAccuracyFiles = null;
        pendingHighAccuracyFolderGroups = null;
    }

    haPasswordClose.addEventListener('click', closeHaPasswordModal);
    haPasswordCancel.addEventListener('click', closeHaPasswordModal);
    haPasswordOverlay.addEventListener('click', (e) => {
        if (e.target === haPasswordOverlay) closeHaPasswordModal();
    });

    haPasswordForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!pendingHighAccuracyFiles && !pendingHighAccuracyFolderGroups) return;

        const password = haPasswordInput.value;

        haPasswordError.style.display = 'none';
        haPasswordConfirmBtn.disabled = true;
        haPasswordConfirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying...';

        const onDone = () => {
            haPasswordConfirmBtn.disabled = false;
            haPasswordConfirmBtn.innerHTML = '<i class="fa-solid fa-check"></i> Confirm & Scan';
            closeHaPasswordModal();
        };
        const onFail = (err) => {
            haPasswordConfirmBtn.disabled = false;
            haPasswordConfirmBtn.innerHTML = '<i class="fa-solid fa-check"></i> Confirm & Scan';
            haPasswordError.textContent = err.message || 'Failed to verify password.';
            haPasswordError.style.display = 'block';
        };

        if (pendingHighAccuracyFolderGroups) {
            const groups = pendingHighAccuracyFolderGroups;
            pendingHighAccuracyFolderGroups = null;
            uploadFolderGroupsSequentially(groups, { highAccuracy: true, password, onSuccess: onDone, onError: onFail });
        } else {
            const filesToUpload = pendingHighAccuracyFiles;
            handleFileUpload(filesToUpload, { highAccuracy: true, password, onSuccess: onDone, onError: onFail });
        }
    });

    // File Upload handling with real-time progress updates, live timer & duplicate protection
    function handleFileUpload(files, options = {}) {
        if (hideProgressTimeoutId) {
            clearTimeout(hideProgressTimeoutId);
            hideProgressTimeoutId = null;
        }

        if (!options.appendProgress) {
            progressContainer.style.display = 'block';
            if (uploadSummaryBanner) uploadSummaryBanner.style.display = 'none';
            progressList.innerHTML = '';
            globalBatchState = {
                totalFiles: files.length,
                processedFiles: 0,
                successFiles: 0,
                errorFiles: 0,
                duplicateFiles: 0,
                itemIndexCounter: 0
            };
            updateProgressBar();
            if (!options.skipTimerStart) {
                startScanTimer();
            }
            if (progressHeading) {
                progressHeading.innerHTML = `<i class="fa-solid fa-spinner fa-spin" style="color: var(--accent-blue);"></i> Processing ${files.length} File(s)...`;
            }
        }

        const formData = new FormData();
        const activeBranch = options.branch !== undefined ? options.branch : (branchInput ? branchInput.value.trim() : '');
        formData.append('branch', activeBranch);
        const activeState = options.state !== undefined ? options.state : (stateInput ? stateInput.value.trim() : '');
        formData.append('state', activeState);
        if (options.highAccuracy) {
            formData.append('high_accuracy', 'true');
            formData.append('confirm_password', options.password || '');
        }

        const statusLabel = options.highAccuracy
            ? 'High accuracy scanning...'
            : 'Extracting & saving...';

        const itemIds = [];
        Array.from(files).forEach((file) => {
            const uploadName = file.webkitRelativePath || file.name;
            formData.append('files[]', file, uploadName);
            const itemId = `upload-item-${globalBatchState.itemIndexCounter++}`;
            itemIds.push(itemId);

            const branchBadgeHtml = activeBranch ? `<span class="badge-branch"><i class="fa-solid fa-code-branch"></i> ${activeBranch}</span>` : '';

            const progressItem = document.createElement('div');
            progressItem.className = 'progress-item';
            progressItem.id = itemId;
            progressItem.innerHTML = `
                <div class="progress-file-info">
                    <i class="fa-solid fa-file-invoice"></i>
                    ${branchBadgeHtml}
                    <span class="progress-filename">${file.name}</span>
                </div>
                <span class="progress-status" id="status-${itemId}">
                    <i class="fa-solid fa-spinner fa-spin"></i> ${statusLabel}
                </span>
            `;
            progressList.appendChild(progressItem);
        });

        // Send to Flask backend
        fetch('/api/process-invoices', {
            method: 'POST',
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                return response.json().catch(() => ({})).then(errData => {
                    throw new Error(errData.error || 'Failed to process documents');
                });
            }
            return response.json();
        })
        .then(data => {
            let newlyAddedCount = 0;
            let duplicateCount = 0;
            let failedCount = 0;

            // Map returned invoices by root filename and exact filename
            const fileInvoicesMap = new Map();
            (data.invoices || []).forEach(inv => {
                const fname = (inv.filename || '').trim();
                const rootName = fname.replace(/\s*\(Page\s*\d+\)\s*$/i, '').trim();
                if (!fileInvoicesMap.has(rootName)) fileInvoicesMap.set(rootName, []);
                fileInvoicesMap.get(rootName).push(inv);
                if (fname !== rootName) {
                    if (!fileInvoicesMap.has(fname)) fileInvoicesMap.set(fname, []);
                    fileInvoicesMap.get(fname).push(inv);
                }
            });

            Array.from(files).forEach((file, idx) => {
                const itemId = itemIds[idx];
                const statusSpan = itemId ? document.getElementById(`status-${itemId}`) : null;
                if (!statusSpan) return;

                const uploadName = file.webkitRelativePath || file.name;
                const invs = fileInvoicesMap.get(file.name) || fileInvoicesMap.get(uploadName) || [];

                if (invs.length > 1) {
                    // Multi-bill file (e.g. multi-page PDF or Excel register)
                    const fileAdded = invs.filter(i => !i.is_duplicate && i.id !== null).length;
                    const fileDups = invs.filter(i => i.is_duplicate).length;
                    const fileFails = invs.filter(i => !i.is_duplicate && i.id === null).length;

                    newlyAddedCount += fileAdded;
                    duplicateCount += fileDups;
                    failedCount += fileFails;

                    if (fileAdded > 0 && fileDups === 0) {
                        statusSpan.className = 'progress-status success';
                        statusSpan.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${fileAdded} bills extracted`;
                    } else if (fileAdded > 0 && fileDups > 0) {
                        statusSpan.className = 'progress-status success';
                        statusSpan.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${fileAdded} added (${fileDups} dup)`;
                    } else if (fileDups > 0 && fileAdded === 0) {
                        statusSpan.className = 'progress-status duplicate';
                        statusSpan.innerHTML = `<i class="fa-solid fa-clone"></i> All ${fileDups} bills duplicate`;
                    } else {
                        statusSpan.className = 'progress-status error';
                        statusSpan.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> ${fileFails} failed`;
                    }
                } else if (invs.length === 1) {
                    const inv = invs[0];
                    if (inv.is_duplicate) {
                        duplicateCount++;
                        statusSpan.className = 'progress-status duplicate';
                        statusSpan.innerHTML = '<i class="fa-solid fa-clone"></i> Duplicate Skipped';
                        statusSpan.title = inv.message || 'Duplicate invoice already recorded';
                    } else if (inv.id !== null) {
                        newlyAddedCount++;
                        statusSpan.className = 'progress-status success';
                        statusSpan.innerHTML = '<i class="fa-solid fa-circle-check"></i> 1 bill processed';
                    } else {
                        failedCount++;
                        statusSpan.className = 'progress-status error';
                        statusSpan.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> Failed (${inv.message || 'Error'})`;
                    }
                } else {
                    newlyAddedCount++;
                    statusSpan.className = 'progress-status success';
                    statusSpan.innerHTML = '<i class="fa-solid fa-circle-check"></i> Processed';
                }
            });

            const totalBillsExtracted = (data.invoices || []).length;
            globalBatchState.processedFiles += files.length;
            globalBatchState.successFiles += newlyAddedCount;
            globalBatchState.errorFiles += failedCount;
            globalBatchState.duplicateFiles = (globalBatchState.duplicateFiles || 0) + duplicateCount;
            updateProgressBar();

            // Add newly saved invoices to state & re-sync from PostgreSQL database
            loadInvoices();

            if (data.invoices && data.invoices.length > 0) {
                // Reflect which AI model actually handled the scan
                const modelUsed = [...data.invoices].reverse().map(inv => inv.ai_model_used).find(Boolean);
                if (modelUsed) updateApiModelBadge(modelUsed);
            }

            if (!options.appendProgress) {
                const elapsedSec = stopScanTimer();
                const avgPerBill = (parseFloat(elapsedSec) / Math.max(1, totalBillsExtracted || files.length)).toFixed(2);
                if (progressHeading) {
                    progressHeading.innerHTML = `<i class="fa-solid fa-circle-check" style="color: var(--accent-green);"></i> Upload Complete • ${elapsedSec}s`;
                }
                if (uploadSummaryBanner && summaryBannerText) {
                    const billsText = totalBillsExtracted > files.length ? ` &bull; <strong>${totalBillsExtracted} bill(s) extracted</strong>` : '';
                    if (newlyAddedCount > 0 && duplicateCount === 0 && failedCount === 0) {
                        summaryBannerText.innerHTML = `<strong><i class="fa-solid fa-circle-check"></i> Upload Successful:</strong> Processed ${files.length} file(s)${billsText} in <strong>${elapsedSec}s</strong> (${avgPerBill}s/bill).`;
                        uploadSummaryBanner.className = 'upload-summary-card';
                    } else if (newlyAddedCount === 0 && duplicateCount > 0) {
                        summaryBannerText.innerHTML = `<strong><i class="fa-solid fa-clone"></i> Duplicates Skipped:</strong> All ${duplicateCount} bill(s) from ${files.length} file(s) already exist in your records.`;
                        uploadSummaryBanner.className = 'upload-summary-card duplicate-warning';
                    } else {
                        let summaryMsg = `<strong>Upload Finished:</strong> Processed ${files.length} file(s)${billsText} in <strong>${elapsedSec}s</strong> (${avgPerBill}s/bill) &mdash; ${newlyAddedCount} added`;
                        if (duplicateCount > 0) summaryMsg += `, <span style="color: #b45309; font-weight: 600;">${duplicateCount} duplicate(s) skipped</span>`;
                        if (failedCount > 0) summaryMsg += `, <span style="color: #b91c1c; font-weight: 600;">${failedCount} failed</span>`;
                        summaryMsg += '.';
                        summaryBannerText.innerHTML = summaryMsg;
                        uploadSummaryBanner.className = failedCount > 0 ? 'upload-summary-card error' : 'upload-summary-card';
                    }
                    uploadSummaryBanner.style.display = 'flex';
                }
            }

            if (options.onSuccess) options.onSuccess();
        })
        .catch(error => {
            console.error('Error uploading invoices:', error);
            if (!options.appendProgress) {
                stopScanTimer();
            }
            itemIds.forEach(itemId => {
                const statusSpan = document.getElementById(`status-${itemId}`);
                if (statusSpan) {
                    statusSpan.className = 'progress-status error';
                    statusSpan.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> Failed (${error.message || 'Error'})`;
                }
            });

            globalBatchState.processedFiles += files.length;
            globalBatchState.errorFiles += files.length;
            updateProgressBar();

            if (options.onError) options.onError(error);
        });
    }

    // Friendly labels for the raw model ids the backend reports via
    // ai_model_used, so the sidebar badge reads clearly instead of showing
    // an internal id like "x-ai/grok-4.6" or "claude-opus-5" verbatim.
    const API_MODEL_DISPLAY_NAMES = {
        'google/gemini-2.5-flash': 'Gemini 2.5 Flash (Ultra-Fast)',
        'claude-sonnet-4-6': 'Claude Sonnet 4.6',
        'x-ai/grok-4.6': 'Grok 4.6 (OpenRouter)',
        'claude-opus-5': 'Claude Opus 5 (Fallback)'
    };

    function updateApiModelBadge(modelId) {
        const badge = document.getElementById('api-model-badge');
        if (!badge || !modelId) return;
        badge.textContent = API_MODEL_DISPLAY_NAMES[modelId] || modelId;
    }

    function isFieldBlank(val) {
        if (val === null || val === undefined) return true;
        const str = String(val).trim().toUpperCase();
        return str === '' || str === 'N/A' || str === '-' || str === 'NULL' || str === 'NONE' || str === 'UNASSIGNED' || str === 'ERROR';
    }

    function calculateAuditCounts() {
        const fyValue = fyFilter ? fyFilter.value.trim() : '';
        const monthValue = monthFilter ? monthFilter.value.trim().toLowerCase() : '';

        // Filter invoices by the selected FY and Month period
        const periodInvoices = invoices.filter(inv => {
            const matchesFy = !fyValue || String(inv.financial_year || '').trim() === fyValue;
            const matchesMonth = !monthValue || String(inv.month || '').trim().toLowerCase() === monthValue;
            return matchesFy && matchesMonth;
        });

        let countIncomplete = 0;
        let countGstin = 0;
        let countInv = 0;
        let countBranch = 0;
        let countPayment = 0;
        let countDate = 0;
        let countTax = 0;

        periodInvoices.forEach(inv => {
            const missingGstin = isFieldBlank(inv.gstin) || String(inv.gstin).trim().length !== 15;
            const missingInv = isFieldBlank(inv.invoice_number);
            const missingBranch = isFieldBlank(inv.branch) || isFieldBlank(inv.state);
            const missingPayment = isFieldBlank(inv.payment_date);
            const missingDate = isFieldBlank(inv.invoice_date);
            const zeroTax = (!inv.taxable_value || inv.taxable_value <= 0) && (!inv.cgst && !inv.sgst && !inv.igst);

            if (missingGstin) countGstin++;
            if (missingInv) countInv++;
            if (missingBranch) countBranch++;
            if (missingPayment) countPayment++;
            if (missingDate) countDate++;
            if (zeroTax) countTax++;

            if (missingGstin || missingInv || missingBranch || missingPayment || missingDate || zeroTax) {
                countIncomplete++;
            }
        });

        const pillAll = document.getElementById('count-pill-all');
        const pillIncomplete = document.getElementById('count-pill-incomplete');
        const pillGstin = document.getElementById('count-pill-gstin');
        const pillInv = document.getElementById('count-pill-inv');
        const pillBranch = document.getElementById('count-pill-branch');
        const pillPayment = document.getElementById('count-pill-payment');
        const pillDate = document.getElementById('count-pill-date');
        const pillTax = document.getElementById('count-pill-tax');

        if (pillAll) pillAll.textContent = periodInvoices.length;
        if (pillIncomplete) pillIncomplete.textContent = countIncomplete;
        if (pillGstin) pillGstin.textContent = countGstin;
        if (pillInv) pillInv.textContent = countInv;
        if (pillBranch) pillBranch.textContent = countBranch;
        if (pillPayment) pillPayment.textContent = countPayment;
        if (pillDate) pillDate.textContent = countDate;
        if (pillTax) pillTax.textContent = countTax;

        const rescanIncompleteCount = document.getElementById('rescan-incomplete-count');
        if (rescanIncompleteCount) rescanIncompleteCount.textContent = countIncomplete;
        const btnRescanIncomplete = document.getElementById('btn-rescan-incomplete');
        if (btnRescanIncomplete) {
            btnRescanIncomplete.disabled = (countIncomplete === 0);
            if (countIncomplete === 0) {
                btnRescanIncomplete.style.opacity = '0.6';
            } else {
                btnRescanIncomplete.style.opacity = '1';
            }
        }
    }

    function setupAuditPills() {
        const ribbon = document.getElementById('audit-filter-ribbon');
        if (!ribbon) return;
        const pills = ribbon.querySelectorAll('.audit-pill');
        pills.forEach(pill => {
            pill.addEventListener('click', () => {
                pills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                currentAuditFilter = pill.dataset.auditFilter || 'all';
                renderTable();
            });
        });
    }

    // Active Column Header Filter Dropdown Popup
    function closeColumnFilterPopup() {
        if (activeFilterPopup) {
            activeFilterPopup.remove();
            activeFilterPopup = null;
        }
    }

    document.addEventListener('click', (e) => {
        if (activeFilterPopup && !e.target.closest('.col-filter-popup') && !e.target.closest('.col-filter-trigger')) {
            closeColumnFilterPopup();
        }
    });

    function openColumnFilter(colKey, triggerBtn) {
        if (activeFilterPopup && activeFilterPopup.dataset.col === colKey) {
            closeColumnFilterPopup();
            return;
        }
        closeColumnFilterPopup();

        const popup = document.createElement('div');
        popup.className = 'col-filter-popup show';
        popup.dataset.col = colKey;

        const fyValue = fyFilter ? fyFilter.value.trim() : '';
        const monthValue = monthFilter ? monthFilter.value.trim().toLowerCase() : '';
        const periodInvoices = invoices.filter(inv => {
            const matchesFy = !fyValue || String(inv.financial_year || '').trim() === fyValue;
            const matchesMonth = !monthValue || String(inv.month || '').trim().toLowerCase() === monthValue;
            return matchesFy && matchesMonth;
        });

        // Collect unique values and counts within active period
        const valueCounts = new Map();
        let blankCount = 0;
        let nonBlankCount = 0;

        periodInvoices.forEach(inv => {
            const rawVal = inv[colKey];
            if (isFieldBlank(rawVal)) {
                blankCount++;
            } else {
                nonBlankCount++;
                const str = String(rawVal).trim();
                valueCounts.set(str, (valueCounts.get(str) || 0) + 1);
            }
        });

        const currentVal = columnFilters[colKey] || '__ALL__';

        popup.innerHTML = `
            <input type="text" class="col-filter-search" placeholder="Search values...">
            <ul class="col-filter-options">
                <li class="col-filter-option" data-val="__ALL__">
                    <input type="radio" name="col_val" ${currentVal === '__ALL__' ? 'checked' : ''}>
                    <span><strong>(All)</strong> (${periodInvoices.length})</span>
                </li>
                <li class="col-filter-option" data-val="__BLANKS__" style="color: #b45309; font-weight: 600;">
                    <input type="radio" name="col_val" ${currentVal === '__BLANKS__' ? 'checked' : ''}>
                    <span><i class="fa-solid fa-triangle-exclamation" style="color: #f59e0b;"></i> (Blanks / Missing Only) (${blankCount})</span>
                </li>
                <li class="col-filter-option" data-val="__NON_BLANKS__">
                    <input type="radio" name="col_val" ${currentVal === '__NON_BLANKS__' ? 'checked' : ''}>
                    <span>(Filled / Valid Only) (${nonBlankCount})</span>
                </li>
                ${Array.from(valueCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 35).map(([val, cnt]) => `
                    <li class="col-filter-option" data-val="${val}">
                        <input type="radio" name="col_val" ${currentVal.toLowerCase() === val.toLowerCase() ? 'checked' : ''}>
                        <span>${val} (${cnt})</span>
                    </li>
                `).join('')}
            </ul>
            <div class="col-filter-actions">
                <button type="button" class="col-filter-clear"><i class="fa-solid fa-rotate-left"></i> Reset</button>
                <button type="button" class="btn btn-primary btn-sm" style="padding: 2px 8px; font-size: 11px;">Close</button>
            </div>
        `;

        const searchInputEl = popup.querySelector('.col-filter-search');
        const optionsList = popup.querySelector('.col-filter-options');
        searchInputEl.addEventListener('input', () => {
            const sq = searchInputEl.value.toLowerCase().trim();
            optionsList.querySelectorAll('li').forEach(li => {
                const text = li.textContent.toLowerCase();
                li.style.display = (!sq || text.includes(sq)) ? 'flex' : 'none';
            });
        });

        optionsList.querySelectorAll('.col-filter-option').forEach(li => {
            li.addEventListener('click', (e) => {
                const chosen = li.dataset.val;
                if (chosen === '__ALL__') {
                    delete columnFilters[colKey];
                    triggerBtn.classList.remove('active');
                } else {
                    columnFilters[colKey] = chosen;
                    triggerBtn.classList.add('active');
                }
                closeColumnFilterPopup();
                renderTable();
            });
        });

        popup.querySelector('.col-filter-clear').addEventListener('click', () => {
            delete columnFilters[colKey];
            triggerBtn.classList.remove('active');
            closeColumnFilterPopup();
            renderTable();
        });

        popup.querySelector('.btn-primary').addEventListener('click', () => {
            closeColumnFilterPopup();
        });

        const th = triggerBtn.closest('th');
        th.style.position = 'relative';
        th.appendChild(popup);
        activeFilterPopup = popup;
        setTimeout(() => searchInputEl.focus(), 50);
    }

    function setupColumnFilterTriggers() {
        document.querySelectorAll('.col-filter-trigger').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const colKey = btn.dataset.col;
                openColumnFilter(colKey, btn);
            });
        });
    }

    // Shared by the table render and the Excel export, so "export" always
    // means "export exactly what's currently shown", not everything ever
    // uploaded.
    function getFilteredInvoices() {
        const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
        const fyValue = fyFilter ? fyFilter.value.trim() : '';
        const monthValue = monthFilter ? monthFilter.value.trim().toLowerCase() : '';

        return invoices.filter(inv => {
            // 1. Text Search across vendor, invoice number, GSTIN, branch, state
            if (query) {
                const matchesSearch = (
                    (inv.vendor_name || '').toLowerCase().includes(query) ||
                    (inv.invoice_number || '').toLowerCase().includes(query) ||
                    (inv.gstin || '').toLowerCase().includes(query) ||
                    (inv.branch || '').toLowerCase().includes(query) ||
                    (inv.state || '').toLowerCase().includes(query)
                );
                if (!matchesSearch) return false;
            }

            // 2. Financial Year & Month Filters
            if (fyValue && String(inv.financial_year || '').trim() !== fyValue) return false;
            if (monthValue && String(inv.month || '').trim().toLowerCase() !== monthValue) return false;

            // 3. Quick Audit Rectification filter
            const missingGstin = isFieldBlank(inv.gstin) || String(inv.gstin).trim().length !== 15;
            const missingInv = isFieldBlank(inv.invoice_number);
            const missingBranch = isFieldBlank(inv.branch) || isFieldBlank(inv.state);
            const missingPayment = isFieldBlank(inv.payment_date);
            const missingDate = isFieldBlank(inv.invoice_date);
            const zeroTax = (!inv.taxable_value || inv.taxable_value <= 0) && (!inv.cgst && !inv.sgst && !inv.igst);

            if (currentAuditFilter === 'missing-all') {
                if (!(missingGstin || missingInv || missingBranch || missingPayment || missingDate || zeroTax)) return false;
            } else if (currentAuditFilter === 'missing-gstin') {
                if (!missingGstin) return false;
            } else if (currentAuditFilter === 'missing-inv') {
                if (!missingInv) return false;
            } else if (currentAuditFilter === 'missing-branch') {
                if (!missingBranch) return false;
            } else if (currentAuditFilter === 'missing-payment') {
                if (!missingPayment) return false;
            } else if (currentAuditFilter === 'missing-date') {
                if (!missingDate) return false;
            } else if (currentAuditFilter === 'zero-tax') {
                if (!zeroTax) return false;
            }

            // 4. Column Header Filters
            for (const [col, filterVal] of Object.entries(columnFilters)) {
                if (!filterVal || filterVal === '__ALL__') continue;
                const cellVal = inv[col];
                const isBlank = isFieldBlank(cellVal);

                if (filterVal === '__BLANKS__') {
                    if (!isBlank) return false;
                } else if (filterVal === '__NON_BLANKS__') {
                    if (isBlank) return false;
                } else if (typeof filterVal === 'string') {
                    if (String(cellVal || '').trim().toLowerCase() !== filterVal.toLowerCase()) return false;
                }
            }

            return true;
        });
    }

    // Update Delete Selected button & master Select All checkbox states
    function updateDeleteSelectedState() {
        const count = selectedInvoiceIds.size;
        if (deleteSelectedCountText) deleteSelectedCountText.textContent = count;
        if (btnDeleteSelected) {
            btnDeleteSelected.disabled = count === 0;
        }

        if (selectAllCheckbox) {
            const filteredInvoices = getFilteredInvoices();
            if (filteredInvoices.length === 0) {
                selectAllCheckbox.checked = false;
                selectAllCheckbox.indeterminate = false;
            } else {
                const selectedFilteredCount = filteredInvoices.filter(inv => inv.id && selectedInvoiceIds.has(inv.id)).length;
                if (selectedFilteredCount === filteredInvoices.length) {
                    selectAllCheckbox.checked = true;
                    selectAllCheckbox.indeterminate = false;
                } else if (selectedFilteredCount > 0) {
                    selectAllCheckbox.checked = false;
                    selectAllCheckbox.indeterminate = true;
                } else {
                    selectAllCheckbox.checked = false;
                    selectAllCheckbox.indeterminate = false;
                }
            }
        }
    }

    // Render Invoices Table
    function renderTable() {
        calculateAuditCounts();
        const filteredInvoices = getFilteredInvoices();
        const colCount = window.IS_ADMIN ? 17 : 16;
        const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
        const fyValue = fyFilter ? fyFilter.value.trim() : '';
        const monthValue = monthFilter ? monthFilter.value.trim().toLowerCase() : '';
        const periodInvoices = invoices.filter(inv => {
            const matchesFy = !fyValue || String(inv.financial_year || '').trim() === fyValue;
            const matchesMonth = !monthValue || String(inv.month || '').trim().toLowerCase() === monthValue;
            return matchesFy && matchesMonth;
        });

        if (filteredInvoices.length === 0) {
            tableBody.innerHTML = `
                <tr class="empty-state-row">
                    <td colspan="${colCount}">
                        <div class="empty-state">
                            <i class="fa-solid fa-receipt"></i>
                            <p>${(query || currentAuditFilter !== 'all' || Object.keys(columnFilters).length > 0 || fyValue || monthValue) ? 'No matching invoices found for the selected filter.' : 'No invoices processed yet. Drag & drop or upload files above.'}</p>
                        </div>
                    </td>
                </tr>
            `;
            invoiceCountText.textContent = `0 of ${periodInvoices.length} Invoice(s) Loaded`;
            updateDeleteSelectedState();
            return;
        }

        invoiceCountText.textContent = `${filteredInvoices.length} of ${periodInvoices.length} Invoice(s) Loaded`;
        tableBody.innerHTML = '';

        filteredInvoices.forEach((inv) => {
            const tr = document.createElement('tr');
            tr.dataset.id = inv.id;
            const isRowSelected = inv.id && selectedInvoiceIds.has(inv.id);
            if (isRowSelected) {
                tr.classList.add('row-selected');
            }

            const stateVal = inv.state || '';
            const stateOptions = ['Gujarat', 'Maharashtra'];
            if (stateVal && !stateOptions.includes(stateVal)) stateOptions.push(stateVal);

            // Highlight missing or unassigned fields for instant rectification
            const isGstinInvalid = isFieldBlank(inv.gstin) || String(inv.gstin).trim().length !== 15;
            const isInvBlank = isFieldBlank(inv.invoice_number);
            const isBranchBlank = isFieldBlank(inv.branch);
            const isStateBlank = isFieldBlank(inv.state);
            const isDateBlank = isFieldBlank(inv.invoice_date);
            const isPayDateBlank = isFieldBlank(inv.payment_date);

            tr.innerHTML = `
                <td class="checkbox-cell col-select">
                    <input type="checkbox" class="row-select-checkbox" data-id="${inv.id || ''}" title="Select this bill" ${isRowSelected ? 'checked' : ''} style="width: 16px; height: 16px; cursor: pointer;">
                </td>
                <td><select class="field-state ${isStateBlank ? 'field-needs-rectification' : ''}" title="${isStateBlank ? 'Missing State - Click to select' : ''}">
                    <option value="">-- Select --</option>
                    ${stateOptions.map(s => `<option value="${s}" ${s === stateVal ? 'selected' : ''}>${s}</option>`).join('')}
                </select></td>
                <td><input type="text" class="field-branch ${isBranchBlank ? 'field-needs-rectification' : ''}" title="${isBranchBlank ? 'Missing Branch - Click to edit' : ''}" value="${inv.branch || ''}"></td>
                <td><input type="text" class="field-gstin ${isGstinInvalid ? 'field-needs-rectification' : ''}" title="${isGstinInvalid ? 'Missing / Incomplete GSTIN - Click to edit' : ''}" value="${inv.gstin || ''}"></td>
                <td><input type="text" class="field-number ${isInvBlank ? 'field-needs-rectification' : ''}" title="${isInvBlank ? 'Missing Invoice # - Click to edit' : ''}" value="${inv.invoice_number || ''}"></td>
                <td><input type="text" class="field-date ${isDateBlank ? 'field-needs-rectification' : ''}" title="${isDateBlank ? 'Missing Date - Click to edit' : ''}" value="${inv.invoice_date || ''}"></td>
                <td><input type="text" class="field-payment-date ${isPayDateBlank ? 'field-needs-rectification' : ''}" placeholder="DD-MM-YYYY" title="${isPayDateBlank ? 'Missing Payment Date - Click to edit' : ''}" value="${inv.payment_date || ''}"></td>
                <td><input type="text" class="field-vendor" list="vendor-suggestions" value="${inv.vendor_name || ''}"></td>
                <td class="numeric"><input type="number" step="0.01" class="field-taxable" value="${(inv.taxable_value || 0).toFixed(2)}"></td>
                <td class="numeric"><input type="number" step="0.01" class="field-cgst" value="${(inv.cgst || 0).toFixed(2)}"></td>
                <td class="numeric"><input type="number" step="0.01" class="field-sgst" value="${(inv.sgst || 0).toFixed(2)}"></td>
                <td class="numeric"><input type="number" step="0.01" class="field-igst" value="${(inv.igst || 0).toFixed(2)}"></td>
                <td class="checkbox-cell"><input type="checkbox" class="field-itc-blocked" title="Section 17(5) blocked credit / fully ineligible" ${inv.itc_blocked ? 'checked' : ''}></td>
                <td class="numeric eligible-column font-bold" id="row-eligible-${inv.id}">₹${(inv.eligible_itc || 0).toFixed(2)}</td>
                <td class="numeric ineligible-column" id="row-ineligible-${inv.id}">₹${(inv.ineligible_itc || 0).toFixed(2)}</td>
                ${window.IS_ADMIN ? `<td class="col-owner">${inv.username || window.CURRENT_USERNAME || ''}</td>` : ''}
                <td class="actions-cell">
                    ${inv.has_file ? `
                    <button class="btn-rescan-row" title="Re-scan this bill with Higher Accuracy AI" data-id="${inv.id}">
                        <i class="fa-solid fa-arrows-rotate"></i>
                    </button>
                    <button class="btn-view-file" title="View original bill" data-id="${inv.id}">
                        <i class="fa-solid fa-file-invoice"></i>
                    </button>` : ''}
                    <button class="btn-delete" title="Remove row">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            `;

            // Row selection listener
            const rowCheckbox = tr.querySelector('.row-select-checkbox');
            if (rowCheckbox) {
                rowCheckbox.addEventListener('change', (e) => {
                    e.stopPropagation();
                    if (rowCheckbox.checked) {
                        if (inv.id) selectedInvoiceIds.add(inv.id);
                        tr.classList.add('row-selected');
                    } else {
                        if (inv.id) selectedInvoiceIds.delete(inv.id);
                        tr.classList.remove('row-selected');
                    }
                    updateDeleteSelectedState();
                });
            }

            // Row-level listeners to update state & save changes to Postgres database
            const vendorInput = tr.querySelector('.field-vendor');
            const gstinInput = tr.querySelector('.field-gstin');
            const branchInputRow = tr.querySelector('.field-branch');
            const stateSelectRow = tr.querySelector('.field-state');

            if (vendorInput && gstinInput) {
                vendorInput.addEventListener('input', () => {
                    const partyVal = vendorInput.value.trim().toLowerCase();
                    if (!partyVal) return;
                    const matched = masterVendors.find(v => v.name.toLowerCase() === partyVal || partyVal.includes(v.name.toLowerCase()) || v.name.toLowerCase().includes(partyVal));
                    if (matched) {
                        gstinInput.value = matched.gstin;
                        gstinInput.classList.remove('field-needs-rectification');
                    }
                });
            }

            if (branchInputRow && stateSelectRow) {
                branchInputRow.addEventListener('input', () => {
                    const val = branchInputRow.value.trim().toUpperCase();
                    const mb = masterBranches.find(b => b.name.toUpperCase() === val);
                    if (mb) {
                        stateSelectRow.value = mb.state;
                        branchInputRow.classList.remove('field-needs-rectification');
                        stateSelectRow.classList.remove('field-needs-rectification');
                    } else if (val.includes('ANDHERI') || val.includes('MAHARASHTRA') || val.includes('MAHARASTRA')) {
                        stateSelectRow.value = 'Maharashtra';
                        branchInputRow.classList.remove('field-needs-rectification');
                        stateSelectRow.classList.remove('field-needs-rectification');
                    } else if (val) {
                        stateSelectRow.value = 'Gujarat';
                        branchInputRow.classList.remove('field-needs-rectification');
                        stateSelectRow.classList.remove('field-needs-rectification');
                    }
                });
            }

            const inputs = tr.querySelectorAll('input:not(.row-select-checkbox), select');
            inputs.forEach(input => {
                input.addEventListener('change', (e) => {
                    if (input.value.trim()) {
                        input.classList.remove('field-needs-rectification');
                    }
                    updateStateFromRow(tr, inv.id);
                });
            });

            tr.querySelector('.btn-delete').addEventListener('click', () => {
                deleteInvoice(inv.id);
            });

            const rescanBtn = tr.querySelector('.btn-rescan-row');
            if (rescanBtn) {
                rescanBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    handleSingleInvoiceRescan(inv.id, rescanBtn);
                });
            }

            const viewFileBtn = tr.querySelector('.btn-view-file');
            if (viewFileBtn) {
                viewFileBtn.addEventListener('click', () => {
                    window.open(`/api/invoice-file/${viewFileBtn.dataset.id}`, '_blank');
                });
            }

            tableBody.appendChild(tr);
        });

        updateDeleteSelectedState();
    }

    // Sync input values with invoice state, calculate 50% split, and POST update to database
    function updateStateFromRow(rowEl, invoiceId) {
        const state = rowEl.querySelector('.field-state').value.trim() || 'Unassigned';
        const branch = rowEl.querySelector('.field-branch').value.trim() || 'Unassigned';
        const gstin = rowEl.querySelector('.field-gstin').value.trim() || 'N/A';
        const invNum = rowEl.querySelector('.field-number').value;
        const invDate = rowEl.querySelector('.field-date').value;
        const paymentDate = rowEl.querySelector('.field-payment-date').value.trim() || null;
        const vendor = rowEl.querySelector('.field-vendor').value;
        const taxable = parseFloat(rowEl.querySelector('.field-taxable').value) || 0;
        const cgst = parseFloat(rowEl.querySelector('.field-cgst').value) || 0;
        const sgst = parseFloat(rowEl.querySelector('.field-sgst').value) || 0;
        const igst = parseFloat(rowEl.querySelector('.field-igst').value) || 0;
        const itcBlocked = rowEl.querySelector('.field-itc-blocked').checked;

        const totalGst = cgst + sgst + igst;
        const eligible = itcBlocked ? 0 : totalGst * 0.5;
        const ineligible = itcBlocked ? totalGst : totalGst * 0.5;

        const elCell = rowEl.querySelector(`#row-eligible-${invoiceId}`);
        const inelCell = rowEl.querySelector(`#row-ineligible-${invoiceId}`);
        if (elCell) elCell.textContent = `₹${eligible.toFixed(2)}`;
        if (inelCell) inelCell.textContent = `₹${ineligible.toFixed(2)}`;

        const index = invoices.findIndex(i => i.id === invoiceId);
        if (index === -1) return;

        // Update local state
        invoices[index] = {
            ...invoices[index],
            state: state,
            branch: branch,
            gstin: gstin,
            invoice_number: invNum,
            invoice_date: invDate,
            payment_date: paymentDate,
            vendor_name: vendor,
            taxable_value: taxable,
            cgst: cgst,
            sgst: sgst,
            igst: igst,
            itc_blocked: itcBlocked,
            eligible_itc: eligible,
            ineligible_itc: ineligible
        };
        updateBranchSuggestions();

        // Sync with Postgres database
        fetch('/api/save-invoice', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(invoices[index])
        })
        .then(response => {
            if (!response.ok) throw new Error('Failed to save changes');
            return response.json();
        })
        .then(data => {
            if (data.success) {
                // If it was a new row created without ID, set it
                invoices[index].id = data.id;
                invoices[index].eligible_itc = data.eligible_itc;
                invoices[index].ineligible_itc = data.ineligible_itc;
                invoices[index].financial_year = data.financial_year;
                invoices[index].month = data.month;

                // Update table values
                document.getElementById(`row-eligible-${index}`).textContent = `₹${data.eligible_itc.toFixed(2)}`;
                document.getElementById(`row-ineligible-${index}`).textContent = `₹${data.ineligible_itc.toFixed(2)}`;

                populateFilters();
                updateMetrics();
            }
        })
        .catch(error => {
            console.error('Error saving invoice change to database:', error);
            alert('Failed to save changes to the database. Check connection.');
        });
    }

    // Delete invoice from UI and PostgreSQL database
    function deleteInvoice(id) {
        const index = invoices.findIndex(i => i.id === id);
        if (index === -1) return;
        const inv = invoices[index];
        if (!inv.id) {
            // Unsaved error row
            invoices.splice(index, 1);
            selectedInvoiceIds.delete(id);
            renderTable();
            updateMetrics();
            return;
        }

        fetch('/api/delete-invoice', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ id: inv.id })
        })
        .then(response => {
            if (!response.ok) throw new Error('Failed to delete invoice');
            return response.json();
        })
        .then(data => {
            if (data.success) {
                selectedInvoiceIds.delete(inv.id);
                invoices.splice(index, 1);
                populateFilters();
                calculateAuditCounts();
                renderTable();
                updateMetrics();
                updateBranchSuggestions();
            }
        })
        .catch(error => {
            console.error('Error deleting invoice:', error);
            alert('Failed to delete invoice from database.');
        });
    }

    // Sum totals and refresh dashboard widgets based on selected FY and Month
    function updateMetrics() {
        const fyValue = fyFilter ? fyFilter.value : '';
        const monthValue = monthFilter ? monthFilter.value : '';

        // Filter invoices by the active FY and Month period
        const periodInvoices = invoices.filter(inv => {
            const matchesFy = !fyValue || inv.financial_year === fyValue;
            const matchesMonth = !monthValue || inv.month === monthValue;
            return matchesFy && matchesMonth;
        });

        let totalTaxable = 0;
        let totalCgst = 0;
        let totalSgst = 0;
        let totalIgst = 0;
        let totalEligible = 0;
        let totalIneligible = 0;

        periodInvoices.forEach(inv => {
            totalTaxable += inv.taxable_value || 0;
            totalCgst += inv.cgst || 0;
            totalSgst += inv.sgst || 0;
            totalIgst += inv.igst || 0;
            totalEligible += inv.eligible_itc || 0;
            totalIneligible += inv.ineligible_itc || 0;
        });

        const totalGst = totalCgst + totalSgst + totalIgst;
        const totalBilling = totalTaxable + totalGst;

        const formatCurrency = (val) => {
            return new Intl.NumberFormat('en-IN', {
                style: 'currency',
                currency: 'INR',
                maximumFractionDigits: 2
            }).format(val);
        };

        if (billingMetric) billingMetric.textContent = formatCurrency(totalBilling);
        if (taxableMetric) taxableMetric.textContent = formatCurrency(totalTaxable);
        if (eligibleMetric) eligibleMetric.textContent = formatCurrency(totalEligible);
        if (ineligibleMetric) ineligibleMetric.textContent = formatCurrency(totalIneligible);

        // Update period indicator subtitle
        if (metricsPeriodLabel) {
            if (fyValue && monthValue) {
                metricsPeriodLabel.innerHTML = `<i class="fa-solid fa-filter" style="color: var(--accent-blue);"></i> Filtered: <strong>FY ${fyValue} &bull; ${monthValue}</strong> (${periodInvoices.length} bill${periodInvoices.length === 1 ? '' : 's'})`;
            } else if (fyValue) {
                metricsPeriodLabel.innerHTML = `<i class="fa-solid fa-filter" style="color: var(--accent-blue);"></i> Filtered: <strong>FY ${fyValue}</strong> (${periodInvoices.length} bill${periodInvoices.length === 1 ? '' : 's'})`;
            } else if (monthValue) {
                metricsPeriodLabel.innerHTML = `<i class="fa-solid fa-filter" style="color: var(--accent-blue);"></i> Filtered: <strong>${monthValue} (All Years)</strong> (${periodInvoices.length} bill${periodInvoices.length === 1 ? '' : 's'})`;
            } else {
                metricsPeriodLabel.innerHTML = `<i class="fa-solid fa-circle-check" style="color: var(--accent-green);"></i> Showing <strong>All Financial Years & Months</strong> (${invoices.length} total bill${invoices.length === 1 ? '' : 's'})`;
            }
        }

        if (btnResetPeriod) {
            btnResetPeriod.style.display = (fyValue || monthValue) ? 'inline-flex' : 'none';
        }
    }

    // Search bar functionality
    searchInput.addEventListener('input', () => {
        renderTable();
    });

    // FY filter dropdown -- changing the year narrows the month dropdown to
    // just the months present within that year, then re-renders table and updates metrics.
    if (fyFilter) {
        fyFilter.addEventListener('change', () => {
            if (monthFilter) monthFilter.value = '';
            populateFilters();
            renderTable();
            updateMetrics();
        });
    }

    // Month filter dropdown -- updates table and re-calculates top metrics
    if (monthFilter) {
        monthFilter.addEventListener('change', () => {
            renderTable();
            updateMetrics();
        });
    }

    // Reset period button
    if (btnResetPeriod) {
        btnResetPeriod.addEventListener('click', () => {
            if (fyFilter) fyFilter.value = '';
            if (monthFilter) monthFilter.value = '';
            populateFilters();
            renderTable();
            updateMetrics();
        });
    }

    // ---- Multi-Select "Select All" Master Checkbox ----
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', () => {
            const filteredInvoices = getFilteredInvoices();
            if (selectAllCheckbox.checked) {
                filteredInvoices.forEach(inv => {
                    if (inv.id) selectedInvoiceIds.add(inv.id);
                });
            } else {
                filteredInvoices.forEach(inv => {
                    if (inv.id) selectedInvoiceIds.delete(inv.id);
                });
            }
            renderTable();
        });
    }

    // ---- Delete Selected Records with Warning Modal ----
    function closeDeleteSelectedModal() {
        if (deleteSelectedOverlay) deleteSelectedOverlay.style.display = 'none';
    }

    if (btnDeleteSelected) {
        btnDeleteSelected.addEventListener('click', () => {
            const count = selectedInvoiceIds.size;
            if (count === 0) {
                alert('No invoices selected. Please select invoices using the checkboxes first.');
                return;
            }
            if (deleteSelectedWarningCount) deleteSelectedWarningCount.textContent = count;
            if (deleteSelectedBtnCount) deleteSelectedBtnCount.textContent = count;
            if (deleteSelectedOverlay) deleteSelectedOverlay.style.display = 'flex';
        });
    }

    if (deleteSelectedCloseBtn) deleteSelectedCloseBtn.addEventListener('click', closeDeleteSelectedModal);
    if (deleteSelectedCancelBtn) deleteSelectedCancelBtn.addEventListener('click', closeDeleteSelectedModal);
    if (deleteSelectedOverlay) {
        deleteSelectedOverlay.addEventListener('click', (e) => {
            if (e.target === deleteSelectedOverlay) closeDeleteSelectedModal();
        });
    }

    if (deleteSelectedConfirmBtn) {
        deleteSelectedConfirmBtn.addEventListener('click', () => {
            const idsToDelete = Array.from(selectedInvoiceIds);
            if (idsToDelete.length === 0) {
                closeDeleteSelectedModal();
                return;
            }

            deleteSelectedConfirmBtn.disabled = true;
            deleteSelectedConfirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting...';

            fetch('/api/delete-selected-invoices', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ids: idsToDelete })
            })
            .then(response => {
                if (!response.ok) throw new Error('Failed to delete selected invoices');
                return response.json();
            })
            .then(data => {
                if (data.success) {
                    // Remove deleted records from local array
                    invoices = invoices.filter(inv => !selectedInvoiceIds.has(inv.id));
                    selectedInvoiceIds.clear();
                    closeDeleteSelectedModal();
                    populateFilters();
                    calculateAuditCounts();
                    renderTable();
                    updateMetrics();
                    updateBranchSuggestions();
                } else {
                    alert(data.error || 'Failed to delete selected invoices.');
                }
            })
            .catch(error => {
                console.error('Error deleting selected invoices:', error);
                alert('Failed to delete selected invoices from the database.');
            })
            .finally(() => {
                deleteSelectedConfirmBtn.disabled = false;
                deleteSelectedConfirmBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i> Delete <span id="delete-selected-btn-count">0</span> Record(s)';
            });
        });
    }

    // ---- Clear All (Password Protected & Admin Only) ----
    const clearAllOverlay = document.getElementById('clear-all-modal-overlay');
    const clearAllCloseBtn = document.getElementById('clear-all-modal-close');
    const clearAllCancelBtn = document.getElementById('clear-all-cancel-btn');
    const clearAllForm = document.getElementById('clear-all-password-form');
    const clearAllPasswordInput = document.getElementById('clear-all-password-input');
    const clearAllError = document.getElementById('clear-all-password-error');
    const clearAllCountText = document.getElementById('clear-all-count-text');
    const clearAllScopeText = document.getElementById('clear-all-scope-text');
    const clearAllConfirmBtn = document.getElementById('clear-all-confirm-btn');

    let pendingIdsToDelete = [];

    function closeClearAllModal() {
        if (clearAllOverlay) clearAllOverlay.style.display = 'none';
        if (clearAllPasswordInput) clearAllPasswordInput.value = '';
        if (clearAllError) {
            clearAllError.style.display = 'none';
            clearAllError.textContent = '';
        }
        pendingIdsToDelete = [];
    }

    if (clearAllCloseBtn) clearAllCloseBtn.addEventListener('click', closeClearAllModal);
    if (clearAllCancelBtn) clearAllCancelBtn.addEventListener('click', closeClearAllModal);

    // Clear All records for user
    // "Clear All" only deletes whatever the active FY/month/search filter
    // is currently showing -- not silently every bill ever entered -- and
    // is Admin-only, password-protected via a confirmation modal, since it
    // permanently removes the original file attachments too.
    btnClearAll.addEventListener('click', () => {
        if (!window.IS_ADMIN) {
            alert('Clear All is an Administrator-only action. Contact your admin to perform bulk invoice deletion.');
            return;
        }

        if (invoices.length === 0) {
            alert('No invoices loaded. Nothing to clear.');
            return;
        }

        const filteredInvoices = getFilteredInvoices();
        if (filteredInvoices.length === 0) {
            alert('No invoices match the current filter/search. Adjust the filters to select what to clear.');
            return;
        }

        pendingIdsToDelete = filteredInvoices.map(inv => inv.id).filter(id => id != null);
        const isFiltered = filteredInvoices.length !== invoices.length;

        if (clearAllCountText) clearAllCountText.textContent = pendingIdsToDelete.length;
        if (clearAllScopeText) clearAllScopeText.textContent = isFiltered ? ' matching your current search/filter' : '';
        if (clearAllPasswordInput) clearAllPasswordInput.value = '';
        if (clearAllError) {
            clearAllError.style.display = 'none';
            clearAllError.textContent = '';
        }

        if (clearAllOverlay) {
            clearAllOverlay.style.display = 'flex';
            setTimeout(() => clearAllPasswordInput.focus(), 100);
        }
    });

    if (clearAllForm) {
        clearAllForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const password = clearAllPasswordInput.value.trim();
            if (!password) {
                clearAllError.textContent = 'Password is required.';
                clearAllError.style.display = 'block';
                return;
            }

            clearAllConfirmBtn.disabled = true;
            clearAllConfirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting...';

            fetch('/api/clear-invoices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: pendingIdsToDelete, password: password })
            })
            .then(response => response.json().then(data => ({ status: response.status, data })))
            .then(({ status, data }) => {
                clearAllConfirmBtn.disabled = false;
                clearAllConfirmBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i> Confirm & Delete Bills';

                if (status === 200 && data.success) {
                    const deletedIds = new Set(pendingIdsToDelete);
                    invoices = invoices.filter(inv => !deletedIds.has(inv.id));
                    closeClearAllModal();
                    populateFilters();
                    renderTable();
                    updateMetrics();
                    updateBranchSuggestions();
                    alert(`Successfully deleted ${data.count} bill(s).`);
                } else {
                    clearAllError.textContent = data.error || 'Failed to clear invoices.';
                    clearAllError.style.display = 'block';
                }
            })
            .catch(error => {
                console.error('Error clearing invoices:', error);
                clearAllConfirmBtn.disabled = false;
                clearAllConfirmBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i> Confirm & Delete Bills';
                clearAllError.textContent = 'Network or server error while executing delete.';
                clearAllError.style.display = 'block';
            });
        });
    }

    // ---- Manual Bill Entry (no physical/soft copy available) ----
    function openManualBillModal() {
        manualBillForm.reset();
        if (stateInput && document.getElementById('mb-state')) document.getElementById('mb-state').value = stateInput.value.trim();
        if (branchInput && document.getElementById('mb-branch')) document.getElementById('mb-branch').value = branchInput.value.trim();
        mbDirectFields.style.display = 'grid';
        mbAutoFields.style.display = 'none';
        mbPreview.style.display = 'none';
        mbCustomRateField.style.display = 'none';
        manualBillOverlay.style.display = 'flex';
        document.getElementById('mb-branch').focus();
    }

    function closeManualBillModal() {
        manualBillOverlay.style.display = 'none';
    }

    btnAddManual.addEventListener('click', openManualBillModal);
    manualBillClose.addEventListener('click', closeManualBillModal);
    manualBillCancel.addEventListener('click', closeManualBillModal);
    manualBillOverlay.addEventListener('click', (e) => {
        if (e.target === manualBillOverlay) closeManualBillModal();
    });

    // Toggle between "enter tax amounts directly" and "enter total, auto-split GST"
    manualBillForm.querySelectorAll('input[name="mb-mode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const isAuto = manualBillForm.querySelector('input[name="mb-mode"]:checked').value === 'auto';
            mbDirectFields.style.display = isAuto ? 'none' : 'grid';
            mbAutoFields.style.display = isAuto ? 'grid' : 'none';
            mbPreview.style.display = isAuto ? 'block' : 'none';
            if (isAuto) updateAutoSplitPreview();
        });
    });

    mbRate.addEventListener('change', () => {
        mbCustomRateField.style.display = mbRate.value === 'custom' ? 'block' : 'none';
        updateAutoSplitPreview();
    });

    ['mb-total', 'mb-custom-rate', 'mb-supply-type'].forEach(id => {
        document.getElementById(id).addEventListener('input', updateAutoSplitPreview);
        document.getElementById(id).addEventListener('change', updateAutoSplitPreview);
    });

    // Back-calculates taxable value + CGST/SGST/IGST from a tax-inclusive total amount
    function computeGstSplit() {
        const total = parseFloat(document.getElementById('mb-total').value) || 0;
        const rateSelection = mbRate.value;
        const rate = rateSelection === 'custom'
            ? (parseFloat(document.getElementById('mb-custom-rate').value) || 0)
            : parseFloat(rateSelection);
        const supplyType = document.getElementById('mb-supply-type').value;

        const taxable = rate > 0 ? total / (1 + rate / 100) : total;
        const taxAmount = total - taxable;

        let cgst = 0, sgst = 0, igst = 0;
        if (supplyType === 'intra') {
            cgst = taxAmount / 2;
            sgst = taxAmount / 2;
        } else {
            igst = taxAmount;
        }

        return {
            taxable_value: Math.round(taxable * 100) / 100,
            cgst: Math.round(cgst * 100) / 100,
            sgst: Math.round(sgst * 100) / 100,
            igst: Math.round(igst * 100) / 100
        };
    }

    function updateAutoSplitPreview() {
        const split = computeGstSplit();
        document.getElementById('mb-preview-taxable').textContent = `₹${split.taxable_value.toFixed(2)}`;
        document.getElementById('mb-preview-cgst').textContent = `₹${split.cgst.toFixed(2)}`;
        document.getElementById('mb-preview-sgst').textContent = `₹${split.sgst.toFixed(2)}`;
        document.getElementById('mb-preview-igst').textContent = `₹${split.igst.toFixed(2)}`;
    }

    // Auto-fill State when Branch is entered in Manual Bill modal
    const mbBranchInput = document.getElementById('mb-branch');
    const mbStateSelect = document.getElementById('mb-state');
    if (mbBranchInput && mbStateSelect) {
        mbBranchInput.addEventListener('input', () => {
            const val = mbBranchInput.value.trim().toUpperCase();
            const mb = masterBranches.find(b => b.name.toUpperCase() === val);
            if (mb) {
                mbStateSelect.value = mb.state;
            } else if (val.includes('ANDHERI') || val.includes('MAHARASHTRA') || val.includes('MAHARASTRA')) {
                mbStateSelect.value = 'Maharashtra';
            } else if (val) {
                mbStateSelect.value = 'Gujarat';
            }
        });
    }

    // Auto-fill GSTIN when Vendor/Party Name is selected in Manual Bill modal
    const mbPartyInput = document.getElementById('mb-party');
    const mbGstinInput = document.getElementById('mb-gstin');
    if (mbPartyInput && mbGstinInput) {
        mbPartyInput.addEventListener('input', () => {
            const partyVal = mbPartyInput.value.trim().toLowerCase();
            if (!partyVal) return;
            const matched = masterVendors.find(v => v.name.toLowerCase() === partyVal || partyVal.includes(v.name.toLowerCase()) || v.name.toLowerCase().includes(partyVal));
            if (matched) {
                mbGstinInput.value = matched.gstin;
            }
        });
    }

    manualBillForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const isAuto = manualBillForm.querySelector('input[name="mb-mode"]:checked').value === 'auto';
        let taxable, cgst, sgst, igst;

        if (isAuto) {
            const split = computeGstSplit();
            taxable = split.taxable_value;
            cgst = split.cgst;
            sgst = split.sgst;
            igst = split.igst;
        } else {
            taxable = parseFloat(document.getElementById('mb-taxable').value) || 0;
            cgst = parseFloat(document.getElementById('mb-cgst').value) || 0;
            sgst = parseFloat(document.getElementById('mb-sgst').value) || 0;
            igst = parseFloat(document.getElementById('mb-igst').value) || 0;
        }

        const itcBlocked = document.getElementById('mb-itc-blocked').checked;
        const totalGst = cgst + sgst + igst;

        const newInvoice = {
            id: null,
            state: document.getElementById('mb-state').value.trim() || 'Unassigned',
            branch: document.getElementById('mb-branch').value.trim() || 'Unassigned',
            gstin: document.getElementById('mb-gstin').value.trim() || 'N/A',
            invoice_number: document.getElementById('mb-invoice-number').value.trim() || 'N/A',
            invoice_date: document.getElementById('mb-date').value.trim() || 'N/A',
            payment_date: document.getElementById('mb-payment-date').value.trim() || null,
            vendor_name: document.getElementById('mb-party').value.trim() || 'Unknown Vendor',
            taxable_value: taxable,
            cgst: cgst,
            sgst: sgst,
            igst: igst,
            itc_blocked: itcBlocked,
            eligible_itc: itcBlocked ? 0 : totalGst * 0.5,
            ineligible_itc: itcBlocked ? totalGst : totalGst * 0.5
        };

        const saveBtn = document.getElementById('manual-bill-save');
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

        fetch('/api/save-invoice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newInvoice)
        })
        .then(response => {
            if (!response.ok) throw new Error('Failed to save manual bill');
            return response.json();
        })
        .then(data => {
            if (data.success) {
                newInvoice.id = data.id;
                newInvoice.eligible_itc = data.eligible_itc;
                newInvoice.ineligible_itc = data.ineligible_itc;
                newInvoice.financial_year = data.financial_year;
                newInvoice.month = data.month;
                invoices = [newInvoice, ...invoices];
                populateFilters();
                renderTable();
                updateMetrics();
                updateBranchSuggestions();
                closeManualBillModal();
            }
        })
        .catch(error => {
            console.error('Error saving manual bill:', error);
            alert('Failed to save the manual bill. Check connection.');
        })
        .finally(() => {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Bill';
        });
    });

    // Export to Excel
    btnExportExcel.addEventListener('click', () => {
        const filteredInvoices = getFilteredInvoices();
        if (filteredInvoices.length === 0) {
            alert(invoices.length === 0
                ? 'No invoices loaded. Please upload invoices to export.'
                : 'No invoices match the current filter/search. Adjust the filters to export a report.');
            return;
        }

        btnExportExcel.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating Excel...';
        btnExportExcel.disabled = true;

        fetch('/api/export-excel', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ invoices: filteredInvoices })
        })
        .then(response => {
            if (!response.ok) throw new Error('Excel generation failed');
            return response.blob();
        })
        .then(blob => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'GST_ITC_Reconciled_Nutan_Nagrik.xlsx';
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
            
            btnExportExcel.innerHTML = '<i class="fa-solid fa-file-excel"></i> Export Reconciled Excel';
            btnExportExcel.disabled = false;
        })
        .catch(error => {
            console.error('Export error:', error);
            alert('Failed to generate Excel sheet.');
            btnExportExcel.innerHTML = '<i class="fa-solid fa-file-excel"></i> Export Reconciled Excel';
            btnExportExcel.disabled = false;
        });
    });

    // =========================================================
    // AI Re-Scan Feature & Interactive Comparison Report Modal
    // =========================================================
    const btnRescanIncomplete = document.getElementById('btn-rescan-incomplete');
    const rescanModalOverlay = document.getElementById('rescan-modal-overlay');
    const rescanModalClose = document.getElementById('rescan-modal-close');
    const rescanCancelBtn = document.getElementById('rescan-cancel-btn');
    const rescanApplyBtn = document.getElementById('rescan-apply-btn');
    const rescanSelectAll = document.getElementById('rescan-select-all');
    const rescanTableBody = document.getElementById('rescan-table-body');
    const rescanSelectedBadge = document.getElementById('rescan-selected-badge');
    const rescanApplyBtnCount = document.getElementById('rescan-apply-btn-count');
    const rescanStatTotal = document.getElementById('rescan-stat-total');
    const rescanStatGstin = document.getElementById('rescan-stat-gstin');
    const rescanStatPayment = document.getElementById('rescan-stat-payment');
    const rescanStatInv = document.getElementById('rescan-stat-inv');
    const rescanStatModel = document.getElementById('rescan-stat-model');

    let currentRescanResults = [];
    let selectedRescanIds = new Set();

    function closeRescanModal() {
        if (rescanModalOverlay) rescanModalOverlay.style.display = 'none';
    }

    if (rescanModalClose) rescanModalClose.addEventListener('click', closeRescanModal);
    if (rescanCancelBtn) rescanCancelBtn.addEventListener('click', closeRescanModal);

    function updateRescanModalSelectionState() {
        const count = selectedRescanIds.size;
        if (rescanSelectedBadge) rescanSelectedBadge.textContent = count;
        if (rescanApplyBtnCount) rescanApplyBtnCount.textContent = count;
        if (rescanApplyBtn) {
            rescanApplyBtn.disabled = count === 0;
            rescanApplyBtn.style.opacity = count === 0 ? '0.5' : '1';
        }

        if (rescanSelectAll) {
            if (currentRescanResults.length === 0) {
                rescanSelectAll.checked = false;
                rescanSelectAll.indeterminate = false;
            } else if (count === currentRescanResults.length) {
                rescanSelectAll.checked = true;
                rescanSelectAll.indeterminate = false;
            } else if (count > 0) {
                rescanSelectAll.checked = false;
                rescanSelectAll.indeterminate = true;
            } else {
                rescanSelectAll.checked = false;
                rescanSelectAll.indeterminate = false;
            }
        }
    }

    if (rescanSelectAll) {
        rescanSelectAll.addEventListener('change', () => {
            const isChecked = rescanSelectAll.checked;
            selectedRescanIds.clear();
            if (isChecked) {
                currentRescanResults.forEach(r => selectedRescanIds.add(r.id));
            }
            const checkboxes = rescanTableBody.querySelectorAll('.rescan-row-checkbox');
            checkboxes.forEach(cb => { cb.checked = isChecked; });
            updateRescanModalSelectionState();
        });
    }

    function openRescanReportModal(data) {
        currentRescanResults = data.results || [];
        selectedRescanIds = new Set(currentRescanResults.map(r => r.id));

        const summary = data.summary || {};
        if (rescanStatTotal) rescanStatTotal.textContent = summary.total_scanned || currentRescanResults.length;
        if (rescanStatGstin) rescanStatGstin.textContent = summary.recovered_gstin || 0;
        if (rescanStatPayment) rescanStatPayment.textContent = summary.recovered_payment_date || 0;
        if (rescanStatInv) rescanStatInv.textContent = summary.recovered_invoice_num || 0;
        if (rescanStatModel) rescanStatModel.textContent = summary.ai_model_used || 'Gemini 2.5 Pro (High Accuracy)';

        if (!rescanTableBody) return;
        rescanTableBody.innerHTML = '';

        if (currentRescanResults.length === 0) {
            rescanTableBody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 40px; color: #64748b;">
                        <i class="fa-solid fa-circle-check" style="font-size: 32px; color: #10b981; margin-bottom: 12px; display: block;"></i>
                        All bills are already complete with no missing fields to re-scan.
                    </td>
                </tr>
            `;
            updateRescanModalSelectionState();
            rescanModalOverlay.style.display = 'flex';
            return;
        }

        currentRescanResults.forEach(item => {
            const orig = item.original || {};
            const sc = item.scanned || {};
            const changes = item.changes || [];

            const isGstinRec = changes.some(c => c.field === 'gstin' && c.is_recovered);
            const isInvRec = changes.some(c => c.field === 'invoice_number' && c.is_recovered);
            const isPayRec = changes.some(c => c.field === 'payment_date' && c.is_recovered);
            const isDateRec = changes.some(c => c.field === 'invoice_date' && c.is_recovered);

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="text-align: center; vertical-align: middle;">
                    <input type="checkbox" class="rescan-row-checkbox" data-id="${item.id}" checked style="cursor: pointer; width: 16px; height: 16px;">
                </td>
                <td>
                    <div style="font-weight: 600; color: #0f172a; font-size: 13.5px;">${escapeHtml(sc.vendor_name || orig.vendor_name || 'Unknown Vendor')}</div>
                    <div style="font-size: 11px; color: #64748b; margin-top: 2px;">
                        <i class="fa-solid fa-file-invoice"></i> ${escapeHtml(item.file_name || `Bill #${item.id}`)}
                    </div>
                </td>
                <td>
                    <div class="rescan-diff-block">
                        ${orig.gstin !== sc.gstin && orig.gstin ? `<span class="rescan-diff-old">${escapeHtml(orig.gstin)}</span>` : ''}
                        <span class="rescan-diff-new ${isGstinRec ? 'recovered' : (orig.gstin !== sc.gstin ? 'changed' : '')}">${escapeHtml(sc.gstin || 'Missing')}</span>
                    </div>
                </td>
                <td>
                    <div class="rescan-diff-block">
                        ${orig.invoice_number !== sc.invoice_number && orig.invoice_number ? `<span class="rescan-diff-old">${escapeHtml(orig.invoice_number)}</span>` : ''}
                        <span class="rescan-diff-new ${isInvRec ? 'recovered' : (orig.invoice_number !== sc.invoice_number ? 'changed' : '')}">${escapeHtml(sc.invoice_number || 'Missing')}</span>
                    </div>
                </td>
                <td>
                    <div class="rescan-diff-block">
                        ${orig.invoice_date !== sc.invoice_date && orig.invoice_date ? `<span class="rescan-diff-old">${escapeHtml(orig.invoice_date)}</span>` : ''}
                        <span class="rescan-diff-new ${isDateRec ? 'recovered' : (orig.invoice_date !== sc.invoice_date ? 'changed' : '')}">${escapeHtml(sc.invoice_date || 'Missing')}</span>
                    </div>
                </td>
                <td>
                    <div class="rescan-diff-block">
                        ${orig.payment_date !== sc.payment_date && orig.payment_date ? `<span class="rescan-diff-old">${escapeHtml(orig.payment_date)}</span>` : ''}
                        <span class="rescan-diff-new ${isPayRec ? 'recovered' : (orig.payment_date !== sc.payment_date && sc.payment_date ? 'changed' : '')}">${escapeHtml(sc.payment_date || 'None')}</span>
                    </div>
                </td>
                <td>
                    <div style="font-size: 13px; font-weight: 600;">Taxable: ₹${(sc.taxable_value || 0).toFixed(2)}</div>
                    <div style="font-size: 11.5px; color: #64748b;">GST: ₹${((sc.cgst || 0) + (sc.sgst || 0) + (sc.igst || 0)).toFixed(2)}</div>
                </td>
                <td>
                    <div style="display: flex; flex-direction: column; gap: 2px;">
                        ${changes.length > 0 ? changes.map(c => `
                            <span class="rescan-tag ${c.is_recovered ? 'recovered' : 'updated'}">
                                <i class="fa-solid ${c.is_recovered ? 'fa-check' : 'fa-pen'}"></i> ${escapeHtml(c.label)}
                            </span>
                        `).join('') : '<span class="rescan-tag no-change">No changes</span>'}
                    </div>
                </td>
            `;

            const cb = tr.querySelector('.rescan-row-checkbox');
            cb.addEventListener('change', () => {
                if (cb.checked) {
                    selectedRescanIds.add(item.id);
                } else {
                    selectedRescanIds.delete(item.id);
                }
                updateRescanModalSelectionState();
            });

            rescanTableBody.appendChild(tr);
        });

        updateRescanModalSelectionState();
        rescanModalOverlay.style.display = 'flex';
    }

    // Handle single bill re-scan from row action button
    function handleSingleInvoiceRescan(invoiceId, btnEl) {
        if (btnEl) {
            btnEl.classList.add('spinning');
            btnEl.disabled = true;
        }

        fetch('/api/rescan-invoices-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoice_ids: [invoiceId] })
        })
        .then(res => {
            if (!res.ok) throw new Error('Re-scan request failed');
            return res.json();
        })
        .then(data => {
            if (btnEl) {
                btnEl.classList.remove('spinning');
                btnEl.disabled = false;
            }
            if (data.results && data.results.length > 0) {
                openRescanReportModal(data);
            } else {
                alert(data.message || 'No original file found for this bill to re-scan.');
            }
        })
        .catch(err => {
            console.error('Error re-scanning invoice:', err);
            if (btnEl) {
                btnEl.classList.remove('spinning');
                btnEl.disabled = false;
            }
            alert('Failed to re-scan invoice with AI. Please check server logs.');
        });
    }

    // Handle batch re-scan of incomplete bills from toolbar button
    if (btnRescanIncomplete) {
        btnRescanIncomplete.addEventListener('click', () => {
            btnRescanIncomplete.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Re-scanning AI...';
            btnRescanIncomplete.disabled = true;

            fetch('/api/rescan-invoices-batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filter_mode: 'incomplete' })
            })
            .then(res => {
                if (!res.ok) throw new Error('Batch re-scan failed');
                return res.json();
            })
            .then(data => {
                btnRescanIncomplete.innerHTML = `<i class="fa-solid fa-arrows-rotate"></i> Re-scan Incomplete (<span id="rescan-incomplete-count">${document.getElementById('count-pill-incomplete')?.textContent || '0'}</span>)`;
                btnRescanIncomplete.disabled = false;
                if (data.results && data.results.length > 0) {
                    openRescanReportModal(data);
                } else {
                    alert(data.message || 'No incomplete invoices with stored files found to re-scan.');
                }
            })
            .catch(err => {
                console.error('Batch re-scan error:', err);
                btnRescanIncomplete.innerHTML = `<i class="fa-solid fa-arrows-rotate"></i> Re-scan Incomplete (<span id="rescan-incomplete-count">${document.getElementById('count-pill-incomplete')?.textContent || '0'}</span>)`;
                btnRescanIncomplete.disabled = false;
                alert('Batch re-scan failed. Please check network/server logs.');
            });
        });
    }

    // Handle Apply Changes (OK button) from Modal
    if (rescanApplyBtn) {
        rescanApplyBtn.addEventListener('click', () => {
            const updatesToApply = currentRescanResults
                .filter(r => selectedRescanIds.has(r.id))
                .map(r => ({
                    id: r.id,
                    vendor_name: r.scanned.vendor_name,
                    gstin: r.scanned.gstin,
                    invoice_number: r.scanned.invoice_number,
                    invoice_date: r.scanned.invoice_date,
                    payment_date: r.scanned.payment_date,
                    taxable_value: r.scanned.taxable_value,
                    cgst: r.scanned.cgst,
                    sgst: r.scanned.sgst,
                    igst: r.scanned.igst,
                    itc_blocked: r.scanned.itc_blocked,
                    branch: r.scanned.branch,
                    state: r.scanned.state
                }));

            if (updatesToApply.length === 0) {
                alert('Please select at least one bill to update.');
                return;
            }

            rescanApplyBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Applying Updates...';
            rescanApplyBtn.disabled = true;

            fetch('/api/apply-rescan-results', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ updates: updatesToApply })
            })
            .then(res => {
                if (!res.ok) throw new Error('Failed to apply re-scan updates');
                return res.json();
            })
            .then(data => {
                rescanApplyBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Apply Changes';
                rescanApplyBtn.disabled = false;
                closeRescanModal();
                loadInvoices(); // Reload table and metrics
            })
            .catch(err => {
                console.error('Error applying rescan results:', err);
                rescanApplyBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Apply Changes';
                rescanApplyBtn.disabled = false;
                alert('Failed to apply updates to database.');
            });
        });
    }

    // Client Entity Switcher Tabs Handler
    document.querySelectorAll('.client-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const clientId = btn.getAttribute('data-client-id');
            if (clientId === 'nutan_nagrik') {
                document.querySelectorAll('.client-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            } else if (clientId === 'sun_builders') {
                document.querySelectorAll('.client-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                alert('Sun Builders: Connected to N. N. Shah & Co. GST audit workspace.');
            } else {
                alert('Client workspace under configuration. Additional client slots can be connected for multi-entity auditing.');
            }
        });
    });

    const btnAddClientTab = document.getElementById('btn-add-client-tab');
    if (btnAddClientTab) {
        btnAddClientTab.addEventListener('click', () => {
            const clientName = prompt('Enter new Client / Company name for N. N. Shah & Co. GST Audit:');
            if (clientName && clientName.trim()) {
                alert(`New client module for "${clientName.trim()}" added to N. N. Shah & Co. portal.`);
            }
        });
    }

    // Initial Data & UI Setup
    loadMasterData();
    setupAuditPills();
    setupColumnFilterTriggers();
    loadInvoices();
});
