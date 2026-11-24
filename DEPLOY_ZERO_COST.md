# Zero-Cost (₹0/month) Production Deployment Guide — Option A (No Credit Card Required)

**Stack:** Neon Free PostgreSQL (1 GB) + Render Free Web Service + GitHub Actions (Google Sheets Sync & Nightly Verified Backups)
**Target Subdomain:** `https://sales.kailash-kalamkari.com/` (leaves `https://www.kailash-kalamkari.com/` 100% untouched)

---

## Step 1: Create Free PostgreSQL Database on Neon (No Card)
1. Sign up at `https://neon.com` using your Google/GitHub account.
2. Create a new project: **`kailash-kalamkari-portal`** (Region: **Singapore / ap-southeast-1** for lowest latency to Andhra Pradesh).
3. Copy the pooled PostgreSQL connection string (`postgresql://neondb_owner:...@ep-...-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`).
4. Open Neon **SQL Editor** and run the entire contents of `db/migrations/001_initial_schema.sql` once.

## Step 2: Push Code to Private GitHub Repository (`kailash-kalamkari-sales`)
1. Push this repository to your private GitHub repository (verify `.env` and `*.json` keys are NOT committed).
2. In GitHub → **Settings → Secrets and variables → Actions**, add:
   - `DATABASE_URL`: your Neon connection string
   - `APP_SECRET_KEY`: generate a 64-char random hex string (`python -c "import secrets; print(secrets.token_hex(32))"`)
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: full JSON contents of your Google Service Account key (and share both Google Sheets with that service account's `client_email` as **Viewer**).
3. Run the **Scheduled Google Sheets Sync** workflow once manually (`Actions → Run workflow`) to reconcile Main Branch + KHPS into Neon!

## Step 3: Deploy Web Portal on Render Free (No Card)
1. Sign up at `https://render.com` with GitHub.
2. Click **New → Blueprint** and select your `kailash-kalamkari-sales` repository (reads `render.yaml` automatically).
3. Enter your `DATABASE_URL` and `GOOGLE_SERVICE_ACCOUNT_JSON` secrets in Render's Environment tab.
4. Once deployed, bootstrap your Owner account from your PC pointing at Neon:
   ```powershell
   $env:DATABASE_URL = "postgresql://..."
   .\.venv\Scripts\python.exe scripts\bootstrap_admin.py --username owner --full-name "Kailash Owner"
   ```
5. Verify staging works on `https://<your-service>.onrender.com/login` on desktop and mobile.

## Step 4: Connect `sales.kailash-kalamkari.com` (Only After Your Final Approval)
1. In Render → **Settings → Custom Domains**, add `sales.kailash-kalamkari.com`.
2. In your domain registrar's DNS panel for `kailash-kalamkari.com`, add ONE record:
   - **Type:** `CNAME` | **Host:** `sales` | **Value:** `<your-service>.onrender.com`
   - **Do NOT touch `@` or `www` records** (`https://www.kailash-kalamkari.com/` stays 100% independent).
3. Wait ~5 minutes for automatic HTTPS certificate issuance, then verify `https://sales.kailash-kalamkari.com/login` and `/dashboard`.
