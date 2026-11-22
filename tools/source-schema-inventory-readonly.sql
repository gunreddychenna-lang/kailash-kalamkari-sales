-- KK Sales self-hosted migration: SOURCE INVENTORY ONLY
-- Run in pgAdmin Query Tool while connected to the existing read-only Sales source.
-- No schema/data changes, no passwords, no user records exported.
-- Do NOT run against an untrusted database or paste connection credentials into chat.
-- Result sets: identity; public objects; columns; constraints; indexes; server-side routines; counts.
SET statement_timeout = '20s';
BEGIN READ ONLY;
SELECT current_database() AS database_name, current_user AS connected_role,
       current_setting('server_version') AS postgres_version,
       inet_server_port() AS server_port;
SELECT n.nspname AS schema_name, c.relname AS object_name,
       CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned_table'
         WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized_view' ELSE c.relkind::text END AS object_type,
       c.relrowsecurity AS row_security_enabled,
       c.relforcerowsecurity AS row_security_forced
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m')
ORDER BY object_type, object_name;
SELECT table_schema,table_name,column_name,ordinal_position,data_type,udt_name,
       is_nullable,column_default,character_maximum_length,numeric_precision,numeric_scale
FROM information_schema.columns
WHERE table_schema='public'
ORDER BY table_name,ordinal_position;
SELECT n.nspname AS schema_name, c.relname AS table_name, k.conname AS constraint_name,
       k.contype AS constraint_type, pg_get_constraintdef(k.oid,true) AS definition
FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' ORDER BY table_name,constraint_name;
SELECT schemaname,tablename,indexname,indexdef
FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname;
SELECT n.nspname AS schema_name,p.proname AS routine_name,
       pg_get_function_identity_arguments(p.oid) AS argument_types,
       p.prosecdef AS security_definer
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' ORDER BY routine_name, argument_types;
SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check
FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname;
-- Financial reference counts and two independently computed sums (no source rows exported).
SELECT 'sales' AS source_table, count(*)::bigint AS row_count,
       coalesce(sum(amount),0)::numeric(24,2) AS amount_total
FROM public.sales
UNION ALL
SELECT 'bills_master',count(*)::bigint,coalesce(sum(bill_amount),0)::numeric(24,2)
FROM public.bills_master;
SELECT 'receivables' AS source_table,count(*)::bigint AS row_count
FROM public.receivables;
ROLLBACK;
