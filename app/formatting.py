"""Exact Decimal math, Indian Rupee formatting, and Asia/Kolkata date utilities."""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Optional
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")
TWO_PLACES = Decimal("0.01")


def to_decimal(value: Any, default: Decimal = Decimal("0.00")) -> Decimal:
    """Convert raw input (including ₹-prefixed or comma-formatted strings) to exact 2-dp Decimal."""
    if value is None or value == "":
        return default
    if isinstance(value, Decimal):
        return value.quantize(TWO_PLACES, rounding=ROUND_HALF_UP)
    if isinstance(value, int):
        return Decimal(value).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)
    if isinstance(value, float):
        return Decimal(str(value)).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)
    cleaned = str(value).strip().replace("₹", "").replace(",", "").replace(" ", "")
    if not cleaned or cleaned in {"-", "--", "N/A", "na", "null"}:
        return default
    try:
        return Decimal(cleaned).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)
    except InvalidOperation:
        return default


def format_inr(amount: Any) -> str:
    """Format an amount in Indian numbering system: ₹1,23,45,678.90."""
    dec = to_decimal(amount)
    negative = dec < 0
    abs_dec = abs(dec)
    whole, frac = f"{abs_dec:.2f}".split(".")
    if len(whole) <= 3:
        grouped = whole
    else:
        last3 = whole[-3:]
        rest = whole[:-3]
        parts = []
        while len(rest) > 2:
            parts.append(rest[-2:])
            rest = rest[:-2]
        if rest:
            parts.append(rest)
        grouped = ",".join(reversed(parts)) + "," + last3
    prefix = "-₹" if negative else "₹"
    return f"{prefix}{grouped}.{frac}"


def now_ist() -> datetime:
    return datetime.now(IST)


def today_ist() -> date:
    return now_ist().date()


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def format_ist_date(d: Optional[str | date | datetime]) -> str:
    if not d:
        return ""
    if isinstance(d, datetime):
        return d.astimezone(IST).strftime("%d/%m/%Y")
    if isinstance(d, date):
        return d.strftime("%d/%m/%Y")
    parsed = parse_bill_date(str(d))
    return parsed.strftime("%d/%m/%Y") if parsed else str(d)


def parse_bill_date(raw: Any) -> Optional[date]:
    """Parse common Indian & ISO date formats safely into a Python date."""
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    s = str(raw).strip()
    if not s:
        return None
    for fmt in (
        "%Y-%m-%d",
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%d.%m.%Y",
        "%d/%m/%y",
        "%d-%m-%y",
        "%d %b %Y",
        "%d-%b-%Y",
        "%Y/%m/%d",
    ):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def indian_fy_bounds(ref_date: date) -> tuple[date, date]:
    """Return (start_date, end_date) of the Indian Financial Year (1 April – 31 March)."""
    if ref_date.month >= 4:
        return date(ref_date.year, 4, 1), date(ref_date.year + 1, 3, 31)
    return date(ref_date.year - 1, 4, 1), date(ref_date.year, 3, 31)


def normalize_phone(phone: Optional[str]) -> str:
    if not phone:
        return ""
    digits = "".join(ch for ch in str(phone) if ch.isdigit())
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    return digits
