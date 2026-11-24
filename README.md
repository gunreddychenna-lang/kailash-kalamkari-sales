# Kailash Kalamkari Sales & Business Management Portal

Production-oriented Phase 1 implementation of the internal Sales Management Portal for **Kailash Kalamkari** (Srikalahasti, Andhra Pradesh).

---

## 1. Architecture & ₹0 Hosting Evaluation

```
                     ┌──────────────────────────────────────┐
                     │  Staff / Accountant / Manager / Owner│
                     │     (Desktop, Tablet, Mobile Web)    │
                     └──────────────────┬───────────────────┘
                                        │ HTTPS (HttpOnly Cookie + CSRF)
                                        ▼
                     ┌──────────────────────────────────────┐
                     │   FastAPI Portal + Branded Web UI    │
                     │  (Render Free OR Oracle Always Free) │
                     └──────────────────┬───────────────────┘
                                        │ SQL (psycopg / TLS)
                                        ▼
                     ┌──────────────────────────────────────┐
                     │      PostgreSQL 16 Database          │
                     │  (Neon Free 1GB OR Self-Hosted PG)   │
                     └──────────────────▲───────────────────┘
                                        │
          ┌─────────────────────────────┴──────────────────────────────┐
          │ GitHub Actions (Private Repo Free: 2,000 min/month)        │
          │  • sheets-sync.yml: Every 30m (IST business hours)         │
          │  • db-backup-verify.yml: Nightly pg_dump + restore test    │
          └─────────────────────────────▲──────────────────────────────┘
                                        │ RS256 Service Account JWT
                                        ▼
                     ┌──────────────────────────────────────┐
                     │     Google Sheets (Source of Truth)  │
                     │  • Main Branch ('Kailash Kalamkari') │
                     │  • KHPS ('Khps', KHPS-FR -> KHPS)    │
                     └──────────────────────────────────────┘
```

### Cloud Plan Limits, Billing Risks & Commercial-Use Compliance

| Component | Recommended Option | ₹0 Limits & Quotas | Commercial Use | Operational Risks & Mitigation |
| :--- | :--- | :--- | :--- | :--- |
| **Vercel Hobby** | **Rejected** | N/A | **Prohibited** ([Vercel Terms](https://vercel.com/legal/terms)) | Hobby is strictly personal/non-commercial. Pro starts at $20/seat/mo. |
| **Web + API (Option A — Managed)** | **Render Free Web Service** ([Render Free Docs](https://render.com/docs/free)) | 750 instance hrs/mo, 512 MB RAM, 0.1 CPU, 5 GB bandwidth/mo | Permitted | Spins down after 15 min idle (~30–60s cold start); ephemeral disk. Never store SQLite here. |
| **Web + API + DB (Option B — Always-On)** | **Oracle Cloud Always Free** ([Oracle Always Free](https://docs.oracle.com/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)) | 2 AMD Micro VMs + Ampere A1 Arm (2 OCPUs / 12 GB RAM), 200 GB block storage, 10 TB egress/mo | Permitted | Card verification required; Arm stock shortages in India regions; idle VMs can be reclaimed. |
| **Managed PostgreSQL** | **Neon PostgreSQL Free** ([Neon Plans](https://neon.com/docs/introduction/plans)) | 1 GB/project, 100 CU-hrs/project/mo (400 hrs @ 0.25 CU), 5 GB egress/mo, 6h instant restore | Permitted | Mandatory 5-min scale-to-zero; no uptime SLA; exceeding CU-hrs or 5 GB egress suspends compute until next month (data preserved). Avoid Render Free Postgres (expires in 30 days) and Supabase Free (pauses after 7 days inactivity). |
| **Scheduled Sync & Backups** | **GitHub Actions Free** ([GitHub Pricing](https://github.com/pricing)) | 2,000 CI/CD min/mo, 500 MB storage (private repo) | Permitted | Sync every 30 min during IST business hours (~390 min/mo) + nightly backup/restore (~60 min/mo) stays well under quota. |

> **Honest Availability Note:** No ₹0 free tier provides a contractual 24/7 uptime SLA. This repository therefore ships with `docker-compose.yml` and nightly verified `pg_dump` backups so the business can fail over to a local/office PostgreSQL instance or another cloud VM in under 5 minutes without data loss.

---

## 2. Quick Start (Local Development & First Working Version)

```bash
# 1. Create virtual environment and install dependencies
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 2. Configure environment (copy template and set APP_SECRET_KEY)
cp .env.example .env

# 3. Bootstrap the first Owner account (no hardcoded passwords)
python3 scripts/bootstrap_admin.py --username owner --full-name "Kailash Owner"

# 4. Run the automated test suite
python3 -m unittest discover -s tests -v

# 5. Start the portal locally
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Open `http://127.0.0.1:8000` in your desktop or mobile browser.

### Running with PostgreSQL via Docker Compose
```bash
export POSTGRES_PASSWORD="choose-a-strong-db-password"
export APP_SECRET_KEY="$(openssl rand -hex 32)"
docker compose up --build -d
```

---

## 3. Rollback Procedure
1. **Application Rollback (Render / GitHub):** Revert to the last known-good Git commit or select one of the previous deploys in Render dashboard.
2. **Database Rollback:** Never run destructive `DROP` migrations on production. To restore from a nightly verified backup:
   ```bash
   gunzip -c backups/kailash_portal_<TIMESTAMP>.sql.gz | psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1
   psql "$TARGET_DATABASE_URL" -f db/scripts/verify_integrity.sql
   ```
