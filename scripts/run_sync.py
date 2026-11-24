#!/usr/bin/env python3
"""CLI entrypoint for scheduled Google Sheets incremental synchronization (GitHub Actions / cron)."""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import load_settings
from app.db import Database
from app.sync.sheets_sync import run_sheets_sync


def main() -> None:
    source_key = sys.argv[1] if len(sys.argv) > 1 else "all"
    settings = load_settings()
    db = Database(settings.database_url)
    db.init_schema()
    result = run_sheets_sync(db, settings, trigger_type="scheduled", triggered_by=None, source_key=source_key)
    print(json.dumps(result.__dict__, indent=2))


if __name__ == "__main__":
    main()
