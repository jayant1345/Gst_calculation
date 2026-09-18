# Multi-Page Bill Scanning (dedicated upload path, zero change to existing flow)

## Context

Reported problem: when a single bill spans multiple physical pages (e.g. a 3-page tax
invoice), the scanner currently treats **every page as an independent, separate bill**
(this is intentional for the *other*, already-working use case: a CA scans a stack of
many one-page bills into one PDF for convenience, and each page really is a different
bill). For a genuine multi-page bill, this means each page gets scanned and judged on
its own — a continuation/itemized page with no repeated header often doesn't look like
a complete bill to the extractor, so it's inconsistent which page "wins" and ends up
saved. This is exactly the "randomly scans page 1 or sometimes page 3" symptom. The CA
also confirmed a hard rule for these bills: **the final/total amount is always on the
last page.**

Constraints, confirmed with the user:
- The AI vision models, prompts, and extraction calls must not change at all — same
  Gemini 2.5 Flash/Pro calls, same prompts, called exactly as today, once per page.
- This is a live, revenue-critical system with real data in it right now — nothing
  about the existing upload/scan flow may be touched or risk regressing.
- Scope: PDF bills only (not multi-image-file bills — that's a separate, deferred case).
- UX: a **separate, dedicated upload path** for multi-page bills, not a checkbox bolted
  onto the existing bulk-upload panel — so the two workflows never share a form, and the
  existing panel's behavior is untouched in every way, including visually.

## Approach

### Why a dedicated path is the safe design here

Auto-detecting "these pages belong together" (e.g. by matching invoice number across
pages) was considered and rejected: continuation pages frequently don't repeat the
invoice number/GSTIN header at all, so a matching heuristic would be unreliable — it
would either fail to merge real multi-page bills, or (worse) wrongly merge two
unrelated bills that happen to share incidental values. An explicit operator action
("I am uploading one multi-page bill now") is deterministic and matches how the
operator already thinks about what they're uploading.

Because the trigger is a fully separate UI action, the implementation can also stay
almost entirely additive: a new button, a new small upload area, a new backend route.
The existing `/api/process-invoices` route, `_parse_single_invoice_file()`, and its
current per-page-as-separate-bill logic (`app.py` ~2784-2868) are **not modified** —
so every existing upload behavior, and all data already in the `invoices` table, is
completely unaffected regardless of what this new path does.

### Stage 1 — Extract the reusable "scan one PDF page" helper (pure refactor, no behavior change)

**File: `app.py`**

The per-page extraction logic inside today's `_process_pdf_page()` (~2788-2843, the
text-first-then-vision-gap-fill logic, or full vision pass in high-accuracy mode) is
non-trivial (~50 lines) and must behave *identically* whether called from the existing
batch path or the new multi-page-bill path — so it's worth pulling out once rather than
copy-pasting a second copy that could quietly drift out of sync over time.

Extract a new pure helper:
```python
def _extract_bills_for_page(file_bytes, filename, p_idx, high_accuracy):
    """Scans ONE page of a PDF exactly as today: text-extraction + vision
    gap-fill when a text layer exists and high_accuracy is off, else a full
    vision pass. Returns the list of bill dict(s) found on that page, with
    no assumption about how many pages the source document has."""
    # body = the existing logic from _process_pdf_page, moved verbatim
```
`_process_pdf_page()` inside `_parse_single_invoice_file()` calls this helper for its
core extraction, then keeps its own existing per-page file-splitting/naming/error
handling exactly as today. This is a pure move-and-call refactor — the existing
function's inputs, outputs, and behavior for the current batch-upload flow do not
change at all. (Verification step below confirms this with a byte-for-byte-equivalent
test upload before/after.)

### Stage 2 — New backend route for multi-page bills

**File: `app.py`**

New route, e.g. `POST /api/process-multipage-bill`, accepting one or more PDF files
(`files[]`) plus `branch`/`state` form fields (reuse exactly as today). For each file:

