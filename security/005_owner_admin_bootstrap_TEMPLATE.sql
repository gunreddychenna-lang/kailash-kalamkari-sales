-- KK-CEO-003 OWNER + ADMIN BOOTSTRAP TEMPLATE
-- DEVELOPMENT ONLY - DO NOT EXECUTE IN PRODUCTION.
--
-- PREREQUISITES:
-- 1. Disposable Supabase development project.
-- 2. Reviewed and tested owner/admin/employee schema migration.
-- 3. Two existing, separately verified Supabase Auth users.
-- 4. Replace both placeholder Auth UUIDs with verified IDs.
--
-- This file NEVER creates passwords or Auth users.
-- It NEVER modifies sales, salary or financial tables.
--
-- Both Owner and Admin receive identical FULL ACCESS.
-- Employees receive permissions separately.

BEGIN;

DO $$
DECLARE
  owner_uid uuid;
  admin_uid uuid;
  all_stores text[] := ARRAY['Main Branch', 'KHPS'];
  all_features text[] := ARRAY[
    'dashboard',
    'sales_entry',
    'crm',
    'inventory',
    'attendance',
    'payments',
    'payroll',
    'reports',
    'staff_management'
  ];
BEGIN
  -- Intentional execution blocker until IDs are supplied.
  IF '__OWNER_AUTH_UUID__' LIKE '__%__'
     OR '__ADMIN_AUTH_UUID__' LIKE '__%__'
  THEN
    RAISE EXCEPTION
      'Replace verified Owner/Admin Auth UUID placeholders first';
  END IF;

  owner_uid := '__OWNER_AUTH_UUID__'::uuid;
  admin_uid := '__ADMIN_AUTH_UUID__'::uuid;

  IF owner_uid = admin_uid THEN
    RAISE EXCEPTION 'Owner and Admin require distinct Auth users';
  END IF;

  IF to_regclass('auth.users') IS NULL
     OR to_regclass('public.kk_staff_access') IS NULL THEN
    RAISE EXCEPTION 'Required Auth or staff table missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = owner_uid
  ) OR NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = admin_uid
  ) THEN
    RAISE EXCEPTION 'Both Auth identities must exist';
  END IF;

  -- Never silently overwrite existing users or staff accounts.
  IF EXISTS (
    SELECT 1
    FROM public.kk_staff_access
    WHERE login_id IN ('owner', 'admin')
       OR auth_user_id IN (owner_uid, admin_uid)
  ) THEN
    RAISE EXCEPTION
      'Conflicting account exists; review before bootstrap';
  END IF;

  INSERT INTO public.kk_staff_access (
    auth_user_id, login_id, display_name,
    role, stores, features, active
  )
  VALUES
  (
    owner_uid,
    'owner',
    'Kailash Kalamkari Owner',
    'owner',
    all_stores,
    all_features,
    true
  ),
  (
    admin_uid,
    'admin',
    'Kailash Kalamkari Admin',
    'admin',
    all_stores,
    all_features,
    true
  );

  IF (
    SELECT COUNT(*)
    FROM public.kk_staff_access
    WHERE auth_user_id IN (owner_uid, admin_uid)
      AND active IS TRUE
  ) <> 2 THEN
    RAISE EXCEPTION 'Bootstrap verification failed';
  END IF;
END;
$$;

COMMIT;