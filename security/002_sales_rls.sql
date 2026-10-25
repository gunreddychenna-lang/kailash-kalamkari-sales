-- KK-CEO-003: SECURITY MIGRATION NOT APPROVED FOR EXECUTION.
--
-- Local PostgreSQL authorization checks:
-- Main Branch: 3753 visible
-- KHPS: 1298 visible
-- Inactive: 0
-- Unknown: 0
-- Anonymous SELECT grant: denied locally
--
-- TEST LIMITATIONS:
-- Local Supabase Auth mock, not production Auth.
-- No actual HTTP API authorization test performed.
-- No payroll/payment/CRM authorization testing completed.
--
-- This file intentionally fails if executed.
-- A production candidate must include complete policies,
-- grants, financial operation protection and rollback.

DO $$
BEGIN
  RAISE EXCEPTION
    'KK-CEO-003 migration blocked: security review incomplete';
END;
$$;