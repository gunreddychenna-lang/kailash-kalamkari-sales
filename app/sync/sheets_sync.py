"""Incremental Google Sheets Synchronization Engine for Kailash Kalamkari.

- Authenticates to Google Sheets API v4 via Service Account RS256 JWT (cryptography + requests).
- Supports both configured sources:
    1. Main Branch (Discount column: 'Discount')
    2. KHPS (legacy branch 'KHPS-FR' normalized to 'KHPS', Discount column: 'Discoun')
- Guarantees:
    * Distributed/DB lock prevents overlapping sync jobs.
    * Deterministic `source_line_id` prevents duplicate invoice lines on re-runs.
    * Composite invoice identity `(branch_id, invoice_no)` prevents cross-branch collisions.
    * Exact Decimal financial arithmetic (zero floats).
    * Never silently overwrites or deletes historical financial records:
      - Edited historical records -> logged as `historical_edit` in `sync_exceptions`.
      - Discount discrepancies (computed vs. sheet or historical change) -> logged as `discount_discrepancy`.
      - Deleted source rows -> flagged `is_source_deleted=1` & logged as `source_deleted` in `sync_exceptions`.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Callable, Dict, List, Optional

import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

from app.config import Settings, SheetSourceConfig
from app.db import Database
from app.formatting import normalize_phone, parse_bill_date, to_decimal
from app.security import write_audit_log


GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token"
SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly"


class SyncLockError(RuntimeError):
    """Raised when another synchronization job already holds the lock."""


@dataclass
class SyncResult:
    run_id: int
    source_key: str
    status: str
    rows_scanned: int
    rows_inserted: int
    rows_unchanged: int
    edits_detected: int
    deletes_detected: int
    discount_diffs: int
    error_message: Optional[str] = None


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _load_service_account(settings: Settings) -> Dict[str, Any]:
    if settings.google_service_account_json.strip():
        return json.loads(settings.google_service_account_json)
    if settings.google_service_account_file and os.path.exists(settings.google_service_account_file):
        with open(settings.google_service_account_file, "r", encoding="utf-8") as fh:
            return json.load(fh)
    raise RuntimeError(
        "Google Service Account credentials not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_FILE."
    )


def get_google_access_token(settings: Settings) -> str:
    sa = _load_service_account(settings)
    now = int(time.time())
    header = _b64url(json.dumps({"alg": "RS256", "typ": "JWT"}).encode("utf-8"))
    claim = _b64url(
        json.dumps(
            {
                "iss": sa["client_email"],
                "scope": SHEETS_SCOPE,
                "aud": sa.get("token_uri", GOOGLE_TOKEN_URI),
                "iat": now,
                "exp": now + 3600,
            }
        ).encode("utf-8")
    )
    signing_input = f"{header}.{claim}".encode("ascii")
    private_key = serialization.load_pem_private_key(sa["private_key"].encode("utf-8"), password=None)
    signature = private_key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
    assertion = f"{header}.{claim}.{_b64url(signature)}"

    resp = requests.post(
        sa.get("token_uri", GOOGLE_TOKEN_URI),
        data={
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": assertion,
        },
        timeout=20,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def fetch_sheet_values_with_retry(
    settings: Settings,
    source: SheetSourceConfig,
    max_attempts: int = 3,
) -> List[List[str]]:
    """Fetch raw sheet rows from Google Sheets API v4 with exponential backoff on transient failures."""
    last_err: Optional[Exception] = None
    for attempt in range(1, max_attempts + 1):
        try:
            token = get_google_access_token(settings)
            range_ref = f"'{source.sheet_name}'!A:Z"
            url = f"https://sheets.googleapis.com/v4/spreadsheets/{source.spreadsheet_id}/values/{requests.utils.quote(range_ref)}"
            resp = requests.get(
                url,
                headers={"Authorization": f"Bearer {token}"},
                params={"valueRenderOption": "UNFORMATTED_VALUE", "dateTimeRenderOption": "FORMATTED_STRING"},
                timeout=30,
            )
            if resp.status_code in {429, 500, 502, 503, 504}:
                raise requests.HTTPError(f"Transient Google Sheets HTTP {resp.status_code}", response=resp)
            resp.raise_for_status()
            return resp.json().get("values", [])
        except Exception as exc:
            last_err = exc
            if attempt < max_attempts:
                time.sleep(2 ** (attempt - 1))
    raise RuntimeError(f"Failed to fetch sheet '{source.sheet_name}' after {max_attempts} attempts: {last_err}")


def _header_map(headers: List[Any]) -> Dict[str, int]:
    return {str(h).strip().lower(): idx for idx, h in enumerate(headers) if str(h).strip()}


def _cell(row: List[Any], hmap: Dict[str, int], aliases: List[str], default: str = "") -> str:
    for alias in aliases:
        idx = hmap.get(alias.lower())
        if idx is not None and idx < len(row) and row[idx] is not None:
            val = str(row[idx]).strip()
            if val != "":
                return val
    return default


def normalize_sheet_row(
    source: SheetSourceConfig,
    hmap: Dict[str, int],
    row: List[Any],
    row_number: int,
) -> Optional[Dict[str, Any]]:
    invoice_no = _cell(row, hmap, ["invoice no", "invoice_no", "bill no", "bil no", "bill number", "invoice", "invoice/bill number"])
    bill_date_raw = _cell(row, hmap, ["bill date", "bill_date", "date", "invoice date"])
    product_name = _cell(row, hmap, ["product", "product name", "item", "item name", "product/item name"])

    if not invoice_no and not product_name:
        return None  # Blank trailing row

    bill_date = parse_bill_date(bill_date_raw)
    if not invoice_no or not bill_date or not product_name:
        return {
            "validation_error": f"Row {row_number}: missing required invoice_no/bill_date/product_name",
            "source_row_number": row_number,
            "invoice_no": invoice_no or f"ROW-{row_number}",
        }

    serial_no = _cell(row, hmap, ["s.no", "sno", "sl no", "serial no", "serial number", "serial_no"], default=str(row_number))
    raw_branch = _cell(row, hmap, ["branch", "branch name", "store", "store name", "branch_name"], default=source.legacy_branch_identifier)
    qty = to_decimal(_cell(row, hmap, ["qty", "quantity", "units"], default="1"), default=Decimal("1.00"))
    rate = to_decimal(_cell(row, hmap, ["rate", "unit price", "price", "mrp"], default="0"))
    discount = to_decimal(
        _cell(row, hmap, [source.discount_column, "discount", "discoun", "disc"], default="0")
    )
    final_amount = to_decimal(
        _cell(row, hmap, ["final amount", "final_amount", "billamount", "bill amount", "net amount", "amount", "total"], default="0")
    )
    sales_executive = _cell(row, hmap, ["sales executive", "sales_executive", "sm name", "sm_name", "agent name", "agent", "staff", "executive"])
    payment_mode = _cell(row, hmap, ["payment mode", "payment_mode", "paymode", "pay mode", "pay_mode", "payment", "mode"], default="Cash")
    sale_type = _cell(row, hmap, ["sale type", "sale_type", "type"], default="Retail")
    account_name = _cell(row, hmap, ["account name", "account_name", "account", "credited account"])
    bank_account = _cell(row, hmap, ["bank account", "bank_account", "bank", "credited bank", "credited bank account", "bank name"])
    customer_name = _cell(row, hmap, ["customer name", "customer_name", "customer"])
    customer_phone = _cell(row, hmap, ["customer phone", "customer_phone", "customer phone number", "phone number", "phone", "mobile"])
    sales_manager = _cell(row, hmap, ["sales manager", "sales_manager", "manager"])

    is_return = final_amount < Decimal("0.00") or qty < Decimal("0.00") or sale_type.lower() in {"return", "sales return", "refund"}

    # Deterministic identity anchored to spreadsheet + tab + invoice + serial + row slot
    identity_payload = f"{source.spreadsheet_id}|{source.sheet_name}|{source.branch_code}|{invoice_no.upper()}|{serial_no}|{product_name.upper()}"
    source_line_id = hashlib.sha256(identity_payload.encode("utf-8")).hexdigest()[:40]

    content_fields = {
        "serial_no": serial_no,
        "invoice_no": invoice_no,
        "bill_date": bill_date.isoformat(),
        "product_name": product_name,
        "quantity": f"{qty:.2f}",
        "rate": f"{rate:.2f}",
        "discount": f"{discount:.2f}",
        "final_amount": f"{final_amount:.2f}",
        "sales_executive": sales_executive,
        "payment_mode": payment_mode,
        "sale_type": sale_type,
        "account_name": account_name,
        "bank_account": bank_account,
        "customer_name": customer_name,
        "customer_phone": customer_phone,
        "sales_manager": sales_manager,
    }
    row_content_hash = hashlib.sha256(json.dumps(content_fields, sort_keys=True).encode("utf-8")).hexdigest()

    # Detect arithmetic discount discrepancy: (qty * rate - discount) vs final_amount
    expected_final = (qty * rate) - discount
    discount_variance = (final_amount - expected_final).quantize(Decimal("0.01"))
    has_formula_discount_diff = rate > Decimal("0.00") and not is_return and abs(discount_variance) > Decimal("0.05")

    return {
        "source_line_id": source_line_id,
        "source_spreadsheet_id": source.spreadsheet_id,
        "source_sheet_name": source.sheet_name,
        "source_row_number": row_number,
        "row_content_hash": row_content_hash,
        "raw_branch_label": raw_branch,
        "is_return": is_return,
        "has_formula_discount_diff": has_formula_discount_diff,
        "discount_variance": discount_variance,
        **content_fields,
    }


def _ensure_sync_bank_account(db: Database, conn: Any, account_name: str) -> int:
    clean = account_name.strip()
    existing = db.fetch_one(conn, "SELECT id FROM bank_accounts WHERE LOWER(account_name) = LOWER(?)", (clean,))
    if existing:
        return int(existing["id"])
    acc_type = "cash" if "cash" in clean.lower() else ("upi" if "upi" in clean.lower() else "bank")
    return db.insert_returning_id(
        conn,
        "INSERT INTO bank_accounts (account_name, bank_name, account_type, is_active) VALUES (?, ?, ?, TRUE)",
        (clean, "Google Sheet Bank", acc_type),
    )


def _sync_sheet_bank_settlement(
    db: Database,
    conn: Any,
    invoice_id: int,
    branch_id: int,
    bill_date: str,
    bank_label: str,
    amount: Decimal,
    payment_mode: str,
    source_line_id: str,
    actor_user_id: Optional[int],
) -> None:
    clean_bank = (bank_label or "").strip()
    if not clean_bank or clean_bank.lower() in {"not defined", "pending", "na", "n/a", "-", "unassigned"}:
        return
    if amount <= Decimal("0.00"):
        return

    auth_uid = actor_user_id
    if auth_uid is None:
        owner_row = db.fetch_one(conn, "SELECT id FROM users WHERE role_code = 'owner' ORDER BY id ASC LIMIT 1")
        if not owner_row:
            owner_row = db.fetch_one(conn, "SELECT id FROM users ORDER BY id ASC LIMIT 1")
        if not owner_row:
            return
        auth_uid = int(owner_row["id"])

    idem_key = f"gsheet::{source_line_id}"
    existing = db.fetch_one(conn, "SELECT id FROM invoice_settlements WHERE idempotency_key = ?", (idem_key,))
    if existing:
        return

    ba_id = _ensure_sync_bank_account(db, conn, clean_bank)
    pm_lower = (payment_mode or "").lower()
    if "cash" in clean_bank.lower() or "cash" in pm_lower:
        pmode = "cash"
    elif "upi" in clean_bank.lower() or "upi" in pm_lower:
        pmode = "upi"
    elif "card" in pm_lower:
        pmode = "card"
    else:
        pmode = "bank_transfer"

    db.execute(
        conn,
        """
        INSERT INTO invoice_settlements (
            invoice_id, branch_id, payment_mode, bank_account_id, amount,
            settlement_status, payment_reference, idempotency_key,
            settlement_date, authorized_by, notes
        ) VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, 'Auto-synced from Google Sheet')
        """,
        (
            invoice_id,
            branch_id,
            pmode,
            ba_id,
            f"{amount:.2f}",
            clean_bank,
            idem_key,
            bill_date,
            auth_uid,
        ),
    )


def _recalculate_invoice_master(db: Database, conn: Any, invoice_id: int) -> None:
    """Recompute invoice_masters totals from its non-deleted sales_lines and completed settlements."""
    lines = db.fetch_all(
        conn,
        """
        SELECT quantity, rate, discount, final_amount, is_return
        FROM sales_lines
        WHERE invoice_id = ? AND is_source_deleted = FALSE
        """,
        (invoice_id,),
    )
    gross = Decimal("0.00")
    discount = Decimal("0.00")
    final_amt = Decimal("0.00")
    refund_amt = Decimal("0.00")

    for ln in lines:
        q = to_decimal(ln["quantity"])
        r = to_decimal(ln["rate"])
        d = to_decimal(ln["discount"])
        f = to_decimal(ln["final_amount"])
        gross += (q * r).quantize(Decimal("0.01"))
        discount += d
        final_amt += f
        if f < Decimal("0.00") or ln["is_return"]:
            refund_amt += abs(f)

    settlements = db.fetch_all(
        conn,
        """
        SELECT amount FROM invoice_settlements
        WHERE invoice_id = ? AND settlement_status = 'completed'
        """,
        (invoice_id,),
    )
    paid = sum((to_decimal(s["amount"]) for s in settlements), Decimal("0.00"))
    outstanding = (final_amt - paid).quantize(Decimal("0.01"))

    if final_amt < Decimal("0.00"):
        pay_status = "return_credit"
    elif outstanding == Decimal("0.00") and final_amt > Decimal("0.00"):
        pay_status = "paid"
    elif outstanding < Decimal("0.00"):
        pay_status = "overpaid"
    elif paid > Decimal("0.00"):
        pay_status = "partial"
    else:
        pay_status = "unpaid"

    now_iso = datetime.now(timezone.utc).isoformat()
    db.execute(
        conn,
        """
        UPDATE invoice_masters
        SET gross_amount = ?, discount_amount = ?, final_amount = ?,
            paid_amount = ?, refund_amount = ?, outstanding_amount = ?,
            payment_status = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            f"{gross:.2f}",
            f"{discount:.2f}",
            f"{final_amt:.2f}",
            f"{paid:.2f}",
            f"{refund_amt:.2f}",
            f"{outstanding:.2f}",
            pay_status,
            now_iso,
            invoice_id,
        ),
    )


