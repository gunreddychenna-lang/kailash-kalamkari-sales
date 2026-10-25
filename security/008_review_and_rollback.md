# KK-CEO-003 Phase 2 — Review and rollback notes

Status: REVIEW ONLY. Not executable or approved for production.

## Current limitations

- Existing Owner/Admin/Employee role migration is not yet tested in real Supabase.
- Current local PostgreSQL restore has no auth.users table.
- The candidate deliberately denies browser financial writes.
- Read-only grants do not implement all existing Sales Portal workflows.
- Employee sales SELECT currently permits reading all sales columns
  for authorized branch records, including customer data.
  Assess column-sensitive access and dedicated server APIs before release.
- The existing login endpoint requires durable rate limiting.
- SECURITY DEFINER functions, all exposed views, and API deployment
  settings require integration review.
- Direct authenticated queries must be tested against both branches.
- Payment split anomalies remain under reconciliation.
- A final approved migration must not contain review blockers.

## Required integration tests

1. Anonymous user: no business table reads/writes.
2. Inactive employee: all access denied.
3. Employee with Main Branch only: KHPS sales denied.
4. Employee without sales_entry: sales denied.
5. Employee without payments: receivables denied.
6. Employee with KHPS only: Main Branch receivables denied.
7. Owner/Admin: equivalent authorized reads.
8. Employees: payment_splits, payroll and bank accounts denied.
9. Legacy users table: passwords never readable.
10. Both dangerous financial RPCs denied to browser roles.
11. Row counts before/after migration remain identical.
12. Original business workflows tested before production approval.

## Rollback design

For disposable isolated tests only:
- Take a tested database backup and capture policies/grants/view settings.
- Implement final migration transactionally after review.
- If verification fails before COMMIT, execute ROLLBACK.
- If already committed, restore verified prior policies/grants
  through a separately reviewed recovery transaction.
- Preserve data and do not run destructive reconciliation.
- Never use a generic DROP-all-policies rollback.
- Never assume revoking a grant reverses legacy exposure.

## Production containment

If an actual production incident occurs, first preserve evidence,
identify exposed endpoints and suspend only the affected service/API
through a separately approved emergency response. Do not run this
draft migration against live databases.