"""Comprehensive Automated Test Suite for Kailash Kalamkari Sales Management Portal (Phase 1).

Covers:
1. Login, logout, HttpOnly cookie, CSRF enforcement, and login rate limiting
2. Session expiration
3. Owner / Admin / Sales Staff / Accountant server-side RBAC & branch-level isolation
4. Google Sheets incremental sync (Main Branch 'Discount' + KHPS 'KHPS-FR' -> 'KHPS' & 'Discoun')
5. Duplicate invoice line prevention & composite (branch_id, invoice_no) identity
6. Multi-line invoices (no double-counting) & returns/negative sales
7. Historical edit detection, source deletion flagging, and discount discrepancy exception logging (never silent overwrite)
8. Split payment settlements (Cash + UPI + Bank Transfer), overpayment detection, duplicate prevention, and authorized reversal
9. Customer receivables ageing buckets (0-30, 31-60, 61-90, 90+)
10. Accountant Excel export (.xlsx) and database backup/restore round-trip integrity
"""

from __future__ import annotations

import os
import shutil
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi.testclient import TestClient

from app.config import Settings, SheetSourceConfig
from app.db import Database
from app.formatting import format_inr
from app.main import create_app
from app.security import hash_password
from app.sync.sheets_sync import SyncLockError, run_sheets_sync


