"""Security utilities: scrypt password hashing, HttpOnly sessions, CSRF, rate limiting, RBAC & audit logs."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence

from fastapi import HTTPException, Request, status

from app.config import Settings
from app.db import Database


SESSION_COOKIE_NAME = "kk_session"
CSRF_HEADER_NAME = "X-CSRF-Token"

ALL_ROLES = {"owner", "admin", "sales_staff", "accountant"}


@dataclass
class AuthContext:
    user_id: int
    username: str
    full_name: str
    role_code: str
    primary_branch_id: Optional[int]
    allowed_branch_ids: List[int]  # Empty list for owner/accountant means ALL branches
    all_branches: bool
    session_id: int
    csrf_token: str


def hash_password(password: str) -> str:
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters long")
    salt = secrets.token_bytes(16)
    n, r, p = 2**14, 8, 1
    derived = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=32)
    return "scrypt${}${}${}${}${}".format(
        n,
        r,
        p,
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(derived).decode("ascii"),
    )


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        scheme, n_s, r_s, p_s, salt_b64, dk_b64 = stored_hash.split("$")
        if scheme != "scrypt":
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(dk_b64)
        derived = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=int(n_s),
            r=int(r_s),
            p=int(p_s),
            dklen=len(expected),
        )
        return hmac.compare_digest(derived, expected)
    except Exception:
        return False


def hash_token(raw_token: str, secret_key: str) -> str:
    return hmac.new(secret_key.encode("utf-8"), raw_token.encode("utf-8"), hashlib.sha256).hexdigest()


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(ts: Any) -> datetime:
    if isinstance(ts, datetime):
        return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    s = str(ts).replace("Z", "+00:00")
    dt = datetime.fromisoformat(s)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def check_login_rate_limit(db: Database, settings: Settings, identifier: str, ip_address: str) -> None:
    cutoff = (_now_utc() - timedelta(minutes=settings.login_window_minutes)).isoformat()
    with db.connection() as conn:
        row = db.fetch_one(
            conn,
            """
            SELECT COUNT(*) AS cnt
            FROM login_attempts
            WHERE identifier = ? AND ip_address = ? AND succeeded = FALSE AND attempted_at >= ?
            """,
            (identifier.lower(), ip_address, cutoff),
        )
        count = int(row["cnt"]) if row else 0
    if count >= settings.login_max_attempts:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many failed login attempts. Try again after {settings.login_window_minutes} minutes.",
        )


def record_login_attempt(db: Database, identifier: str, ip_address: str, succeeded: bool) -> None:
    with db.connection() as conn:
        db.execute(
            conn,
            """
            INSERT INTO login_attempts (identifier, ip_address, succeeded, attempted_at)
            VALUES (?, ?, ?, ?)
            """,
            (identifier.lower(), ip_address, bool(succeeded), _now_utc().isoformat()),
        )


def create_session(
    db: Database,
    settings: Settings,
    user_id: int,
    ip_address: str,
    user_agent: str,
) -> tuple[str, str, datetime]:
    raw_token = secrets.token_urlsafe(32)
    csrf_token = secrets.token_urlsafe(24)
    token_digest = hash_token(raw_token, settings.secret_key)
    expires_at = _now_utc() + timedelta(hours=settings.session_ttl_hours)

    with db.connection() as conn:
        db.execute(
            conn,
            """
            INSERT INTO user_sessions (session_hash, csrf_token, user_id, ip_address, user_agent, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (token_digest, csrf_token, user_id, ip_address, user_agent[:250], expires_at.isoformat(), _now_utc().isoformat()),
        )
        db.execute(
            conn,
            "UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?",
            (_now_utc().isoformat(), _now_utc().isoformat(), user_id),
        )
    return raw_token, csrf_token, expires_at


def revoke_session(db: Database, settings: Settings, raw_token: str) -> None:
    token_digest = hash_token(raw_token, settings.secret_key)
    with db.connection() as conn:
        db.execute(
            conn,
            "UPDATE user_sessions SET revoked_at = ? WHERE session_hash = ? AND revoked_at IS NULL",
            (_now_utc().isoformat(), token_digest),
        )


