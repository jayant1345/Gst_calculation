document.addEventListener('DOMContentLoaded', () => {
    // State management
    let invoices = [];
    
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
    const branchSuggestions = document.getElementById('branch-suggestions');
    
    // Metric Elements
    const billingMetric = document.getElementById('metric-total-billing');
    const taxableMetric = document.getElementById('metric-total-taxable');
    const eligibleMetric = document.getElementById('metric-eligible-itc');
    const ineligibleMetric = document.getElementById('metric-ineligible-itc');
    
    // Button Elements
    const btnClearAll = document.getElementById('btn-clear-all');
    const btnExportExcel = document.getElementById('btn-export-excel');
    const btnAddManual = document.getElementById('btn-add-manual');

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

    // Load saved invoices from PostgreSQL on initial load
    loadInvoices();

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
                    renderTable();
                    updateMetrics();
                    updateBranchSuggestions();
                }
            })
            .catch(error => {
                console.error('Error fetching invoices from database:', error);
            });
    }

    // Financial year runs April -> March; used to sort the month filter
    // dropdown in FY order rather than plain alphabetical/calendar order.
    const FY_MONTH_ORDER = ['April', 'May', 'June', 'July', 'August', 'September',
        'October', 'November', 'December', 'January', 'February', 'March'];

    // Rebuild the FY and Month filter dropdowns from whatever financial
    // years/months are actually present in the currently loaded invoices,
    // so they always reflect real data. Month options are scoped to
    // whichever FY is currently selected (or every month across all years
    // when "All Years" is picked), like the FY -> month drill-down on the
    // Reconciliation page.
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

    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            triggerUpload(files);
        }
    });

    dropZone.addEventListener('click', (e) => {
        if (e.target.closest('label')) return;
        fileInput.click();
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            triggerUpload(fileInput.files);
        }
    });

    cameraInput.addEventListener('change', () => {
        if (cameraInput.files.length > 0) {
            triggerUpload(cameraInput.files);
        }
        cameraInput.value = '';
    });

    // Progress UI Elements
    const progressCounter = document.getElementById('progress-counter');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const uploadSummaryBanner = document.getElementById('upload-summary-banner');
    const summaryBannerText = document.getElementById('summary-banner-text');
    const dismissSummaryBtn = document.getElementById('dismiss-summary-btn');

    if (dismissSummaryBtn) {
        dismissSummaryBtn.addEventListener('click', () => {
            progressContainer.style.display = 'none';
            uploadSummaryBanner.style.display = 'none';
        });
    }

    // Optional bulk path: pick one main folder containing a subfolder per
    // branch (e.g. Bills/Andheri/, Bills/Borivali/) and every subfolder is
    // scanned automatically, tagged with its own branch name.
    if (folderInput) {
        folderInput.addEventListener('change', () => {
            if (folderInput.files.length > 0) {
                const groups = groupFilesByBranchFolder(folderInput.files);
                if (groups.size === 0) {
                    alert('No supported bill files (PDF, JPG, PNG, WEBP, XLSX, XLS, CSV) were found in that folder.');
                } else {
                    triggerFolderUpload(groups);
                }
            }
            folderInput.value = '';
        });
    }

    const SUPPORTED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'xlsx', 'xls', 'csv'];

    // Groups a webkitdirectory FileList by its branch subfolder.
    // Supports direct branch folder selection ("Andheri/inv1.pdf" -> "Andheri")
    // as well as container folder selection ("Bills/Andheri/inv1.pdf" -> "Andheri").
    function groupFilesByBranchFolder(fileList) {
        const groups = new Map();
        Array.from(fileList).forEach(file => {
            if (file.name.startsWith('.') || file.name.startsWith('~$')) return; // Ignore system/temp files

            const ext = (file.name.split('.').pop() || '').toLowerCase();
            if (!SUPPORTED_EXTENSIONS.includes(ext)) return;

            const relPath = file.webkitRelativePath || file.name;
            const parts = relPath.split('/').filter(p => p.trim().length > 0);

            let branch = 'Unassigned';
            if (parts.length === 2) {
                // Direct branch folder: "Andheri/invoice1.pdf" -> "Andheri"
                branch = parts[0];
            } else if (parts.length > 2) {
                // Container folder: "Bills/Andheri/invoice1.pdf" -> "Andheri"
                // Or nested: "Bills/2024/Andheri/invoice1.pdf" -> "Andheri"
                branch = (parts[parts.length - 2] !== parts[0]) ? parts[parts.length - 2] : parts[1];
            }

            branch = branch.trim();
            if (!branch) branch = 'Unassigned';

            if (!groups.has(branch)) groups.set(branch, []);
            groups.get(branch).push(file);
        });
        return groups;
    }

    // Routes uploads through a password-confirm gate when High Accuracy Scan
    // is enabled (slower, forces a full AI vision pass on every field).
    function triggerUpload(files) {
        if (highAccuracyToggle && highAccuracyToggle.checked) {
            pendingHighAccuracyFiles = files;
            haPasswordInput.value = '';
            haPasswordError.style.display = 'none';
            haPasswordOverlay.style.display = 'flex';
            haPasswordInput.focus();
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
            itemIndexCounter: 0
        };
        updateProgressBar();

        if (progressHeading) {
            progressHeading.innerHTML = `<i class="fa-solid fa-folder-tree" style="color: var(--accent-blue);"></i> Uploading Branch Folder: ${totalBranches} Branch(es), ${totalFiles} File(s)...`;
        }

        let index = 0;
        function next() {
            if (index >= totalBranches) {
                // Complete! Show summary report banner
                if (progressHeading) {
                    progressHeading.innerHTML = `<i class="fa-solid fa-circle-check" style="color: var(--accent-green);"></i> Branch Folder Upload Complete`;
                }
                if (uploadSummaryBanner && summaryBannerText) {
                    const errCount = globalBatchState.errorFiles;
                    uploadSummaryBanner.className = errCount > 0 ? 'upload-summary-card error' : 'upload-summary-card';
                    summaryBannerText.innerHTML = `<strong><i class="fa-solid ${errCount > 0 ? 'fa-triangle-exclamation' : 'fa-circle-check'}"></i> Upload Finished:</strong> Processed ${globalBatchState.processedFiles} bill(s) across ${totalBranches} branch(es) (${globalBatchState.successFiles} succeeded${errCount > 0 ? `, ${errCount} failed` : ''}).`;
                    uploadSummaryBanner.style.display = 'flex';
                }

                if (options.onSuccess) options.onSuccess();
                return;
            }

            const [branch, files] = entries[index];
            index++;
            
            handleFileUpload(files, {
                ...options,
                branch: branch,
                appendProgress: true,
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

    // File Upload handling with real-time progress updates
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
                itemIndexCounter: 0
            };
            updateProgressBar();
            if (progressHeading) {
                progressHeading.innerHTML = `<i class="fa-solid fa-spinner fa-spin" style="color: var(--accent-blue);"></i> Processing ${files.length} File(s)...`;
            }
        }

        const formData = new FormData();
        const activeBranch = options.branch !== undefined ? options.branch : branchInput.value.trim();
        formData.append('branch', activeBranch);
        if (options.highAccuracy) {
            formData.append('high_accuracy', 'true');
            formData.append('confirm_password', options.password || '');
        }

        const statusLabel = options.highAccuracy
            ? 'High accuracy scanning...'
            : 'Extracting & saving...';

        const itemIds = [];
        Array.from(files).forEach((file) => {
            formData.append('files[]', file);
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
            itemIds.forEach(itemId => {
                const statusSpan = document.getElementById(`status-${itemId}`);
                if (statusSpan) {
                    statusSpan.className = 'progress-status success';
                    statusSpan.innerHTML = '<i class="fa-solid fa-circle-check"></i> Processed';
                }
            });

            globalBatchState.processedFiles += files.length;
            globalBatchState.successFiles += files.length;
            updateProgressBar();

            // Add newly saved invoices to state
            if (data.invoices && data.invoices.length > 0) {
                const validInvoices = data.invoices.filter(inv => inv.id !== null);
                invoices = [...validInvoices, ...invoices];
                populateFilters();
                renderTable();
                updateMetrics();
                updateBranchSuggestions();
            }

            if (!options.appendProgress) {
                if (progressHeading) {
                    progressHeading.innerHTML = `<i class="fa-solid fa-circle-check" style="color: var(--accent-green);"></i> Upload Complete`;
                }
                if (uploadSummaryBanner && summaryBannerText) {
                    summaryBannerText.innerHTML = `<strong><i class="fa-solid fa-circle-check"></i> Upload Successful:</strong> Processed ${files.length} file(s).`;
                    uploadSummaryBanner.className = 'upload-summary-card';
                    uploadSummaryBanner.style.display = 'flex';
                }
            }

            if (options.onSuccess) options.onSuccess();
        })
        .catch(error => {
            console.error('Error uploading invoices:', error);
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

    // Populate the branch datalist with previously used branch names
    function updateBranchSuggestions() {
        const branches = [...new Set(invoices.map(inv => inv.branch).filter(b => b && b !== 'Unassigned'))].sort();
        branchSuggestions.innerHTML = branches.map(b => `<option value="${b}"></option>`).join('');
    }

    // Shared by the table render and the Excel export, so "export" always
    // means "export exactly what's currently shown", not everything ever
    // uploaded.
    function getFilteredInvoices() {
        const query = searchInput.value.toLowerCase().trim();
        const fyValue = fyFilter.value;
        const monthValue = monthFilter.value;
        return invoices.filter(inv => {
            const matchesSearch = (
                (inv.vendor_name || '').toLowerCase().includes(query) ||
                (inv.invoice_number || '').toLowerCase().includes(query) ||
                (inv.gstin || '').toLowerCase().includes(query)
            );
            const matchesFy = !fyValue || inv.financial_year === fyValue;
            const matchesMonth = !monthValue || inv.month === monthValue;
            return matchesSearch && matchesFy && matchesMonth;
        });
    }

    // Render Invoices Table
    function renderTable() {
        const filteredInvoices = getFilteredInvoices();
        const colCount = window.IS_ADMIN ? 15 : 14;

        if (filteredInvoices.length === 0) {
            tableBody.innerHTML = `
                <tr class="empty-state-row">
                    <td colspan="${colCount}">
                        <div class="empty-state">
                            <i class="fa-solid fa-receipt"></i>
                            <p>${query ? 'No matching invoices found.' : 'No invoices processed yet. Drag & drop or upload files above.'}</p>
                        </div>
                    </td>
                </tr>
            `;
            invoiceCountText.textContent = '0 Invoices Loaded';
            return;
        }

        invoiceCountText.textContent = `${filteredInvoices.length} Invoice(s) Loaded`;
        tableBody.innerHTML = '';

        filteredInvoices.forEach((inv, index) => {
            const tr = document.createElement('tr');
            tr.dataset.index = index;
            tr.innerHTML = `
                <td><input type="text" class="field-branch" list="branch-suggestions" value="${inv.branch || ''}"></td>
                <td><input type="text" class="field-gstin" value="${inv.gstin || ''}"></td>
                <td><input type="text" class="field-number" value="${inv.invoice_number || ''}"></td>
                <td><input type="text" class="field-date" value="${inv.invoice_date || ''}"></td>
                <td><input type="text" class="field-payment-date" placeholder="DD-MM-YYYY" value="${inv.payment_date || ''}"></td>
                <td><input type="text" class="field-vendor" value="${inv.vendor_name || ''}"></td>
                <td class="numeric"><input type="number" step="0.01" class="field-taxable" value="${(inv.taxable_value || 0).toFixed(2)}"></td>
                <td class="numeric"><input type="number" step="0.01" class="field-cgst" value="${(inv.cgst || 0).toFixed(2)}"></td>
                <td class="numeric"><input type="number" step="0.01" class="field-sgst" value="${(inv.sgst || 0).toFixed(2)}"></td>
                <td class="numeric"><input type="number" step="0.01" class="field-igst" value="${(inv.igst || 0).toFixed(2)}"></td>
                <td class="checkbox-cell"><input type="checkbox" class="field-itc-blocked" title="Section 17(5) blocked credit / fully ineligible" ${inv.itc_blocked ? 'checked' : ''}></td>
                <td class="numeric eligible-column font-bold" id="row-eligible-${index}">₹${(inv.eligible_itc || 0).toFixed(2)}</td>
                <td class="numeric ineligible-column" id="row-ineligible-${index}">₹${(inv.ineligible_itc || 0).toFixed(2)}</td>
                ${window.IS_ADMIN ? `<td class="col-owner">${inv.username || ''}</td>` : ''}
                <td class="actions-cell">
                    ${inv.has_file ? `
                    <button class="btn-view-file" title="View original bill" data-id="${inv.id}">
                        <i class="fa-solid fa-file-invoice"></i>
                    </button>` : ''}
                    <button class="btn-delete" title="Remove row">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            `;

            // Row-level listeners to update state & save changes to Postgres database
            const inputs = tr.querySelectorAll('input');
            inputs.forEach(input => {
                input.addEventListener('change', (e) => {
                    updateStateFromRow(tr, index);
                });
            });

            tr.querySelector('.btn-delete').addEventListener('click', () => {
                deleteInvoice(index);
            });

            const viewFileBtn = tr.querySelector('.btn-view-file');
            if (viewFileBtn) {
                viewFileBtn.addEventListener('click', () => {
                    window.open(`/api/invoice-file/${viewFileBtn.dataset.id}`, '_blank');
                });
            }

            tableBody.appendChild(tr);
        });
    }

    // Sync input values with invoice state, calculate 50% split, and POST update to database
    function updateStateFromRow(rowEl, index) {
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

        // Update local state
        invoices[index] = {
            ...invoices[index],
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
    function deleteInvoice(index) {
        const inv = invoices[index];
        if (!inv.id) {
            // Unsaved error row
            invoices.splice(index, 1);
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
                invoices.splice(index, 1);
                renderTable();
                updateMetrics();
            }
        })
        .catch(error => {
            console.error('Error deleting invoice:', error);
            alert('Failed to delete invoice from database.');
        });
    }

    // Sum totals and refresh dashboard widgets
    function updateMetrics() {
        let totalTaxable = 0;
        let totalCgst = 0;
        let totalSgst = 0;
        let totalIgst = 0;
        let totalEligible = 0;
        let totalIneligible = 0;

        invoices.forEach(inv => {
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

        billingMetric.textContent = formatCurrency(totalBilling);
        taxableMetric.textContent = formatCurrency(totalTaxable);
        eligibleMetric.textContent = formatCurrency(totalEligible);
        ineligibleMetric.textContent = formatCurrency(totalIneligible);
    }

    // Search bar functionality
    searchInput.addEventListener('input', () => {
        renderTable();
    });

    // FY filter dropdown -- changing the year narrows the month dropdown to
    // just the months present within that year, then re-renders.
    fyFilter.addEventListener('change', () => {
        monthFilter.value = '';
        populateFilters();
        renderTable();
    });

    // Month filter dropdown
    monthFilter.addEventListener('change', () => {
        renderTable();
    });

    // Clear All records for user
    // "Clear All" only deletes whatever the active FY/month/search filter
    // is currently showing -- not silently every bill ever entered -- and
    // requires typing DELETE rather than a single OK/Cancel popup, since
    // it permanently removes the original file attachments too.
    btnClearAll.addEventListener('click', () => {
        if (invoices.length === 0) {
            alert('No invoices loaded. Nothing to clear.');
            return;
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

    clearAllBtn.addEventListener('click', () => {
        if (!window.IS_ADMIN) {
            alert('Clear All is an Administrator-only action. Contact your admin to perform bulk invoice deletion.');
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
        document.getElementById('mb-branch').value = branchInput.value.trim();
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
});
