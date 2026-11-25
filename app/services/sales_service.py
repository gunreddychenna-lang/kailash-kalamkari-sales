"""Sales Analytics Service: accurate multi-line invoice counts, period totals, breakdowns, and targets."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Dict, List, Optional

from app.db import Database
from app.formatting import format_inr, indian_fy_bounds, today_ist, to_decimal


def _branch_clause(branch_ids: Optional[List[int]], alias: str = "sl") -> tuple[str, List[Any]]:
    if branch_ids is None:
        return "1=1", []
    placeholders = ",".join("?" for _ in branch_ids)
    return f"{alias}.branch_id IN ({placeholders})", list(branch_ids)


def _sum_period(
    db: Database,
    conn: Any,
    branch_ids: Optional[List[int]],
    start_date: date,
    end_date: date,
) -> Dict[str, Any]:
    b_sql, b_params = _branch_clause(branch_ids, "sl")
    rows = db.fetch_all(
        conn,
        f"""
        SELECT sl.invoice_id, sl.quantity, sl.discount, sl.final_amount, sl.is_return
        FROM sales_lines sl
        WHERE {b_sql}
          AND sl.is_source_deleted = FALSE
          AND sl.bill_date >= ? AND sl.bill_date <= ?
        """,
        (*b_params, start_date.isoformat(), end_date.isoformat()),
    )
    total_sales = Decimal("0.00")
    total_discounts = Decimal("0.00")
    returns_total = Decimal("0.00")
    units_sold = Decimal("0.00")
    invoice_ids: set[int] = set()

    for r in rows:
        amt = to_decimal(r["final_amount"])
        disc = to_decimal(r["discount"])
        qty = to_decimal(r["quantity"])
        total_sales += amt
        total_discounts += disc
        units_sold += qty
        invoice_ids.add(int(r["invoice_id"]))
        if amt < Decimal("0.00") or r["is_return"]:
            returns_total += amt

    inv_count = len(invoice_ids)
    avg_invoice = (total_sales / Decimal(inv_count)).quantize(Decimal("0.01")) if inv_count else Decimal("0.00")

    return {
        "total_sales": f"{total_sales:.2f}",
        "total_sales_formatted": format_inr(total_sales),
        "total_discounts": f"{total_discounts:.2f}",
        "total_discounts_formatted": format_inr(total_discounts),
        "returns_total": f"{returns_total:.2f}",
        "returns_total_formatted": format_inr(returns_total),
        "units_sold": f"{units_sold:.2f}",
        "invoice_count": inv_count,
        "line_count": len(rows),
        "average_invoice_value": f"{avg_invoice:.2f}",
        "average_invoice_value_formatted": format_inr(avg_invoice),
    }


def get_sales_dashboard(
    db: Database,
    branch_ids: Optional[List[int]],
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    reference_date: Optional[date] = None,
) -> Dict[str, Any]:
    ref = reference_date or today_ist()
    yesterday = ref - timedelta(days=1)
    month_start = ref.replace(day=1)
    prev_month_end = month_start - timedelta(days=1)
    prev_month_start = prev_month_end.replace(day=1)
    fy_start, fy_end = indian_fy_bounds(ref)

    range_start = start_date or month_start
    range_end = end_date or ref

    with db.connection() as conn:
        today_stats = _sum_period(db, conn, branch_ids, ref, ref)
        yesterday_stats = _sum_period(db, conn, branch_ids, yesterday, yesterday)
        current_month_stats = _sum_period(db, conn, branch_ids, month_start, ref)
        prev_month_stats = _sum_period(db, conn, branch_ids, prev_month_start, prev_month_end)
        fy_stats = _sum_period(db, conn, branch_ids, fy_start, fy_end)
        range_stats = _sum_period(db, conn, branch_ids, range_start, range_end)

        b_sql, b_params = _branch_clause(branch_ids, "sl")
        lines = db.fetch_all(
            conn,
            f"""
            SELECT sl.invoice_id, sl.branch_id, b.name AS branch_name, sl.bill_date,
                   sl.product_name, sl.quantity, sl.discount, sl.final_amount,
                   sl.is_return, sl.sales_executive, sl.payment_mode
            FROM sales_lines sl
            JOIN branches b ON b.id = sl.branch_id
            WHERE {b_sql}
              AND sl.is_source_deleted = FALSE
              AND sl.bill_date >= ? AND sl.bill_date <= ?
            ORDER BY sl.bill_date ASC
            """,
            (*b_params, range_start.isoformat(), range_end.isoformat()),
        )

        # Monthly targets for current month
        t_sql, t_params = _branch_clause(branch_ids, "st")
        target_rows = db.fetch_all(
            conn,
            f"""
            SELECT st.branch_id, st.target_amount
            FROM sales_targets st
            WHERE {t_sql} AND st.employee_id IS NULL
              AND st.target_year = ? AND st.target_month = ?
            """,
            (*t_params, ref.year, ref.month),
        )
        monthly_target = sum((to_decimal(t["target_amount"]) for t in target_rows), Decimal("0.00"))
        cur_month_val = to_decimal(current_month_stats["total_sales"])
        achievement_pct = (
            ((cur_month_val / monthly_target) * Decimal("100")).quantize(Decimal("0.01"))
            if monthly_target > Decimal("0.00")
            else Decimal("0.00")
        )

        last_success_sync = db.fetch_one(
            conn,
            "SELECT id, source_key, finished_at, rows_inserted, edits_detected, discount_diffs FROM sync_runs WHERE status = 'succeeded' ORDER BY id DESC LIMIT 1",
        )
        last_sync = db.fetch_one(
            conn,
            "SELECT id, source_key, status, finished_at, error_message, rows_inserted FROM sync_runs ORDER BY id DESC LIMIT 1",
        )
        open_exceptions_row = db.fetch_one(
            conn,
            "SELECT COUNT(*) AS cnt FROM sync_exceptions WHERE resolution_status = 'open'",
        )

    by_branch: Dict[str, Dict[str, Any]] = {}
    by_staff: Dict[str, Dict[str, Any]] = {}
    by_payment: Dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    by_product: Dict[str, Dict[str, Any]] = {}
    daily_trend: Dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))

    for ln in lines:
        amt = to_decimal(ln["final_amount"])
        qty = to_decimal(ln["quantity"])
        inv_id = int(ln["invoice_id"])

        b_name = ln["branch_name"]
        if b_name not in by_branch:
            by_branch[b_name] = {"branch": b_name, "sales": Decimal("0.00"), "units": Decimal("0.00"), "invoices": set()}
        by_branch[b_name]["sales"] += amt
        by_branch[b_name]["units"] += qty
        by_branch[b_name]["invoices"].add(inv_id)

        raw_staff = " ".join((ln["sales_executive"] or "").split()) or "Unassigned"
        staff_key = raw_staff.lower()
        if staff_key not in by_staff:
            by_staff[staff_key] = {"staff": raw_staff, "sales": Decimal("0.00"), "units": Decimal("0.00"), "invoices": set()}
        by_staff[staff_key]["sales"] += amt
        by_staff[staff_key]["units"] += qty
        by_staff[staff_key]["invoices"].add(inv_id)

        pm = ln["payment_mode"] or "Unspecified"
        by_payment[pm] += amt

        prod = ln["product_name"]
        if prod not in by_product:
            by_product[prod] = {"product": prod, "sales": Decimal("0.00"), "units": Decimal("0.00")}
        by_product[prod]["sales"] += amt
        by_product[prod]["units"] += qty

        daily_trend[str(ln["bill_date"])] += amt

    branch_list = sorted(
        [
            {
                "branch": v["branch"],
                "sales": f"{v['sales']:.2f}",
                "sales_formatted": format_inr(v["sales"]),
                "units": f"{v['units']:.2f}",
                "invoice_count": len(v["invoices"]),
            }
            for v in by_branch.values()
        ],
        key=lambda x: Decimal(x["sales"]),
        reverse=True,
    )
    staff_list = sorted(
        [
            {
                "staff": v["staff"],
                "sales": f"{v['sales']:.2f}",
                "sales_formatted": format_inr(v["sales"]),
                "units": f"{v['units']:.2f}",
                "invoice_count": len(v["invoices"]),
            }
            for v in by_staff.values()
        ],
        key=lambda x: Decimal(x["sales"]),
        reverse=True,
    )
    payment_list = sorted(
        [
            {"payment_mode": k, "sales": f"{v:.2f}", "sales_formatted": format_inr(v)}
            for k, v in by_payment.items()
        ],
        key=lambda x: Decimal(x["sales"]),
        reverse=True,
    )
    product_list = sorted(
        [
            {
                "product": v["product"],
                "sales": f"{v['sales']:.2f}",
                "sales_formatted": format_inr(v["sales"]),
                "units": f"{v['units']:.2f}",
            }
            for v in by_product.values()
        ],
        key=lambda x: Decimal(x["sales"]),
        reverse=True,
    )[:20]
    trend_list = [
        {"date": d, "sales": f"{v:.2f}", "sales_formatted": format_inr(v)}
        for d, v in sorted(daily_trend.items())
    ]

    return {
        "reference_date": ref.isoformat(),
        "range": {"start_date": range_start.isoformat(), "end_date": range_end.isoformat()},
        "periods": {
            "today": today_stats,
            "yesterday": yesterday_stats,
            "current_month": current_month_stats,
            "previous_month": prev_month_stats,
            "financial_year": fy_stats,
            "selected_range": range_stats,
        },
        "target": {
            "month": ref.strftime("%B %Y"),
            "target_amount": f"{monthly_target:.2f}",
            "target_amount_formatted": format_inr(monthly_target),
            "achieved_amount": current_month_stats["total_sales"],
            "achieved_amount_formatted": current_month_stats["total_sales_formatted"],
            "achievement_pct": f"{achievement_pct:.2f}",
        },
        "breakdowns": {
            "by_branch": branch_list,
            "by_staff": staff_list,
            "by_payment_mode": payment_list,
            "by_product": product_list,
            "daily_trend": trend_list,
        },
        "sync_status": {
            "last_successful_sync": last_success_sync,
            "latest_sync": last_sync,
            "open_exceptions": int(open_exceptions_row["cnt"]) if open_exceptions_row else 0,
        },
    }
