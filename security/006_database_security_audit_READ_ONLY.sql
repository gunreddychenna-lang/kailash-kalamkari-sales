-- KK-CEO-003 DATABASE SECURITY INVENTORY
-- READ ONLY. Safe to inspect against the test database.
-- No passwords, row-level business data or secrets returned.
-- Does NOT modify schema, tables, policies or grants.

BEGIN TRANSACTION READ ONLY;

-- 1. DATABASE AND AUTH ENVIRONMENT
SELECT
  current_database() AS database_name,
  current_user AS executing_user,
  to_regclass('public.sales') IS NOT NULL AS sales_exists,
  to_regclass('public.kk_staff_access') IS NOT NULL AS staff_exists,
  to_regclass('auth.users') IS NOT NULL AS auth_users_exists,
  to_regprocedure('auth.uid()') IS NOT NULL AS auth_uid_exists;

-- 2. BUSINESS TABLE RLS STATUS
SELECT
  c.relname AS object_name,
  CASE c.relkind
    WHEN 'r' THEN 'table'
    WHEN 'p' THEN 'partitioned_table'
    WHEN 'v' THEN 'view'
    WHEN 'm' THEN 'materialized_view'
  END AS object_type,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced,
  pg_get_userbyid(c.relowner) AS object_owner
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r','p','v','m')
ORDER BY c.relname;

-- 3. ALL EXISTING RLS POLICIES
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual AS using_expression,
  with_check AS check_expression
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 4. TABLE AND VIEW ACCESS GRANTS
SELECT
  table_name,
  grantee,
  privilege_type,
  is_grantable
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN (
    'PUBLIC',
    'anon',
    'authenticated',
    'service_role'
  )
ORDER BY table_name, grantee, privilege_type;

-- 5. COLUMN-LEVEL GRANTS
SELECT
  table_name,
  column_name,
  grantee,
  privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND grantee IN ('anon','authenticated')
ORDER BY table_name, column_name, grantee;

-- 6. PUBLIC FUNCTIONS AND EXECUTION PERMISSIONS
SELECT
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS arguments,
    p.prosecdef AS security_definer,

    EXISTS (
        SELECT 1
        FROM aclexplode(
            COALESCE(p.proacl, acldefault('f', p.proowner))
        ) AS a
        WHERE a.grantee = 0
          AND a.privilege_type = 'EXECUTE'
    ) AS public_execute,

    CASE
        WHEN to_regrole('anon') IS NOT NULL
        THEN has_function_privilege(
            'anon', p.oid, 'EXECUTE'
        )
        ELSE NULL
    END AS anon_execute,

    CASE
        WHEN to_regrole('authenticated') IS NOT NULL
        THEN has_function_privilege(
            'authenticated', p.oid, 'EXECUTE'
        )
        ELSE NULL
    END AS authenticated_execute

FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname;

-- 7. VIEW SECURITY OPTIONS
SELECT
  c.relname AS view_name,
  c.reloptions AS security_options
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'v'
ORDER BY c.relname;

-- 8. STAFF TABLE COLUMN DEFINITIONS
SELECT
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'kk_staff_access'
ORDER BY ordinal_position;

-- 9. STAFF CONSTRAINTS
SELECT
  con.conname AS constraint_name,
  pg_get_constraintdef(con.oid)
    AS constraint_definition
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'kk_staff_access'
ORDER BY con.conname;

ROLLBACK;