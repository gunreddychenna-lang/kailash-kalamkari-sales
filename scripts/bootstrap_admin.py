#!/usr/bin/env python3
"""Bootstrap initial Owner / Super Admin user securely (no hardcoded passwords)."""

from __future__ import annotations

import argparse
import getpass
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import load_settings
from app.db import Database
from app.security import hash_password


def main() -> None:
    parser = argparse.ArgumentParser(description="Create initial Owner account for Kailash Kalamkari Portal")
    parser.add_argument("--username", required=True)
    parser.add_argument("--full-name", required=True)
    parser.add_argument("--email", default=None)
    args = parser.parse_args()

    password = os.getenv("OWNER_INITIAL_PASSWORD") or getpass.getpass("Enter strong password (min 8 chars): ")
    pw_hash = hash_password(password)

    settings = load_settings()
    db = Database(settings.database_url)
    db.init_schema()

    with db.connection() as conn:
        existing = db.fetch_one(conn, "SELECT id FROM users WHERE LOWER(username) = LOWER(?)", (args.username,))
        if existing:
            print(f"User '{args.username}' already exists (id={existing['id']}). Aborting without overwrite.")
            sys.exit(1)
        uid = db.insert_returning_id(
            conn,
            """
            INSERT INTO users (username, email, full_name, password_hash, role_code, is_active)
            VALUES (?, ?, ?, ?, 'owner', TRUE)
            """,
            (args.username, args.email, args.full_name, pw_hash),
        )
    print(f"Owner user '{args.username}' created successfully (id={uid}).")


if __name__ == "__main__":
    main()
