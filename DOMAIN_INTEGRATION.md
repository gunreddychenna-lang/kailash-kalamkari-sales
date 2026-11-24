# Official Website & Subdomain Integration Guide (`sales.kailash-kalamkari.com`)

> **Zero-Touch Guarantee:** `https://www.kailash-kalamkari.com/` (root `@` and `www` DNS records, storefront code, catalogue, pricing, customer accounts, and SEO) is **never modified** by this setup.

---

## 1. Target URL Architecture

| URL | Purpose | Auth & SEO Behavior |
| :--- | :--- | :--- |
| `https://www.kailash-kalamkari.com/` | Public shopping storefront (existing) | Unchanged, completely isolated |
| `https://sales.kailash-kalamkari.com/` | Sales Portal root | `302` → `/dashboard` (if signed in) or `/login` (if signed out) |
| `https://sales.kailash-kalamkari.com/login` | Staff/Owner login page | Public login form; `X-Robots-Tag: noindex, nofollow, noarchive` |
| `https://sales.kailash-kalamkari.com/dashboard` | Owner & Staff portal | Server-side session check; `302` → `/login` if unauthenticated |
| `https://sales.kailash-kalamkari.com/robots.txt` | Crawler blocker | `User-agent: *` / `Disallow: /` |

### Session & Authentication Isolation
- The `kk_session` cookie is issued as a **host-only cookie** (no `Domain=.kailash-kalamkari.com` attribute), `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- Browsers strictly bind it to `sales.kailash-kalamkari.com` alone—customer accounts on `www.kailash-kalamkari.com` cannot read, share, or interfere with internal portal sessions.

---

## 2. Deployment Path & Commercial-Use Compliance

| Option | Monthly Cost | DNS Record for `sales` Subdomain | Commercial Use |
| :--- | :--- | :--- | :--- |
| **Option A (Recommended ₹0): Render Free Web Service + Neon Free Postgres + GitHub Actions** | **₹0** | `CNAME` `sales` → `<your-service>.onrender.com` | Permitted |
| **Option B (Always-On ₹0): Oracle Cloud Always Free VM (Docker + Caddy HTTPS) + GitHub Actions** | **₹0** | `A` `sales` → `<oracle-vm-public-ip>` | Permitted |
| **Option C (Existing Vercel Workflow): Vercel Pro + Neon Free Postgres + GitHub Actions** | **$20/seat/mo** | `CNAME` `sales` → `cname.vercel-dns.com` | Permitted on **Pro only** (Vercel Hobby prohibits commercial use) |

---

## 3. Pre-Cutover Checklist (Do Not Execute Without Approval)
1. Push this repository to the private `kailash-kalamkari-sales` GitHub repository (never commit `.env` or service account JSON keys).
2. Configure environment secrets in your hosting provider & GitHub Actions (`APP_ENV=production`, `COOKIE_SECURE=true`, `APP_SECRET_KEY`, `DATABASE_URL`, `GOOGLE_SERVICE_ACCOUNT_JSON`).
3. Verify staging URL:
   - `GET /api/health` returns `200 {"status":"ok","database":"up"}`
   - `GET /dashboard` without cookie returns `302` → `/login`
   - `GET /robots.txt` returns `Disallow: /`
   - Login as Owner, Accountant, Store Manager, and Sales Staff on desktop & mobile.
4. **Only after explicit approval**, add the single `sales` DNS record (`CNAME` or `A`) in your domain registrar for `kailash-kalamkari.com` — leaving `@` and `www` records completely untouched.
5. Wait for automatic TLS/HTTPS certificate issuance and run smoke tests on `https://sales.kailash-kalamkari.com/login` and `https://sales.kailash-kalamkari.com/dashboard`.

---

## 4. Rollback Procedure (< 2 Minutes)
1. **Immediate Portal Take-Down / Traffic Cut:** Remove or pause the `sales` CNAME/A record in DNS (zero impact on `www.kailash-kalamkari.com`).
2. **Code Rollback:** In Render or Vercel, click **Rollback** to the previous known-good deployment, or `git revert <commit>` and push to `main`.
3. **Database Rollback:** Restore the latest verified nightly backup:
   ```bash
   gunzip -c backups/kailash_portal_<TIMESTAMP>.sql.gz | psql "$DATABASE_URL" -v ON_ERROR_STOP=1
   psql "$DATABASE_URL" -f db/scripts/verify_integrity.sql
   ```
