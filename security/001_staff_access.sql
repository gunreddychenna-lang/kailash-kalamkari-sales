-- KK-CEO-003: ISOLATED DEVELOPMENT ONLY
-- Do not execute against production Supabase.
-- Authentication passwords belong in Supabase Auth, not this table.

BEGIN;

CREATE TABLE IF NOT EXISTS public.kk_staff_access (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id uuid UNIQUE,
    login_id text NOT NULL UNIQUE,
    display_name text NOT NULL,
    employee_id text,
    role text NOT NULL CHECK (
        role IN (
            'owner_admin',
            'store_manager',
            'sales_staff',
            'accountant'
        )
    ),
    stores text[] NOT NULL DEFAULT '{}',
    features text[] NOT NULL DEFAULT '{}',
    active boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT kk_staff_login_not_blank
        CHECK (length(trim(login_id)) > 0),

    CONSTRAINT kk_staff_auth_required_when_active
        CHECK (active = false OR auth_user_id IS NOT NULL)
);

ALTER TABLE public.kk_staff_access
    ENABLE ROW LEVEL SECURITY;

-- Fail closed: no client-readable staff policies yet.
-- Owner-only management policies will be added and tested
-- together with Supabase Auth in an isolated environment.

REVOKE ALL ON public.kk_staff_access
    FROM PUBLIC;

COMMIT;