def _acquire_sync_lock(db: Database, lock_name: str, owner: str, ttl_seconds: int) -> None:
    now = datetime.now(timezone.utc)
    expires = now + timedelta(seconds=ttl_seconds)
    with db.connection() as conn:
        existing = db.fetch_one(conn, "SELECT lock_name, expires_at FROM sync_locks WHERE lock_name = ?", (lock_name,))
        if existing:
            exp_dt = datetime.fromisoformat(str(existing["expires_at"]).replace("Z", "+00:00"))
            if exp_dt.tzinfo is None:
                exp_dt = exp_dt.replace(tzinfo=timezone.utc)
            if exp_dt > now:
                raise SyncLockError(f"Sync lock '{lock_name}' is currently held until {existing['expires_at']}")
            db.execute(conn, "DELETE FROM sync_locks WHERE lock_name = ?", (lock_name,))
        db.execute(
            conn,
            "INSERT INTO sync_locks (lock_name, locked_by, locked_at, expires_at) VALUES (?, ?, ?, ?)",
            (lock_name, owner, now.isoformat(), expires.isoformat()),
        )


def _release_sync_lock(db: Database, lock_name: str) -> None:
    with db.connection() as conn:
        db.execute(conn, "DELETE FROM sync_locks WHERE lock_name = ?", (lock_name,))


