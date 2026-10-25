# Sales app: simple login deployment

Login: user ID **admin**, password **admin**. No Supabase Auth account, staff email, or Auth role setup is required. Other user IDs already configured in the existing users table continue to use that table. Sessions expire after six hours; logout preserves the monthly target.

This user-requested browser-side login is a convenience gate, not strong authentication. Existing database grants and RLS determine actual data access. The app does not disable RLS or bypass database permissions.

## One-time bank-save setup

1. Open your existing Sales project in Supabase, then SQL Editor.
2. Paste and run **database-settlements.sql**. It installs only the atomic replacement function; no existing sales, attendance or settlement rows are changed by installation. The function uses the caller's existing table permissions (SECURITY INVOKER).
3. Do not run the earlier database-security.sql migration. That file is now a no-op notice. If you already ran its previous version, report that before deployment: its Auth-only policies will block this simple-login version. No automatic security rollback is included.
4. If a settlement insert reports a sequence permission error, inspect the existing grants for the specific sequence returned by pg_get_serial_sequence('public.receivables', 'id'). Do not disable RLS or grant broad access as a workaround.

## Upload together

- index.html
- app.js
- common.js (required)
- attendance.html
- entry.html
- crm.html
- stock.html
- styles.css (existing styling)

Keep SQL, tests and documentation out of the public upload when possible. Open index.html and log in with admin / admin. No production deployment or database migration has been performed by this edit.

## Checks

Local regression checks: node --test tests/regression.test.cjs

Verify live login, branch/date totals, 0% commission, fractional quantities, CRM phone matching, and stock totals. Validate settlement rollback and concurrent saves on a staging database. If the function has not been installed, saving shows a setup message and does not fall back to unsafe separate delete/insert requests.

Bank saves are atomic. Partial payments are supported; overpayments are rejected. Duplicate invoice numbers across branches/dates are rejected rather than merged. Concurrent replacements are serialized; the last successful replacement wins. Creating an already existing attendance month is rejected instead of clearing its attendance.

The database script has not been executed against your database. Browser visual verification and production data reconciliation remain necessary. The revenue-less-net-payroll metric is not profit: product costs and operating expenses are excluded. Historical sales are still processed in the browser; large datasets may need server-side aggregation. CSV CRM imports without master invoices use supplied amounts and cannot be certified as reconciled.
