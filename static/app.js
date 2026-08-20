document.addEventListener('DOMContentLoaded', () => {
    // State management
    let invoices = [];
    
    // DOM Elements
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const cameraInput = document.getElementById('camera-input');
    const progressContainer = document.getElementById('progress-container');
    const progressList = document.getElementById('progress-list');
    const tableBody = document.getElementById('invoice-table-body');
    const searchInput = document.getElementById('table-search');
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
                    renderTable();
                    updateMetrics();
                    updateBranchSuggestions();
                }
            })
            .catch(error => {
                console.error('Error fetching invoices from database:', error);
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

    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            handleFileUpload(files);
        }
    });

    dropZone.addEventListener('click', (e) => {
        if (e.target.closest('label')) return;
        fileInput.click();
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            handleFileUpload(fileInput.files);
        }
    });

    cameraInput.addEventListener('change', () => {
        if (cameraInput.files.length > 0) {
            handleFileUpload(cameraInput.files);
        }
        cameraInput.value = '';
    });

    // File Upload handling
    function handleFileUpload(files) {
        progressContainer.style.display = 'block';
        progressList.innerHTML = '';
        
        const formData = new FormData();
        formData.append('branch', branchInput.value.trim());

        Array.from(files).forEach((file, index) => {
            formData.append('files[]', file);
            
            const progressItem = document.createElement('div');
            progressItem.className = 'progress-item';
            progressItem.id = `upload-item-${index}`;
            progressItem.innerHTML = `
                <div class="progress-file-info">
                    <i class="fa-solid fa-file-invoice"></i>
                    <span class="progress-filename">${file.name}</span>
                </div>
                <span class="progress-status" id="upload-status-${index}">
                    <i class="fa-solid fa-spinner fa-spin"></i> Extracting & saving...
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
            if (!response.ok) throw new Error('Failed to process documents');
            return response.json();
        })
        .then(data => {
            Array.from(files).forEach((file, index) => {
                const statusSpan = document.getElementById(`upload-status-${index}`);
                if (statusSpan) {
                    statusSpan.className = 'progress-status success';
                    statusSpan.innerHTML = '<i class="fa-solid fa-circle-check"></i> Processed';
                }
            });
            
            // Add newly saved invoices to state
            if (data.invoices && data.invoices.length > 0) {
                // Filter out any errored rows from merging into invoices list
                const validInvoices = data.invoices.filter(inv => inv.id !== null);
                invoices = [...validInvoices, ...invoices];
                renderTable();
                updateMetrics();
                updateBranchSuggestions();
            }
            
            setTimeout(() => {
                progressContainer.style.display = 'none';
            }, 3000);
        })
        .catch(error => {
            console.error('Error uploading invoices:', error);
            Array.from(files).forEach((file, index) => {
                const statusSpan = document.getElementById(`upload-status-${index}`);
                if (statusSpan) {
                    statusSpan.className = 'progress-status error';
                    statusSpan.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Failed';
                }
            });
        });
    }

    // Populate the branch datalist with previously used branch names
    function updateBranchSuggestions() {
        const branches = [...new Set(invoices.map(inv => inv.branch).filter(b => b && b !== 'Unassigned'))].sort();
        branchSuggestions.innerHTML = branches.map(b => `<option value="${b}"></option>`).join('');
    }

    // Render Invoices Table
    function renderTable() {
        const query = searchInput.value.toLowerCase().trim();
        const filteredInvoices = invoices.filter(inv => {
            return (
                (inv.vendor_name || '').toLowerCase().includes(query) ||
                (inv.invoice_number || '').toLowerCase().includes(query)
            );
        });

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
                
                // Update table values
                document.getElementById(`row-eligible-${index}`).textContent = `₹${data.eligible_itc.toFixed(2)}`;
                document.getElementById(`row-ineligible-${index}`).textContent = `₹${data.ineligible_itc.toFixed(2)}`;
                
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

    // Clear All records for user
    btnClearAll.addEventListener('click', () => {
        if (invoices.length > 0 && confirm('Are you sure you want to clear all invoices from the database? This cannot be undone.')) {
            fetch('/api/clear-invoices', {
                method: 'POST'
            })
            .then(response => {
                if (!response.ok) throw new Error('Failed to clear invoices');
                return response.json();
            })
            .then(data => {
                if (data.success) {
                    invoices = [];
                    renderTable();
                    updateMetrics();
                }
            })
            .catch(error => {
                console.error('Error clearing invoices:', error);
                alert('Failed to clear invoices from database.');
            });
        }
    });

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
                invoices = [newInvoice, ...invoices];
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
        if (invoices.length === 0) {
            alert('No invoices loaded. Please upload invoices to export.');
            return;
        }

        btnExportExcel.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating Excel...';
        btnExportExcel.disabled = true;

        fetch('/api/export-excel', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ invoices })
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