def run_sheets_sync(
    db: Database,
    settings: Settings,
    trigger_type: str = "manual",
    triggered_by: Optional[int] = None,
    source_key: str = "all",
    fetcher: Optional[Callable[[SheetSourceConfig], List[List[Any]]]] = None,
) -> SyncResult:
    """Execute incremental sync for configured Google Sheets without overwriting history."""
    lock_name = f"sheets_sync:{source_key}"
    _acquire_sync_lock(db, lock_name, owner=f"{trigger_type}:{triggered_by or 'system'}", ttl_seconds=settings.sync_lock_ttl_seconds)

    started_at = datetime.now(timezone.utc).isoformat()
    with db.connection() as conn:
        run_id = db.insert_returning_id(
            conn,
            """
            INSERT INTO sync_runs (source_key, trigger_type, triggered_by, status, started_at)
            VALUES (?, ?, ?, 'running', ?)
            """,
            (source_key, trigger_type, triggered_by, started_at),
        )

    rows_scanned = 0
    rows_inserted = 0
    rows_unchanged = 0
    edits_detected = 0
    deletes_detected = 0
    discount_diffs = 0

    try:
        sources = [s for s in settings.sheet_sources if source_key == "all" or s.key == source_key]
        if not sources:
            raise ValueError(f"Unknown sheet source_key: {source_key}")

        for source in sources:
            raw_values = fetcher(source) if fetcher else fetch_sheet_values_with_retry(settings, source)
            if not raw_values:
                continue
            hmap = _header_map(raw_values[0])
            seen_source_ids: set[str] = set()
            touched_invoice_ids: set[int] = set()

            with db.connection() as conn:
                branch = db.fetch_one(conn, "SELECT id, code FROM branches WHERE code = ?", (source.branch_code,))
                if not branch:
                    raise RuntimeError(f"Branch '{source.branch_code}' not found in database")
                branch_id = int(branch["id"])

                existing_rows = db.fetch_all(
                    conn,
                    """
                    SELECT id, source_line_id, row_content_hash, invoice_id, invoice_no,
                           discount, final_amount, is_source_deleted
                    FROM sales_lines
                    WHERE source_spreadsheet_id = ? AND source_sheet_name = ?
                    """,
                    (source.spreadsheet_id, source.sheet_name),
                )
                existing_by_sid = {r["source_line_id"]: r for r in existing_rows}

                for offset, raw_row in enumerate(raw_values[1:], start=2):
                    normalized = normalize_sheet_row(source, hmap, raw_row, offset)
                    if normalized is None:
                        continue
                    rows_scanned += 1

                    if "validation_error" in normalized:
                        db.execute(
                            conn,
                            """
                            INSERT INTO sync_exceptions (
                                sync_run_id, source_line_id, branch_id, invoice_no,
                                exception_type, incoming_snapshot, resolution_status
                            ) VALUES (?, ?, ?, ?, 'validation_error', ?, 'open')
                            """,
                            (
                                run_id,
                                f"INVALID-{source.branch_code}-{offset}",
                                branch_id,
                                normalized["invoice_no"],
                                json.dumps(normalized),
                            ),
                        )
                        continue

                    sid = normalized["source_line_id"]
                    seen_source_ids.add(sid)

                    if sid in existing_by_sid:
                        prev = existing_by_sid[sid]
                        if prev["row_content_hash"] == normalized["row_content_hash"]:
                            rows_unchanged += 1
                            continue

                        # Historical edit detected — DO NOT silently overwrite financial history!
                        prev_disc = to_decimal(prev["discount"])
                        new_disc = to_decimal(normalized["discount"])
                        prev_final = to_decimal(prev["final_amount"])
                        new_final = to_decimal(normalized["final_amount"])
                        is_disc_diff = prev_disc != new_disc
                        exc_type = "discount_discrepancy" if is_disc_diff else "historical_edit"
                        variance = (new_final - prev_final) if not is_disc_diff else (new_disc - prev_disc)

                        if is_disc_diff:
                            discount_diffs += 1
                        edits_detected += 1

                        db.execute(
                            conn,
                            "UPDATE sales_lines SET has_pending_diff = TRUE, updated_at = ? WHERE id = ?",
                            (datetime.now(timezone.utc).isoformat(), prev["id"]),
                        )
                        db.execute(
                            conn,
                            """
                            INSERT INTO sync_exceptions (
                                sync_run_id, source_line_id, branch_id, invoice_no,
                                exception_type, existing_snapshot, incoming_snapshot,
                                variance_amount, resolution_status
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')
                            """,
                            (
                                run_id,
                                sid,
                                branch_id,
                                normalized["invoice_no"],
                                exc_type,
                                json.dumps(prev, default=str),
                                json.dumps(normalized, default=str),
                                f"{variance:.2f}",
                            ),
                        )
                        continue

                    # New record: upsert customer, upsert composite invoice_master, insert sales_line
                    customer_id: Optional[int] = None
                    norm_phone = normalize_phone(normalized["customer_phone"])
                    if norm_phone:
                        cust = db.fetch_one(conn, "SELECT id FROM customers WHERE normalized_phone = ?", (norm_phone,))
                        if cust:
                            customer_id = int(cust["id"])
                        elif normalized["customer_name"]:
                            customer_id = db.insert_returning_id(
                                conn,
                                """
                                INSERT INTO customers (full_name, phone, normalized_phone, primary_branch_id)
                                VALUES (?, ?, ?, ?)
                                """,
                                (normalized["customer_name"], normalized["customer_phone"], norm_phone, branch_id),
                            )

                    invoice_uid = f"{source.branch_code}::{normalized['invoice_no']}"
                    inv = db.fetch_one(
                        conn,
                        "SELECT id FROM invoice_masters WHERE branch_id = ? AND invoice_no = ?",
                        (branch_id, normalized["invoice_no"]),
                    )
                    if inv:
                        invoice_id = int(inv["id"])
                    else:
                        invoice_id = db.insert_returning_id(
                            conn,
                            """
                            INSERT INTO invoice_masters (
                                invoice_uid, branch_id, invoice_no, bill_date,
                                customer_id, customer_name, customer_phone,
                                sales_executive, sales_manager, sale_type
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                invoice_uid,
                                branch_id,
                                normalized["invoice_no"],
                                normalized["bill_date"],
                                customer_id,
                                normalized["customer_name"],
                                normalized["customer_phone"],
                                normalized["sales_executive"],
                                normalized["sales_manager"],
                                normalized["sale_type"],
                            ),
                        )

                    db.execute(
                        conn,
                        """
                        INSERT INTO sales_lines (
                            source_line_id, source_spreadsheet_id, source_sheet_name, source_row_number,
                            row_content_hash, invoice_id, serial_no, branch_id, raw_branch_label,
                            invoice_no, bill_date, product_name, quantity, rate, discount, final_amount,
                            is_return, sales_executive, payment_mode, sale_type, account_name,
                            bank_account, customer_name, customer_phone, sales_manager
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            sid,
                            source.spreadsheet_id,
                            source.sheet_name,
                            normalized["source_row_number"],
                            normalized["row_content_hash"],
                            invoice_id,
                            normalized["serial_no"],
                            branch_id,
                            normalized["raw_branch_label"],
                            normalized["invoice_no"],
                            normalized["bill_date"],
                            normalized["product_name"],
                            normalized["quantity"],
                            normalized["rate"],
                            normalized["discount"],
                            normalized["final_amount"],
                            bool(normalized["is_return"]),
                            normalized["sales_executive"],
                            normalized["payment_mode"],
                            normalized["sale_type"],
                            normalized["account_name"],
                            normalized["bank_account"],
                            normalized["customer_name"],
                            normalized["customer_phone"],
                            normalized["sales_manager"],
                        ),
                    )
                    bank_label = normalized["bank_account"] or normalized["account_name"]
                    if bank_label:
                        _sync_sheet_bank_settlement(
                            db,
                            conn,
                            invoice_id=invoice_id,
                            branch_id=branch_id,
                            bill_date=normalized["bill_date"],
                            bank_label=bank_label,
                            amount=to_decimal(normalized["final_amount"]),
                            payment_mode=normalized["payment_mode"],
                            source_line_id=sid,
                            actor_user_id=triggered_by,
                        )
                    rows_inserted += 1
                    touched_invoice_ids.add(invoice_id)

                    if normalized["has_formula_discount_diff"]:
                        discount_diffs += 1
                        db.execute(
                            conn,
                            """
                            INSERT INTO sync_exceptions (
                                sync_run_id, source_line_id, branch_id, invoice_no,
                                exception_type, incoming_snapshot, variance_amount, resolution_status
                            ) VALUES (?, ?, ?, ?, 'discount_discrepancy', ?, ?, 'open')
                            """,
                            (
                                run_id,
                                sid,
                                branch_id,
                                normalized["invoice_no"],
                                json.dumps(normalized, default=str),
                                f"{normalized['discount_variance']:.2f}",
                            ),
                        )

                # Detect source deletions without deleting historical DB rows
                for prev_sid, prev_row in existing_by_sid.items():
                    if prev_sid not in seen_source_ids and not prev_row["is_source_deleted"]:
                        deletes_detected += 1
                        db.execute(
                            conn,
                            "UPDATE sales_lines SET is_source_deleted = TRUE, updated_at = ? WHERE id = ?",
                            (datetime.now(timezone.utc).isoformat(), prev_row["id"]),
                        )
                        db.execute(
                            conn,
                            """
                            INSERT INTO sync_exceptions (
                                sync_run_id, source_line_id, branch_id, invoice_no,
                                exception_type, existing_snapshot, variance_amount, resolution_status
                            ) VALUES (?, ?, ?, ?, 'source_deleted', ?, ?, 'open')
                            """,
                            (
                                run_id,
                                prev_sid,
                                branch_id,
                                prev_row["invoice_no"],
                                json.dumps(prev_row, default=str),
                                f"{-to_decimal(prev_row['final_amount']):.2f}",
                            ),
                        )

                for inv_id in touched_invoice_ids:
                    _recalculate_invoice_master(db, conn, inv_id)

        finished_at = datetime.now(timezone.utc).isoformat()
        with db.connection() as conn:
            db.execute(
                conn,
                """
                UPDATE sync_runs
                SET status = 'succeeded', rows_scanned = ?, rows_inserted = ?,
                    rows_unchanged = ?, edits_detected = ?, deletes_detected = ?,
                    discount_diffs = ?, finished_at = ?
                WHERE id = ?
                """,
                (
                    rows_scanned,
                    rows_inserted,
                    rows_unchanged,
                    edits_detected,
                    deletes_detected,
                    discount_diffs,
                    finished_at,
                    run_id,
                ),
            )
            write_audit_log(
                db,
                conn,
                actor_user_id=triggered_by,
                actor_role="system" if triggered_by is None else None,
                action="sheets_sync_completed",
                entity_type="sync_run",
                entity_id=str(run_id),
                after_state={
                    "rows_scanned": rows_scanned,
                    "rows_inserted": rows_inserted,
                    "edits_detected": edits_detected,
                    "deletes_detected": deletes_detected,
                    "discount_diffs": discount_diffs,
                },
            )

        return SyncResult(
            run_id=run_id,
            source_key=source_key,
            status="succeeded",
            rows_scanned=rows_scanned,
            rows_inserted=rows_inserted,
            rows_unchanged=rows_unchanged,
            edits_detected=edits_detected,
            deletes_detected=deletes_detected,
            discount_diffs=discount_diffs,
        )
    except Exception as exc:
        finished_at = datetime.now(timezone.utc).isoformat()
        with db.connection() as conn:
            db.execute(
                conn,
                """
                UPDATE sync_runs
                SET status = 'failed', rows_scanned = ?, rows_inserted = ?,
                    rows_unchanged = ?, edits_detected = ?, deletes_detected = ?,
                    discount_diffs = ?, error_message = ?, finished_at = ?
                WHERE id = ?
                """,
                (
                    rows_scanned,
                    rows_inserted,
                    rows_unchanged,
                    edits_detected,
                    deletes_detected,
                    discount_diffs,
                    str(exc)[:1000],
                    finished_at,
                    run_id,
                ),
            )
        raise
    finally:
        _release_sync_lock(db, lock_name)


