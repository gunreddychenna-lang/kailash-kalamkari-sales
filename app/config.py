"""Application configuration loaded strictly from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import List


@dataclass(frozen=True)
class SheetSourceConfig:
    key: str
    branch_code: str
    branch_name: str
    spreadsheet_id: str
    sheet_name: str
    discount_column: str
    legacy_branch_identifier: str


@dataclass(frozen=True)
class Settings:
    app_name: str
    app_env: str
    database_url: str
    secret_key: str
    session_ttl_hours: int
    cookie_secure: bool
    timezone_name: str
    login_max_attempts: int
    login_window_minutes: int
    sync_lock_ttl_seconds: int
    google_service_account_json: str
    google_service_account_file: str
    sheet_sources: List[SheetSourceConfig]
    crm_spreadsheet_id: str = "1a7GMkMb0B8fij4DjkFaaqsmYH_cMTqUlSxM5we5uti0"
    crm_sheet_name: str = ""


def load_settings() -> Settings:
    app_env = os.getenv("APP_ENV", "development").strip().lower()
    secret_key = os.getenv("APP_SECRET_KEY", "")
    if not secret_key:
        if app_env == "production":
            raise RuntimeError("APP_SECRET_KEY must be set in production")
        secret_key = "dev-only-change-before-production-deployment"

    sheet_sources = [
        SheetSourceConfig(
            key="main_branch",
            branch_code="MAIN",
            branch_name="Main Branch",
            spreadsheet_id=os.getenv(
                "MAIN_BRANCH_SPREADSHEET_ID",
                "1e7tdwzgJ0qky1lKdBwf2ajGL85GKvGDpkwnnJlZhhL8",
            ),
            sheet_name=os.getenv("MAIN_BRANCH_SHEET_NAME", "Kailash Kalamkari"),
            discount_column=os.getenv("MAIN_BRANCH_DISCOUNT_COL", "Discount"),
            legacy_branch_identifier="Main Branch",
        ),
        SheetSourceConfig(
            key="khps",
            branch_code="KHPS",
            branch_name="KHPS",
            spreadsheet_id=os.getenv(
                "KHPS_SPREADSHEET_ID",
                "11FXIfo2dA3JPtKm6kJPsYncStE4kSXNRZx-sHe1z88w",
            ),
            sheet_name=os.getenv("KHPS_SHEET_NAME", "Khps"),
            discount_column=os.getenv("KHPS_DISCOUNT_COL", "Discoun"),
            legacy_branch_identifier="KHPS-FR",
        ),
    ]

    return Settings(
        app_name="Kailash Kalamkari Sales Management Portal",
        app_env=app_env,
        database_url=os.getenv("DATABASE_URL", "sqlite:///./kailash_portal.db"),
        secret_key=secret_key,
        session_ttl_hours=int(os.getenv("SESSION_TTL_HOURS", "12")),
        cookie_secure=os.getenv("COOKIE_SECURE", "true" if app_env == "production" else "false").lower() == "true",
        timezone_name="Asia/Kolkata",
        login_max_attempts=int(os.getenv("LOGIN_MAX_ATTEMPTS", "5")),
        login_window_minutes=int(os.getenv("LOGIN_WINDOW_MINUTES", "15")),
        sync_lock_ttl_seconds=int(os.getenv("SYNC_LOCK_TTL_SECONDS", "600")),
        google_service_account_json=os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", ""),
        google_service_account_file=os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE", ""),
        sheet_sources=sheet_sources,
        crm_spreadsheet_id=os.getenv("CRM_SPREADSHEET_ID", "1a7GMkMb0B8fij4DjkFaaqsmYH_cMTqUlSxM5we5uti0").strip(),
        crm_sheet_name=os.getenv("CRM_SHEET_NAME", "").strip(),
    )
