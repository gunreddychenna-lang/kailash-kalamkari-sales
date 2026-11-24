"""FastAPI application entry point for Kailash Kalamkari Sales Management Portal."""

from __future__ import annotations

import os
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query, Request, Response, status
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.config import Settings, load_settings
from app.db import Database
from app.formatting import parse_bill_date
from app.security import (
    ALL_ROLES,
    SESSION_COOKIE_NAME,
    AuthContext,
    authenticate_request,
    check_login_rate_limit,
    consume_password_reset_token,
    create_password_reset_token,
    create_session,
    hash_password,
    record_login_attempt,
    require_roles,
    resolve_branch_filter,
    revoke_session,
    verify_csrf,
    verify_password,
    write_audit_log,
)
from app.services.export_service import build_excel_bytes
from app.services.invoice_service import (
    get_invoice_detail,
    get_receivables_report,
    list_invoices,
    record_settlements,
    reverse_settlement,
)
from app.services.sales_service import get_sales_dashboard
from app.services.inventory_service import (
    create_inventory_item,
    list_inventory,
    move_or_transfer_stock,
    sync_google_drive_catalogue,
)
from app.services.portal_service import (
    add_portal_bank_account,
    get_monthly_target,
    get_portal_attendance,
    get_portal_bills_master,
    get_portal_sales_rows,
    reset_bill_settlements,
    save_bill_bank_splits,
    save_monthly_target,
    save_portal_attendance,
)
from app.sync.sheets_sync import SyncLockError, run_sheets_sync


class LoginPayload(BaseModel):
    username: str = Field(..., min_length=2, max_length=64)
    password: str = Field(..., min_length=1, max_length=128)


class CreateUserPayload(BaseModel):
    username: str = Field(..., min_length=3, max_length=64)
    full_name: str = Field(..., min_length=2, max_length=120)
    email: Optional[str] = None
    password: str = Field(..., min_length=8, max_length=128)
    role_code: str
    primary_branch_id: Optional[int] = None
    branch_ids: List[int] = Field(default_factory=list)


class PasswordResetConfirmPayload(BaseModel):
    token: str = Field(..., min_length=16)
    new_password: str = Field(..., min_length=8, max_length=128)


class SettlementItemPayload(BaseModel):
    payment_mode: str
    bank_account_id: Optional[int] = None
    amount: str
    payment_reference: Optional[str] = None
    idempotency_key: Optional[str] = None
    settlement_date: Optional[str] = None
    notes: Optional[str] = None


class RecordSettlementsPayload(BaseModel):
    entries: List[SettlementItemPayload]
    allow_overpayment: bool = False


class ReverseSettlementPayload(BaseModel):
    reason: str = Field(..., min_length=5, max_length=400)


class SyncTriggerPayload(BaseModel):
    source_key: str = Field(default="all")


