#!/usr/bin/env python3
"""Annual Financial Year Archive Export Script.

Exports a full multi-sheet Excel archive (Sales Lines, Invoices, Settlements,
Receivables, Exceptions) before rolling over to a new Financial Year's Google Sheets.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime

from openpyxl import Workbook

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import load_settings
from app.db import Database


def export_fy_archive(output_path: str) -> str:
    settings = load_settings()
    db = Database(settings.database_url)
    wb = Workbook()
    wb.remove(wb.active)

    tables = [
        ("Sales Lines", "SELECT * FROM sales_lines ORDER BY bill_date ASC, id ASC"),
        ("Invoices", "SELECT * FROM invoice_masters ORDER BY bill_date ASC, id ASC"),
        ("Settlements", "SELECT * FROM invoice_settlements ORDER BY settlement_date ASC, id ASC"),
        ("Exceptions", "SELECT * FROM sync_exceptions ORDER BY id ASC"),
        ("Attendance", "SELECT * FROM attendance_sheets ORDER BY month_sheet ASC, emp_id ASC"),
    ]

    with db.connection() as conn:
        for title, sql in tables:
            ws = wb.create_sheet(title=title)
            rows = db.fetch_all(conn, sql)
            if rows:
                headers = list(rows[0].keys())
                ws.append(headers)
                for r in rows:
                    ws.append([str(r[h]) if r[h] is not None else "" for h in headers])
            else:
                ws.append(["No records"])

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    wb.save(output_path)
    return output_path


if __name__ == "__main__":
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out = sys.argv[1] if len(sys.argv) > 1 else f"archives/kailash_fy_archive_{stamp}.xlsx"
    saved = export_fy_archive(out)
    print(f"Financial Year archive exported successfully: {saved}")
