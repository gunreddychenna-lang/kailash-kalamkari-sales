-- KK-CEO-003: REVIEW CANDIDATE ONLY
-- DO NOT RUN ON PRODUCTION.
-- Requires Supabase auth.uid(), anon and authenticated roles.
-- Apply only to a disposable isolated test database first.

BEGIN;

-- Stop if prerequisites are missing.
DO $$
BEGIN
  IF to_regprocedure('auth.uid()') IS NULL
     OR to_regclass('public.kk_staff_access') IS NULL
     OR to_regclass('public.sales') IS NULL THEN
    RAISE EXCEPTION 'Missing Auth or staff prerequisites';
  END IF;
END;
$$;

-- Remove all known insecure sales policies.
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

-- Fail if another permissive sales policy remains.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sales'
      AND permissive = 'PERMISSIVE'
  ) THEN
    RAISE EXCEPTION 'Unreviewed sales policies remain';
  END IF;
END;
$$;

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kk_staff_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kk_staff_self_read
  ON public.kk_staff_access;

CREATE POLICY kk_staff_self_read
ON public.kk_staff_access
FOR SELECT TO authenticated
USING (
  auth_user_id = (SELECT auth.uid())
  AND active IS TRUE
);

-- Clients may read only their own active profile.
REVOKE ALL ON public.kk_staff_access
  FROM PUBLIC, anon, authenticated;

GRANT SELECT (
  auth_user_id, login_id, display_name,
  employee_id, role, stores, features, active
)
ON public.kk_staff_access TO authenticated;

DROP POLICY IF EXISTS kk_sales_branch_read
  ON public.sales;

CREATE POLICY kk_sales_branch_read
ON public.sales
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.kk_staff_access AS staff
    WHERE staff.auth_user_id = (SELECT auth.uid())
      AND staff.active IS TRUE
      AND 'dashboard' = ANY(staff.features)
      AND (
        (
          staff.role = 'owner_admin'
          AND (
            sales.store_name = 'Main Branch'
            OR sales.store_name = 'KHPS'
          )
        )
        OR (
          staff.role IN (
            'store_manager',
            'sales_staff',
            'accountant'
          )
          AND sales.store_name = ANY(staff.stores)
        )
      )
  )
);

-- No anonymous sales access.
REVOKE ALL ON public.sales FROM PUBLIC, anon, authenticated;

-- Read-only until separately authorized write policies exist.
GRANT SELECT ON public.sales TO authenticated;

-- Revenue function must not remain anonymously callable.
REVOKE ALL ON FUNCTION public.get_total_sales(
  date, date, text, text
) FROM PUBLIC, anon, authenticated;

-- Settlement function remains unavailable to browser roles
-- pending controlled server-side write implementation.
REVOKE ALL ON FUNCTION public.replace_settlements(jsonb)
  FROM PUBLIC, anon, authenticated;

-- Existing view must respect caller's underlying RLS.
ALTER VIEW public.bills_master
  SET (security_invoker = true);

-- Invoker view still requires appropriate base-table grants.
-- Other table grants and their RLS require separate review.

COMMIT;