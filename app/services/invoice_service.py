"""Invoice Management, Split Bank Settlements, Reversals, and Customer Receivables Ageing."""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, status

from app.db import Database
from app.formatting import format_inr, format_ist_date, parse_bill_date, today_ist, to_decimal
from app.security import AuthContext, write_audit_log
from app.sync.sheets_sync import _recalculate_invoice_master


VALID_PAYMENT_MODES = {"cash", "upi", "bank_transfer", "card", "cheque", "other"}


def list_invoices(
    db: Database,
    branch_ids: Optional[List[int]],
    search: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    staff: Optional[str] = None,
    payment_status: Optional[str] = None,
    page: int = 1,
    page_size: int = 25,
) -> Dict[str, Any]:
    clauses = ["1=1"]
    params: List[Any] = []

    if branch_ids is not None:
        placeholders = ",".join("?" for _ in branch_ids)
        clauses.append(f"im.branch_id IN ({placeholders})")
        params.extend(branch_ids)

    if search:
        like = f"%{search.strip()}%"
        clauses.append("(im.invoice_no LIKE ? OR im.customer_name LIKE ? OR im.customer_phone LIKE ?)")
        params.extend([like, like, like])

    if start_date:
        clauses.append("im.bill_date >= ?")
        params.append(start_date)
    if end_date:
        clauses.append("im.bill_date <= ?")
        params.append(end_date)
    if staff:
        clauses.append("im.sales_executive LIKE ?")
        params.append(f"%{staff.strip()}%")
    if payment_status:
        clauses.append("im.payment_status = ?")
        params.append(payment_status)

    where_sql = " AND ".join(clauses)
    offset = (max(1, page) - 1) * page_size

    with db.connection() as conn:
        count_row = db.fetch_one(conn, f"SELECT COUNT(*) AS cnt FROM invoice_masters im WHERE {where_sql}", params)
        total = int(count_row["cnt"]) if count_row else 0

        rows = db.fetch_all(
            conn,
            f"""
            SELECT im.id, im.invoice_uid, im.branch_id, b.name AS branch_name,
                   im.invoice_no, im.bill_date, im.customer_name, im.customer_phone,
                   im.sales_executive, im.final_amount, im.discount_amount,
                   im.paid_amount, im.outstanding_amount, im.payment_status, im.due_date
            FROM invoice_masters im
            JOIN branches b ON b.id = im.branch_id
            WHERE {where_sql}
            ORDER BY im.bill_date DESC, im.id DESC
            LIMIT ? OFFSET ?
            """,
            (*params, page_size, offset),
        )

    items = []
    for r in rows:
        items.append(
            {
                **r,
                "bill_date_ist": format_ist_date(r["bill_date"]),
                "final_amount_formatted": format_inr(r["final_amount"]),
                "discount_amount_formatted": format_inr(r["discount_amount"]),
                "paid_amount_formatted": format_inr(r["paid_amount"]),
                "outstanding_amount_formatted": format_inr(r["outstanding_amount"]),
            }
        )

    return {"total": total, "page": page, "page_size": page_size, "items": items}


def get_invoice_detail(db: Database, invoice_id: int, branch_ids: Optional[List[int]]) -> Dict[str, Any]:
    with db.connection() as conn:
        inv = db.fetch_one(
            conn,
            """
            SELECT im.*, b.name AS branch_name, b.code AS branch_code
            FROM invoice_masters im
            JOIN branches b ON b.id = im.branch_id
            WHERE im.id = ?
            """,
            (invoice_id,),
        )
        if not inv:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")
        if branch_ids is not None and int(inv["branch_id"]) not in branch_ids:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied for this branch's invoice")

        lines = db.fetch_all(
            conn,
            """
            SELECT id, source_line_id, serial_no, product_name, quantity, rate,
                   discount, final_amount, is_return, sales_executive, payment_mode,
                   is_source_deleted, has_pending_diff
            FROM sales_lines
            WHERE invoice_id = ?
            ORDER BY id ASC
            """,
            (invoice_id,),
        )
        settlements = db.fetch_all(
            conn,
            """
            SELECT s.id, s.payment_mode, s.bank_account_id, ba.account_name AS bank_account_name,
                   s.amount, s.settlement_status, s.payment_reference, s.settlement_date,
                   s.reversed_settlement_id, s.reversal_reason, s.notes,
                   u.full_name AS authorized_by_name, s.created_at
            FROM invoice_settlements s
            LEFT JOIN bank_accounts ba ON ba.id = s.bank_account_id
            LEFT JOIN users u ON u.id = s.authorized_by
            WHERE s.invoice_id = ?
            ORDER BY s.settlement_date ASC, s.id ASC
            """,
            (invoice_id,),
        )

    return {
        "invoice": {
            **inv,
            "bill_date_ist": format_ist_date(inv["bill_date"]),
            "final_amount_formatted": format_inr(inv["final_amount"]),
            "paid_amount_formatted": format_inr(inv["paid_amount"]),
            "outstanding_amount_formatted": format_inr(inv["outstanding_amount"]),
        },
        "lines": [
            {
                **ln,
                "rate_formatted": format_inr(ln["rate"]),
                "discount_formatted": format_inr(ln["discount"]),
                "final_amount_formatted": format_inr(ln["final_amount"]),
            }
            for ln in lines
        ],
        "settlements": [
            {
                **s,
                "settlement_date_ist": format_ist_date(s["settlement_date"]),
                "amount_formatted": format_inr(s["amount"]),
            }
            for s in settlements
        ],
    }