def fetch_crm_sheet_rows(settings: Settings) -> List[Dict[str, Any]]:
    """Fetch live rows directly from the dedicated CRM Google Sheet (auto-detects first tab if CRM_SHEET_NAME is blank)."""
    if not settings.crm_spreadsheet_id:
        return []
    token = get_google_access_token(settings)
    headers = {"Authorization": f"Bearer {token}"}
    sheet_title = settings.crm_sheet_name
    if not sheet_title:
        meta_url = f"https://sheets.googleapis.com/v4/spreadsheets/{settings.crm_spreadsheet_id}"
        meta_resp = requests.get(
            meta_url,
            headers=headers,
            params={"fields": "sheets.properties.title"},
            timeout=20,
        )
        meta_resp.raise_for_status()
        sheets = meta_resp.json().get("sheets", [])
        if not sheets:
            return []
        sheet_title = sheets[0]["properties"]["title"]

    range_ref = f"'{sheet_title}'!A:Z"
    val_url = f"https://sheets.googleapis.com/v4/spreadsheets/{settings.crm_spreadsheet_id}/values/{requests.utils.quote(range_ref)}"
    resp = requests.get(
        val_url,
        headers=headers,
        params={"valueRenderOption": "UNFORMATTED_VALUE", "dateTimeRenderOption": "FORMATTED_STRING"},
        timeout=30,
    )
    resp.raise_for_status()
    values = resp.json().get("values", [])
    if len(values) < 2:
        return []

    raw_headers = [str(h).strip() for h in values[0]]
    rows: List[Dict[str, Any]] = []
    for row in values[1:]:
        if not any(str(c).strip() for c in row if c is not None):
            continue
        obj: Dict[str, Any] = {}
        for idx, h in enumerate(raw_headers):
            if not h:
                continue
            obj[h] = row[idx] if idx < len(row) and row[idx] is not None else ""
        rows.append(obj)
    return rows
