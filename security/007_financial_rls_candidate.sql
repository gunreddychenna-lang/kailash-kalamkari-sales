-- KK-CEO-003 / PHASE 2
-- FINANCIAL RLS CANDIDATE - REVIEW ONLY
--
-- DO NOT EXECUTE IN PRODUCTION.
-- DO NOT EXECUTE AGAINST THE LOCAL RESTORED DATABASE.
--
-- Requires an isolated Supabase development environment.
-- Requires reviewed Owner/Admin/Employee role migration.
-- Requires real Auth and authorization integration tests.
--
-- Intentional blocker prevents accidental execution.
-- Remove ONLY in an approved disposable test environment.

DO $$
BEGIN
    RAISE EXCEPTION
      'REVIEW ONLY: isolated test approval and migration prerequisites required';
END;
$$;

-- ----------------------------------------------------------------
-- DRAFT IMPLEMENTATION (deliberately blocked above)
-- ----------------------------------------------------------------

BEGIN;

-- Prerequisite checks: fail closed.

DO $$
BEGIN
    IF to_regclass('auth.users') IS NULL
       OR to_regprocedure('auth.uid()') IS NULL
       OR to_regclass('public.kk_staff_access') IS NULL
    THEN
        RAISE EXCEPTION 'Supabase Auth prerequisites missing';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.kk_staff_access
        WHERE role NOT IN ('owner','admin','employee')
    ) THEN
        RAISE EXCEPTION 'Legacy staff roles remain';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.sales
        WHERE store_name IS NULL
           OR store_name NOT IN ('Main Branch','KHPS')
    ) THEN
        RAISE EXCEPTION 'Unmapped sales store found';
    END IF;
END;
$$;

-- Staff profile lookup required by RLS policies.
-- Assumes the reviewed staff self-read policy from 004
-- exists and works with authenticated sessions.

-- SALES
-- 004 must be reviewed/reconciled before this policy is used.

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

-- RECEIVABLES
ALTER TABLE public.receivables ENABLE ROW LEVEL SECURITY;

CREATE POLICY kk_receivables_authorized_select
ON public.receivables
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.kk_staff_access s
        WHERE s.auth_user_id = (SELECT auth.uid())
          AND s.active IS TRUE
          AND (
              s.role IN ('owner', 'admin')
              OR (
                  s.role = 'employee'
                  AND 'payments' = ANY(s.features)
                  AND receivables.store_name = ANY(s.stores)
              )
          )
    )
);

-- PAYMENT SPLITS
-- Keep employee access denied until invoice reconciliation
-- and unambiguous branch association are validated.

ALTER TABLE public.payment_splits ENABLE ROW LEVEL SECURITY;

CREATE POLICY kk_payment_splits_management_select
ON public.payment_splits
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.kk_staff_access s
        WHERE s.auth_user_id = (SELECT auth.uid())
          AND s.active IS TRUE
          AND s.role IN ('owner', 'admin')
    )
);

-- SENSITIVE TABLES
-- Owner/Admin access only in the first candidate.

ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saree_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY kk_attendance_management_select
ON public.attendance
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.kk_staff_access s
        WHERE s.auth_user_id = (SELECT auth.uid())
          AND s.active IS TRUE
          AND s.role IN ('owner', 'admin')
    )
);

CREATE POLICY kk_bank_accounts_management_select
ON public.bank_accounts
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.kk_staff_access s
        WHERE s.auth_user_id = (SELECT auth.uid())
          AND s.active IS TRUE
          AND s.role IN ('owner', 'admin')
    )
);

CREATE POLICY kk_inventory_management_select
ON public.saree_inventory
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.kk_staff_access s
        WHERE s.auth_user_id = (SELECT auth.uid())
          AND s.active IS TRUE
          AND s.role IN ('owner', 'admin')
    )
);

-- Legacy user credentials are not exposed through
-- authenticated client access.

REVOKE ALL ON public.users
FROM PUBLIC, anon, authenticated;

-- Restrict dangerous financial function execution.
-- These changes require regression testing.

REVOKE ALL ON FUNCTION public.get_total_sales(
    date, date, text, text
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.replace_settlements(
    jsonb
) FROM PUBLIC, anon, authenticated;

-- Verify view respects caller permissions.
ALTER VIEW public.bills_master
SET (security_invoker = true);

-- Financial writes are deliberately NOT enabled.
-- Existing permissive policies must be replaced in a
-- separately reviewed migration before any deployment.
--
-- IMPORTANT: This is not a complete final migration.
-- Additional GRANT, policy-conflict, RPC and workflow
-- validation is mandatory.

ROLLBACK;