class PortalPhase1Tests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.mkdtemp(prefix="kk_test_")
        self.db_path = os.path.join(self.tmpdir, "test_portal.db")
        self.settings = Settings(
            app_name="Kailash Kalamkari Test",
            app_env="test",
            database_url=f"sqlite:///{self.db_path}",
            secret_key="test-secret-key-not-for-prod",
            session_ttl_hours=12,
            cookie_secure=False,
            timezone_name="Asia/Kolkata",
            login_max_attempts=3,
            login_window_minutes=15,
            sync_lock_ttl_seconds=60,
            google_service_account_json="",
            google_service_account_file="",
            sheet_sources=[
                SheetSourceConfig(
                    key="main_branch",
                    branch_code="MAIN",
                    branch_name="Main Branch",
                    spreadsheet_id="1e7tdwzgJ0qky1lKdBwf2ajGL85GKvGDpkwnnJlZhhL8",
                    sheet_name="Kailash Kalamkari",
                    discount_column="Discount",
                    legacy_branch_identifier="Main Branch",
                ),
                SheetSourceConfig(
                    key="khps",
                    branch_code="KHPS",
                    branch_name="KHPS",
                    spreadsheet_id="11FXIfo2dA3JPtKm6kJPsYncStE4kSXNRZx-sHe1z88w",
                    sheet_name="Khps",
                    discount_column="Discoun",
                    legacy_branch_identifier="KHPS-FR",
                ),
            ],
        )
        self.db = Database(self.settings.database_url)
        self.app = create_app(settings=self.settings, db=self.db)
        self._seed_users()

    def tearDown(self) -> None:
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _seed_users(self) -> None:
        with self.db.connection() as conn:
            branches = self.db.fetch_all(conn, "SELECT id, code FROM branches")
            bmap = {b["code"]: int(b["id"]) for b in branches}
            self.main_branch_id = bmap["MAIN"]
            self.khps_branch_id = bmap["KHPS"]

            users = [
                ("owner1", "Kailash Owner", "OwnerPass#2026", "owner", None, []),
                ("mgr_main", "Main Store Manager", "ManagerPass#2026", "admin", self.main_branch_id, [self.main_branch_id]),
                ("staff_khps", "KHPS Sales Staff", "StaffPass#2026", "sales_staff", self.khps_branch_id, [self.khps_branch_id]),
                ("acct1", "Chief Accountant", "AccountPass#2026", "accountant", None, []),
            ]
            for uname, fname, pw, role, pbid, bids in users:
                uid = self.db.insert_returning_id(
                    conn,
                    """
                    INSERT INTO users (username, full_name, password_hash, role_code, primary_branch_id, is_active)
                    VALUES (?, ?, ?, ?, ?, TRUE)
                    """,
                    (uname, fname, hash_password(pw), role, pbid),
                )
                for bid in bids:
                    self.db.execute(conn, "INSERT INTO user_branch_access (user_id, branch_id) VALUES (?, ?)", (uid, bid))

    def _login(self, client: TestClient, username: str, password: str) -> str:
        resp = client.post("/api/auth/login", json={"username": username, "password": password})
        self.assertEqual(resp.status_code, 200, resp.text)
        return resp.json()["csrf_token"]

    def _sample_sheet_fetcher(self, mutated: bool = False, delete_khps_row: bool = False):
        main_rows = [
            ["S.No", "Branch", "Invoice No", "Bill Date", "Product Name", "Quantity", "Rate", "Discount", "Final Amount", "Sales Executive", "Payment Mode", "Sale Type", "Customer Name", "Customer Phone", "Sales Manager"],
            # Multi-line invoice INV-1001 on Main Branch (2 lines = ₹15,000 total)
            ["1", "Main Branch", "INV-1001", "2026-11-24", "Srikalahasti Silk Saree", "1", "10000", "500" if not mutated else "900", "9500", "Ramesh", "UPI", "Retail", "Lakshmi Devi", "9848011111", "Suresh"],
            ["2", "Main Branch", "INV-1001", "2026-11-24", "Kalamkari Cotton Dupatta", "1", "6000", "500", "5500", "Ramesh", "UPI", "Retail", "Lakshmi Devi", "9848011111", "Suresh"],
            # Older invoice for ageing bucket (45 days old -> 31_60 bucket)
            ["3", "Main Branch", "INV-0900", "2026-10-10", "Handpainted Pen Kalamkari", "1", "8000", "0", "8000", "Ramesh", "Cash", "Retail", "Padma Rao", "9848022222", "Suresh"],
            # Return / negative sale
            ["4", "Main Branch", "RET-1002", "2026-11-23", "Kalamkari Cotton Dupatta", "-1", "2000", "0", "-2000", "Ramesh", "Cash", "Return", "Lakshmi Devi", "9848011111", "Suresh"],
        ]
        khps_rows = [
            ["S.No", "Branch", "Invoice No", "Bill Date", "Product Name", "Quantity", "Rate", "Discoun", "Final Amount", "Sales Executive", "Payment Mode", "Sale Type", "Customer Name", "Customer Phone", "Sales Manager"],
            # Same invoice number INV-1001 on KHPS (tests composite branch+invoice identity!) + legacy KHPS-FR + Discoun column + arithmetic discount discrepancy
            ["1", "KHPS-FR", "INV-1001", "2026-11-24", "Tussar Kalamkari Saree", "1", "12000", "1000", "11500", "Kavitha", "Card", "Retail", "Anitha", "9848033333", "Suresh"],
        ]
        if delete_khps_row:
            khps_rows = khps_rows[:1]

        def _fetch(source: SheetSourceConfig):
            return main_rows if source.branch_code == "MAIN" else khps_rows

        return _fetch

    def test_01_inr_formatting(self) -> None:
        self.assertEqual(format_inr(Decimal("56328879.36")), "₹5,63,28,879.36")
        self.assertEqual(format_inr(Decimal("-2000.00")), "-₹2,000.00")

    def test_02_login_logout_csrf_and_rate_limit(self) -> None:
        client = TestClient(self.app)
        # Unauthenticated rejected
        self.assertEqual(client.get("/api/sales/dashboard").status_code, 401)

        # Wrong password triggers rate limit after 3 attempts
        for _ in range(3):
            r = client.post("/api/auth/login", json={"username": "owner1", "password": "wrong"})
            self.assertEqual(r.status_code, 401)
        r_limited = client.post("/api/auth/login", json={"username": "owner1", "password": "OwnerPass#2026"})
        self.assertEqual(r_limited.status_code, 429)

        # Valid login for accountant (different identifier)
        csrf = self._login(client, "acct1", "AccountPass#2026")
        self.assertEqual(client.get("/api/auth/me").status_code, 200)

        # Logout without CSRF fails (403), with CSRF succeeds (200)
        self.assertEqual(client.post("/api/auth/logout").status_code, 403)
        self.assertEqual(client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf}).status_code, 200)
        self.assertEqual(client.get("/api/auth/me").status_code, 401)

    def test_03_session_expiration(self) -> None:
        client = TestClient(self.app)
        self._login(client, "owner1", "OwnerPass#2026")
        expired = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        with self.db.connection() as conn:
            self.db.execute(conn, "UPDATE user_sessions SET expires_at = ?", (expired,))
        self.assertEqual(client.get("/api/auth/me").status_code, 401)

    def test_04_sync_idempotency_composite_invoices_edits_deletes_and_discounts(self) -> None:
        # Initial sync
        res1 = run_sheets_sync(self.db, self.settings, trigger_type="manual", fetcher=self._sample_sheet_fetcher())
        self.assertEqual(res1.status, "succeeded")
        self.assertEqual(res1.rows_inserted, 5)
        # KHPS row had rate 12000 - disc 1000 = 11000 vs final 11500 -> 1 arithmetic discount discrepancy
        self.assertEqual(res1.discount_diffs, 1)

        # Re-run identical sync -> 0 inserts, 5 unchanged (idempotent, zero duplicates!)
        res2 = run_sheets_sync(self.db, self.settings, trigger_type="scheduled", fetcher=self._sample_sheet_fetcher())
        self.assertEqual(res2.rows_inserted, 0)
        self.assertEqual(res2.rows_unchanged, 5)

        # Mutate historical discount on Main Branch & remove KHPS row -> must NOT overwrite/delete history, must log exceptions
        res3 = run_sheets_sync(
            self.db,
            self.settings,
            trigger_type="scheduled",
            fetcher=self._sample_sheet_fetcher(mutated=True, delete_khps_row=True),
        )
        self.assertEqual(res3.edits_detected, 1)
        self.assertEqual(res3.discount_diffs, 1)
        self.assertEqual(res3.deletes_detected, 1)

        with self.db.connection() as conn:
            # Verify original discount '500.00' was preserved, not silently overwritten to 900.00
            row = self.db.fetch_one(conn, "SELECT discount, has_pending_diff FROM sales_lines WHERE invoice_no = 'INV-1001' AND product_name = 'Srikalahasti Silk Saree'")
            self.assertEqual(row["discount"], "500.00")
            self.assertEqual(row["has_pending_diff"], 1)
            # Verify composite invoices exist separately for MAIN::INV-1001 and KHPS::INV-1001
            invs = self.db.fetch_all(conn, "SELECT invoice_uid FROM invoice_masters WHERE invoice_no = 'INV-1001' ORDER BY invoice_uid")
            self.assertEqual([i["invoice_uid"] for i in invs], ["KHPS::INV-1001", "MAIN::INV-1001"])

    def test_05_rbac_branch_isolation_sales_analytics_and_exports(self) -> None:
        run_sheets_sync(self.db, self.settings, trigger_type="manual", fetcher=self._sample_sheet_fetcher())

        # Owner sees both branches combined
        owner_client = TestClient(self.app)
        self._login(owner_client, "owner1", "OwnerPass#2026")
        dash = owner_client.get("/api/sales/dashboard?reference_date=2026-11-24&start_date=2026-10-01&end_date=2026-11-24").json()
        # Main: 9500 + 5500 + 8000 - 2000 = 21000; KHPS: 11500; Combined = 32500.00
        self.assertEqual(dash["periods"]["selected_range"]["total_sales"], "32500.00")
        # Distinct invoices: MAIN::INV-1001 (2 lines counted ONCE!), MAIN::INV-0900, MAIN::RET-1002, KHPS::INV-1001 = 4
        self.assertEqual(dash["periods"]["selected_range"]["invoice_count"], 4)
        self.assertEqual(dash["periods"]["selected_range"]["returns_total"], "-2000.00")

        # Sales Staff (KHPS only) cannot access Main Branch, Receivables, Exceptions, or User Admin
        staff_client = TestClient(self.app)
        self._login(staff_client, "staff_khps", "StaffPass#2026")
        self.assertEqual(staff_client.get(f"/api/sales/dashboard?branch_id={self.main_branch_id}").status_code, 403)
        self.assertEqual(staff_client.get("/api/receivables").status_code, 403)
        self.assertEqual(staff_client.get("/api/sync/exceptions").status_code, 403)
        khps_dash = staff_client.get("/api/sales/dashboard?reference_date=2026-11-24&start_date=2026-11-01&end_date=2026-11-24").json()
        self.assertEqual(khps_dash["periods"]["selected_range"]["total_sales"], "11500.00")

        # Accountant can export Excel and view exceptions, but cannot create admin users
        acct_client = TestClient(self.app)
        acct_csrf = self._login(acct_client, "acct1", "AccountPass#2026")
        self.assertEqual(acct_client.get("/api/exports/receivables.xlsx").status_code, 200)
        self.assertEqual(acct_client.get("/api/exports/exceptions.xlsx").status_code, 200)
        r_admin = acct_client.post(
            "/api/admin/users",
            headers={"X-CSRF-Token": acct_csrf},
            json={"username": "newstaff1", "full_name": "New Staff", "password": "Password#123", "role_code": "sales_staff"},
        )
        self.assertEqual(r_admin.status_code, 403)

    def test_06_split_settlements_overpayment_duplicate_reversal_and_receivables_ageing(self) -> None:
        run_sheets_sync(self.db, self.settings, trigger_type="manual", fetcher=self._sample_sheet_fetcher())
        client = TestClient(self.app)
        csrf = self._login(client, "acct1", "AccountPass#2026")

        with self.db.connection() as conn:
            inv = self.db.fetch_one(conn, "SELECT id, final_amount FROM invoice_masters WHERE invoice_uid = 'MAIN::INV-1001'")
            inv_id = int(inv["id"])
            self.assertEqual(inv["final_amount"], "15000.00")

        # Overpayment (> ₹15,000) rejected
        r_over = client.post(
            f"/api/invoices/{inv_id}/settlements",
            headers={"X-CSRF-Token": csrf},
            json={"entries": [{"payment_mode": "cash", "amount": "16000.00", "idempotency_key": "over-1"}]},
        )
        self.assertEqual(r_over.status_code, 400)

        # Split settlement: Cash ₹5,000 + UPI ₹7,000 + Bank Transfer ₹3,000 = ₹15,000
        r_split = client.post(
            f"/api/invoices/{inv_id}/settlements",
            headers={"X-CSRF-Token": csrf},
            json={
                "entries": [
                    {"payment_mode": "cash", "amount": "5000.00", "idempotency_key": "split-cash-1"},
                    {"payment_mode": "upi", "amount": "7000.00", "payment_reference": "UTR123", "idempotency_key": "split-upi-1"},
                    {"payment_mode": "bank_transfer", "amount": "3000.00", "payment_reference": "NEFT456", "idempotency_key": "split-neft-1"},
                ]
            },
        )
        self.assertEqual(r_split.status_code, 201, r_split.text)
        self.assertEqual(r_split.json()["updated_invoice"]["payment_status"], "paid")
        self.assertEqual(r_split.json()["updated_invoice"]["outstanding_amount"], "0.00")

        # Duplicate settlement idempotency key rejected (409)
        r_dup = client.post(
            f"/api/invoices/{inv_id}/settlements",
            headers={"X-CSRF-Token": csrf},
            json={"entries": [{"payment_mode": "cash", "amount": "5000.00", "idempotency_key": "split-cash-1"}], "allow_overpayment": True},
        )
        self.assertEqual(r_dup.status_code, 409)

        # Authorized reversal of the ₹3,000 bank transfer -> invoice becomes partial with ₹3,000 outstanding
        bank_settlement_id = r_split.json()["settlement_ids"][2]
        r_rev = client.post(
            f"/api/settlements/{bank_settlement_id}/reverse",
            headers={"X-CSRF-Token": csrf},
            json={"reason": "Bank transfer bounced by clearing house"},
        )
        self.assertEqual(r_rev.status_code, 200)

        # Verify Receivables Ageing as of 2026-11-24
        rec = client.get("/api/receivables?as_of_date=2026-11-24").json()
        # 0-30 bucket: MAIN::INV-1001 (₹3,000) + KHPS::INV-1001 (₹11,500) = ₹14,500
        # 31-60 bucket: MAIN::INV-0900 (45 days old, ₹8,000)
        self.assertEqual(rec["ageing_buckets"]["0_30"]["amount"], "14500.00")
        self.assertEqual(rec["ageing_buckets"]["31_60"]["amount"], "8000.00")
        self.assertEqual(rec["total_outstanding"], "22500.00")

    def test_07_backup_restore_and_health_check(self) -> None:
        run_sheets_sync(self.db, self.settings, trigger_type="manual", fetcher=self._sample_sheet_fetcher())
        backup_path = os.path.join(self.tmpdir, "backup_copy.db")
        shutil.copy2(self.db_path, backup_path)
        restored_db = Database(f"sqlite:///{backup_path}")
        self.assertTrue(restored_db.health_check())
        with restored_db.connection() as conn:
            row = restored_db.fetch_one(conn, "SELECT COUNT(*) AS cnt FROM sales_lines")
            self.assertEqual(int(row["cnt"]), 5)



    def test_08_subdomain_routes_isolation_and_seo_protection(self) -> None:
        client = TestClient(self.app)
        # Unauthenticated root & /dashboard redirect to /login
        r_root = client.get("/", follow_redirects=False)
        self.assertEqual(r_root.status_code, 302)
        self.assertEqual(r_root.headers["location"], "/login")

        r_dash = client.get("/dashboard", follow_redirects=False)
        self.assertEqual(r_dash.status_code, 302)
        self.assertEqual(r_dash.headers["location"], "/login")

        # SEO & crawler protection headers on subdomain
        r_login = client.get("/login")
        self.assertEqual(r_login.status_code, 200)
        self.assertEqual(r_login.headers.get("x-robots-tag"), "noindex, nofollow, noarchive")

        r_robots = client.get("/robots.txt")
        self.assertEqual(r_robots.status_code, 200)
        self.assertIn("Disallow: /", r_robots.text)

        # Authenticated session: host-only cookie (no parent Domain=.kailash-kalamkari.com) & /dashboard -> 200
        r_auth = client.post("/api/auth/login", json={"username": "owner1", "password": "OwnerPass#2026"})
        self.assertEqual(r_auth.status_code, 200)
        set_cookie = r_auth.headers.get("set-cookie", "")
        self.assertIn("HttpOnly", set_cookie)
        self.assertNotIn("Domain=", set_cookie)

        r_dash_ok = client.get("/dashboard", follow_redirects=False)
        self.assertEqual(r_dash_ok.status_code, 200)
        r_login_redir = client.get("/login", follow_redirects=False)
        self.assertEqual(r_login_redir.status_code, 302)
        self.assertEqual(r_login_redir.headers["location"], "/dashboard")



    def test_09_modernized_original_portal_screens_and_apis(self) -> None:
        run_sheets_sync(self.db, self.settings, trigger_type="manual", fetcher=self._sample_sheet_fetcher())
        anon = TestClient(self.app)
        # Protected original HTML screens redirect unauthenticated visitors to /login
        for path in ("/entry.html", "/crm.html", "/attendance.html"):
            r = anon.get(path, follow_redirects=False)
            self.assertEqual(r.status_code, 302, f"{path} should redirect when logged out")
            self.assertEqual(r.headers["location"], "/login")

        # Owner logs in and accesses all 4 original screens + modernized APIs
        client = TestClient(self.app)
        csrf = self._login(client, "owner1", "OwnerPass#2026")
        for path in ("/dashboard", "/entry.html", "/crm.html", "/attendance.html", "/styles.css"):
            r = client.get(path, follow_redirects=False)
            self.assertEqual(r.status_code, 200, f"{path} should return 200 when authenticated")

        # Sales rows API (powers index.html & crm.html)
        sales_rows = client.get("/api/portal/sales-rows").json()["rows"]
        self.assertEqual(len(sales_rows), 5)
        self.assertTrue(any(r["customer_phone"] == "9848011111" for r in sales_rows))

        # Sales staff has customer_phone masked & cannot access attendance or bills-master
        staff_client = TestClient(self.app)
        self._login(staff_client, "staff_khps", "StaffPass#2026")
        staff_rows = staff_client.get("/api/portal/sales-rows").json()["rows"]
        self.assertTrue(all(r["customer_phone"] == "" for r in staff_rows))
        self.assertEqual(staff_client.get("/api/portal/bills-master").status_code, 403)
        self.assertEqual(staff_client.get("/api/portal/attendance").status_code, 403)

        # Bank Portal API (entry.html): add bank, save multi-split, verify persistence, reset
        r_bank = client.post("/api/portal/bank-accounts", headers={"X-CSRF-Token": csrf}, json={"account_name": "42441-TJ", "account_type": "Current Account"})
        self.assertEqual(r_bank.status_code, 201)
        bm = client.get("/api/portal/bills-master").json()
        main_bill = next(b for b in bm["bills"] if b["invoice_uid"] == "MAIN::INV-1001")
        r_save = client.post(
            "/api/portal/settlements/save",
            headers={"X-CSRF-Token": csrf},
            json={"items": [{"invoice_id": main_bill["invoice_id"], "splits": [{"account": "Cash", "amount": 5000}, {"account": "42441-TJ", "amount": 10000}]}]},
        )
        self.assertEqual(r_save.status_code, 200)
        bm2 = client.get("/api/portal/bills-master").json()
        main_bill2 = next(b for b in bm2["bills"] if b["invoice_uid"] == "MAIN::INV-1001")
        self.assertEqual(len(main_bill2["settlements"]), 2)

        r_reset = client.delete(f"/api/portal/settlements/{main_bill['invoice_id']}", headers={"X-CSRF-Token": csrf})
        self.assertEqual(r_reset.status_code, 200)

        # Attendance API (attendance.html): seeds 11 staff & persists updates
        att = client.get("/api/portal/attendance").json()["records"]
        self.assertEqual(len(att), 11)
        att[0]["days_data"]["10"] = "P"
        att[0]["advance_taken"] = 1500
        r_att = client.post("/api/portal/attendance/save", headers={"X-CSRF-Token": csrf}, json={"records": [att[0]]})
        self.assertEqual(r_att.status_code, 200)
        att2 = client.get("/api/portal/attendance").json()["records"]
        ks103 = next(a for a in att2 if a["emp_id"] == "KS-103")
        self.assertEqual(ks103["days_data"].get("10"), "P")
        self.assertEqual(ks103["advance_taken"], 1500.0)

        # Monthly target API
        r_t = client.post("/api/portal/targets", headers={"X-CSRF-Token": csrf}, json={"year": 2026, "month": 11, "target_amount": 2500000})
        self.assertEqual(r_t.status_code, 200)
        self.assertEqual(client.get("/api/portal/targets?year=2026&month=11").json()["target_amount"], 2500000.0)



    def test_10_inventory_drive_sync_transfers_and_exception_resolution(self) -> None:
        run_sheets_sync(self.db, self.settings, trigger_type="manual", fetcher=self._sample_sheet_fetcher())
        anon = TestClient(self.app)
        for path in ("/inventory.html", "/reconciliation.html"):
            r = anon.get(path, follow_redirects=False)
            self.assertEqual(r.status_code, 302)
            self.assertEqual(r.headers["location"], "/login")

        client = TestClient(self.app)
        csrf = self._login(client, "owner1", "OwnerPass#2026")
        self.assertEqual(client.get("/inventory.html").status_code, 200)
        self.assertEqual(client.get("/reconciliation.html").status_code, 200)

        # Manual SKU creation + transfer to KHPS + reserve
        r_sku = client.post(
            "/api/portal/inventory",
            headers={"X-CSRF-Token": csrf},
            json={"sku": "KK-SILK-101", "product_name": "Kalamkari Bridal Silk", "fabric_category": "Silk", "mrp": "18500", "quantity_available": 3, "branch_id": self.main_branch_id},
        )
        self.assertEqual(r_sku.status_code, 201)
        item_id = r_sku.json()["id"]

        r_tr = client.post(
            f"/api/portal/inventory/{item_id}/move",
            headers={"X-CSRF-Token": csrf},
            json={"movement_type": "transfer", "quantity": 1, "to_branch_id": self.khps_branch_id, "note": "Transfer to KHPS"},
        )
        self.assertEqual(r_tr.status_code, 200)
        self.assertEqual(r_tr.json()["branch_id"], self.khps_branch_id)

        # Google Drive file-ID catalogue sync: add 2 files -> idempotent re-sync -> remove 1 file
        files_v1 = [
            {"file_id": "drv_saree_001", "file_name": "Peacock_Pen_Kalamkari.jpg", "mrp": 12500},
            {"file_id": "drv_saree_002", "file_name": "Lotus_Tussar_Saree.jpg", "mrp": 9800},
        ]
        r_d1 = client.post("/api/portal/inventory/drive-sync", headers={"X-CSRF-Token": csrf}, json={"branch_id": self.main_branch_id, "files": files_v1})
        self.assertEqual(r_d1.status_code, 200)
        self.assertEqual(r_d1.json()["created"], 2)

        # Re-sync same files -> zero duplicate SKUs
        r_d2 = client.post("/api/portal/inventory/drive-sync", headers={"X-CSRF-Token": csrf}, json={"branch_id": self.main_branch_id, "files": files_v1})
        self.assertEqual(r_d2.json()["created"], 0)

        # Remove drv_saree_002 from Drive -> ONLY drv_saree_002 marked unavailable; manual SKU untouched!
        r_d3 = client.post("/api/portal/inventory/drive-sync", headers={"X-CSRF-Token": csrf}, json={"branch_id": self.main_branch_id, "files": [files_v1[0]]})
        self.assertEqual(r_d3.json()["marked_unavailable"], 1)

        inv_list = client.get("/api/portal/inventory").json()["items"]
        by_fid = {i["drive_file_id"]: i for i in inv_list if i["drive_file_id"]}
        self.assertEqual(by_fid["drv_saree_001"]["status"], "available")
        self.assertEqual(by_fid["drv_saree_002"]["status"], "unavailable")
        manual_item = next(i for i in inv_list if i["sku"] == "KK-SILK-101")
        self.assertEqual(manual_item["status"], "available")

        # Resolve open discount exception via Accountant workflow
        excs = client.get("/api/sync/exceptions?status_filter=open").json()["exceptions"]
        self.assertGreaterEqual(len(excs), 1)
        r_res = client.post(
            f"/api/sync/exceptions/{excs[0]['id']}/resolve",
            headers={"X-CSRF-Token": csrf},
            json={"resolution_status": "kept_existing", "resolution_notes": "Verified against physical bill"},
        )
        self.assertEqual(r_res.status_code, 200)



    def test_11_cross_branch_same_agent_aggregation_and_branch_filter(self) -> None:
        def _two_branch_same_agent_fetcher(source: SheetSourceConfig):
            if source.branch_code == "MAIN":
                return [
                    ["Bil No", "Bill Date", "Item Name", "Qty", "Rate", "Discount", "BillAmount", "SM Name", "PayMode"],
                    ["M-1", "2026-11-24", "Kalamkari Saree", "1", "5000", "0", "5000", "Chenna kesava reddy", "UPI"],
                ]
            return [
                ["Bil No", "Bill Date", "Item Name", "Qty", "Rate", "Discoun", "BillAmount", "SM Name", "PayMode"],
                ["K-1", "2026-11-24", "Tussar Saree", "1", "3000", "0", "3000", "Chenna Kesava Reddy", "Cash"],
            ]

        res = run_sheets_sync(self.db, self.settings, trigger_type="manual", fetcher=_two_branch_same_agent_fetcher)
        self.assertEqual(res.rows_inserted, 2)

        client = TestClient(self.app)
        self._login(client, "owner1", "OwnerPass#2026")

        # All Branches -> combined into 1 staff entry (5000 + 3000 = 8000.00)
        all_dash = client.get("/api/sales/dashboard?reference_date=2026-11-24&start_date=2026-11-01&end_date=2026-11-24").json()
        self.assertEqual(len(all_dash["breakdowns"]["by_staff"]), 1)
        self.assertEqual(all_dash["breakdowns"]["by_staff"][0]["sales"], "8000.00")

        # Filter to Main Branch -> only 5000.00
        main_dash = client.get(f"/api/sales/dashboard?branch_id={self.main_branch_id}&reference_date=2026-11-24&start_date=2026-11-01&end_date=2026-11-24").json()
        self.assertEqual(main_dash["breakdowns"]["by_staff"][0]["sales"], "5000.00")

        # Filter to KHPS -> only 3000.00
        khps_dash = client.get(f"/api/sales/dashboard?branch_id={self.khps_branch_id}&reference_date=2026-11-24&start_date=2026-11-01&end_date=2026-11-24").json()
        self.assertEqual(khps_dash["breakdowns"]["by_staff"][0]["sales"], "3000.00")


if __name__ == "__main__":
    unittest.main()