def record_settlements(
    db: Database,
    auth: AuthContext,
    invoice_id: int,
    entries: List[Dict[str, Any]],
    allow_overpayment: bool = False,
    ip_address: Optional[str] = None,
) -> Dict[str, Any]:
    """Record one or more split payment settlement lines atomically with overpayment & duplicate protection."""
    if not entries:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one settlement entry is required")

    with db.connection() as conn:
        inv = db.fetch_one(conn, "SELECT * FROM invoice_masters WHERE id = ?", (invoice_id,))
        if not inv:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")
        if not auth.all_branches and int(inv["branch_id"]) not in auth.allowed_branch_ids:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Branch access denied")

        batch_total = Decimal("0.00")
        for entry in entries:
            mode = str(entry.get("payment_mode", "")).strip().lower()
            if mode not in VALID_PAYMENT_MODES:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid payment_mode '{mode}'")
            amt = to_decimal(entry.get("amount"))
            if amt <= Decimal("0.00"):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Settlement amount must be positive")
            batch_total += amt

            idem_key = entry.get("idempotency_key")
            if idem_key:
                dup = db.fetch_one(conn, "SELECT id FROM invoice_settlements WHERE idempotency_key = ?", (idem_key,))
                if dup:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=f"Duplicate settlement rejected for idempotency_key '{idem_key}'",
                    )

        current_outstanding = to_decimal(inv["outstanding_amount"])
        if not allow_overpayment and batch_total > current_outstanding:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Overpayment detected: attempted {format_inr(batch_total)} "
                    f"exceeds outstanding balance {format_inr(current_outstanding)}"
                ),
            )

        created_ids: List[int] = []
        for entry in entries:
            amt = to_decimal(entry["amount"])
            settle_date = entry.get("settlement_date") or today_ist().isoformat()
            sid = db.insert_returning_id(
                conn,
                """
                INSERT INTO invoice_settlements (
                    invoice_id, branch_id, payment_mode, bank_account_id, amount,
                    settlement_status, payment_reference, idempotency_key,
                    settlement_date, authorized_by, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    invoice_id,
                    inv["branch_id"],
                    str(entry["payment_mode"]).strip().lower(),
                    entry.get("bank_account_id"),
                    f"{amt:.2f}",
                    entry.get("settlement_status", "completed"),
                    entry.get("payment_reference"),
                    entry.get("idempotency_key"),
                    settle_date,
                    auth.user_id,
                    entry.get("notes"),
                ),
            )
            created_ids.append(sid)

        _recalculate_invoice_master(db, conn, invoice_id)
        updated_inv = db.fetch_one(conn, "SELECT paid_amount, outstanding_amount, payment_status FROM invoice_masters WHERE id = ?", (invoice_id,))
        write_audit_log(
            db,
            conn,
            actor_user_id=auth.user_id,
            actor_role=auth.role_code,
            action="record_settlements",
            entity_type="invoice",
            entity_id=str(invoice_id),
            branch_id=int(inv["branch_id"]),
            ip_address=ip_address,
            before_state={"paid_amount": inv["paid_amount"], "outstanding_amount": inv["outstanding_amount"]},
            after_state={"settlement_ids": created_ids, **updated_inv},
        )

    return {"invoice_id": invoice_id, "settlement_ids": created_ids, "updated_invoice": updated_inv}


def reverse_settlement(
    db: Database,
    auth: AuthContext,
    settlement_id: int,
    reason: str,
    ip_address: Optional[str] = None,
) -> Dict[str, Any]:
    """Authorized financial reversal workflow — never deletes or silently overwrites settlement history."""
    if not reason or len(reason.strip()) < 5:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A clear reversal reason (min 5 chars) is required")

    with db.connection() as conn:
        orig = db.fetch_one(conn, "SELECT * FROM invoice_settlements WHERE id = ?", (settlement_id,))
        if not orig:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Settlement not found")
        if orig["settlement_status"] == "reversed":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Settlement is already reversed")

        now_iso = datetime.now(timezone.utc).isoformat()
        db.execute(
            conn,
            "UPDATE invoice_settlements SET settlement_status = 'reversed', reversal_reason = ?, updated_at = ? WHERE id = ?",
            (reason.strip(), now_iso, settlement_id),
        )
        rev_id = db.insert_returning_id(
            conn,
            """
            INSERT INTO invoice_settlements (
                invoice_id, branch_id, payment_mode, bank_account_id, amount,
                settlement_status, payment_reference, settlement_date,
                authorized_by, reversed_settlement_id, reversal_reason
            ) VALUES (?, ?, ?, ?, ?, 'reversed', ?, ?, ?, ?, ?)
            """,
            (
                orig["invoice_id"],
                orig["branch_id"],
                orig["payment_mode"],
                orig["bank_account_id"],
                f"{-to_decimal(orig['amount']):.2f}",
                f"REV-{settlement_id}",
                today_ist().isoformat(),
                auth.user_id,
                settlement_id,
                reason.strip(),
            ),
        )
        _recalculate_invoice_master(db, conn, int(orig["invoice_id"]))
        write_audit_log(
            db,
            conn,
            actor_user_id=auth.user_id,
            actor_role=auth.role_code,
            action="reverse_settlement",
            entity_type="invoice_settlement",
            entity_id=str(settlement_id),
            branch_id=int(orig["branch_id"]),
            ip_address=ip_address,
            before_state=orig,
            after_state={"reversal_entry_id": rev_id, "reason": reason.strip()},
        )
    return {"reversed_settlement_id": settlement_id, "reversal_entry_id": rev_id}


def get_receivables_report(
    db: Database,
    branch_ids: Optional[List[int]],
    as_of_date: Optional[date] = None,
) -> Dict[str, Any]:
    ref = as_of_date or today_ist()
    clauses = ["CAST(im.outstanding_amount AS REAL) > 0.00", "im.payment_status IN ('unpaid', 'partial')"]
    params: List[Any] = []
    if branch_ids is not None:
        placeholders = ",".join("?" for _ in branch_ids)
        clauses.append(f"im.branch_id IN ({placeholders})")
        params.extend(branch_ids)

    where_sql = " AND ".join(clauses)
    with db.connection() as conn:
        rows = db.fetch_all(
            conn,
            f"""
            SELECT im.id, im.invoice_uid, im.invoice_no, im.branch_id, b.name AS branch_name,
                   im.bill_date, im.due_date, im.customer_name, im.customer_phone,
                   im.final_amount, im.paid_amount, im.outstanding_amount, im.payment_status
            FROM invoice_masters im
            JOIN branches b ON b.id = im.branch_id
            WHERE {where_sql}
            ORDER BY im.bill_date ASC
            """,
            params,
        )

    buckets = {"0_30": Decimal("0.00"), "31_60": Decimal("0.00"), "61_90": Decimal("0.00"), "90_plus": Decimal("0.00")}
    total_outstanding = Decimal("0.00")
    total_overdue = Decimal("0.00")
    by_branch: Dict[str, Decimal] = {}
    items: List[Dict[str, Any]] = []

    for r in rows:
        bill_dt = parse_bill_date(r["bill_date"]) or ref
        due_dt = parse_bill_date(r["due_date"]) or bill_dt
        age_days = max(0, (ref - bill_dt).days)
        outstanding = to_decimal(r["outstanding_amount"])
        total_outstanding += outstanding
        if ref > due_dt:
            total_overdue += outstanding

        if age_days <= 30:
            bucket = "0_30"
        elif age_days <= 60:
            bucket = "31_60"
        elif age_days <= 90:
            bucket = "61_90"
        else:
            bucket = "90_plus"
        buckets[bucket] += outstanding
        by_branch[r["branch_name"]] = by_branch.get(r["branch_name"], Decimal("0.00")) + outstanding

        items.append(
            {
                **r,
                "age_days": age_days,
                "ageing_bucket": bucket,
                "bill_date_ist": format_ist_date(r["bill_date"]),
                "final_amount_formatted": format_inr(r["final_amount"]),
                "paid_amount_formatted": format_inr(r["paid_amount"]),
                "outstanding_amount_formatted": format_inr(outstanding),
            }
        )

    return {
        "as_of_date": ref.isoformat(),
        "total_outstanding": f"{total_outstanding:.2f}",
        "total_outstanding_formatted": format_inr(total_outstanding),
        "total_overdue": f"{total_overdue:.2f}",
        "total_overdue_formatted": format_inr(total_overdue),
        "ageing_buckets": {k: {"amount": f"{v:.2f}", "formatted": format_inr(v)} for k, v in buckets.items()},
        "by_branch": [
            {"branch": k, "outstanding": f"{v:.2f}", "outstanding_formatted": format_inr(v)}
            for k, v in sorted(by_branch.items())
        ],
        "items": items,
    }
