"""Backend service layer for the original Kailash Kalamkari Portal screens:
- index.html (Multi-Store Sales Analytics, Targets, Inline Attendance)
- entry.html (Enterprise Bank Settlement & Multi-Split Reconciliation)
- crm.html (Retail Customer Relationship Hub, excluding Wholesale / Take by Hand)
- attendance.html (Staff Attendance & Pro-Rated Payroll Hub)
"""

from __future__ import annotations

import json
import requests
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, status

from app.db import Database
from app.formatting import to_decimal
from app.security import AuthContext, write_audit_log
from app.sync.sheets_sync import _recalculate_invoice_master


DEFAULT_STAFF_ROSTER = [
    {"emp_id": "KS-103", "employee_name": "B varalakshmi", "designation": "Sales (Fabrics)", "phone_number": "", "monthly_salary": 10000, "commission_pct": 1.0, "status": "Active", "days_data": {"5": "P", "6": "A", "7": "P"}},
    {"emp_id": "KS-104", "employee_name": "Ty mounika", "designation": "Sales (Fabrics)", "phone_number": "8317649338", "monthly_salary": 10000, "commission_pct": 1.0, "status": "Active", "days_data": {"5": "P", "6": "P", "7": "P"}},
    {"emp_id": "KS-105", "employee_name": "r sanjana", "designation": "Sales (Fabrics)", "phone_number": "", "monthly_salary": 10000, "commission_pct": 1.0, "status": "Active", "days_data": {"5": "P", "6": "P", "7": "P"}},
    {"emp_id": "KS-106", "employee_name": "geethika", "designation": "Sales (Fabrics)", "phone_number": "7995218133", "monthly_salary": 10000, "commission_pct": 1.0, "status": "Active", "days_data": {"5": "P", "6": "P", "7": "P"}},
    {"emp_id": "KS-107", "employee_name": "J sandhya", "designation": "Sales (Fabrics)", "phone_number": "9618854507", "monthly_salary": 10000, "commission_pct": 1.0, "status": "Active", "days_data": {"5": "P", "6": "P", "7": "P"}},
    {"emp_id": "KS-108", "employee_name": "c Pushpa", "designation": "Sales (Fabrics)", "phone_number": "7893617526", "monthly_salary": 10000, "commission_pct": 1.0, "status": "Active", "days_data": {"5": "P", "6": "A", "7": "A"}},
    {"emp_id": "KS-109", "employee_name": "Bharathamma", "designation": "Sweeper", "phone_number": "", "monthly_salary": 8000, "commission_pct": 0.0, "status": "Active", "days_data": {"5": "P", "6": "P", "7": "P"}},
    {"emp_id": "KS-110", "employee_name": "Nandhini", "designation": "Sales (Fabrics)", "phone_number": "", "monthly_salary": 10000, "commission_pct": 1.0, "status": "Active", "days_data": {"5": "P", "6": "P", "7": "P"}},
    {"emp_id": "KS-111", "employee_name": "Harika", "designation": "Sales (Fabrics)", "phone_number": "", "monthly_salary": 10000, "commission_pct": 1.0, "status": "Active", "days_data": {"5": "HD", "6": "A", "7": "P"}},
    {"emp_id": "KS-112", "employee_name": "Dhanalakshmi", "designation": "Sales (Fabrics)", "phone_number": "", "monthly_salary": 10000, "commission_pct": 1.0, "status": "Active", "days_data": {"4": "A", "5": "A", "6": "P", "7": "P"}},
    {"emp_id": "KS-113", "employee_name": "M.Ammulu", "designation": "Sweeper", "phone_number": "", "monthly_salary": 8000, "commission_pct": 0.0, "status": "Active", "days_data": {"7": "P"}},
]


def _classify_channel(sale_type: str, payment_mode: str, invoice_no: str, branch_name: str) -> str:
    st = (sale_type or "").lower()
    pm = (payment_mode or "").lower()
    bno = (invoice_no or "").upper()
    br = (branch_name or "").lower()
    if (
        "wholesale" in st
        or "take by hand" in st
        or "takebyhand" in st
        or "take by hand" in pm
        or "wholesale" in pm
        or "tbh" in pm
        or bno.startswith("TBH")
        or bno.startswith("WS")
        or "wholesale" in br
    ):
        return "Take by Hand"
    if "online" in st or "online" in pm or "website" in st or "ecom" in st:
        return "Online"
    return "Offline"