def create_app(settings: Optional[Settings] = None, db: Optional[Database] = None) -> FastAPI:
    cfg = settings or load_settings()
    database = db or Database(cfg.database_url)
    database.init_schema()

    app = FastAPI(
        title=cfg.app_name,
        version="1.0.0-phase1",
        docs_url="/api/docs" if cfg.app_env != "production" else None,
        redoc_url=None,
    )
    app.state.settings = cfg
    app.state.db = database

    static_dir = os.path.join(os.path.dirname(__file__), "static")
    if os.path.isdir(static_dir):
        app.mount("/static", StaticFiles(directory=static_dir), name="static")

    @app.middleware("http")
    async def security_headers_middleware(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; "
            "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com; "
            "img-src 'self' data: blob: https:;"
        )
        response.headers["X-Robots-Tag"] = "noindex, nofollow, noarchive"
        if cfg.app_env == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    def _client_ip(request: Request) -> str:
        fwd = request.headers.get("X-Forwarded-For", "")
        if fwd:
            return fwd.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    def _auth(request: Request, enforce_csrf: bool = False) -> AuthContext:
        ctx = authenticate_request(request, database, cfg)
        if enforce_csrf:
            verify_csrf(request, ctx)
        return ctx

    # ------------------------------------------------------------------
    # Frontend & Health
    # ------------------------------------------------------------------
    def _has_valid_session(request: Request) -> bool:
        try:
            authenticate_request(request, database, cfg)
            return True
        except HTTPException:
            return False

    @app.get("/robots.txt", include_in_schema=False)
    def robots_txt():
        return PlainTextResponse("User-agent: *\nDisallow: /\n")

    @app.get("/", include_in_schema=False)
    def serve_root(request: Request):
        target = "/dashboard" if _has_valid_session(request) else "/login"
        return RedirectResponse(url=target, status_code=302)

    @app.get("/login", include_in_schema=False)
    def serve_login(request: Request):
        if _has_valid_session(request):
            return RedirectResponse(url="/dashboard", status_code=302)
        return FileResponse(os.path.join(static_dir, "index.html"))

    @app.get("/dashboard", include_in_schema=False)
    def serve_dashboard(request: Request):
        if not _has_valid_session(request):
            return RedirectResponse(url="/login", status_code=302)
        return FileResponse(os.path.join(static_dir, "index.html"))

    @app.get("/index.html", include_in_schema=False)
    def serve_index_html():
        return FileResponse(os.path.join(static_dir, "index.html"))

    @app.get("/entry.html", include_in_schema=False)
    def serve_entry_html(request: Request):
        if not _has_valid_session(request):
            return RedirectResponse(url="/login", status_code=302)
        return FileResponse(os.path.join(static_dir, "entry.html"))

    @app.get("/crm.html", include_in_schema=False)
    def serve_crm_html(request: Request):
        if not _has_valid_session(request):
            return RedirectResponse(url="/login", status_code=302)
        return FileResponse(os.path.join(static_dir, "crm.html"))

    @app.get("/attendance.html", include_in_schema=False)
    def serve_attendance_html(request: Request):
        if not _has_valid_session(request):
            return RedirectResponse(url="/login", status_code=302)
        return FileResponse(os.path.join(static_dir, "attendance.html"))

    @app.get("/inventory.html", include_in_schema=False)
    def serve_inventory_html(request: Request):
        if not _has_valid_session(request):
            return RedirectResponse(url="/login", status_code=302)
        return FileResponse(os.path.join(static_dir, "inventory.html"))

    @app.get("/reconciliation.html", include_in_schema=False)
    def serve_reconciliation_html(request: Request):
        if not _has_valid_session(request):
            return RedirectResponse(url="/login", status_code=302)
        return FileResponse(os.path.join(static_dir, "reconciliation.html"))

    @app.get("/api/portal/inventory")
    def api_list_inventory(
        request: Request,
        status_filter: Optional[str] = Query(default=None),
        search: Optional[str] = Query(default=None),
    ):
        auth = _auth(request)
        allowed = resolve_branch_filter(auth, None)
        return list_inventory(database, allowed, status_filter=status_filter, search=search)

    @app.post("/api/portal/inventory", status_code=201)
    def api_create_inventory(payload: Dict[str, Any], request: Request):
        auth = _auth(request, enforce_csrf=True)
        require_roles(auth, ["owner", "admin"])
        return create_inventory_item(database, auth, payload, ip_address=_client_ip(request))

    @app.post("/api/portal/inventory/{item_id}/move")
    def api_move_inventory(item_id: int, payload: Dict[str, Any], request: Request):
        auth = _auth(request, enforce_csrf=True)
        require_roles(auth, ["owner", "admin"])
        return move_or_transfer_stock(
            database,
            auth,
            item_id=item_id,
            movement_type=str(payload.get("movement_type", "")),
            quantity=int(payload.get("quantity", 0)),
            to_branch_id=payload.get("to_branch_id"),
            note=str(payload.get("note", "")),
            ip_address=_client_ip(request),
        )

    @app.post("/api/portal/inventory/drive-sync")
    def api_drive_inventory_sync(payload: Dict[str, Any], request: Request):
        auth = _auth(request, enforce_csrf=True)
        require_roles(auth, ["owner", "admin"])
        branch_id = int(payload.get("branch_id", 1))
        files = payload.get("files") or []
        return sync_google_drive_catalogue(database, auth, branch_id, files, ip_address=_client_ip(request))

    @app.post("/api/sync/exceptions/{exc_id}/resolve")
    def api_resolve_exception(exc_id: int, payload: Dict[str, Any], request: Request):
        auth = _auth(request, enforce_csrf=True)
        require_roles(auth, ["owner", "accountant"])
        decision = str(payload.get("resolution_status", "")).strip()
        if decision not in {"approved_update", "kept_existing", "dismissed"}:
            raise HTTPException(status_code=400, detail="Invalid resolution_status")
        notes = str(payload.get("resolution_notes", "")).strip()
        now_iso = datetime.now(timezone.utc).isoformat()
        with database.connection() as conn:
            ex = database.fetch_one(conn, "SELECT * FROM sync_exceptions WHERE id = ?", (exc_id,))
            if not ex:
                raise HTTPException(status_code=404, detail="Exception not found")
            database.execute(
                conn,
                "UPDATE sync_exceptions SET resolution_status = ?, resolved_by = ?, resolved_at = ?, resolution_notes = ? WHERE id = ?",
                (decision, auth.user_id, now_iso, notes, exc_id),
            )
            write_audit_log(
                database,
                conn,
                actor_user_id=auth.user_id,
                actor_role=auth.role_code,
                action="resolve_sync_exception",
                entity_type="sync_exception",
                entity_id=str(exc_id),
                branch_id=int(ex["branch_id"]),
                ip_address=_client_ip(request),
                after_state={"decision": decision, "notes": notes},
            )
        return {"id": exc_id, "resolution_status": decision}

    @app.get("/styles.css", include_in_schema=False)
    def serve_styles_css():
        return FileResponse(os.path.join(static_dir, "styles.css"))

    # ------------------------------------------------------------------
    # Portal Modernized APIs (Replaces Supabase for index/entry/crm/attendance)
    # ------------------------------------------------------------------
    @app.get("/api/portal/sales-rows")
    def api_portal_sales_rows(request: Request):
        auth = _auth(request)
        allowed = resolve_branch_filter(auth, None)
        include_phone = auth.role_code in {"owner", "admin", "accountant"}
        return {"rows": get_portal_sales_rows(database, allowed, include_customer_phone=include_phone)}

    @app.get("/api/portal/bills-master")
    def api_portal_bills_master(request: Request):
        auth = _auth(request)
        require_roles(auth, ["owner", "admin", "accountant"])
        allowed = resolve_branch_filter(auth, None)
        return get_portal_bills_master(database, allowed)

    @app.post("/api/portal/settlements/save")
    def api_portal_save_settlements(payload: Dict[str, Any], request: Request):
        auth = _auth(request, enforce_csrf=True)
        require_roles(auth, ["owner", "admin", "accountant"])
        items = payload.get("items") or []
        return save_bill_bank_splits(database, auth, items, ip_address=_client_ip(request))

    @app.delete("/api/portal/settlements/{invoice_id}")
    def api_portal_reset_single_settlement(invoice_id: int, request: Request):
        auth = _auth(request, enforce_csrf=True)
        require_roles(auth, ["owner", "admin", "accountant"])
        return reset_bill_settlements(database, auth, invoice_id=invoice_id, ip_address=_client_ip(request))

    @app.delete("/api/portal/settlements")
    def api_portal_reset_all_settlements(request: Request):
        auth = _auth(request, enforce_csrf=True)
        require_roles(auth, ["owner", "accountant"])
        return reset_bill_settlements(database, auth, invoice_id=None, ip_address=_client_ip(request))

    @app.post("/api/portal/bank-accounts", status_code=201)
    def api_portal_add_bank(payload: Dict[str, Any], request: Request):
        auth = _auth(request, enforce_csrf=True)
        require_roles(auth, ["owner", "admin", "accountant"])
        return add_portal_bank_account(
            database,
            auth,
            account_name=str(payload.get("account_name", "")),
            account_type=str(payload.get("account_type", "Current Account")),
            ip_address=_client_ip(request),
        )

    @app.get("/api/portal/attendance")
    def api_portal_get_attendance(request: Request):
        auth = _auth(request)
        require_roles(auth, ["owner", "admin", "accountant"])
        return {"records": get_portal_attendance(database)}

    @app.post("/api/portal/attendance/save")
    def api_portal_save_attendance(payload: Dict[str, Any], request: Request):
        auth = _auth(request, enforce_csrf=True)
        require_roles(auth, ["owner", "admin"])
        return save_portal_attendance(database, auth, payload.get("records") or [], ip_address=_client_ip(request))

    @app.get("/api/portal/targets")
    def api_portal_get_target(request: Request, year: int = Query(default=2026), month: int = Query(default=11)):
        _auth(request)
        return get_monthly_target(database, year, month)

    @app.post("/api/portal/targets")
    def api_portal_save_target(payload: Dict[str, Any], request: Request):
        auth = _auth(request, enforce_csrf=True)
        require_roles(auth, ["owner", "admin"])
        return save_monthly_target(
            database,
            auth,
            int(payload.get("year", 2026)),
            int(payload.get("month", 11)),
            payload.get("target_amount", 1000000),
        )

    @app.get("/api/health")
    def health():
        ok = database.health_check()
        if not ok:
            return JSONResponse(status_code=503, content={"status": "unhealthy", "database": "down"})
        return {"status": "ok", "database": "up", "env": cfg.app_env, "timezone": cfg.timezone_name}

    # ------------------------------------------------------------------
    # Authentication & Session Management
    # ------------------------------------------------------------------
    @app.post("/api/auth/login")
    def login(payload: LoginPayload, request: Request, response: Response):
        ip = _client_ip(request)
        check_login_rate_limit(database, cfg, payload.username, ip)

        with database.connection() as conn:
            user = database.fetch_one(
                conn,
                "SELECT id, username, full_name, password_hash, role_code, primary_branch_id, is_active FROM users WHERE LOWER(username) = LOWER(?)",
                (payload.username.strip(),),
            )

        if not user or not user["is_active"] or not verify_password(payload.password, user["password_hash"]):
            record_login_attempt(database, payload.username, ip, succeeded=False)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")

        record_login_attempt(database, payload.username, ip, succeeded=True)
        raw_token, csrf_token, expires_at = create_session(
            database,
            cfg,
            user_id=int(user["id"]),
            ip_address=ip,
            user_agent=request.headers.get("User-Agent", ""),
        )
        with database.connection() as conn:
            write_audit_log(
                database,
                conn,
                actor_user_id=int(user["id"]),
                actor_role=user["role_code"],
                action="login",
                entity_type="user",
                entity_id=str(user["id"]),
                ip_address=ip,
            )

        response.set_cookie(
            key=SESSION_COOKIE_NAME,
            value=raw_token,
            httponly=True,
            secure=cfg.cookie_secure,
            samesite="lax",
            max_age=cfg.session_ttl_hours * 3600,
            path="/",
        )
        return {
            "user": {
                "id": int(user["id"]),
                "username": user["username"],
                "full_name": user["full_name"],
                "role_code": user["role_code"],
                "primary_branch_id": user["primary_branch_id"],
            },
            "csrf_token": csrf_token,
            "expires_at": expires_at.isoformat(),
        }

    @app.post("/api/auth/logout")
    def logout(request: Request, response: Response):
        auth = _auth(request, enforce_csrf=True)
        raw_token = request.cookies.get(SESSION_COOKIE_NAME, "")
        if raw_token:
            revoke_session(database, cfg, raw_token)
        with database.connection() as conn:
            write_audit_log(
                database,
                conn,
                actor_user_id=auth.user_id,
                actor_role=auth.role_code,
                action="logout",
                entity_type="user",
                entity_id=str(auth.user_id),
                ip_address=_client_ip(request),
            )
        response.delete_cookie(SESSION_COOKIE_NAME, path="/")
        return {"status": "logged_out"}

    @app.get("/api/auth/me")
    def me(request: Request):
        auth = _auth(request)
        return {
            "user_id": auth.user_id,
            "username": auth.username,
            "full_name": auth.full_name,
            "role_code": auth.role_code,
            "primary_branch_id": auth.primary_branch_id,
            "allowed_branch_ids": auth.allowed_branch_ids,
            "all_branches": auth.all_branches,
            "csrf_token": auth.csrf_token,
        }

    @app.post("/api/auth/password-reset/request/{target_user_id}")
    def request_password_reset(target_user_id: int, request: Request):
        auth = _auth(request, enforce_csrf=True)
        require_roles(auth, ["owner"])
        token = create_password_reset_token(database, cfg, target_user_id)
        with database.connection() as conn:
            write_audit_log(
                database,
                conn,
                actor_user_id=auth.user_id,
                actor_role=auth.role_code,
                action="issue_password_reset",
                entity_type="user",
                entity_id=str(target_user_id),
                ip_address=_client_ip(request),
            )
        return {"reset_token": token, "expires_in_minutes": 30}

    @app.post("/api/auth/password-reset/confirm")
    def confirm_password_reset(payload: PasswordResetConfirmPayload):
        user_id = consume_password_reset_token(database, cfg, payload.token, payload.new_password)
        return {"status": "password_updated", "user_id": user_id}

    # ------------------------------------------------------------------
    # Branches, Bank Accounts & User Administration
    # ------------------------------------------------------------------
    @app.get("/api/branches")
    def get_branches(request: Request):
        auth = _auth(request)
        branch_ids = resolve_branch_filter(auth, None)
        with database.connection() as conn:
            if branch_ids is None:
                rows = database.fetch_all(conn, "SELECT id, code, name, legacy_source_code, city, is_active FROM branches ORDER BY id ASC")
            else:
                ph = ",".join("?" for _ in branch_ids)
                rows = database.fetch_all(
                    conn,
                    f"SELECT id, code, name, legacy_source_code, city, is_active FROM branches WHERE id IN ({ph}) ORDER BY id ASC",
                    branch_ids,
                )
        return {"branches": rows}

    @app.get("/api/bank-accounts")
    def get_bank_accounts(request: Request):
        auth = _auth(request)
        require_roles(auth, ["owner", "admin", "accountant"])
        with database.connection() as conn:
            rows = database.fetch_all(
                conn,
                "SELECT id, account_name, bank_name, account_type, branch_id, is_active FROM bank_accounts WHERE is_active = 1 ORDER BY id ASC",
            )
        return {"bank_accounts": rows}

    @app.post("/api/admin/users", status_code=201)
    def create_user(payload: CreateUserPayload, request: Request):
        auth = _auth(request, enforce_csrf=True)
        require_roles(auth, ["owner"])
        if payload.role_code not in ALL_ROLES:
            raise HTTPException(status_code=400, detail=f"Invalid role_code '{payload.role_code}'")
        pw_hash = hash_password(payload.password)
        with database.connection() as conn:
            existing = database.fetch_one(conn, "SELECT id FROM users WHERE LOWER(username) = LOWER(?)", (payload.username.strip(),))
            if existing:
                raise HTTPException(status_code=409, detail="Username already exists")
            uid = database.insert_returning_id(
                conn,
                """
                INSERT INTO users (username, email, full_name, password_hash, role_code, primary_branch_id)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    payload.username.strip(),
                    payload.email,
                    payload.full_name.strip(),
                    pw_hash,
                    payload.role_code,
                    payload.primary_branch_id,
                ),
            )
            for bid in set(payload.branch_ids + ([payload.primary_branch_id] if payload.primary_branch_id else [])):
                database.execute(
                    conn,
                    "INSERT INTO user_branch_access (user_id, branch_id) VALUES (?, ?)",
                    (uid, bid),
                )
            write_audit_log(
                database,
                conn,
                actor_user_id=auth.user_id,
                actor_role=auth.role_code,
                action="create_user",
                entity_type="user",
                entity_id=str(uid),
                ip_address=_client_ip(request),
                after_state={"username": payload.username, "role_code": payload.role_code},
            )
        return {"id": uid, "username": payload.username, "role_code": payload.role_code}

    # ------------------------------------------------------------------
    # Sales Dashboard & Analytics
    # ------------------------------------------------------------------
    @app.get("/api/sales/dashboard")
    def sales_dashboard(
        request: Request,
        branch_id: Optional[int] = Query(default=None),
        start_date: Optional[str] = Query(default=None),
        end_date: Optional[str] = Query(default=None),
        reference_date: Optional[str] = Query(default=None),
    ):
        auth = _auth(request)
        allowed = resolve_branch_filter(auth, branch_id)
        return get_sales_dashboard(
            database,
            branch_ids=allowed,
            start_date=parse_bill_date(start_date) if start_date else None,
            end_date=parse_bill_date(end_date) if end_date else None,
            reference_date=parse_bill_date(reference_date) if reference_date else None,
        )

    # ------------------------------------------------------------------
    # Invoices, Split Settlements & Reversals
    # ------------------------------------------------------------------
    @app.get("/api/invoices")
    def api_list_invoices(
        request: Request,
        branch_id: Optional[int] = Query(default=None),
        search: Optional[str] = Query(default=None),
        start_date: Optional[str] = Query(default=None),
        end_date: Optional[str] = Query(default=None),
        staff: Optional[str] = Query(default=None),
        payment_status: Optional[str] = Query(default=None),
        page: int = Query(default=1, ge=1),
        page_size: int = Query(default=25, ge=1, le=100),
    ):
        auth = _auth(request)
        allowed = resolve_branch_filter(auth, branch_id)
        return list_invoices(
            database,
            branch_ids=allowed,
            search=search,
            start_date=start_date,
            end_date=end_date,
            staff=staff,
            payment_status=payment_status,
            page=page,
            page_size=page_size,
        )

    @app.get("/api/invoices/{invoice_id}")
    def api_invoice_detail(invoice_id: int, request: Request):
        auth = _auth(request)
        allowed = resolve_branch_filter(auth, None)
        return get_invoice_detail(database, invoice_id, allowed)

    @app.post("/api/invoices/{invoice_id}/settlements", status_code=201)
    def api_record_settlements(invoice_id: int, payload: RecordSettlementsPayload, request: Request):
        auth = _auth(request, enforce_csrf=True)
        require_roles(auth, ["owner", "admin", "accountant"])
        return record_settlements(
            database,
            auth=auth,
            invoice_id=invoice_id,
            entries=[e.model_dump() if hasattr(e, 'model_dump') else e.dict() for e in payload.entries],
            allow_overpayment=payload.allow_overpayment,
            ip_address=_client_ip(request),
        )

    @app.post("/api/settlements/{settlement_id}/reverse")
    def api_reverse_settlement(settlement_id: int, payload: ReverseSettlementPayload, request: Request):
        auth = _auth(request, enforce_csrf=True)
        require_roles(auth, ["owner", "accountant"])
        return reverse_settlement(
            database,
            auth=auth,
            settlement_id=settlement_id,
            reason=payload.reason,
            ip_address=_client_ip(request),
        )

    # ------------------------------------------------------------------
    # Customer Receivables
    # ------------------------------------------------------------------
    @app.get("/api/receivables")
    def api_receivables(
        request: Request,
        branch_id: Optional[int] = Query(default=None),
        as_of_date: Optional[str] = Query(default=None),
    ):
        auth = _auth(request)
        require_roles(auth, ["owner", "admin", "accountant"])
        allowed = resolve_branch_filter(auth, branch_id)
        return get_receivables_report(
            database,
            branch_ids=allowed,
            as_of_date=parse_bill_date(as_of_date) if as_of_date else None,
        )

    # ------------------------------------------------------------------
    # Google Sheets Synchronization & Reconciliation Exceptions
    # ------------------------------------------------------------------
    @app.post("/api/sync/trigger")
    def api_trigger_sync(payload: SyncTriggerPayload, request: Request):
        auth = _auth(request, enforce_csrf=True)
        require_roles(auth, ["owner", "admin", "accountant"])
        try:
            res = run_sheets_sync(
                database,
                cfg,
                trigger_type="manual",
                triggered_by=auth.user_id,
                source_key=payload.source_key,
            )
            return res.__dict__
        except SyncLockError as exc:
            raise HTTPException(status_code=409, detail=str(exc))
        except Exception as exc:
            raise HTTPException(status_code=502, detail=str(exc))

    @app.get("/api/sync/status")
    def api_sync_status(request: Request):
        auth = _auth(request)
        with database.connection() as conn:
            runs = database.fetch_all(
                conn,
                """
                SELECT id, source_key, trigger_type, status, rows_scanned, rows_inserted,
                       rows_unchanged, edits_detected, deletes_detected, discount_diffs,
                       error_message, started_at, finished_at
                FROM sync_runs
                ORDER BY id DESC
                LIMIT 15
                """,
            )
            last_ok = database.fetch_one(
                conn,
                "SELECT id, finished_at, rows_inserted FROM sync_runs WHERE status = 'succeeded' ORDER BY id DESC LIMIT 1",
            )
        return {"last_successful_sync": last_ok, "recent_runs": runs}

    @app.get("/api/sync/exceptions")
    def api_sync_exceptions(
        request: Request,
        status_filter: str = Query(default="open"),
        branch_id: Optional[int] = Query(default=None),
    ):
        auth = _auth(request)
        require_roles(auth, ["owner", "accountant"])
        allowed = resolve_branch_filter(auth, branch_id)
        clauses = ["se.resolution_status = ?"]
        params: List[Any] = [status_filter]
        if allowed is not None:
            ph = ",".join("?" for _ in allowed)
            clauses.append(f"se.branch_id IN ({ph})")
            params.extend(allowed)
        with database.connection() as conn:
            rows = database.fetch_all(
                conn,
                f"""
                SELECT se.id, se.sync_run_id, se.source_line_id, b.name AS branch_name,
                       se.invoice_no, se.exception_type, se.variance_amount,
                       se.resolution_status, se.created_at, se.existing_snapshot, se.incoming_snapshot
                FROM sync_exceptions se
                JOIN branches b ON b.id = se.branch_id
                WHERE {' AND '.join(clauses)}
                ORDER BY se.id DESC
                LIMIT 200
                """,
                params,
            )
        return {"exceptions": rows}

    # ------------------------------------------------------------------
    # Accountant / Owner Excel Exports
    # ------------------------------------------------------------------
    @app.get("/api/exports/receivables.xlsx")
    def export_receivables_xlsx(request: Request, branch_id: Optional[int] = Query(default=None)):
        auth = _auth(request)
        require_roles(auth, ["owner", "accountant"])
        allowed = resolve_branch_filter(auth, branch_id)
        report = get_receivables_report(database, branch_ids=allowed)
        headers = [
            "Invoice UID", "Branch", "Invoice No", "Bill Date (IST)", "Customer",
            "Phone", "Bill Amount (INR)", "Paid (INR)", "Outstanding (INR)", "Age (Days)", "Bucket",
        ]
        rows = [
            [
                it["invoice_uid"], it["branch_name"], it["invoice_no"], it["bill_date_ist"],
                it["customer_name"] or "", it["customer_phone"] or "",
                float(it["final_amount"]), float(it["paid_amount"]), float(it["outstanding_amount"]),
                it["age_days"], it["ageing_bucket"],
            ]
            for it in report["items"]
        ]
        content = build_excel_bytes("Receivables Ageing", headers, rows)
        return StreamingResponse(
            iter([content]),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": 'attachment; filename="kailash_receivables.xlsx"'},
        )

    @app.get("/api/exports/exceptions.xlsx")
    def export_exceptions_xlsx(request: Request):
        auth = _auth(request)
        require_roles(auth, ["owner", "accountant"])
        with database.connection() as conn:
            rows_db = database.fetch_all(
                conn,
                """
                SELECT se.id, b.name AS branch_name, se.invoice_no, se.exception_type,
                       se.variance_amount, se.resolution_status, se.created_at
                FROM sync_exceptions se
                JOIN branches b ON b.id = se.branch_id
                ORDER BY se.id DESC
                """,
            )
        headers = ["Exception ID", "Branch", "Invoice No", "Type", "Variance (INR)", "Status", "Detected At"]
        rows = [
            [r["id"], r["branch_name"], r["invoice_no"], r["exception_type"], float(r["variance_amount"] or 0), r["resolution_status"], r["created_at"]]
            for r in rows_db
        ]
        content = build_excel_bytes("Reconciliation Exceptions", headers, rows)
        return StreamingResponse(
            iter([content]),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": 'attachment; filename="kailash_reconciliation_exceptions.xlsx"'},
        )

    return app


app = create_app()