1. Open with `pymupdf`, get `num_pages`.
2. For each page `0..num_pages-1`, call `_extract_bills_for_page(file_bytes, filename, p_idx, high_accuracy)` from Stage 1 — same extraction, unchanged.
3. **Merge the page results into ONE bill dict** (new, small, pure function `_merge_multipage_bill(page_bills)`):
   - `invoice_number` / `vendor_name` / `gstin` / `invoice_date` / `payment_date`: the first non-empty, non-"N/A" value found scanning pages in order (page 1 first) — header info is normally on page 1, but this tolerates it appearing later.
   - `taxable_value` / `cgst` / `sgst` / `igst`: per the CA's rule, scan pages **last-to-first** and take the **first page whose total (`taxable+cgst+sgst+igst`) is non-zero** — this is "the last page" in the normal case, with a built-in fallback if the very last page happens to fail extraction (matches the existing app-wide principle this session of never silently dropping a legitimate recovered value).
   - If two or more pages produced **conflicting non-empty invoice numbers**, don't silently pick one — set `_merge_conflict: True` and keep both values visible in a note, so it surfaces for manual review instead of guessing (same "flag, don't block" pattern already used for the rescan risky-zero-out case).
4. Store the **whole original PDF** (`file_bytes`, unsplit) as this bill's file — not the per-page single-page split used by the existing batch path.
5. Run the merged dict through the **same normalize → `compute_billing_period` → `find_duplicate_invoice` → insert** sequence used by `process_invoices()` (~2998-3060), calling the same existing helper functions (`compute_billing_period`, `find_duplicate_invoice`, `normalize_gstin`, `get_branch_state`, `log_activity`) — reused as-is, not reimplemented. The short (~15-line) inline per-field normalization block (string/float coercion, filename-based branch auto-detect, eligible/ineligible ITC split) is duplicated into this new route rather than extracted from `process_invoices()`, specifically so the existing route's code is not touched at all.

### Stage 3 — Frontend: dedicated multi-page bill upload

**File: `static/app.js`, `templates/index.html`**

New button next to the existing "Add Manual Bill" / "Vendor Directory" buttons, e.g.
**"Upload Multi-Page Bill"**, opening a small dedicated modal: file picker (accepts
`.pdf`, allows multiple files — each independently treated as one multi-page bill),
plus the existing Branch/State autocomplete inputs (reuse `setupAutocomplete` exactly
as wired for the Manual Bill modal). On submit, POSTs to `/api/process-multipage-bill`
and renders results the same way the existing upload results are shown today (reuse
the existing results-rendering code/table, just fed from this new endpoint's response
shape, which matches the existing per-bill result shape exactly).

If a result comes back with `_merge_conflict: true`, show it with the same visual
treatment as the existing "Verify" rescan tag (red, triangle-warning icon) so the
operator checks it before trusting the merged data.

## Verification

- **Stage 1 (no-behavior-change refactor):** re-run the existing multi-page-PDF batch
  upload test path locally with a real multi-bill-per-page PDF (from the scratchpad
  test fixtures used earlier this session) before and after the refactor; diff the
  saved rows — must be byte-identical. This is the step that proves the existing flow
  is untouched.
- **Stage 2 (new endpoint, local only, local DB):** build a synthetic 3-page test PDF
  locally (page 1 = header/vendor/GSTIN/invoice date, page 2 = itemized lines only,
  page 3 = final totals) and confirm the merged result correctly picks header fields
  from page 1 and amounts from page 3. Also test a 3-page PDF where the last page's
  totals are blank/zero, to confirm the last-non-zero-page fallback works. Test the
  conflicting-invoice-number case to confirm `_merge_conflict` is set and doesn't
  silently pick a number.
- **Stage 3 (Playwright, local):** open the new modal, upload a real multi-page test
  bill, confirm one row is created (not N rows), confirm the stored file downloads as
  the full multi-page PDF, and confirm the merge-conflict warning renders when forced.
- **Before touching production:** run the full existing local regression scripts
  (`test_maharashtra_igst.py`, `test_gl_voucher_shared_catalog.py`,
  `test_gl_tally_filter.py`) to confirm Stage 1's refactor didn't disturb anything they
  check.
- **On production:** deploy, then test with one real multi-page bill upload (using a
  disposable test branch name, deleted afterward) before telling the CA office it's
  ready to use for real bills. No retroactive changes to any existing saved bill are
  made by this work — it only affects bills uploaded through the new button going
  forward.

## Critical files
- `C:\Project_AI\GST_calculation\app.py` — `_process_pdf_page` (extract helper),
  new `_extract_bills_for_page`, new `_merge_multipage_bill`, new
  `/api/process-multipage-bill` route
- `C:\Project_AI\GST_calculation\static\app.js` — new modal open/submit logic, reuse
  of `setupAutocomplete` and the existing results-rendering function
- `C:\Project_AI\GST_calculation\templates\index.html` — new button + modal markup