def _branch_sql(branch_ids: Optional[List[int]], alias: str) -> tuple[str, List[Any]]:
    if branch_ids is None:
        return "1=1", []
    ph = ",".join("?" for _ in branch_ids)
    return f"{alias}.branch_id IN ({ph})", list(branch_ids)


def get_portal_sales_rows(
    db: Database,
    branch_ids: Optional[List[int]],
    include_customer_phone: bool = True,
) -> List[Dict[str, Any]]:
    b_sql, params = _branch_sql(branch_ids, "sl")
    with db.connection() as conn:
        rows = db.fetch_all(
            conn,
            f"""
            SELECT sl.id, sl.invoice_id, sl.invoice_no AS bill_no, sl.bill_date,
                   b.name AS store_name, b.code AS branch_code,
                   sl.product_name AS item_name, sl.quantity AS qty, sl.rate,
                   sl.discount, sl.final_amount AS amount, sl.is_return,
                   sl.sales_executive AS sm_name, sl.payment_mode AS pay_mode,
                   sl.sale_type, sl.account_name, sl.bank_account,
                   sl.customer_name, sl.customer_phone, sl.sales_manager
            FROM sales_lines sl
            JOIN branches b ON b.id = sl.branch_id
            WHERE {b_sql} AND sl.is_source_deleted = FALSE
            ORDER BY sl.bill_date ASC, sl.id ASC
            """,
            params,
        )
    out: List[Dict[str, Any]] = []
    for r in rows:
        item = dict(r)
        item["channel"] = _classify_channel(
            item.get("sale_type", ""),
            item.get("pay_mode", ""),
            item.get("bill_no", ""),
            item.get("store_name", ""),
        )
        if not include_customer_phone:
            item["customer_phone"] = ""
        out.append(item)
    return out


def get_portal_bills_master(db: Database, branch_ids: Optional[List[int]]) -> Dict[str, Any]:
    """Return invoice-level bills_master + existing bank settlements + bank_accounts for entry.html."""
    b_sql, params = _branch_sql(branch_ids, "im")
    with db.connection() as conn:
        bills = db.fetch_all(
            conn,
            f"""
            SELECT im.id AS invoice_id, im.invoice_uid, im.invoice_no AS bill_no,
                   im.bill_date, b.name AS branch, b.id AS branch_id,
                   COALESCE(im.sales_executive, 'No Agent') AS sm_name,
                   im.sale_type, im.final_amount AS bill_amount,
                   im.paid_amount, im.outstanding_amount, im.payment_status
            FROM invoice_masters im
            JOIN branches b ON b.id = im.branch_id
            WHERE {b_sql}
            ORDER BY im.bill_date ASC, im.invoice_no ASC
            """,
            params,
        )

        # Fetch payment mode hint from first sales line per invoice for channel classification
        mode_rows = db.fetch_all(
            conn,
            "SELECT invoice_id, MIN(payment_mode) AS pay_mode FROM sales_lines WHERE is_source_deleted = FALSE GROUP BY invoice_id",
        )
        mode_by_inv = {int(m["invoice_id"]): (m["pay_mode"] or "") for m in mode_rows}

        settle_rows = db.fetch_all(
            conn,
            """
            SELECT s.invoice_id, im.invoice_no AS bill_no, im.invoice_uid,
                   COALESCE(ba.account_name, s.payment_reference, s.payment_mode) AS bank_account,
                   s.amount
            FROM invoice_settlements s
            JOIN invoice_masters im ON im.id = s.invoice_id
            LEFT JOIN bank_accounts ba ON ba.id = s.bank_account_id
            WHERE s.settlement_status = 'completed'
            ORDER BY s.id ASC
            """,
        )

        bank_rows = db.fetch_all(
            conn,
            "SELECT id, account_name, bank_name, account_type FROM bank_accounts WHERE is_active = TRUE ORDER BY account_name ASC",
        )

    settlements_by_uid: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for s in settle_rows:
        acc = (s["bank_account"] or "").strip()
        if acc and acc.lower() not in {"not defined", "pending"}:
            settlements_by_uid[s["invoice_uid"]].append(
                {"account": acc, "amount": float(to_decimal(s["amount"]))}
            )

    formatted_bills = []
    for b in bills:
        pm = mode_by_inv.get(int(b["invoice_id"]), "")
        channel = _classify_channel(b.get("sale_type") or "", pm, b["bill_no"], b["branch"])
        formatted_bills.append(
            {
                "invoice_id": int(b["invoice_id"]),
                "invoice_uid": b["invoice_uid"],
                "bill_no": b["bill_no"],
                "bill_date": str(b["bill_date"]),
                "branch": b["branch"],
                "sm_name": b["sm_name"] or "No Agent",
                "channel": channel,
                "bill_amount": float(to_decimal(b["bill_amount"])),
                "settlements": settlements_by_uid.get(b["invoice_uid"], []),
            }
        )

    return {
        "bills": formatted_bills,
        "bank_accounts": bank_rows,
    }


