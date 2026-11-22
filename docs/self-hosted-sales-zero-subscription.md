# KK Sales Portal: ₹0 Recurring Software Subscription — Development Plan

**Status:** DEVELOPMENT ONLY. Production is frozen at commit `901747c5d6cd7d32bd46fba9fe2b9564850763eb`.
No production edits, server exposure, database writes, credentials rotation or cutover without separate owner approval.

## Existing dependencies confirmed from production code

- `index.html`, `app.js`, `security-auth.js` use Supabase JS/Auth.
- `api/staff-config.js` provides Supabase URL and public anon key.
- `api/owner-dashboard.js` verifies Supabase Auth JWT and `kk_staff_access` profile, fetches datasets using Supabase REST and separate PostgreSQL read-only access.
- `api/sales-sync-live.js` already uses `pg` through `KK_SALES_IMPORT_DATABASE_URL`, with financial validation, dry-run, transaction rollback and idempotent sales-line identifiers.
- Payments/receivables, historical invoices, and owner reports must remain protected and reconciled.
- Production is hosted on Vercel; existing live user workflow is Google Sheets → manual Apps Script PUSH → sales importer.

## Proposed destination

- Existing Windows office PC is a **candidate**, not an approved always-on production host.
- Local PostgreSQL, bound only to loopback/private network; never publish port 5432.
- Node.js API server serving the current UI and API routes.
- A reviewed self-hosted staff authentication/session implementation, with server-side role checks on **every** API route; do not substitute a superficial frontend login.
- Cloudflare Tunnel (HTTPS application ingress) with application authentication; keep secrets out of frontend and Git.
- Backups: daily encrypted PostgreSQL logical dump + periodic verified restoration + a separate physical/offsite copy.
- Manual Google Apps Script PUSH preserved; endpoint and credentials change only during approved cutover.

## Ordered release gates

1. Run `tools/check-self-host-readiness.ps1` on the actual office PC. Record hardware, available storage, PostgreSQL readiness, Node.js, cloudflared.
2. Export a **read-only** source schema/inventory report with counts and financial totals; document extensions, roles, policies, triggers, procedures and Auth dependencies. Never share actual secrets.
3. Set up isolated LOCAL PostgreSQL and an independently tested backup/restore procedure.
4. Recreate database schema and historical data only in **LOCAL DEVELOPMENT**, then reconcile per-table counts, invoices, summed sales and receipts. Missing/duplicate invoices are blocking defects.
5. Build local API compatibility adapters and replace Supabase Auth with reviewed self-hosted identity. Require server-side Owner/Admin/staff permissions and session expiry, password hashing and safe recovery.
6. Validate real manual Google Sheets PUSH against local isolated tests, including repeat push, returns, interrupted batches and rejected invoice changes.
7. Verify dashboard, sales, payments, historical invoices, Main Branch and KHPS, mobile and desktop, and account isolation.
8. Test 24/7 readiness, reboot recovery, disk/UPS/internet failure, tunnel access, backup and restore. Never expose DB directly to the public Internet.
9. Request explicit owner approval for migration. Keep source production as rollback until historical and post-cutover totals reconcile.

## Constraints and non-guarantees

- PostgreSQL is open-source; self-hosting removes a database subscription but **not** electricity, internet, hardware, domain renewal, maintenance or backup expenses.
- A Windows office PC is not equivalent to high-availability cloud infrastructure. Scheduled Windows sleep, reboots and outages interrupt the portal.
- Free-service terms and quotas may change. Confirm a provider's commercial-use permission before relying on its free plan.
- No direct `SUPABASE_URL` environment swap is valid: current login, permissions and dashboard rely on Supabase Auth and REST.
- No application or financial-table changes made by this planning commit.
