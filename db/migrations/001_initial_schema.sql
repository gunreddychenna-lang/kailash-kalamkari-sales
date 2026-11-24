-- ============================================================================
-- Kailash Kalamkari Sales & Business Management Portal
-- PostgreSQL Production Schema — Migration 001 (Initial Complete Schema)
-- Currency: INR (NUMERIC(14,2) — exact decimal, zero floating-point)
-- Timezone: Asia/Kolkata (stored in TIMESTAMPTZ, formatted in IST)
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. ROLES & BRANCHES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
    id              SERIAL PRIMARY KEY,
    code            VARCHAR(32) NOT NULL UNIQUE
                    CHECK (code IN ('owner', 'admin', 'sales_staff', 'accountant')),
    name            VARCHAR(64) NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO roles (code, name, description) VALUES
    ('owner',       'Owner / Super Admin',   'Full visibility across all branches, finance, staff, and admin controls'),
    ('admin',       'Admin / Store Manager', 'Configured branch operational access, sales, and staff performance'),
    ('sales_staff', 'Sales Staff',           'Assigned branch sales and permitted CRM views only'),
    ('accountant',  'Accountant',            'Authorized financial reconciliation, settlements, receivables, and exports')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS branches (
    id                  SERIAL PRIMARY KEY,
    code                VARCHAR(32) NOT NULL UNIQUE,
    name                VARCHAR(100) NOT NULL UNIQUE,
    legacy_source_code  VARCHAR(64),
    city                VARCHAR(80) NOT NULL DEFAULT 'Srikalahasti',
    state               VARCHAR(80) NOT NULL DEFAULT 'Andhra Pradesh',
    address             TEXT,
    phone               VARCHAR(32),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO branches (code, name, legacy_source_code) VALUES
    ('MAIN', 'Main Branch', 'Main Branch'),
    ('KHPS', 'KHPS',        'KHPS-FR')
ON CONFLICT (code) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. USERS, SESSIONS, PASSWORD RESETS & LOGIN RATE LIMITING
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id                  BIGSERIAL PRIMARY KEY,
    username            VARCHAR(64) NOT NULL UNIQUE,
    email               VARCHAR(160) UNIQUE,
    full_name           VARCHAR(120) NOT NULL,
    password_hash       TEXT NOT NULL,
    role_code           VARCHAR(32) NOT NULL REFERENCES roles(code),
    primary_branch_id   INTEGER REFERENCES branches(id),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    must_reset_password BOOLEAN NOT NULL DEFAULT FALSE,
    last_login_at       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_branch_access (
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    branch_id   INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, branch_id)
);

