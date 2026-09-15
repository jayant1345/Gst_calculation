document.addEventListener('DOMContentLoaded', () => {
    const tabButtons = document.querySelectorAll('.gl-tab-btn');
    const tabPanels = {
        ledger: document.getElementById('gl-tab-ledger'),
        scan: document.getElementById('gl-tab-scan'),
        manual: document.getElementById('gl-tab-manual')
    };
    if (!tabButtons.length) return; // Section not present on this page

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            tabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            Object.entries(tabPanels).forEach(([key, panel]) => {
                if (panel) panel.style.display = key === btn.dataset.tab ? 'block' : 'none';
            });
        });
    });

    const progressContainer = document.getElementById('gl-progress-container');
    const progressList = document.getElementById('gl-progress-list');
    const uploadFyInput = document.getElementById('gl-upload-fy');
    const uploadMonthSelect = document.getElementById('gl-upload-month');

    function showProgress(filenames) {
        progressContainer.style.display = 'block';
        progressList.innerHTML = filenames.map((name, i) => `
            <div class="progress-item" id="gl-upload-item-${i}">
                <div class="progress-file-info">
                    <i class="fa-solid fa-file-invoice"></i>
                    <span class="progress-filename">${name}</span>
                </div>
                <span class="progress-status" id="gl-upload-status-${i}">
                    <i class="fa-solid fa-spinner fa-spin"></i> Processing...
                </span>
            </div>
        `).join('');
    }

    function finishProgress(results) {
        results.forEach((r, i) => {
            const statusSpan = document.getElementById(`gl-upload-status-${i}`);
            if (!statusSpan) return;
            if (r.error) {
                statusSpan.className = 'progress-status error';
                statusSpan.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> ${r.error}`;
            } else {
                statusSpan.className = 'progress-status success';
                statusSpan.innerHTML = r.needs_review
                    ? `<i class="fa-solid fa-triangle-exclamation"></i> Saved (needs review: ${r.review_reason})`
                    : `<i class="fa-solid fa-circle-check"></i> Saved: ${r.branch || ''} / ${r.gl_code || ''} - ₹${(r.voucher_amount || 0).toFixed(2)}`;
            }
        });
        setTimeout(() => { progressContainer.style.display = 'none'; }, 5000);
    }

    function uploadGlFiles(files, mode) {
        if (!files.length) return;
        const filenames = Array.from(files).map(f => f.name);
        showProgress(filenames);

        const formData = new FormData();
        formData.append('mode', mode);
        formData.append('financial_year', uploadFyInput.value.trim());
        formData.append('month', uploadMonthSelect.value);
        Array.from(files).forEach(f => formData.append('gl_files', f));

        fetch('/api/upload-gl-voucher', { method: 'POST', body: formData })
            .then(async res => {
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || 'Upload failed.');
                return data;
            })
            .then(data => {
                finishProgress(data.results || []);
                loadGlTallyReport();
            })
            .catch(err => {
                console.error('GL voucher upload error:', err);
                alert(err.message || 'Failed to upload GL voucher file(s).');
                progressContainer.style.display = 'none';
            });
    }

    // Ledger upload drop zone
    const ledgerDropZone = document.getElementById('gl-ledger-drop-zone');
    const ledgerFileInput = document.getElementById('gl-ledger-file-input');
    if (ledgerDropZone && ledgerFileInput) {
        ledgerDropZone.addEventListener('click', (e) => {
            if (e.target.closest('label')) return;
            ledgerFileInput.click();
        });
        ledgerFileInput.addEventListener('change', () => uploadGlFiles(ledgerFileInput.files, 'ledger'));
        ['dragenter', 'dragover'].forEach(ev => ledgerDropZone.addEventListener(ev, (e) => {
            e.preventDefault(); e.stopPropagation(); ledgerDropZone.classList.add('dragging');
        }));
        ['dragleave', 'drop'].forEach(ev => ledgerDropZone.addEventListener(ev, (e) => {
            e.preventDefault(); e.stopPropagation(); ledgerDropZone.classList.remove('dragging');
        }));
        ledgerDropZone.addEventListener('drop', (e) => uploadGlFiles(e.dataTransfer.files, 'ledger'));
    }

    // Scan/photo drop zone
    const scanDropZone = document.getElementById('gl-scan-drop-zone');
    const scanFileInput = document.getElementById('gl-scan-file-input');
    if (scanDropZone && scanFileInput) {
        scanDropZone.addEventListener('click', (e) => {
            if (e.target.closest('label')) return;
            scanFileInput.click();
        });
        scanFileInput.addEventListener('change', () => uploadGlFiles(scanFileInput.files, 'scan'));
        ['dragenter', 'dragover'].forEach(ev => scanDropZone.addEventListener(ev, (e) => {
            e.preventDefault(); e.stopPropagation(); scanDropZone.classList.add('dragging');
        }));
        ['dragleave', 'drop'].forEach(ev => scanDropZone.addEventListener(ev, (e) => {
            e.preventDefault(); e.stopPropagation(); scanDropZone.classList.remove('dragging');
        }));
        scanDropZone.addEventListener('drop', (e) => uploadGlFiles(e.dataTransfer.files, 'scan'));
    }

    // Manual voucher entry form
    window.populateGlVoucherCodeDropdown = function () {
        const sel = document.getElementById('glm-gl-code');
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = '<option value="">-- Select --</option>' +
            (window.expenseCodes || []).slice().sort((a, b) => a.code.localeCompare(b.code))
                .map(c => `<option value="${c.code}">${c.code} - ${c.particulars}</option>`).join('');
        sel.value = current;
    };
    window.populateGlVoucherCodeDropdown();

    const glManualForm = document.getElementById('gl-manual-form');
    if (glManualForm) {
        glManualForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const saveBtn = document.getElementById('gl-manual-save');
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

            const branch = document.getElementById('glm-branch').value.trim();
            const fy = document.getElementById('glm-fy').value.trim();
            const month = document.getElementById('glm-month').value;
            const glCode = document.getElementById('glm-gl-code').value;
            const amount = parseFloat(document.getElementById('glm-amount').value) || 0;

            if (!branch || !fy || !glCode) {
                alert('Branch, Financial Year, and GL Code are required.');
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Add Voucher Entry';
                return;
            }

            const formData = new FormData();
            formData.append('mode', 'manual');
            formData.append('financial_year', fy);
            formData.append('month', month);
            formData.append('branch', branch);
            formData.append('gl_code', glCode);
            formData.append('amount', amount);

            fetch('/api/save-gl-voucher-manual', { method: 'POST', body: formData })
                .then(async res => {
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(data.error || 'Failed to save voucher entry.');
                    return data;
                })
                .then(() => {
                    glManualForm.reset();
                    loadGlTallyReport();
                })
                .catch(err => {
                    console.error('Manual GL voucher save error:', err);
                    alert(err.message || 'Failed to save voucher entry.');
                })
                .finally(() => {
                    saveBtn.disabled = false;
                    saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Add Voucher Entry';
                });
        });
    }

    // Manage Expense GL Codes modal
    const expenseCodesModalOverlay = document.getElementById('expenseCodesModalOverlay');
    const expenseCodesModalClose = document.getElementById('expenseCodesModalClose');
    const expenseCodeForm = document.getElementById('expenseCodeForm');
    const expenseCodeFormMsg = document.getElementById('expenseCodeFormMsg');
    const expenseCodesTableBody = document.getElementById('expenseCodesTableBody');
    const expenseCodeSearchInput = document.getElementById('expenseCodeSearchInput');
    const expenseCodeSearchCount = document.getElementById('expenseCodeSearchCount');

    function openExpenseCodesModal() {
        if (!expenseCodesModalOverlay) return;
        expenseCodesModalOverlay.style.display = 'flex';
        renderExpenseCodesTable();
    }
    function closeExpenseCodesModal() {
        if (expenseCodesModalOverlay) expenseCodesModalOverlay.style.display = 'none';
    }

    ['btn-manage-expense-codes', 'mb-manage-expense-codes-btn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', (e) => { e.preventDefault(); openExpenseCodesModal(); });
    });
    if (expenseCodesModalClose) expenseCodesModalClose.addEventListener('click', closeExpenseCodesModal);
    if (expenseCodesModalOverlay) {
        expenseCodesModalOverlay.addEventListener('click', (e) => {
            if (e.target === expenseCodesModalOverlay) closeExpenseCodesModal();
        });
    }

    function renderExpenseCodesTable() {
        if (!expenseCodesTableBody) return;
        const query = expenseCodeSearchInput ? expenseCodeSearchInput.value.toLowerCase().trim() : '';
        const codes = (window.expenseCodes || []).filter(c =>
            !query || c.code.toLowerCase().includes(query) || (c.particulars || '').toLowerCase().includes(query)
        ).sort((a, b) => a.code.localeCompare(b.code));

        if (expenseCodeSearchCount) expenseCodeSearchCount.textContent = `${codes.length} code(s)`;

        if (codes.length === 0) {
            expenseCodesTableBody.innerHTML = `<tr><td colspan="4" style="padding: 16px; text-align: center; color: #94a3b8;">No expense GL codes yet. Add one above.</td></tr>`;
            return;
        }

        expenseCodesTableBody.innerHTML = codes.map(c => `
            <tr style="border-top: 1px solid var(--border-color);">
                <td style="padding: 8px 10px; font-family: monospace;">${c.code}</td>
                <td style="padding: 8px 10px;">${c.particulars}</td>
                <td style="padding: 8px 10px; color: #64748b;">${c.category || ''}</td>
                <td style="padding: 8px 10px;">
                    <button type="button" class="btn-edit-expense-code" data-code="${c.code}" title="Edit"><i class="fa-solid fa-pen"></i></button>
                    <button type="button" class="btn-delete-expense-code" data-code="${c.code}" title="Delete"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `).join('');

        expenseCodesTableBody.querySelectorAll('.btn-edit-expense-code').forEach(btn => {
            btn.addEventListener('click', () => {
                const c = window.expenseCodes.find(x => x.code === btn.dataset.code);
                if (!c) return;
                document.getElementById('expenseCodeInputCode').value = c.code;
                document.getElementById('expenseCodeInputParticulars').value = c.particulars;
                document.getElementById('expenseCodeInputCategory').value = c.category || '';
            });
        });
        expenseCodesTableBody.querySelectorAll('.btn-delete-expense-code').forEach(btn => {
            btn.addEventListener('click', () => {
                if (!confirm(`Delete Expense GL code ${btn.dataset.code}? Bills/vouchers already tagged with it are left as-is.`)) return;
                fetch(`/api/expense-codes-master/${encodeURIComponent(btn.dataset.code)}`, { method: 'DELETE' })
                    .then(async res => {
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok) throw new Error(data.error || 'Failed to delete code.');
                        return data;
                    })
                    .then(() => loadExpenseCodes().then(renderExpenseCodesTable))
                    .catch(err => alert(err.message || 'Failed to delete code.'));
            });
        });
    }

    if (expenseCodeSearchInput) expenseCodeSearchInput.addEventListener('input', renderExpenseCodesTable);

    if (expenseCodeForm) {
        expenseCodeForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const code = document.getElementById('expenseCodeInputCode').value.trim();
            const particulars = document.getElementById('expenseCodeInputParticulars').value.trim();
            const category = document.getElementById('expenseCodeInputCategory').value.trim();

            fetch('/api/expense-codes-master', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, particulars, category })
            })
            .then(async res => {
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || 'Failed to save code.');
                return data;
            })
            .then(() => {
                expenseCodeForm.reset();
                if (expenseCodeFormMsg) {
                    expenseCodeFormMsg.style.display = 'block';
                    expenseCodeFormMsg.style.background = '#dcfce7';
                    expenseCodeFormMsg.style.color = '#166534';
                    expenseCodeFormMsg.textContent = `Saved GL code ${code}.`;
                    setTimeout(() => { expenseCodeFormMsg.style.display = 'none'; }, 3000);
                }
                return loadExpenseCodes();
            })
            .then(() => renderExpenseCodesTable())
            .catch(err => {
                if (expenseCodeFormMsg) {
                    expenseCodeFormMsg.style.display = 'block';
                    expenseCodeFormMsg.style.background = '#fee2e2';
                    expenseCodeFormMsg.style.color = '#991b1b';
                    expenseCodeFormMsg.textContent = err.message || 'Failed to save code.';
                }
            });
        });
    }

    // Tally report
    const glTallyTableBody = document.getElementById('gl-tally-table-body');
    const btnRefreshGlTally = document.getElementById('btn-refresh-gl-tally');

    function statusPillClass(status) {
        switch (status) {
            case 'Matched': return 'gl-status-matched';
            case 'Mismatch': return 'gl-status-mismatch';
            case 'Missing in Bills': return 'gl-status-missing-bills';
            case 'Missing in Voucher': return 'gl-status-missing-voucher';
            default: return '';
        }
    }

    function loadGlTallyReport() {
        if (!glTallyTableBody) return;
        fetch('/api/gl-tally-report')
            .then(res => res.json())
            .then(data => {
                const report = data.report || [];
                if (report.length === 0) {
                    glTallyTableBody.innerHTML = `
                        <tr class="empty-state-row">
                            <td colspan="8">
                                <div class="empty-state">
                                    <i class="fa-solid fa-scale-balanced"></i>
                                    <p>No tally data yet. Upload a branch ledger export, scan a voucher, or add one manually above.</p>
                                </div>
                            </td>
                        </tr>`;
                    return;
                }
                glTallyTableBody.innerHTML = report.map(r => `
                    <tr>
                        <td>${r.branch}</td>
                        <td style="font-family: monospace;">${r.gl_code}</td>
                        <td>${r.particulars}</td>
                        <td>${r.month} ${r.financial_year}</td>
                        <td class="numeric">₹${r.bills_total.toFixed(2)} <span style="color:#94a3b8; font-size: 11px;">(${r.bill_count} bill${r.bill_count === 1 ? '' : 's'})</span></td>
                        <td class="numeric">₹${r.voucher_total.toFixed(2)}</td>
                        <td class="numeric">₹${r.difference.toFixed(2)}</td>
                        <td><span class="gl-status-pill ${statusPillClass(r.status)}">${r.status}</span></td>
                    </tr>
                `).join('');
            })
            .catch(err => console.error('Error loading GL tally report:', err));
    }

    if (btnRefreshGlTally) btnRefreshGlTally.addEventListener('click', loadGlTallyReport);

    loadGlTallyReport();
});
