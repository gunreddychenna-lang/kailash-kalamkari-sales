#!/usr/bin/env bash
set -euo pipefail

# Automated PostgreSQL Backup + Isolated Restore Verification Script
# Requires: SOURCE_DATABASE_URL and VERIFY_DATABASE_URL environment variables.

mkdir -p backups
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_FILE="backups/kailash_portal_${STAMP}.sql.gz"

echo "[1/4] Dumping source PostgreSQL database..."
pg_dump --no-owner --no-privileges --format=plain "$SOURCE_DATABASE_URL" | gzip -9 > "$DUMP_FILE"
ls -lh "$DUMP_FILE"

echo "[2/4] Restoring into isolated verification database..."
gunzip -c "$DUMP_FILE" | psql "$VERIFY_DATABASE_URL" -v ON_ERROR_STOP=1 >/dev/null

echo "[3/4] Running financial integrity checks against restored database..."
psql "$VERIFY_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/scripts/verify_integrity.sql

echo "[4/4] Backup and isolated restore verified successfully: $DUMP_FILE"