CREATE TABLE IF NOT EXISTS user_sessions (
    id              BIGSERIAL PRIMARY KEY,
    session_hash    VARCHAR(128) NOT NULL UNIQUE,
    csrf_token      VARCHAR(128) NOT NULL,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address      VARCHAR(64),
    user_agent      TEXT,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(128) NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS login_attempts (
    id          BIGSERIAL PRIMARY KEY,
    identifier  VARCHAR(128) NOT NULL,
    ip_address  VARCHAR(64) NOT NULL,
    succeeded   BOOLEAN NOT NULL DEFAULT FALSE,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_lookup
    ON login_attempts(identifier, ip_address, attempted_at DESC);

-- ----------------------------------------------------------------------------
-- 3. EMPLOYEES, ATTENDANCE, SALARY ADVANCES & SALES TARGETS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employees (
    id                  BIGSERIAL PRIMARY KEY,
    employee_code       VARCHAR(32) NOT NULL UNIQUE,
    user_id             BIGINT UNIQUE REFERENCES users(id),
    full_name           VARCHAR(120) NOT NULL,
    role_title          VARCHAR(80) NOT NULL,
    branch_id           INTEGER NOT NULL REFERENCES branches(id),
    phone               VARCHAR(32),
    email               VARCHAR(160),
    joining_date        DATE NOT NULL,
    relieving_date      DATE,
    employment_status   VARCHAR(24) NOT NULL DEFAULT 'active'
                        CHECK (employment_status IN ('active', 'on_leave', 'resigned', 'terminated')),
    monthly_salary      NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (monthly_salary >= 0),
    commission_pct      NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (commission_pct >= 0 AND commission_pct <= 100),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (relieving_date IS NULL OR relieving_date >= joining_date)
);

CREATE INDEX IF NOT EXISTS idx_employees_branch ON employees(branch_id);

CREATE TABLE IF NOT EXISTS attendance_codes (
    code                VARCHAR(16) PRIMARY KEY,
    label               VARCHAR(64) NOT NULL,
    pay_multiplier      NUMERIC(4,2) NOT NULL CHECK (pay_multiplier >= 0 AND pay_multiplier <= 2.00),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO attendance_codes (code, label, pay_multiplier) VALUES
    ('P',  'Present',        1.00),
    ('A',  'Absent',         0.00),
    ('HD', 'Half Day',       0.50),
    ('PL', 'Paid Leave',     1.00),
    ('UL', 'Unpaid Leave',   0.00),
    ('WO', 'Weekly Holiday', 1.00)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS attendance_records (
    id              BIGSERIAL PRIMARY KEY,
    employee_id     BIGINT NOT NULL REFERENCES employees(id),
    branch_id       INTEGER NOT NULL REFERENCES branches(id),
    attendance_date DATE NOT NULL,
    status_code     VARCHAR(16) NOT NULL REFERENCES attendance_codes(code),
    notes           TEXT,
    recorded_by     BIGINT REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (employee_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(attendance_date, branch_id);

CREATE TABLE IF NOT EXISTS salary_advances (
    id              BIGSERIAL PRIMARY KEY,
    employee_id     BIGINT NOT NULL REFERENCES employees(id),
    advance_date    DATE NOT NULL,
    amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    recovered_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (recovered_amount >= 0 AND recovered_amount <= amount),
    status          VARCHAR(24) NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'partially_recovered', 'recovered', 'reversed')),
    remarks         TEXT,
    approved_by     BIGINT REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_targets (
    id              BIGSERIAL PRIMARY KEY,
    branch_id       INTEGER REFERENCES branches(id),
    employee_id     BIGINT REFERENCES employees(id),
    target_year     INTEGER NOT NULL CHECK (target_year BETWEEN 2020 AND 2100),
    target_month    INTEGER NOT NULL CHECK (target_month BETWEEN 1 AND 12),
    target_amount   NUMERIC(14,2) NOT NULL CHECK (target_amount >= 0),
    created_by      BIGINT REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (branch_id IS NOT NULL OR employee_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_targets_scope
    ON sales_targets(COALESCE(branch_id, 0), COALESCE(employee_id, 0), target_year, target_month);

-- ----------------------------------------------------------------------------
-- 4. CUSTOMERS (CRM)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
    id                  BIGSERIAL PRIMARY KEY,
    full_name           VARCHAR(160) NOT NULL,
    phone               VARCHAR(32),
    normalized_phone    VARCHAR(20),
    email               VARCHAR(160),
    city                VARCHAR(80),
    segment             VARCHAR(32) NOT NULL DEFAULT 'regular'
                        CHECK (segment IN ('new', 'regular', 'repeat', 'vip', 'wholesale', 'inactive')),
    assigned_staff_id   BIGINT REFERENCES employees(id),
    primary_branch_id   INTEGER REFERENCES branches(id),
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_normalized_phone
    ON customers(normalized_phone) WHERE normalized_phone IS NOT NULL AND normalized_phone <> '';
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(LOWER(full_name));

CREATE TABLE IF NOT EXISTS customer_enquiries (
    id                  BIGSERIAL PRIMARY KEY,
    customer_id         BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    branch_id           INTEGER REFERENCES branches(id),
    assigned_staff_id   BIGINT REFERENCES employees(id),
    enquiry_text        TEXT NOT NULL,
    follow_up_date      DATE,
    status              VARCHAR(24) NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'in_progress', 'converted', 'closed')),
    created_by          BIGINT REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 5. BANK ACCOUNTS & PAYMENT MODES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bank_accounts (
    id              SERIAL PRIMARY KEY,
    account_name    VARCHAR(120) NOT NULL UNIQUE,
    bank_name       VARCHAR(120) NOT NULL,
    account_number_masked VARCHAR(32),
    ifsc_code       VARCHAR(20),
    account_type    VARCHAR(24) NOT NULL DEFAULT 'bank'
                    CHECK (account_type IN ('cash', 'bank', 'upi', 'card_settlement')),
    branch_id       INTEGER REFERENCES branches(id),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO bank_accounts (account_name, bank_name, account_type) VALUES
    ('Cash Drawer - Main Branch', 'Cash', 'cash'),
    ('Cash Drawer - KHPS',        'Cash', 'cash'),
    ('Primary Business Bank',     'Configured Bank', 'bank'),
    ('Business UPI Settlement',   'Configured UPI',  'upi')
ON CONFLICT (account_name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 6. INVOICE MASTERS, SALES / INVOICE ITEMS, PAYMENTS, SETTLEMENTS & RECEIVABLES
--    Composite invoice identity: (branch_id, invoice_no) prevents cross-branch collisions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_masters (
    id                  BIGSERIAL PRIMARY KEY,
    invoice_uid         VARCHAR(120) NOT NULL UNIQUE,  -- e.g. 'MAIN::INV-1001'
    branch_id           INTEGER NOT NULL REFERENCES branches(id),
    invoice_no          VARCHAR(80) NOT NULL,
    bill_date           DATE NOT NULL,
    customer_id         BIGINT REFERENCES customers(id),
    customer_name       VARCHAR(160),
    customer_phone      VARCHAR(32),
    sales_executive     VARCHAR(120),
    sales_manager       VARCHAR(120),
    sale_type           VARCHAR(64),
    gross_amount        NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    discount_amount     NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    final_amount        NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    paid_amount         NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    refund_amount       NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    outstanding_amount  NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    due_date            DATE,
    payment_status      VARCHAR(24) NOT NULL DEFAULT 'unpaid'
                        CHECK (payment_status IN ('unpaid', 'partial', 'paid', 'overpaid', 'refunded', 'return_credit')),
    is_finalized        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (branch_id, invoice_no)
);

CREATE INDEX IF NOT EXISTS idx_invoices_bill_date ON invoice_masters(bill_date DESC, branch_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoice_masters(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoice_masters(payment_status, branch_id);

CREATE TABLE IF NOT EXISTS sales_lines (
    id                  BIGSERIAL PRIMARY KEY,
    source_line_id      VARCHAR(128) NOT NULL UNIQUE,   -- Deterministic SHA-256 identity from Google Sheets
    source_spreadsheet_id VARCHAR(128) NOT NULL,
    source_sheet_name   VARCHAR(100) NOT NULL,
    source_row_number   INTEGER,
    row_content_hash    VARCHAR(64) NOT NULL,
    invoice_id          BIGINT NOT NULL REFERENCES invoice_masters(id),
    serial_no           VARCHAR(64),
    branch_id           INTEGER NOT NULL REFERENCES branches(id),
    raw_branch_label    VARCHAR(64),
    invoice_no          VARCHAR(80) NOT NULL,
    bill_date           DATE NOT NULL,
    product_name        VARCHAR(255) NOT NULL,
    quantity            NUMERIC(12,3) NOT NULL DEFAULT 1,
    rate                NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    discount            NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    final_amount        NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    is_return           BOOLEAN NOT NULL DEFAULT FALSE,
    sales_executive     VARCHAR(120),
    payment_mode        VARCHAR(64),
    sale_type           VARCHAR(64),
    account_name        VARCHAR(120),
    bank_account        VARCHAR(120),
    customer_name       VARCHAR(160),
    customer_phone      VARCHAR(32),
    sales_manager       VARCHAR(120),
    is_source_deleted   BOOLEAN NOT NULL DEFAULT FALSE,
    has_pending_diff    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_lines_bill_date ON sales_lines(bill_date DESC, branch_id);
CREATE INDEX IF NOT EXISTS idx_sales_lines_invoice ON sales_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_sales_lines_staff ON sales_lines(sales_executive, bill_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_lines_payment_mode ON sales_lines(payment_mode);
CREATE INDEX IF NOT EXISTS idx_sales_lines_product ON sales_lines(product_name);

CREATE TABLE IF NOT EXISTS invoice_settlements (
    id                  BIGSERIAL PRIMARY KEY,
    invoice_id          BIGINT NOT NULL REFERENCES invoice_masters(id),
    branch_id           INTEGER NOT NULL REFERENCES branches(id),
    payment_mode        VARCHAR(32) NOT NULL
                        CHECK (payment_mode IN ('cash', 'upi', 'bank_transfer', 'card', 'cheque', 'other')),
    bank_account_id     INTEGER REFERENCES bank_accounts(id),
    amount              NUMERIC(14,2) NOT NULL CHECK (amount <> 0),
    settlement_status   VARCHAR(24) NOT NULL DEFAULT 'completed'
                        CHECK (settlement_status IN ('pending', 'completed', 'reversed')),
    payment_reference   VARCHAR(120),
    idempotency_key     VARCHAR(128) UNIQUE,
    settlement_date     DATE NOT NULL,
    authorized_by       BIGINT NOT NULL REFERENCES users(id),
    reversed_settlement_id BIGINT REFERENCES invoice_settlements(id),
    reversal_reason     TEXT,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settlements_invoice ON invoice_settlements(invoice_id);
CREATE INDEX IF NOT EXISTS idx_settlements_date ON invoice_settlements(settlement_date DESC, branch_id);

-- ----------------------------------------------------------------------------
-- 7. INVENTORY & GOOGLE DRIVE CATALOGUE IMAGES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_items (
    id                  BIGSERIAL PRIMARY KEY,
    sku                 VARCHAR(80) NOT NULL UNIQUE,
    product_name        VARCHAR(255) NOT NULL,
    fabric_category     VARCHAR(100),
    design_category     VARCHAR(100),
    mrp                 NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (mrp >= 0),
    branch_id           INTEGER NOT NULL REFERENCES branches(id),
    status              VARCHAR(24) NOT NULL DEFAULT 'available'
                        CHECK (status IN ('available', 'reserved', 'sold', 'transferred', 'unavailable')),
    quantity_available  INTEGER NOT NULL DEFAULT 1 CHECK (quantity_available >= 0),
    quantity_reserved   INTEGER NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
    quantity_sold       INTEGER NOT NULL DEFAULT 0 CHECK (quantity_sold >= 0),
    is_drive_controlled BOOLEAN NOT NULL DEFAULT FALSE,
    drive_file_id       VARCHAR(160) UNIQUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_branch_status ON inventory_items(branch_id, status);

CREATE TABLE IF NOT EXISTS product_images (
    id                  BIGSERIAL PRIMARY KEY,
    inventory_item_id   BIGINT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    drive_file_id       VARCHAR(160) UNIQUE,
    image_url           TEXT NOT NULL,
    file_name           VARCHAR(255),
    is_present_in_drive BOOLEAN NOT NULL DEFAULT TRUE,
    last_verified_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_movements (
    id                  BIGSERIAL PRIMARY KEY,
    inventory_item_id   BIGINT NOT NULL REFERENCES inventory_items(id),
    movement_type       VARCHAR(32) NOT NULL
                        CHECK (movement_type IN ('intake', 'transfer', 'reserve', 'release', 'sale', 'adjustment', 'drive_removed')),
    from_branch_id      INTEGER REFERENCES branches(id),
    to_branch_id        INTEGER REFERENCES branches(id),
    quantity_delta      INTEGER NOT NULL,
    reference_note      TEXT,
    performed_by        BIGINT REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 8. GOOGLE SHEETS SYNC STATE, LOCKS, EXCEPTIONS & AUDIT LOGS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_locks (
    lock_name       VARCHAR(64) PRIMARY KEY,
    locked_by       VARCHAR(128) NOT NULL,
    locked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_runs (
    id                  BIGSERIAL PRIMARY KEY,
    source_key          VARCHAR(64) NOT NULL,  -- 'all', 'main_branch', 'khps'
    trigger_type        VARCHAR(24) NOT NULL CHECK (trigger_type IN ('scheduled', 'manual')),
    triggered_by        BIGINT REFERENCES users(id),
    status              VARCHAR(24) NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
    rows_scanned        INTEGER NOT NULL DEFAULT 0,
    rows_inserted       INTEGER NOT NULL DEFAULT 0,
    rows_unchanged      INTEGER NOT NULL DEFAULT 0,
    edits_detected      INTEGER NOT NULL DEFAULT 0,
    deletes_detected    INTEGER NOT NULL DEFAULT 0,
    discount_diffs      INTEGER NOT NULL DEFAULT 0,
    error_message       TEXT,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_status ON sync_runs(status, finished_at DESC);

CREATE TABLE IF NOT EXISTS sync_exceptions (
    id                  BIGSERIAL PRIMARY KEY,
    sync_run_id         BIGINT REFERENCES sync_runs(id),
    source_line_id      VARCHAR(128) NOT NULL,
    branch_id           INTEGER NOT NULL REFERENCES branches(id),
    invoice_no          VARCHAR(80),
    exception_type      VARCHAR(40) NOT NULL
                        CHECK (exception_type IN ('historical_edit', 'source_deleted', 'discount_discrepancy', 'validation_error')),
    existing_snapshot   JSONB,
    incoming_snapshot   JSONB,
    variance_amount     NUMERIC(14,2) DEFAULT 0.00,
    resolution_status   VARCHAR(24) NOT NULL DEFAULT 'open'
                        CHECK (resolution_status IN ('open', 'approved_update', 'kept_existing', 'dismissed')),
    resolved_by         BIGINT REFERENCES users(id),
    resolved_at         TIMESTAMPTZ,
    resolution_notes    TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_exceptions_status ON sync_exceptions(resolution_status, exception_type);

CREATE TABLE IF NOT EXISTS audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    actor_user_id   BIGINT REFERENCES users(id),
    actor_role      VARCHAR(32),
    action          VARCHAR(80) NOT NULL,
    entity_type     VARCHAR(64) NOT NULL,
    entity_id       VARCHAR(128),
    branch_id       INTEGER REFERENCES branches(id),
    ip_address      VARCHAR(64),
    before_state    JSONB,
    after_state     JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);


CREATE TABLE IF NOT EXISTS attendance_sheets (
    id                  BIGSERIAL PRIMARY KEY,
    emp_id              VARCHAR(32) NOT NULL,
    employee_name       VARCHAR(120) NOT NULL,
    designation         VARCHAR(80) NOT NULL DEFAULT 'Sales (Fabrics)',
    month_sheet         VARCHAR(40) NOT NULL,
    phone_number        VARCHAR(32) DEFAULT '',
    monthly_salary      NUMERIC(14,2) NOT NULL DEFAULT 10000.00,
    commission_pct      NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    advance_taken       NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    status              VARCHAR(24) NOT NULL DEFAULT 'Active',
    joining_date        DATE,
    relieving_date      DATE,
    termination_reason  TEXT DEFAULT '',
    days_data           JSONB NOT NULL DEFAULT '{}'::jsonb,
    notes_data          JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (emp_id, month_sheet)
);

COMMIT;
