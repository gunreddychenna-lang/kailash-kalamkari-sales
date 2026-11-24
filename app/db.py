"""Database abstraction supporting PostgreSQL (production) and SQLite (local dev/tests).

Production uses PostgreSQL (`DATABASE_URL=postgresql://...`) via `psycopg`.
Local development and automated unit/integration tests seamlessly run on SQLite
(`DATABASE_URL=sqlite:///...`) with identical SQL semantics and transaction safety.
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from typing import Any, Dict, Iterable, List, Optional, Sequence


SQLITE_BOOTSTRAP_SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO roles (code, name, description) VALUES
    ('owner',       'Owner / Super Admin',   'Full visibility across all branches, finance, staff, and admin controls'),
    ('admin',       'Admin / Store Manager', 'Configured branch operational access, sales, and staff performance'),
    ('sales_staff', 'Sales Staff',           'Assigned branch sales and permitted CRM views only'),
    ('accountant',  'Accountant',            'Authorized financial reconciliation, settlements, receivables, and exports');

CREATE TABLE IF NOT EXISTS branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL UNIQUE,
    legacy_source_code TEXT,
    city TEXT NOT NULL DEFAULT 'Srikalahasti',
    state TEXT NOT NULL DEFAULT 'Andhra Pradesh',
    address TEXT,
    phone TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO branches (code, name, legacy_source_code) VALUES
    ('MAIN', 'Main Branch', 'Main Branch'),
    ('KHPS', 'KHPS',        'KHPS-FR');

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT UNIQUE,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role_code TEXT NOT NULL REFERENCES roles(code),
    primary_branch_id INTEGER REFERENCES branches(id),
    is_active INTEGER NOT NULL DEFAULT 1,
    must_reset_password INTEGER NOT NULL DEFAULT 0,
    last_login_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_branch_access (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, branch_id)
);

CREATE TABLE IF NOT EXISTS user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_hash TEXT NOT NULL UNIQUE,
    csrf_token TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address TEXT,
    user_agent TEXT,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    succeeded INTEGER NOT NULL DEFAULT 0,
    attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_code TEXT NOT NULL UNIQUE,
    user_id INTEGER UNIQUE REFERENCES users(id),
    full_name TEXT NOT NULL,
    role_title TEXT NOT NULL,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    phone TEXT,
    email TEXT,
    joining_date TEXT NOT NULL,
    relieving_date TEXT,
    employment_status TEXT NOT NULL DEFAULT 'active',
    monthly_salary TEXT NOT NULL DEFAULT '0.00',
    commission_pct TEXT NOT NULL DEFAULT '0.00',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance_codes (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    pay_multiplier TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
);

INSERT OR IGNORE INTO attendance_codes (code, label, pay_multiplier) VALUES
    ('P',  'Present',        '1.00'),
    ('A',  'Absent',         '0.00'),
    ('HD', 'Half Day',       '0.50'),
    ('PL', 'Paid Leave',     '1.00'),
    ('UL', 'Unpaid Leave',   '0.00'),
    ('WO', 'Weekly Holiday', '1.00');

CREATE TABLE IF NOT EXISTS attendance_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    attendance_date TEXT NOT NULL,
    status_code TEXT NOT NULL REFERENCES attendance_codes(code),
    notes TEXT,
    recorded_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (employee_id, attendance_date)
);

CREATE TABLE IF NOT EXISTS salary_advances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    advance_date TEXT NOT NULL,
    amount TEXT NOT NULL,
    recovered_amount TEXT NOT NULL DEFAULT '0.00',
    status TEXT NOT NULL DEFAULT 'open',
    remarks TEXT,
    approved_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sales_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER REFERENCES branches(id),
    employee_id INTEGER REFERENCES employees(id),
    target_year INTEGER NOT NULL,
    target_month INTEGER NOT NULL,
    target_amount TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    phone TEXT,
    normalized_phone TEXT,
    email TEXT,
    city TEXT,
    segment TEXT NOT NULL DEFAULT 'regular',
    assigned_staff_id INTEGER REFERENCES employees(id),
    primary_branch_id INTEGER REFERENCES branches(id),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customer_enquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    branch_id INTEGER REFERENCES branches(id),
    assigned_staff_id INTEGER REFERENCES employees(id),
    enquiry_text TEXT NOT NULL,
    follow_up_date TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bank_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_name TEXT NOT NULL UNIQUE,
    bank_name TEXT NOT NULL,
    account_number_masked TEXT,
    ifsc_code TEXT,
    account_type TEXT NOT NULL DEFAULT 'bank',
    branch_id INTEGER REFERENCES branches(id),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO bank_accounts (account_name, bank_name, account_type) VALUES
    ('Cash Drawer - Main Branch', 'Cash', 'cash'),
    ('Cash Drawer - KHPS',        'Cash', 'cash'),
    ('Primary Business Bank',     'Configured Bank', 'bank'),
    ('Business UPI Settlement',   'Configured UPI',  'upi');

CREATE TABLE IF NOT EXISTS invoice_masters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_uid TEXT NOT NULL UNIQUE,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    invoice_no TEXT NOT NULL,
    bill_date TEXT NOT NULL,
    customer_id INTEGER REFERENCES customers(id),
    customer_name TEXT,
    customer_phone TEXT,
    sales_executive TEXT,
    sales_manager TEXT,
    sale_type TEXT,
    gross_amount TEXT NOT NULL DEFAULT '0.00',
    discount_amount TEXT NOT NULL DEFAULT '0.00',
    final_amount TEXT NOT NULL DEFAULT '0.00',
    paid_amount TEXT NOT NULL DEFAULT '0.00',
    refund_amount TEXT NOT NULL DEFAULT '0.00',
    outstanding_amount TEXT NOT NULL DEFAULT '0.00',
    due_date TEXT,
    payment_status TEXT NOT NULL DEFAULT 'unpaid',
    is_finalized INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (branch_id, invoice_no)
);

CREATE TABLE IF NOT EXISTS sales_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_line_id TEXT NOT NULL UNIQUE,
    source_spreadsheet_id TEXT NOT NULL,
    source_sheet_name TEXT NOT NULL,
    source_row_number INTEGER,
    row_content_hash TEXT NOT NULL,
    invoice_id INTEGER NOT NULL REFERENCES invoice_masters(id),
    serial_no TEXT,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    raw_branch_label TEXT,
    invoice_no TEXT NOT NULL,
    bill_date TEXT NOT NULL,
    product_name TEXT NOT NULL,
    quantity TEXT NOT NULL DEFAULT '1',
    rate TEXT NOT NULL DEFAULT '0.00',
    discount TEXT NOT NULL DEFAULT '0.00',
    final_amount TEXT NOT NULL DEFAULT '0.00',
    is_return INTEGER NOT NULL DEFAULT 0,
    sales_executive TEXT,
    payment_mode TEXT,
    sale_type TEXT,
    account_name TEXT,
    bank_account TEXT,
    customer_name TEXT,
    customer_phone TEXT,
    sales_manager TEXT,
    is_source_deleted INTEGER NOT NULL DEFAULT 0,
    has_pending_diff INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoice_settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoice_masters(id),
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    payment_mode TEXT NOT NULL,
    bank_account_id INTEGER REFERENCES bank_accounts(id),
    amount TEXT NOT NULL,
    settlement_status TEXT NOT NULL DEFAULT 'completed',
    payment_reference TEXT,
    idempotency_key TEXT UNIQUE,
    settlement_date TEXT NOT NULL,
    authorized_by INTEGER NOT NULL REFERENCES users(id),
    reversed_settlement_id INTEGER REFERENCES invoice_settlements(id),
    reversal_reason TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT NOT NULL UNIQUE,
    product_name TEXT NOT NULL,
    fabric_category TEXT,
    design_category TEXT,
    mrp TEXT NOT NULL DEFAULT '0.00',
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    status TEXT NOT NULL DEFAULT 'available',
    quantity_available INTEGER NOT NULL DEFAULT 1,
    quantity_reserved INTEGER NOT NULL DEFAULT 0,
    quantity_sold INTEGER NOT NULL DEFAULT 0,
    is_drive_controlled INTEGER NOT NULL DEFAULT 0,
    drive_file_id TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    drive_file_id TEXT UNIQUE,
    image_url TEXT NOT NULL,
    file_name TEXT,
    is_present_in_drive INTEGER NOT NULL DEFAULT 1,
    last_verified_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
    movement_type TEXT NOT NULL,
    from_branch_id INTEGER REFERENCES branches(id),
    to_branch_id INTEGER REFERENCES branches(id),
    quantity_delta INTEGER NOT NULL,
    reference_note TEXT,
    performed_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_locks (
    lock_name TEXT PRIMARY KEY,
    locked_by TEXT NOT NULL,
    locked_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_key TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    triggered_by INTEGER REFERENCES users(id),
    status TEXT NOT NULL,
    rows_scanned INTEGER NOT NULL DEFAULT 0,
    rows_inserted INTEGER NOT NULL DEFAULT 0,
    rows_unchanged INTEGER NOT NULL DEFAULT 0,
    edits_detected INTEGER NOT NULL DEFAULT 0,
    deletes_detected INTEGER NOT NULL DEFAULT 0,
    discount_diffs INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT
);

CREATE TABLE IF NOT EXISTS sync_exceptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_run_id INTEGER REFERENCES sync_runs(id),
    source_line_id TEXT NOT NULL,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    invoice_no TEXT,
    exception_type TEXT NOT NULL,
    existing_snapshot TEXT,
    incoming_snapshot TEXT,
    variance_amount TEXT DEFAULT '0.00',
    resolution_status TEXT NOT NULL DEFAULT 'open',
    resolved_by INTEGER REFERENCES users(id),
    resolved_at TEXT,
    resolution_notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id INTEGER REFERENCES users(id),
    actor_role TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    branch_id INTEGER REFERENCES branches(id),
    ip_address TEXT,
    before_state TEXT,
    after_state TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance_sheets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    emp_id TEXT NOT NULL,
    employee_name TEXT NOT NULL,
    designation TEXT NOT NULL DEFAULT 'Sales (Fabrics)',
    month_sheet TEXT NOT NULL,
    phone_number TEXT DEFAULT '',
    monthly_salary TEXT NOT NULL DEFAULT '10000.00',
    commission_pct TEXT NOT NULL DEFAULT '0.00',
    advance_taken TEXT NOT NULL DEFAULT '0.00',
    status TEXT NOT NULL DEFAULT 'Active',
    joining_date TEXT,
    relieving_date TEXT,
    termination_reason TEXT DEFAULT '',
    days_data TEXT NOT NULL DEFAULT '{}',
    notes_data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (emp_id, month_sheet)
);
"""