def authenticate_request(request: Request, db: Database, settings: Settings) -> AuthContext:
    raw_token = request.cookies.get(SESSION_COOKIE_NAME)
    if not raw_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    token_digest = hash_token(raw_token, settings.secret_key)
    with db.connection() as conn:
        row = db.fetch_one(
            conn,
            """
            SELECT s.id AS session_id, s.csrf_token, s.expires_at, s.revoked_at,
                   u.id AS user_id, u.username, u.full_name, u.role_code,
                   u.primary_branch_id, u.is_active
            FROM user_sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.session_hash = ?
            """,
            (token_digest,),
        )
        if not row or row["revoked_at"] is not None or not row["is_active"]:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session invalid or revoked")

        if _parse_iso(row["expires_at"]) <= _now_utc():
            db.execute(
                conn,
                "UPDATE user_sessions SET revoked_at = ? WHERE id = ?",
                (_now_utc().isoformat(), row["session_id"]),
            )
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")

        role_code = row["role_code"]
        all_branches = role_code in {"owner", "accountant"}
        allowed_branch_ids: List[int] = []
        if not all_branches:
            access_rows = db.fetch_all(
                conn,
                "SELECT branch_id FROM user_branch_access WHERE user_id = ?",
                (row["user_id"],),
            )
            allowed_branch_ids = [int(r["branch_id"]) for r in access_rows]
            if row["primary_branch_id"] and int(row["primary_branch_id"]) not in allowed_branch_ids:
                allowed_branch_ids.append(int(row["primary_branch_id"]))

    return AuthContext(
        user_id=int(row["user_id"]),
        username=str(row["username"]),
        full_name=str(row["full_name"]),
        role_code=role_code,
        primary_branch_id=int(row["primary_branch_id"]) if row["primary_branch_id"] is not None else None,
        allowed_branch_ids=allowed_branch_ids,
        all_branches=all_branches,
        session_id=int(row["session_id"]),
        csrf_token=str(row["csrf_token"]),
    )


def verify_csrf(request: Request, auth: AuthContext) -> None:
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    header_token = request.headers.get(CSRF_HEADER_NAME, "")
    if not header_token or not hmac.compare_digest(header_token, auth.csrf_token):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid or missing CSRF token")


def require_roles(auth: AuthContext, allowed_roles: Sequence[str]) -> None:
    if auth.role_code not in allowed_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Role '{auth.role_code}' is not authorized for this action",
        )


def resolve_branch_filter(auth: AuthContext, requested_branch_id: Optional[int]) -> Optional[List[int]]:
    """Return None if unrestricted, or a list of permitted branch IDs; raise 403 on unauthorized branch."""
    if auth.all_branches:
        return [requested_branch_id] if requested_branch_id is not None else None

    if not auth.allowed_branch_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No branch access configured for this user")

    if requested_branch_id is not None:
        if requested_branch_id not in auth.allowed_branch_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied for the requested branch",
            )
        return [requested_branch_id]
    return list(auth.allowed_branch_ids)


def write_audit_log(
    db: Database,
    conn: Any,
    actor_user_id: Optional[int],
    actor_role: Optional[str],
    action: str,
    entity_type: str,
    entity_id: Optional[str],
    branch_id: Optional[int] = None,
    ip_address: Optional[str] = None,
    before_state: Optional[Dict[str, Any]] = None,
    after_state: Optional[Dict[str, Any]] = None,
) -> None:
    db.execute(
        conn,
        """
        INSERT INTO audit_logs (
            actor_user_id, actor_role, action, entity_type, entity_id,
            branch_id, ip_address, before_state, after_state, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            actor_user_id,
            actor_role,
            action,
            entity_type,
            entity_id,
            branch_id,
            ip_address,
            json.dumps(before_state, default=str) if before_state is not None else None,
            json.dumps(after_state, default=str) if after_state is not None else None,
            _now_utc().isoformat(),
        ),
    )


def create_password_reset_token(db: Database, settings: Settings, user_id: int, ttl_minutes: int = 30) -> str:
    raw_token = secrets.token_urlsafe(32)
    token_digest = hash_token(raw_token, settings.secret_key)
    expires_at = (_now_utc() + timedelta(minutes=ttl_minutes)).isoformat()
    with db.connection() as conn:
        db.execute(
            conn,
            """
            INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (user_id, token_digest, expires_at, _now_utc().isoformat()),
        )
    return raw_token


def consume_password_reset_token(db: Database, settings: Settings, raw_token: str, new_password: str) -> int:
    token_digest = hash_token(raw_token, settings.secret_key)
    new_hash = hash_password(new_password)
    now = _now_utc()
    with db.connection() as conn:
        row = db.fetch_one(
            conn,
            "SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ?",
            (token_digest,),
        )
        if not row or row["used_at"] is not None or _parse_iso(row["expires_at"]) <= now:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset token")
        user_id = int(row["user_id"])
        db.execute(
            conn,
            "UPDATE users SET password_hash = ?, must_reset_password = FALSE, updated_at = ? WHERE id = ?",
            (new_hash, now.isoformat(), user_id),
        )
        db.execute(
            conn,
            "UPDATE password_reset_tokens SET used_at = ? WHERE id = ?",
            (now.isoformat(), row["id"]),
        )
        db.execute(
            conn,
            "UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
            (now.isoformat(), user_id),
        )
    return user_id
