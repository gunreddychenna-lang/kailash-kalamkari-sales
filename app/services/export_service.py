"""Excel (.xlsx) export generator using openpyxl for Accountant and Owner workflows."""

from __future__ import annotations

import io
from typing import Any, Dict, List

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill


MAROON_HEADER = PatternFill(start_color="5C1624", end_color="5C1624", fill_type="solid")
HEADER_FONT = Font(name="Calibri", size=11, bold=True, color="FAF6F0")


def build_excel_bytes(sheet_title: str, headers: List[str], rows: List[List[Any]]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = sheet_title[:31]

    ws.append(headers)
    for col_idx in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.fill = MAROON_HEADER
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center")

    for row in rows:
        ws.append(row)

    for col in ws.columns:
        max_len = max((len(str(c.value or "")) for c in col), default=10)
        ws.column_dimensions[col[0].column_letter].width = min(max_len + 4, 42)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
