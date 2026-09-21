// CA Material Sorter (Part 4) -- pure client-side, browser-only. No file
// content is ever uploaded anywhere; this reads the selected folder's
// relative paths locally and writes the reorganized result straight to a
// real output folder on disk (via the File System Access API, the same
// Chromium capability already relied on for the source folder picker), so
// the result is immediately usable in the regular upload folder-picker --
// no ZIP to extract first. Falls back to a ZIP download only in browsers
// that don't support writing to disk (e.g. Firefox).
document.addEventListener('DOMContentLoaded', function () {
    'use strict';

    const folderInput = document.getElementById('sorter-folder-input');
    const runBtn = document.getElementById('sorter-run-btn');
    const fySelect = document.getElementById('sorter-fy');
    const monthSelect = document.getElementById('sorter-month');
    const summaryEl = document.getElementById('sorter-summary');

    const supportsDirectoryWrite = typeof window.showDirectoryPicker === 'function';
    if (!supportsDirectoryWrite) {
        runBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Sort &amp; Download ZIP';
        const notice = document.createElement('p');
        notice.style.cssText = 'margin-top:10px; font-size:12.5px; color:#b45309;';
        notice.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> This browser can\'t write folders directly -- you\'ll get a ZIP to extract instead. Use Chrome or Edge for a direct folder output.';
        runBtn.insertAdjacentElement('afterend', notice);
    }

    const JUNK_NAMES = new Set(['thumbs.db', 'desktop.ini', '.ds_store']);
    const PURCHASE_ALIASES = ['purchase bill', 'purchase bills', 'purchase'];
    const INCOME_ALIASES = ['income code', 'income ledger', 'pl code', 'gl code', 'gl statement'];

    const MONTH_ABBR = {
        January: 'Jan', February: 'Feb', March: 'Mar', April: 'Apr', May: 'May', June: 'Jun',
        July: 'Jul', August: 'Aug', September: 'Sep', October: 'Oct', November: 'Nov', December: 'Dec'
    };
    // Calendar month index (0=Jan) for each month name, used to derive the
    // correct calendar year from the selected FY (FY runs April->March).
    const MONTH_INDEX = {
        April: 3, May: 4, June: 5, July: 6, August: 7, September: 8,
        October: 9, November: 10, December: 11, January: 0, February: 1, March: 2
    };

    folderInput.addEventListener('change', () => {
        runBtn.disabled = !(folderInput.files && folderInput.files.length > 0);
        summaryEl.innerHTML = '';
    });

    function monthYearLabel(fy, month) {
        const [fyStartYear] = fy.split('-').map(s => parseInt(s, 10));
        const calendarYear = MONTH_INDEX[month] <= 2 ? fyStartYear + 1 : fyStartYear;
        const yy = String(calendarYear).slice(-2);
        return `${MONTH_ABBR[month]}-${yy}`;
    }

    function isJunk(filename) {
        const lower = filename.toLowerCase();
        return JUNK_NAMES.has(lower) || lower.startsWith('.');
    }

    function matchesAlias(segmentLower, aliases) {
        return aliases.some(alias => segmentLower === alias || segmentLower.includes(alias));
    }

    // Classifies one file's relative path (e.g. "ASHRAM ROAD/PURCHASE BILL/BSNL 1031.pdf")
    // into { branch, category, isArchive } where category is 'purchase' | 'income' | null.
    function classifyPath(relativePath) {
        const parts = relativePath.split('/');
        const filename = parts[parts.length - 1];
        const branch = parts[0] || 'Unassigned';
        const middleSegments = parts.slice(1, -1);

        let category = null;
        for (const seg of middleSegments) {
            const segLower = seg.trim().toLowerCase();
            if (matchesAlias(segLower, PURCHASE_ALIASES)) { category = 'purchase'; break; }
            if (matchesAlias(segLower, INCOME_ALIASES)) { category = 'income'; break; }
        }
        const isArchive = /\.(zip|rar|7z)$/i.test(filename);

        return { branch, category, filename, isArchive };
    }

    // Tracks filenames already placed under <bucket>/<branch>/ so a
    // collision (two source files ending up with the same plain filename
    // after flattening) is disambiguated instead of one overwriting the other.
    function makeUniqueNamer() {
        const usedNames = new Set();
        return function uniqueName(bucketKey, branch, filename) {
            const key = `${bucketKey}/${branch}/${filename}`;
            if (!usedNames.has(key)) { usedNames.add(key); return filename; }
            const dotIdx = filename.lastIndexOf('.');
            const base = dotIdx > -1 ? filename.slice(0, dotIdx) : filename;
            const ext = dotIdx > -1 ? filename.slice(dotIdx) : '';
            let n = 2;
            let candidate;
            do {
                candidate = `${base}_${n}${ext}`;
                n++;
            } while (usedNames.has(`${bucketKey}/${branch}/${candidate}`));
            usedNames.add(`${bucketKey}/${branch}/${candidate}`);
            return candidate;
        };
    }

    async function classifyAllFiles(files) {
        const uniqueName = makeUniqueNamer();
        const buckets = { purchase: [], income: [], unclassified: [] };
        let totalScanned = 0, skippedJunk = 0;
        const unclassifiedEntries = [];

        for (const file of files) {
            const relPath = file.webkitRelativePath || file.name;
            const filename = relPath.split('/').pop();
            if (isJunk(filename)) { skippedJunk++; continue; }
            totalScanned++;

            const { branch, category, isArchive } = classifyPath(relPath);
            const buffer = await file.arrayBuffer();
            const bucketKey = category === 'purchase' ? 'purchase' : (category === 'income' ? 'income' : 'unclassified');
            const name = uniqueName(bucketKey, branch, filename);
            buckets[bucketKey].push({ branch, filename: name, buffer });
            if (bucketKey === 'unclassified') {
                unclassifiedEntries.push(`${branch}/${filename}${isArchive ? '  [archive -- contents not inspected]' : ''}`);
            }
        }

        return { buckets, totalScanned, skippedJunk, unclassifiedEntries };
    }

    async function writeBucketToDirectory(rootHandle, folderName, entries) {
        if (entries.length === 0) return;
        const folderHandle = await rootHandle.getDirectoryHandle(folderName, { create: true });
        const branchHandles = {};
        for (const entry of entries) {
            if (!branchHandles[entry.branch]) {
                branchHandles[entry.branch] = await folderHandle.getDirectoryHandle(entry.branch, { create: true });
            }
            const fileHandle = await branchHandles[entry.branch].getFileHandle(entry.filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(entry.buffer);
            await writable.close();
        }
    }

    async function runViaDirectoryWrite(files, label) {
        const rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        const { buckets, totalScanned, skippedJunk, unclassifiedEntries } = await classifyAllFiles(files);

        await writeBucketToDirectory(rootHandle, `${label} PURCHASE BILL`, buckets.purchase);
        await writeBucketToDirectory(rootHandle, `${label} INCOME LEDGER`, buckets.income);
        await writeBucketToDirectory(rootHandle, 'Unclassified - Needs Review', buckets.unclassified);

        const manifestHandle = await rootHandle.getFileHandle('manifest.txt', { create: true });
        const writable = await manifestHandle.createWritable();
        await writable.write(buildManifest(label, totalScanned, skippedJunk, buckets, unclassifiedEntries));
        await writable.close();

        return { totalScanned, skippedJunk, buckets, unclassifiedEntries, wroteToDisk: true };
    }

    async function runViaZipDownload(files, label) {
        const { buckets, totalScanned, skippedJunk, unclassifiedEntries } = await classifyAllFiles(files);
        const zip = new JSZip();
        const purchaseFolder = zip.folder(`${label} PURCHASE BILL`);
        const incomeFolder = zip.folder(`${label} INCOME LEDGER`);
        const unclassifiedFolder = zip.folder('Unclassified - Needs Review');

        buckets.purchase.forEach(e => purchaseFolder.folder(e.branch).file(e.filename, e.buffer));
        buckets.income.forEach(e => incomeFolder.folder(e.branch).file(e.filename, e.buffer));
        buckets.unclassified.forEach(e => unclassifiedFolder.folder(e.branch).file(e.filename, e.buffer));
        zip.file('manifest.txt', buildManifest(label, totalScanned, skippedJunk, buckets, unclassifiedEntries));

        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `CA_Material_Sorted_${label.replace(/\s/g, '_')}.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        return { totalScanned, skippedJunk, buckets, unclassifiedEntries, wroteToDisk: false };
    }

    function buildManifest(label, totalScanned, skippedJunk, buckets, unclassifiedEntries) {
        return [
            `CA Material Sorter -- ${label}`,
            `Generated: ${new Date().toString()}`,
            '',
            `Total files scanned: ${totalScanned} (${skippedJunk} junk file(s) skipped)`,
            `Purchase Bill: ${buckets.purchase.length}`,
            `Income Ledger: ${buckets.income.length}`,
            `Unclassified - Needs Review: ${buckets.unclassified.length}`,
            '',
            'Unclassified files:',
            ...unclassifiedEntries.map(e => `  - ${e}`)
        ].join('\n');
    }

    runBtn.addEventListener('click', async () => {
        const files = Array.from(folderInput.files || []);
        if (files.length === 0) return;

        const fy = fySelect.value;
        const month = monthSelect.value;
        const label = monthYearLabel(fy, month);

        runBtn.disabled = true;
        const originalLabel = runBtn.innerHTML;
        runBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sorting&hellip;';
        summaryEl.innerHTML = '';

        try {
            const result = supportsDirectoryWrite
                ? await runViaDirectoryWrite(files, label)
                : await runViaZipDownload(files, label);

            const { totalScanned, skippedJunk, buckets, unclassifiedEntries, wroteToDisk } = result;
            summaryEl.innerHTML = `
                <div class="sorter-bucket purchase"><span><i class="fa-solid fa-file-invoice-dollar"></i> Purchase Bill</span><strong>${buckets.purchase.length} file(s)</strong></div>
                <div class="sorter-bucket income"><span><i class="fa-solid fa-file-invoice"></i> Income Ledger</span><strong>${buckets.income.length} file(s)</strong></div>
                <div class="sorter-bucket unclassified"><span><i class="fa-solid fa-triangle-exclamation"></i> Unclassified - Needs Review</span><strong>${buckets.unclassified.length} file(s)</strong></div>
                ${buckets.unclassified.length > 0 ? `<div id="sorter-unclassified-list">${unclassifiedEntries.map(e => `<div>${e}</div>`).join('')}</div>` : ''}
                <p style="margin-top:12px; font-size:12.5px; color:#64748b;">${skippedJunk} junk file(s) (Thumbs.db etc.) skipped. ${wroteToDisk ? 'Folders written to the location you selected -- ready to use directly.' : 'ZIP downloaded -- extract it before uploading.'}</p>
            `;
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Sort error:', err);
                summaryEl.innerHTML = `<p style="color:#dc2626;">Something went wrong: ${err.message || err}</p>`;
            }
        } finally {
            runBtn.disabled = false;
            runBtn.innerHTML = originalLabel;
        }
    });
});
