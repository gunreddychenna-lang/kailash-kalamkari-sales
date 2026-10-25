-- KK-CEO-003
-- ISOLATED DEVELOPMENT CANDIDATE
-- DO NOT RUN IN PRODUCTION.
-- Requires migration 001 and Supabase-style auth roles.
--
-- Owner and Admin have identical full access.
-- Employee access is controlled by stores and features.
-- Financial write policies are NOT provided by this file.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.kk_staff_access') IS NULL
    OR to_regclass('public.sales') IS NULL
    OR to_regprocedure('auth.uid()') IS NULL
  THEN
    RAISE EXCEPTION 'Security prerequisites missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.kk_staff_access
    WHERE role NOT IN ('owner','admin','employee')
  ) THEN
    RAISE EXCEPTION
      'Existing roles require explicit account migration';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sales
    WHERE store_name IS NULL
       OR store_name NOT IN ('Main Branch','KHPS')
  ) THEN
    RAISE EXCEPTION
      'Unmapped sales store labels require review';
  END IF;
END;
$$;

-- Replace role constraint, preserving records.
ALTER TABLE public.kk_staff_access
  DROP CONSTRAINT IF EXISTS kk_staff_access_role_check;

ALTER TABLE public.kk_staff_access
  ADD CONSTRAINT kk_staff_access_role_check
  CHECK (role IN ('owner','admin','employee'));

-- Existing conflicting policies are blocked by an audit
-- before implementation; this is not a production rollout.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'kk_staff_access'
  ) THEN
    RAISE EXCEPTION
      'Review existing staff policies before applying';
  END IF;
END;
$$;

ALTER TABLE public.kk_staff_access
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY kk_staff_self_read
ON public.kk_staff_access
FOR SELECT TO authenticated
USING (
  active IS TRUE
  AND auth_user_id = (SELECT auth.uid())
);

REVOKE ALL ON public.kk_staff_access
  FROM PUBLIC, anon, authenticated;

GRANT SELECT (
  auth_user_id,
  login_id,
  display_name,
  employee_id,
  role,
  stores,
  features,
  active
)
ON public.kk_staff_access TO authenticated;

-- Explicitly remove known unsafe sales policies.
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

-- Abort if unreviewed permissive policies remain.
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

CREATE POLICY kk_sales_read
ON public.sales
FOR SELECT TO authenticated
USING (
  store_name IN ('Main Branch', 'KHPS')
  AND EXISTS (
    SELECT 1
    FROM public.kk_staff_access AS s
    WHERE s.auth_user_id = (SELECT auth.uid())
      AND s.active IS TRUE
      AND (
        s.role IN ('owner', 'admin')
        OR (
          s.role = 'employee'
          AND 'dashboard' = ANY(s.features)
          AND sales.store_name = ANY(s.stores)
        )
      )
  )
);

-- Read-only sales grants.
REVOKE ALL ON public.sales
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.sales TO authenticated;

-- Block legacy financial RPC exposure.
REVOKE ALL ON FUNCTION public.get_total_sales(
  date, date, text, text
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.replace_settlements(jsonb)
  FROM PUBLIC, anon, authenticated;

-- Prevent unrelated financial tables from being
-- accidentally opened by this candidate.
-- Additional RLS is required before their grants change.

COMMIT;