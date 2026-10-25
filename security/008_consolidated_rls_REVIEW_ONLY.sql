-- KK-CEO-003 PHASE 2
-- CONSOLIDATED RLS - REVIEW ONLY
-- NOT APPROVED FOR EXECUTION
-- DO NOT RUN ON PRODUCTION OR LOCAL FINANCIAL RESTORE.
--
-- Prerequisites:
-- Dedicated disposable Supabase test project
-- Schema/data compatibility review
-- Verified Auth identities
-- Tested backup and recovery
-- Explicit separate approval before any future execution
--
-- Intentionally prevents execution, even in a test database.
DO $$
BEGIN
  RAISE EXCEPTION
    'REVIEW ONLY: execution disabled pending isolated integration plan';
END;
$$;

BEGIN;

-- 1. REQUIRED ENVIRONMENT
DO $$
BEGIN
  IF to_regclass('auth.users') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL
     OR to_regclass('public.kk_staff_access') IS NULL
     OR to_regclass('public.sales') IS NULL
  THEN
    RAISE EXCEPTION 'Missing required Auth or business schema';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.kk_staff_access
    WHERE role NOT IN ('owner', 'admin', 'employee')
  ) THEN
    RAISE EXCEPTION 'Legacy roles need migration review';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sales
    WHERE store_name IS NULL
       OR store_name NOT IN ('Main Branch', 'KHPS')
  ) THEN
    RAISE EXCEPTION 'Unmapped sales branch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.receivables
    WHERE store_name IS NULL
       OR store_name NOT IN ('Main Branch', 'KHPS')
  ) THEN
    RAISE EXCEPTION 'Unmapped receivables branch';
  END IF;

  -- No unreviewed policies should survive the replacement.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'sales', 'receivables', 'payment_splits',
        'attendance', 'bank_accounts',
        'saree_inventory', 'users', 'kk_staff_access'
      )
      AND policyname NOT IN (
        'Allow anon all on attendance',
        'Allow anon all on bank_accounts',
        'Allow anon all on receivables',
        'Allow anon full access on sales',
        'Allow full access to sales',
        'Allow public access to sales',
        'Enable insert for all users',
        'Enable read access for all users',
        'Enable update for all users'
      )
  ) THEN
    RAISE EXCEPTION 'Unexpected existing policy; manual review required';
  END IF;
END;
$$;

-- 2. STAFF ROLE CONSTRAINT
ALTER TABLE public.kk_staff_access
  DROP CONSTRAINT IF EXISTS kk_staff_access_role_check;

ALTER TABLE public.kk_staff_access
  ADD CONSTRAINT kk_staff_access_role_check
  CHECK (role IN ('owner', 'admin', 'employee'));

-- 3. REMOVE VERIFIED LEGACY POLICIES
DROP POLICY IF EXISTS "Allow anon all on attendance"
  ON public.attendance;
DROP POLICY IF EXISTS "Allow anon all on bank_accounts"
  ON public.bank_accounts;
DROP POLICY IF EXISTS "Allow anon all on receivables"
  ON public.receivables;

DROP POLICY IF EXISTS "Allow anon full access on sales"
  ON public.sales;
DROP POLICY IF EXISTS "Allow full access to sales"
  ON public.sales;
DROP POLICY IF EXISTS "Allow public access to sales"
  ON public.sales;
DROP POLICY IF EXISTS "Enable insert for all users"
  ON public.sales;
DROP POLICY IF EXISTS "Enable read access for all users"
  ON public.sales;
DROP POLICY IF EXISTS "Enable update for all users"
  ON public.sales;

-- 4. ENABLE RLS
ALTER TABLE public.kk_staff_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receivables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saree_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- 5. STAFF SELF-READ
CREATE POLICY kk_staff_self_read
ON public.kk_staff_access
FOR SELECT TO authenticated
USING (
  active IS TRUE
  AND auth_user_id = (SELECT auth.uid())
);

-- 6. SALES: STORE AND FEATURE MUST BOTH MATCH
CREATE POLICY kk_sales_select
ON public.sales
FOR SELECT TO authenticated
USING (
  store_name IN ('Main Branch', 'KHPS')
  AND EXISTS (
    SELECT 1 FROM public.kk_staff_access s
    WHERE s.auth_user_id = (SELECT auth.uid())
      AND s.active IS TRUE
      AND (
        s.role IN ('owner', 'admin')
        OR (
          s.role = 'employee'
          AND 'sales_entry' = ANY(s.features)
          AND sales.store_name = ANY(s.stores)
        )
      )
  )
);

-- 7. RECEIVABLES: PAYMENTS PERMISSION AND STORE
CREATE POLICY kk_receivables_select
ON public.receivables
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.kk_staff_access s
    WHERE s.auth_user_id = (SELECT auth.uid())
      AND s.active IS TRUE
      AND (
        s.role IN ('owner', 'admin')
        OR (
          s.role = 'employee'
          AND 'payments' = ANY(s.features)
          AND receivables.store_name = ANY(s.stores)
          AND receivables.store_name IN ('Main Branch', 'KHPS')
        )
      )
  )
);

-- 8. FINANCIAL/SENSITIVE TABLES: OWNER OR ADMIN ONLY
CREATE POLICY kk_payment_splits_select
ON public.payment_splits
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.kk_staff_access s
    WHERE s.auth_user_id = (SELECT auth.uid())
      AND s.active IS TRUE
      AND s.role IN ('owner', 'admin')
  )
);

CREATE POLICY kk_attendance_select
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

CREATE POLICY kk_bank_accounts_select
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

CREATE POLICY kk_inventory_select
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

-- Do not grant browser access to legacy user credentials.

-- 9. TABLE GRANTS
REVOKE ALL ON public.kk_staff_access
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.sales
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.receivables
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.payment_splits
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.attendance
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.bank_accounts
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.saree_inventory
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.users
  FROM PUBLIC, anon, authenticated;

GRANT SELECT (
  auth_user_id, login_id, display_name,
  employee_id, role, stores, features, active
)
ON public.kk_staff_access TO authenticated;

GRANT SELECT ON public.sales TO authenticated;
GRANT SELECT ON public.receivables TO authenticated;
GRANT SELECT ON public.payment_splits TO authenticated;
GRANT SELECT ON public.attendance TO authenticated;
GRANT SELECT ON public.bank_accounts TO authenticated;
GRANT SELECT ON public.saree_inventory TO authenticated;

-- 10. FINANCIAL RPC RESTRICTIONS
REVOKE ALL ON FUNCTION public.get_total_sales(
  date, date, text, text
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.replace_settlements(
  jsonb
) FROM PUBLIC, anon, authenticated;

-- 11. VIEW SECURITY
ALTER VIEW public.bills_master
  SET (security_invoker = true);

-- Intentional ROLLBACK:
-- Even if the initial execution blocker is later removed,
-- this file alone does not persist schema changes.
ROLLBACK;