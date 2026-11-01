# KK Automatic Drive Inventory — DEV/Preview-only package

**Not deployed. Do not merge directly into production.** No historical sales/receivables/inventory rows are changed by this package.

## Files
- `google-apps-script/Code.gs`: recursive scan of all images in configured Drive root folders every 15 minutes.
- `api/drive-sync.js`: shared-secret protected POST endpoint, rejects incomplete/undersized scans.
- `sql/01_catalogue_drive_sync.sql`: isolated RLS-protected tables, atomic full scan apply, 2-scan deletion safeguard.
- `lib/drive-normalize.js`: parses `Design & Colour`, strips `(1)`, `(2)` duplicate suffixes.
- `api/owner-inventory.js`: replacement for existing API, preserves owner/admin authentication and source `catalogue_products`; live scan is required, not stale archive fallback.
- `stock.html`: unchanged visual design, removes hard-coded 1,190 file assertion and reads live scan.

## Preconditions / owner approval
1. Confirm which Google Drive folder IDs are **all** catalogue roots (Main Catalogue, KHPS, Store C/D) and whether their subfolders are fabric names. Current source audit has only Main Catalogue and KHPS labels; this must not be guessed.
2. Create isolated DEV/Preview Supabase project or use existing approved DEV project. Review and approve SQL migration **only there**.
3. Add Vercel PREVIEW-only env vars `KK_DRIVE_SYNC_SUPABASE_URL`, `KK_DRIVE_SYNC_SERVICE_ROLE_KEY`, `KK_DRIVE_SYNC_SECRET` (random 32+ chars), `KK_DRIVE_SYNC_MIN_FILES` (approved minimum after first verified scan).
4. Configure Apps Script Properties `ROOTS_JSON`, `SYNC_URL`, `SYNC_SECRET`. Never paste tokens in chat or source code. Grant folder access to the Apps Script Google account.
5. Preview deploy from new review branch only, run `kkScanAndSync` manually, verify server response and inventory counts.
6. Install quarter-hour trigger only after first scan matched, validate adding/renaming/deleting **test** files. Deletion is marked unavailable only after TWO complete accepted scans. Files are not deleted from any system by this sync.
7. Compare accepted scan counts against expected folder count, test account access and permissions, collect rollback evidence, then request a **separate production deployment approval**.

## Important production risk
The old API mixes a static 1,190-image Drive audit with an actual Supabase catalogue query. New code changes only the Drive audit source and its display; it **does not** mutate the `products` table. Therefore other website/catalogue product counts are NOT automatically decremented by this package. These must be handled by the existing inventory pipeline after separate review.

## Rollback
Revert only `stock.html`, `api/owner-inventory.js`; remove `api/drive-sync.js`; disable Apps Script trigger. Retain isolated scan tables as audit trail until an explicitly approved cleanup. Existing sales data is untouched.

## Additional notes
- Apps Script execution limits may cause full scans to fail on very large folders; failure must never produce a `complete:true` payload.
- A malformed name (no `&`) is `Unknown Design` / `Unknown Colour`, never guessed.
- Same design and colour with distinct Drive IDs count as distinct physical saree images.
- Existing frontend remains CDN Tailwind-based; no unrelated UI refactor.