def _ensure_bank_account(db: Database, conn: Any, account_name: str, account_type: str = "bank") -> int:
    clean = account_name.strip()
    existing = db.fetch_one(conn, "SELECT id FROM bank_accounts WHERE LOWER(account_name) = LOWER(?)", (clean,))
    if existing:
        return int(existing["id"])
    norm_type = "cash" if "cash" in clean.lower() or "cash" in account_type.lower() else (
        "upi" if "upi" in clean.lower() or "upi" in account_type.lower() else (
            "card_settlement" if "card" in account_type.lower() or "pos" in account_type.lower() else "bank"
        )
    )
    return db.insert_returning_id(
        conn,
        "INSERT INTO bank_accounts (account_name, bank_name, account_type, is_active) VALUES (?, ?, ?, TRUE)",
        (clean, account_type or "Configured Bank", norm_type),
    )


def save_bill_bank_splits(
    db: Database,
    auth: AuthContext,
    items: List[Dict[str, Any]],
    ip_address: Optional[str] = None,
) -> Dict[str, Any]:
    """Save single or bulk bank-account split allocations from entry.html atomically."""
    if not items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No bill settlements provided")

    updated_count = 0
    now_iso = datetime.now(timezone.utc).isoformat()
    with db.connection() as conn:
        for item in items:
            inv = None
            if item.get("invoice_id"):
                inv = db.fetch_one(conn, "SELECT * FROM invoice_masters WHERE id = ?", (int(item["invoice_id"]),))
            elif item.get("invoice_uid"):
                inv = db.fetch_one(conn, "SELECT * FROM invoice_masters WHERE invoice_uid = ?", (item["invoice_uid"],))
            elif item.get("bill_no"):
                inv = db.fetch_one(conn, "SELECT * FROM invoice_masters WHERE invoice_no = ? ORDER BY id ASC LIMIT 1", (item["bill_no"],))

            if not inv:
                continue
            if not auth.all_branches and int(inv["branch_id"]) not in auth.allowed_branch_ids:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Branch access denied")

            splits = [
                s for s in (item.get("splits") or [])
                if str(s.get("account", "")).strip() and to_decimal(s.get("amount")) > Decimal("0.00")
            ]
            if not splits:
                continue

            inv_id = int(inv["id"])
            # Mark prior completed settlements on this invoice as reversed (preserves audit trail) or replace active allocation
            db.execute(
                conn,
                "DELETE FROM invoice_settlements WHERE invoice_id = ? AND settlement_status = 'completed'",
                (inv_id,),
            )

            for s in splits:
                acc_name = str(s["account"]).strip()
                amt = to_decimal(s["amount"])
                ba_id = _ensure_bank_account(db, conn, acc_name)
                pmode = "cash" if "cash" in acc_name.lower() else ("upi" if "upi" in acc_name.lower() else "bank_transfer")
                db.execute(
                    conn,
                    """
                    INSERT INTO invoice_settlements (
                        invoice_id, branch_id, payment_mode, bank_account_id, amount,
                        settlement_status, payment_reference, settlement_date, authorized_by, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)
                    """,
                    (
                        inv_id,
                        inv["branch_id"],
                        pmode,
                        ba_id,
                        f"{amt:.2f}",
                        acc_name,
                        str(inv["bill_date"]),
                        auth.user_id,
                        now_iso,
                        now_iso,
                    ),
                )

            _recalculate_invoice_master(db, conn, inv_id)
            updated_count += 1

        write_audit_log(
            db,
            conn,
            actor_user_id=auth.user_id,
            actor_role=auth.role_code,
            action="save_bank_settlements",
            entity_type="invoice_settlements",
            entity_id=f"batch:{updated_count}",
            ip_address=ip_address,
            after_state={"updated_invoices": updated_count},
        )

    return {"status": "saved", "updated_invoices": updated_count}


