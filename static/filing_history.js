(function () {
    'use strict';

    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    var ACTION_LABELS = {
        bill_added: { label: 'Bill Added', badge: 'badge-blue', icon: 'fa-receipt' },
        bill_upload: { label: 'Bill Upload', badge: 'badge-blue', icon: 'fa-file-arrow-up' },
        bill_corrected: { label: 'Bill Corrected', badge: 'badge-yellow', icon: 'fa-wand-magic-sparkles' },
        bill_rescanned: { label: 'Bill Re-scanned', badge: 'badge-purple', icon: 'fa-arrows-rotate' },
        bills_cleared: { label: 'Bills Cleared', badge: 'badge-red', icon: 'fa-trash-can' },
        gstr2b_upload: { label: 'GSTR-2B Import', badge: 'badge-blue', icon: 'fa-file-arrow-up' },
        export_excel: { label: 'Excel Export', badge: 'badge-green', icon: 'fa-file-excel' },
        export_annual_report: { label: 'Annual Report Export', badge: 'badge-green', icon: 'fa-file-excel' },
        export_vendor_discrepancy: { label: 'Vendor Discrepancy Export', badge: 'badge-yellow', icon: 'fa-file-excel' }
    };

    function formatDateTime(iso) {
        if (!iso) return '-';
        // created_at is stored/serialized as a naive UTC timestamp (no 'Z' or
        // offset), so without this the browser misreads it as already-local
        // time. Mark it UTC explicitly, then render in IST regardless of the
        // viewer's own device timezone.
        var hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(iso);
        var d = new Date(hasTz ? iso : iso + 'Z');
        if (isNaN(d.getTime())) return iso;
        return d.toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        }) + ' IST';
    }

    function renderRows(history, isAdmin) {
        var tbody = document.getElementById('history-table-body');
        if (!history.length) {
            var colspan = isAdmin ? 7 : 6;
            tbody.innerHTML = '<tr class="empty-state-row"><td colspan="' + colspan + '">' +
                '<div class="empty-state"><i class="fa-solid fa-circle-check"></i>' +
                '<p>No activity recorded yet.</p></div></td></tr>';
            return;
        }

        var rows = history.map(function (entry) {
            var meta = ACTION_LABELS[entry.action] || { label: entry.action, badge: 'badge-blue', icon: 'fa-circle-info' };
            var userCell = isAdmin ? '<td>' + escapeHtml(entry.username) + '</td>' : '';
            return '<tr>' +
                '<td>' + escapeHtml(formatDateTime(entry.created_at)) + '</td>' +
                '<td><span class="badge ' + meta.badge + '"><i class="fa-solid ' + meta.icon + '"></i> ' + escapeHtml(meta.label) + '</span></td>' +
                '<td>' + escapeHtml(entry.description || '-') + '</td>' +
                '<td>' + escapeHtml(entry.financial_year || '-') + '</td>' +
                '<td>' + escapeHtml(entry.month || '-') + '</td>' +
                '<td class="text-right">' + escapeHtml(entry.record_count !== null && entry.record_count !== undefined ? entry.record_count : '-') + '</td>' +
                userCell +
                '</tr>';
        });

        tbody.innerHTML = rows.join('');
    }

    function loadHistory() {
        var statusEl = document.getElementById('history-status');
        var wrapperEl = document.getElementById('history-table-wrapper');
        var table = document.getElementById('history-table');
        var isAdmin = table.querySelectorAll('thead th').length === 7;

        fetch('/api/filing-history')
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (data.error) {
                    statusEl.textContent = 'Failed to load activity log: ' + data.error;
                    return;
                }
                renderRows(data.history || [], isAdmin);
                statusEl.style.display = 'none';
                wrapperEl.style.display = '';
            })
            .catch(function (err) {
                statusEl.textContent = 'Failed to load activity log. Please refresh the page.';
                console.error('Filing history load error:', err);
            });
    }

    function renderSummaryRows(summary, isAdmin) {
        var tbody = document.getElementById('summary-table-body');
        if (!summary.length) {
            var colspan = isAdmin ? 4 : 3;
            tbody.innerHTML = '<tr class="empty-state-row"><td colspan="' + colspan + '">' +
                '<div class="empty-state"><i class="fa-solid fa-circle-check"></i>' +
                '<p>No bills entered yet.</p></div></td></tr>';
            return;
        }

        var rows = summary.map(function (entry) {
            var userCell = isAdmin ? '<td>' + escapeHtml(entry.username) + '</td>' : '';
            return '<tr>' +
                '<td>' + escapeHtml(entry.financial_year || '-') + '</td>' +
                '<td>' + escapeHtml(entry.month || '-') + '</td>' +
                userCell +
                '<td class="text-right">' + escapeHtml(entry.bill_count) + '</td>' +
                '</tr>';
        });

        tbody.innerHTML = rows.join('');
    }

    function renderYearlyRows(summary, isAdmin) {
        var tbody = document.getElementById('yearly-table-body');

        // Roll the already-fetched monthly rows up to FY (+ user) totals
        // client-side -- no separate endpoint needed, same source data.
        var totals = {};
        var order = [];
        summary.forEach(function (entry) {
            var key = entry.financial_year + '||' + (isAdmin ? entry.username : '');
            if (!(key in totals)) {
                totals[key] = { financial_year: entry.financial_year, username: entry.username, bill_count: 0 };
                order.push(key);
            }
            totals[key].bill_count += Number(entry.bill_count) || 0;
        });
        var yearly = order.map(function (key) { return totals[key]; });

        if (!yearly.length) {
            var colspan = isAdmin ? 3 : 2;
            tbody.innerHTML = '<tr class="empty-state-row"><td colspan="' + colspan + '">' +
                '<div class="empty-state"><i class="fa-solid fa-circle-check"></i>' +
                '<p>No bills entered yet.</p></div></td></tr>';
            return;
        }

        var rows = yearly.map(function (entry) {
            var userCell = isAdmin ? '<td>' + escapeHtml(entry.username) + '</td>' : '';
            return '<tr>' +
                '<td>' + escapeHtml(entry.financial_year || '-') + '</td>' +
                userCell +
                '<td class="text-right">' + escapeHtml(entry.bill_count) + '</td>' +
                '</tr>';
        });

        tbody.innerHTML = rows.join('');
    }

    function loadMonthlySummary() {
        var statusEl = document.getElementById('summary-status');
        var wrapperEl = document.getElementById('summary-table-wrapper');
        var table = document.getElementById('summary-table');
        var isAdmin = table.querySelectorAll('thead th').length === 4;

        var yearlyStatusEl = document.getElementById('yearly-status');
        var yearlyWrapperEl = document.getElementById('yearly-table-wrapper');

        fetch('/api/monthly-bill-summary')
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (data.error) {
                    statusEl.textContent = 'Failed to load monthly summary: ' + data.error;
                    yearlyStatusEl.textContent = 'Failed to load yearly summary: ' + data.error;
                    return;
                }
                var summary = data.summary || [];
                renderSummaryRows(summary, isAdmin);
                statusEl.style.display = 'none';
                wrapperEl.style.display = '';

                renderYearlyRows(summary, isAdmin);
                yearlyStatusEl.style.display = 'none';
                yearlyWrapperEl.style.display = '';
            })
            .catch(function (err) {
                statusEl.textContent = 'Failed to load monthly summary. Please refresh the page.';
                yearlyStatusEl.textContent = 'Failed to load yearly summary. Please refresh the page.';
                console.error('Monthly summary load error:', err);
            });
    }

    document.addEventListener('DOMContentLoaded', function () {
        loadHistory();
        loadMonthlySummary();
    });
})();
