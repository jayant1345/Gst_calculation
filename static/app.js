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
    
    // Metric Elements
    const billingMetric = document.getElementById('metric-total-billing');
    const taxableMetric = document.getElementById('metric-total-taxable');
    const eligibleMetric = document.getElementById('metric-eligible-itc');
    const ineligibleMetric = document.getElementById('metric-ineligible-itc');
    
    // Button Elements
    const btnClearAll = document.getElementById('btn-clear-all');
    const btnExportExcel = document.getElementById('btn-export-excel');

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

    // Render Invoices Table
    function renderTable() {
        const query = searchInput.value.toLowerCase().trim();
        const filteredInvoices = invoices.filter(inv => {
            return (
                (inv.vendor_name || '').toLowerCase().includes(query) ||
                (inv.invoice_number || '').toLowerCase().includes(query)
            );
        });

        const colCount = window.IS_ADMIN ? 11 : 10;

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
                <td><input type="text" class="field-number" value="${inv.invoice_number || ''}"></td>
                <td><input type="text" class="field-date" value="${inv.invoice_date || ''}"></td>
                <td><input type="text" class="field-vendor" value="${inv.vendor_name || ''}"></td>
                <td class="numeric"><input type="number" step="0.01" class="field-taxable" value="${(inv.taxable_value || 0).toFixed(2)}"></td>
                <td class="numeric"><input type="number" step="0.01" class="field-cgst" value="${(inv.cgst || 0).toFixed(2)}"></td>
                <td class="numeric"><input type="number" step="0.01" class="field-sgst" value="${(inv.sgst || 0).toFixed(2)}"></td>
                <td class="numeric"><input type="number" step="0.01" class="field-igst" value="${(inv.igst || 0).toFixed(2)}"></td>
                <td class="numeric eligible-column font-bold" id="row-eligible-${index}">₹${(inv.eligible_itc || 0).toFixed(2)}</td>
                <td class="numeric ineligible-column" id="row-ineligible-${index}">₹${(inv.ineligible_itc || 0).toFixed(2)}</td>
                ${window.IS_ADMIN ? `<td class="col-owner">${inv.username || ''}</td>` : ''}
                <td>
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

            tableBody.appendChild(tr);
        });
    }

    // Sync input values with invoice state, calculate 50% split, and POST update to database
    function updateStateFromRow(rowEl, index) {
        const invNum = rowEl.querySelector('.field-number').value;
        const invDate = rowEl.querySelector('.field-date').value;
        const vendor = rowEl.querySelector('.field-vendor').value;
        const taxable = parseFloat(rowEl.querySelector('.field-taxable').value) || 0;
        const cgst = parseFloat(rowEl.querySelector('.field-cgst').value) || 0;
        const sgst = parseFloat(rowEl.querySelector('.field-sgst').value) || 0;
        const igst = parseFloat(rowEl.querySelector('.field-igst').value) || 0;

        const totalGst = cgst + sgst + igst;
        const halfGst = totalGst * 0.5;

        // Update local state
        invoices[index] = {
            ...invoices[index],
            invoice_number: invNum,
            invoice_date: invDate,
            vendor_name: vendor,
            taxable_value: taxable,
            cgst: cgst,
            sgst: sgst,
            igst: igst,
            eligible_itc: halfGst,
            ineligible_itc: halfGst
        };

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