def reset_bill_settlements(
    db: Database,
    auth: AuthContext,
    invoice_id: Optional[int] = None,
    ip_address: Optional[str] = None,
) -> Dict[str, Any]:
    with db.connection() as conn:
        if invoice_id is not None:
            inv = db.fetch_one(conn, "SELECT id, branch_id FROM invoice_masters WHERE id = ?", (invoice_id,))
            if not inv:
                raise HTTPException(status_code=404, detail="Invoice not found")
            if not auth.all_branches and int(inv["branch_id"]) not in auth.allowed_branch_ids:
                raise HTTPException(status_code=403, detail="Branch access denied")
            db.execute(conn, "DELETE FROM invoice_settlements WHERE invoice_id = ?", (invoice_id,))
            _recalculate_invoice_master(db, conn, invoice_id)
            affected = 1
        else:
            all_invs = db.fetch_all(conn, "SELECT id FROM invoice_masters")
            db.execute(conn, "DELETE FROM invoice_settlements")
            for row in all_invs:
                _recalculate_invoice_master(db, conn, int(row["id"]))
            affected = len(all_invs)

        write_audit_log(
            db,
            conn,
            actor_user_id=auth.user_id,
            actor_role=auth.role_code,
            action="reset_bank_settlements",
            entity_type="invoice_settlements",
            entity_id=str(invoice_id) if invoice_id is not None else "ALL",
            ip_address=ip_address,
            after_state={"affected_invoices": affected},
        )
    return {"status": "reset", "affected_invoices": affected}


def add_portal_bank_account(
    db: Database,
    auth: AuthContext,
    account_name: str,
    account_type: str,
    ip_address: Optional[str] = None,
) -> Dict[str, Any]:
    clean = account_name.strip()
    if not clean:
        raise HTTPException(status_code=400, detail="Bank account name is required")
    with db.connection() as conn:
        ba_id = _ensure_bank_account(db, conn, clean, account_type)
        write_audit_log(
            db,
            conn,
            actor_user_id=auth.user_id,
            actor_role=auth.role_code,
            action="add_bank_account",
            entity_type="bank_account",
            entity_id=str(ba_id),
            ip_address=ip_address,
            after_state={"account_name": clean, "account_type": account_type},
        )
    return {"id": ba_id, "account_name": clean, "account_type": account_type}


def get_portal_attendance(db: Database) -> List[Dict[str, Any]]:
    """Return all attendance sheets; seed default 11-staff roster for September 2026 if empty."""
    with db.connection() as conn:
        rows = db.fetch_all(conn, "SELECT * FROM attendance_sheets ORDER BY month_sheet ASC, emp_id ASC")
        if not rows:
            for m in DEFAULT_STAFF_ROSTER:
                db.execute(
                    conn,
                    """
                    INSERT INTO attendance_sheets (
                        emp_id, employee_name, designation, month_sheet, phone_number,
                        monthly_salary, commission_pct, advance_taken, status, days_data, notes_data
                    ) VALUES (?, ?, ?, 'September 2026', ?, ?, ?, '0.00', ?, ?, '{}')
                    """,
                    (
                        m["emp_id"],
                        m["employee_name"],
                        m["designation"],
                        m["phone_number"],
                        f"{m['monthly_salary']:.2f}",
                        f"{m['commission_pct']:.2f}",
                        m["status"],
                        json.dumps(m["days_data"]),
                    ),
                )
            rows = db.fetch_all(conn, "SELECT * FROM attendance_sheets ORDER BY month_sheet ASC, emp_id ASC")

    parsed = []
    for r in rows:
        days = r["days_data"]
        if isinstance(days, str):
            try:
                days = json.loads(days) if days else {}
            except Exception:
                days = {}
        notes = r["notes_data"]
        if isinstance(notes, str):
            try:
                notes = json.loads(notes) if notes else {}
            except Exception:
                notes = {}
        parsed.append(
            {
                "id": int(r["id"]),
                "emp_id": r["emp_id"],
                "employee_name": r["employee_name"],
                "designation": r["designation"],
                "month_sheet": r["month_sheet"],
                "phone_number": r["phone_number"] or "",
                "monthly_salary": float(to_decimal(r["monthly_salary"])),
                "commission_pct": float(to_decimal(r["commission_pct"])),
                "advance_taken": float(to_decimal(r["advance_taken"])),
                "status": r["status"] or "Active",
                "joining_date": r["joining_date"] or "",
                "relieving_date": r["relieving_date"] or "",
                "termination_reason": r["termination_reason"] or "",
                "days_data": days,
                "notes_data": notes,
            }
        )
    return parsed