class Database:
    """Thin, transaction-safe DB wrapper for PostgreSQL and SQLite."""

    def __init__(self, database_url: str) -> None:
        self.database_url = database_url
        self.is_postgres = database_url.startswith(("postgres://", "postgresql://"))
        self.sqlite_path: Optional[str] = None
        if not self.is_postgres:
            if database_url.startswith("sqlite:///"):
                self.sqlite_path = database_url[len("sqlite:///") :]
            elif database_url == ":memory:":
                self.sqlite_path = ":memory:"
            else:
                self.sqlite_path = database_url

    def _adapt_sql(self, sql: str) -> str:
        if self.is_postgres:
            return sql.replace("?", "%s")
        return sql

    @contextmanager
    def connection(self):
        if self.is_postgres:
            import psycopg
            from psycopg.rows import dict_row

            conn = psycopg.connect(self.database_url, row_factory=dict_row)
            try:
                yield conn
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.close()
        else:
            assert self.sqlite_path is not None
            conn = sqlite3.connect(self.sqlite_path, timeout=30.0)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys = ON")
            try:
                yield conn
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.close()

    def init_schema(self) -> None:
        if self.is_postgres:
            migration_path = os.path.join(
                os.path.dirname(os.path.dirname(__file__)),
                "db",
                "migrations",
                "001_initial_schema.sql",
            )
            with open(migration_path, "r", encoding="utf-8") as fh:
                sql = fh.read()
            with self.connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(sql)
        else:
            with self.connection() as conn:
                conn.executescript(SQLITE_BOOTSTRAP_SCHEMA)

    def fetch_all(self, conn: Any, sql: str, params: Sequence[Any] = ()) -> List[Dict[str, Any]]:
        cur = conn.cursor()
        cur.execute(self._adapt_sql(sql), tuple(params))
        rows = cur.fetchall()
        return [dict(r) for r in rows]

    def fetch_one(self, conn: Any, sql: str, params: Sequence[Any] = ()) -> Optional[Dict[str, Any]]:
        cur = conn.cursor()
        cur.execute(self._adapt_sql(sql), tuple(params))
        row = cur.fetchone()
        return dict(row) if row is not None else None

    def execute(self, conn: Any, sql: str, params: Sequence[Any] = ()) -> int:
        cur = conn.cursor()
        cur.execute(self._adapt_sql(sql), tuple(params))
        return cur.rowcount

    def insert_returning_id(self, conn: Any, sql: str, params: Sequence[Any] = ()) -> int:
        if self.is_postgres:
            cur = conn.cursor()
            cur.execute(self._adapt_sql(sql + " RETURNING id"), tuple(params))
            row = cur.fetchone()
            return int(row["id"])
        cur = conn.cursor()
        cur.execute(sql, tuple(params))
        return int(cur.lastrowid)

    def health_check(self) -> bool:
        try:
            with self.connection() as conn:
                row = self.fetch_one(conn, "SELECT 1 AS ok")
                return bool(row and row.get("ok") == 1)
        except Exception:
            return False