def save_portal_attendance(
    db: Database,
    auth: AuthContext,
    records: List[Dict[str, Any]],
    ip_address: Optional[str] = None,
) -> Dict[str, Any]:
    if not records:
        raise HTTPException(status_code=400, detail="No attendance records provided")
    now_iso = datetime.now(timezone.utc).isoformat()
    with db.connection() as conn:
        for rec in records:
            emp_id = str(rec.get("emp_id", "")).strip()
            month_sheet = str(rec.get("month_sheet", "")).strip()
            if not emp_id or not month_sheet:
                continue
            existing = db.fetch_one(
                conn,
                "SELECT id FROM attendance_sheets WHERE emp_id = ? AND month_sheet = ?",
                (emp_id, month_sheet),
            )
            days_json = json.dumps(rec.get("days_data") or {})
            notes_json = json.dumps(rec.get("notes_data") or {})
            params = (
                rec.get("employee_name", ""),
                rec.get("designation", "Sales (Fabrics)"),
                rec.get("phone_number", ""),
                f"{to_decimal(rec.get('monthly_salary', 10000)):.2f}",
                f"{to_decimal(rec.get('commission_pct', 0)):.2f}",
                f"{to_decimal(rec.get('advance_taken', 0)):.2f}",
                rec.get("status", "Active"),
                rec.get("joining_date") or None,
                rec.get("relieving_date") or None,
                rec.get("termination_reason") or "",
                days_json,
                notes_json,
                now_iso,
            )
            if existing:
                db.execute(
                    conn,
                    """
                    UPDATE attendance_sheets
                    SET employee_name=?, designation=?, phone_number=?, monthly_salary=?,
                        commission_pct=?, advance_taken=?, status=?, joining_date=?,
                        relieving_date=?, termination_reason=?, days_data=?, notes_data=?, updated_at=?
                    WHERE id=?
                    """,
                    (*params, existing["id"]),
                )
            else:
                db.execute(
                    conn,
                    """
                    INSERT INTO attendance_sheets (
                        emp_id, month_sheet, employee_name, designation, phone_number,
                        monthly_salary, commission_pct, advance_taken, status,
                        joining_date, relieving_date, termination_reason, days_data, notes_data, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (emp_id, month_sheet, *params),
                )

        write_audit_log(
            db,
            conn,
            actor_user_id=auth.user_id,
            actor_role=auth.role_code,
            action="save_attendance_sheets",
            entity_type="attendance_sheets",
            entity_id=f"count:{len(records)}",
            ip_address=ip_address,
            after_state={"saved_records": len(records)},
        )
    return {"status": "saved", "saved_records": len(records)}


def get_monthly_target(db: Database, year: int, month: int) -> Dict[str, Any]:
    with db.connection() as conn:
        row = db.fetch_one(
            conn,
            "SELECT target_amount FROM sales_targets WHERE branch_id IS NULL AND employee_id IS NULL AND target_year = ? AND target_month = ?",
            (year, month),
        )
    amt = to_decimal(row["target_amount"]) if row else Decimal("1000000.00")
    return {"year": year, "month": month, "target_amount": float(amt)}


def save_monthly_target(db: Database, auth: AuthContext, year: int, month: int, amount: Any) -> Dict[str, Any]:
    dec = to_decimal(amount)
    now_iso = datetime.now(timezone.utc).isoformat()
    with db.connection() as conn:
        existing = db.fetch_one(
            conn,
            "SELECT id FROM sales_targets WHERE branch_id IS NULL AND employee_id IS NULL AND target_year = ? AND target_month = ?",
            (year, month),
        )
        if existing:
            db.execute(
                conn,
                "UPDATE sales_targets SET target_amount = ?, updated_at = ? WHERE id = ?",
                (f"{dec:.2f}", now_iso, existing["id"]),
            )
        else:
            db.execute(
                conn,
                "INSERT INTO sales_targets (branch_id, employee_id, target_year, target_month, target_amount, created_by) VALUES (NULL, NULL, ?, ?, ?, ?)",
                (year, month, f"{dec:.2f}", auth.user_id),
            )
    return {"year": year, "month": month, "target_amount": float(dec)}


def _normalize_legacy_branch(store_name: str) -> str:
    s = (store_name or "").strip().lower()
    if "khps" in s:
        return "KHPS"
    return "MAIN"


def import_legacy_supabase_bank_data(
    db: Database,
    auth: AuthContext,
    supabase_url: str,
    supabase_anon_key: str,
    ip_address: Optional[str] = None,
) -> Dict[str, Any]:
    """Pull previously entered bank_accounts and receivables from legacy Supabase portal into PostgreSQL."""
    base_url = supabase_url.strip().rstrip("/")
    headers = {
        "apikey": supabase_anon_key.strip(),
        "Authorization": f"Bearer {supabase_anon_key.strip()}",
    }

    # 1. Fetch legacy bank_accounts
    banks_imported = 0
    r_banks = requests.get(f"{base_url}/rest/v1/bank_accounts?select=*", headers=headers, timeout=20)
    if r_banks.status_code == 200:
        legacy_banks = r_banks.json()
    else:
        legacy_banks = []

    # 2. Fetch legacy receivables (paginated in 1000-row chunks)
    legacy_recs: List[Dict[str, Any]] = []
    offset = 0
    step = 1000
    while True:
        r_rec = requests.get(
            f"{base_url}/rest/v1/receivables?select=*&order=id.asc&offset={offset}&limit={step}",
            headers=headers,
            timeout=30,
        )
        r_rec.raise_for_status()
        batch = r_rec.json()
        if not batch:
            break
        legacy_recs.extend(batch)
        if len(batch) < step:
            break
        offset += step

    settlements_imported = 0
    settlements_skipped_dup = 0
    unmatched_bills: List[str] = []
    touched_invoice_ids: set[int] = set()
    now_iso = datetime.now(timezone.utc).isoformat()

    with db.connection() as conn:
        for b in legacy_banks:
            acc_name = str(b.get("account_name", "")).strip()
            if acc_name:
                _ensure_bank_account(db, conn, acc_name, str(b.get("account_type", "bank")))
                banks_imported += 1

        branches = db.fetch_all(conn, "SELECT id, code FROM branches")
        branch_id_by_code = {br["code"]: int(br["id"]) for br in branches}

        for rec in legacy_recs:
            acc = str(rec.get("bank_account", "")).strip()
            bill_no = str(rec.get("bill_no", "")).strip()
            amt = to_decimal(rec.get("amount", 0))
            if not bill_no or not acc or acc.lower() in {"not defined", "pending"} or amt <= Decimal("0.00"):
                continue

            rec_id = rec.get("id") or f"{bill_no}:{acc}:{amt}"
            idem_key = f"legacy_supabase::{rec_id}"
            dup = db.fetch_one(conn, "SELECT id FROM invoice_settlements WHERE idempotency_key = ?", (idem_key,))
            if dup:
                settlements_skipped_dup += 1
                continue

            b_code = _normalize_legacy_branch(str(rec.get("store_name", "")))
            branch_id = branch_id_by_code.get(b_code)
            inv = None
            if branch_id:
                inv = db.fetch_one(
                    conn,
                    "SELECT id, branch_id, bill_date FROM invoice_masters WHERE branch_id = ? AND UPPER(invoice_no) = UPPER(?)",
                    (branch_id, bill_no),
                )
            if not inv:
                inv = db.fetch_one(
                    conn,
                    "SELECT id, branch_id, bill_date FROM invoice_masters WHERE UPPER(invoice_no) = UPPER(?) ORDER BY id ASC LIMIT 1",
                    (bill_no,),
                )
            if not inv:
                unmatched_bills.append(f"{b_code}::{bill_no}")
                continue

            ba_id = _ensure_bank_account(db, conn, acc)
            pmode = "cash" if "cash" in acc.lower() else ("upi" if "upi" in acc.lower() else "bank_transfer")
            settle_date = str(rec.get("bill_date") or inv["bill_date"] or "")[:10] or str(inv["bill_date"])

            db.execute(
                conn,
                """
                INSERT INTO invoice_settlements (
                    invoice_id, branch_id, payment_mode, bank_account_id, amount,
                    settlement_status, payment_reference, idempotency_key,
                    settlement_date, authorized_by, notes, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, 'Imported from legacy portal', ?, ?)
                """,
                (
                    inv["id"],
                    inv["branch_id"],
                    pmode,
                    ba_id,
                    f"{amt:.2f}",
                    acc,
                    idem_key,
                    settle_date,
                    auth.user_id,
                    now_iso,
                    now_iso,
                ),
            )
            settlements_imported += 1
            touched_invoice_ids.add(int(inv["id"]))

        for inv_id in touched_invoice_ids:
            _recalculate_invoice_master(db, conn, inv_id)

        write_audit_log(
            db,
            conn,
            actor_user_id=auth.user_id,
            actor_role=auth.role_code,
            action="import_legacy_bank_data",
            entity_type="invoice_settlements",
            entity_id=f"imported:{settlements_imported}",
            ip_address=ip_address,
            after_state={
                "banks_imported": banks_imported,
                "settlements_imported": settlements_imported,
                "skipped_duplicates": settlements_skipped_dup,
                "unmatched_count": len(unmatched_bills),
            },
        )

    return {
        "banks_imported": banks_imported,
        "legacy_rows_fetched": len(legacy_recs),
        "settlements_imported": settlements_imported,
        "skipped_duplicates": settlements_skipped_dup,
        "unmatched_bills_count": len(unmatched_bills),
        "unmatched_bills_sample": unmatched_bills[:20],
    }


def import_legacy_receivables_rows(
    db: Database,
    auth: AuthContext,
    rows: List[Dict[str, Any]],
    ip_address: Optional[str] = None,
) -> Dict[str, Any]:
    """Import bank settlements from an exported Supabase receivables CSV/JSON list."""
    settlements_imported = 0
    settlements_skipped_dup = 0
    unmatched_bills: List[str] = []
    touched_invoice_ids: set[int] = set()
    now_iso = datetime.now(timezone.utc).isoformat()

    with db.connection() as conn:
        branches = db.fetch_all(conn, "SELECT id, code FROM branches")
        branch_id_by_code = {br["code"]: int(br["id"]) for br in branches}

        for idx, rec in enumerate(rows):
            acc = str(rec.get("bank_account") or rec.get("Bank Account") or rec.get("account") or "").strip()
            bill_no = str(rec.get("bill_no") or rec.get("Bill No") or rec.get("Bil No") or "").strip()
            amt = to_decimal(rec.get("amount") or rec.get("Amount") or 0)
            if not bill_no or not acc or acc.lower() in {"not defined", "pending", "na"} or amt <= Decimal("0.00"):
                continue

            rec_id = rec.get("id") or f"csv:{idx}:{bill_no}:{acc}:{amt}"
            idem_key = f"legacy_supabase::{rec_id}"
            dup = db.fetch_one(conn, "SELECT id FROM invoice_settlements WHERE idempotency_key = ?", (idem_key,))
            if dup:
                settlements_skipped_dup += 1
                continue

            b_code = _normalize_legacy_branch(str(rec.get("store_name") or rec.get("branch") or ""))
            branch_id = branch_id_by_code.get(b_code)
            inv = None
            if branch_id:
                inv = db.fetch_one(
                    conn,
                    "SELECT id, branch_id, bill_date FROM invoice_masters WHERE branch_id = ? AND UPPER(invoice_no) = UPPER(?)",
                    (branch_id, bill_no),
                )
            if not inv:
                inv = db.fetch_one(
                    conn,
                    "SELECT id, branch_id, bill_date FROM invoice_masters WHERE UPPER(invoice_no) = UPPER(?) ORDER BY id ASC LIMIT 1",
                    (bill_no,),
                )
            if not inv:
                unmatched_bills.append(f"{b_code}::{bill_no}")
                continue

            ba_id = _ensure_bank_account(db, conn, acc)
            pmode = "cash" if "cash" in acc.lower() else ("upi" if "upi" in acc.lower() else "bank_transfer")
            settle_date = str(rec.get("bill_date") or inv["bill_date"] or "")[:10] or str(inv["bill_date"])

            db.execute(
                conn,
                """
                INSERT INTO invoice_settlements (
                    invoice_id, branch_id, payment_mode, bank_account_id, amount,
                    settlement_status, payment_reference, idempotency_key,
                    settlement_date, authorized_by, notes, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, 'Imported from legacy receivables CSV', ?, ?)
                """,
                (
                    inv["id"],
                    inv["branch_id"],
                    pmode,
                    ba_id,
                    f"{amt:.2f}",
                    acc,
                    idem_key,
                    settle_date,
                    auth.user_id,
                    now_iso,
                    now_iso,
                ),
            )
            settlements_imported += 1
            touched_invoice_ids.add(int(inv["id"]))

        for inv_id in touched_invoice_ids:
            _recalculate_invoice_master(db, conn, inv_id)

        write_audit_log(
            db,
            conn,
            actor_user_id=auth.user_id,
            actor_role=auth.role_code,
            action="import_legacy_receivables_csv",
            entity_type="invoice_settlements",
            entity_id=f"csv:{settlements_imported}",
            ip_address=ip_address,
            after_state={"settlements_imported": settlements_imported, "skipped": settlements_skipped_dup},
        )

    return {
        "rows_processed": len(rows),
        "settlements_imported": settlements_imported,
        "skipped_duplicates": settlements_skipped_dup,
        "unmatched_bills_count": len(unmatched_bills),
    }


def backfill_sheet_bank_settlements(
    db: Database,
    auth: AuthContext,
    ip_address: Optional[str] = None,
) -> Dict[str, Any]:
    """Backfill invoice_settlements from already-synced sales_lines that have bank_account or account_name."""
    created = 0
    skipped = 0
    touched: set[int] = set()
    now_iso = datetime.now(timezone.utc).isoformat()

    with db.connection() as conn:
        lines = db.fetch_all(
            conn,
            """
            SELECT id, source_line_id, invoice_id, branch_id, bill_date,
                   bank_account, account_name, final_amount, payment_mode
            FROM sales_lines
            WHERE is_source_deleted = FALSE
              AND (COALESCE(bank_account, '') <> '' OR COALESCE(account_name, '') <> '')
            """,
        )
        for ln in lines:
            bank_label = (ln["bank_account"] or ln["account_name"] or "").strip()
            amt = to_decimal(ln["final_amount"])
            if not bank_label or bank_label.lower() in {"not defined", "pending", "na", "n/a", "-", "unassigned"} or amt <= Decimal("0.00"):
                continue

            idem_key = f"gsheet::{ln['source_line_id']}"
            dup = db.fetch_one(conn, "SELECT id FROM invoice_settlements WHERE idempotency_key = ?", (idem_key,))
            if dup:
                skipped += 1
                continue

            ba_id = _ensure_bank_account(db, conn, bank_label)
            pm_lower = (ln["payment_mode"] or "").lower()
            pmode = "cash" if ("cash" in bank_label.lower() or "cash" in pm_lower) else (
                "upi" if ("upi" in bank_label.lower() or "upi" in pm_lower) else (
                    "card" if "card" in pm_lower else "bank_transfer"
                )
            )
            db.execute(
                conn,
                """
                INSERT INTO invoice_settlements (
                    invoice_id, branch_id, payment_mode, bank_account_id, amount,
                    settlement_status, payment_reference, idempotency_key,
                    settlement_date, authorized_by, notes, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, 'Backfilled from Google Sheet', ?, ?)
                """,
                (
                    ln["invoice_id"],
                    ln["branch_id"],
                    pmode,
                    ba_id,
                    f"{amt:.2f}",
                    bank_label,
                    idem_key,
                    str(ln["bill_date"]),
                    auth.user_id,
                    now_iso,
                    now_iso,
                ),
            )
            created += 1
            touched.add(int(ln["invoice_id"]))

        for inv_id in touched:
            _recalculate_invoice_master(db, conn, inv_id)

        write_audit_log(
            db,
            conn,
            actor_user_id=auth.user_id,
            actor_role=auth.role_code,
            action="backfill_sheet_bank_settlements",
            entity_type="invoice_settlements",
            entity_id=f"backfill:{created}",
            ip_address=ip_address,
            after_state={"created": created, "skipped": skipped},
        )
    return {"settlements_created": created, "skipped_existing": skipped, "invoices_updated": len(touched)}
