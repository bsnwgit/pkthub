from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Request, Response
from fastapi.responses import RedirectResponse
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
import aiosqlite
import logging

from app.config import get_settings
from app.database import get_db
from app.models import LoginRequest, TokenResponse, TokenData, UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")
_log = logging.getLogger(__name__)

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    settings = get_settings()
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=settings.jwt_expire_minutes))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.jwt_secret, algorithm=settings.jwt_algorithm)

async def get_current_user(token: str = Depends(oauth2_scheme), db: aiosqlite.Connection = Depends(get_db)) -> dict:
    settings = get_settings()
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    async with db.execute("SELECT * FROM users WHERE username = ? AND is_active = 1", (username,)) as cur:
        row = await cur.fetchone()
    if row is None:
        raise credentials_exception
    return dict(row)

def require_role(*roles):
    async def check(current_user: dict = Depends(get_current_user)):
        if current_user["role"] not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return current_user
    return check

require_admin = require_role("admin")
require_analyst_or_admin = require_role("admin", "analyst")

@router.post("/login", response_model=TokenResponse)
async def login(request: LoginRequest, db: aiosqlite.Connection = Depends(get_db)):
    async with db.execute("SELECT * FROM users WHERE username = ? AND is_active = 1", (request.username,)) as cur:
        user = await cur.fetchone()

    if not user or not verify_password(request.password, user["hashed_password"]):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    token = create_access_token({"sub": user["username"], "role": user["role"], "uid": user["id"]})
    await db.execute("UPDATE users SET last_login = datetime('now') WHERE id = ?", (user["id"],))
    await db.commit()

    return TokenResponse(access_token=token, role=user["role"], username=user["username"])

@router.get("/me", response_model=UserOut)
async def get_me(current_user: dict = Depends(get_current_user)):
    return UserOut(
        id=current_user["id"],
        username=current_user["username"],
        email=current_user["email"],
        role=current_user["role"],
        is_active=bool(current_user["is_active"]),
        created_at=current_user["created_at"],
        last_login=current_user.get("last_login"),
    )

@router.post("/logout")
async def logout():
    return {"message": "Logged out"}

@router.get("/config")
async def auth_config(db: aiosqlite.Connection = Depends(get_db)):
    """Public endpoint — tells the login page which auth methods are enabled."""
    async with db.execute("SELECT value FROM platform_config WHERE key = 'okta_saml_enabled'") as cur:
        row = await cur.fetchone()
    saml_enabled = bool(row and row["value"] == "true")

    async with db.execute("SELECT value FROM platform_config WHERE key = 'auth_local_enabled'") as cur:
        row = await cur.fetchone()
    local_enabled = not row or row["value"] != "false"

    return {"saml_enabled": saml_enabled, "local_enabled": local_enabled}


# ── SAML helpers ──────────────────────────────────────────────────────────────

async def _load_saml_cfg(db: aiosqlite.Connection) -> Optional[dict]:
    """Load SAML config from platform_config. Returns dict or None if disabled/incomplete."""
    keys = (
        "okta_saml_enabled", "okta_saml_idp_entity_id", "okta_saml_idp_sso_url",
        "okta_saml_idp_cert", "okta_saml_sp_entity_id", "okta_saml_sp_cert", "okta_saml_sp_key",
        "base_url",
    )
    placeholders = ",".join(["?"] * len(keys))
    async with db.execute(
        f"SELECT key, value FROM platform_config WHERE key IN ({placeholders})", keys
    ) as cur:
        rows = await cur.fetchall()
    kv = {r["key"]: (r["value"] or "").strip() for r in rows}

    if kv.get("okta_saml_enabled") != "true":
        return None

    idp_entity_id = kv.get("okta_saml_idp_entity_id", "")
    idp_sso_url   = kv.get("okta_saml_idp_sso_url", "")
    idp_cert      = kv.get("okta_saml_idp_cert", "")

    if not all([idp_entity_id, idp_sso_url, idp_cert]):
        return None

    base_url     = kv.get("base_url", "").rstrip("/") or "https://172.23.80.5:8760"
    sp_entity_id = kv.get("okta_saml_sp_entity_id") or f"{base_url}/api/auth/saml/metadata"
    acs_url      = f"{base_url}/api/auth/saml/callback"

    return {
        "base_url":      base_url,
        "sp_entity_id":  sp_entity_id,
        "acs_url":       acs_url,
        "idp_entity_id": idp_entity_id,
        "idp_sso_url":   idp_sso_url,
        "idp_cert":      idp_cert,
        "sp_cert":       kv.get("okta_saml_sp_cert", ""),
        "sp_key":        kv.get("okta_saml_sp_key", ""),
    }


def _build_saml_settings(cfg: dict) -> dict:
    sp: dict = {
        "entityId": cfg["sp_entity_id"],
        "assertionConsumerService": {
            "url": cfg["acs_url"],
            "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
        },
        "NameIDFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    }
    if cfg.get("sp_cert") and cfg.get("sp_key"):
        sp["x509cert"] = cfg["sp_cert"]
        sp["privateKey"] = cfg["sp_key"]

    return {
        "strict": True,
        "debug": False,
        "sp": sp,
        "idp": {
            "entityId": cfg["idp_entity_id"],
            "singleSignOnService": {
                "url": cfg["idp_sso_url"],
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
            },
            "x509cert": cfg["idp_cert"],
        },
        "security": {
            "authnRequestsSigned":    bool(cfg.get("sp_cert")),
            "wantAssertionsSigned":   True,
            "wantMessagesSigned":     False,
            "wantNameId":             True,
            "wantAttributeStatement": False,
            "requestedAuthnContext":  False,
            "signatureAlgorithm":     "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
            "digestAlgorithm":        "http://www.w3.org/2001/04/xmlenc#sha256",
        },
    }


async def _prepare_saml_request(request: Request) -> dict:
    from urllib.parse import urlparse
    body = {}
    if request.method == "POST":
        form = await request.form()
        body = dict(form)
    parsed = urlparse(str(request.url))
    return {
        "https":       "on" if parsed.scheme == "https" else "off",
        "http_host":   request.headers.get("host", parsed.netloc),
        "server_port": str(parsed.port or (443 if parsed.scheme == "https" else 80)),
        "script_name": parsed.path,
        "get_data":    dict(request.query_params),
        "post_data":   body,
    }


# ── SAML endpoints ────────────────────────────────────────────────────────────

@router.get("/saml/metadata")
async def saml_metadata(db: aiosqlite.Connection = Depends(get_db)):
    """SP metadata XML for Okta app registration."""
    cfg = await _load_saml_cfg(db)
    if not cfg:
        raise HTTPException(status_code=503, detail="SAML SSO is not configured")
    try:
        from onelogin.saml2.settings import OneLogin_Saml2_Settings
        settings_obj = OneLogin_Saml2_Settings(settings=_build_saml_settings(cfg), sp_validation_only=True)
        xml = settings_obj.get_sp_metadata()
        return Response(content=xml, media_type="application/xml")
    except Exception as exc:
        _log.error("SAML metadata error: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/saml/login")
async def saml_login(request: Request, db: aiosqlite.Connection = Depends(get_db)):
    """Initiate SP-initiated SAML flow — redirect to Okta SSO URL."""
    cfg = await _load_saml_cfg(db)
    if not cfg:
        return RedirectResponse(url="/login?sso_error=saml_disabled", status_code=302)
    try:
        from onelogin.saml2.auth import OneLogin_Saml2_Auth
        req = await _prepare_saml_request(request)
        auth = OneLogin_Saml2_Auth(req, _build_saml_settings(cfg))
        redirect_url = auth.login()
        return RedirectResponse(url=redirect_url, status_code=302)
    except Exception as exc:
        _log.error("SAML login init error: %s", exc, exc_info=True)
        return RedirectResponse(url="/login?sso_error=saml_init_failed", status_code=302)


@router.post("/saml/callback")
async def saml_callback(request: Request, db: aiosqlite.Connection = Depends(get_db)):
    """ACS endpoint — Okta POSTs SAMLResponse here after authentication."""
    cfg = await _load_saml_cfg(db)
    if not cfg:
        return RedirectResponse(url="/login?sso_error=saml_disabled", status_code=303)

    try:
        from onelogin.saml2.auth import OneLogin_Saml2_Auth
        req = await _prepare_saml_request(request)
        auth = OneLogin_Saml2_Auth(req, _build_saml_settings(cfg))
        auth.process_response()
    except Exception as exc:
        _log.error("SAML process_response error: %s", exc, exc_info=True)
        return RedirectResponse(url="/login?sso_error=saml_processing_failed", status_code=303)

    errors = auth.get_errors()
    if errors:
        reason = auth.get_last_error_reason() or ""
        _log.error("SAML validation errors: %s | %s", errors, reason)
        return RedirectResponse(url="/login?sso_error=saml_invalid_response", status_code=303)

    if not auth.is_authenticated():
        return RedirectResponse(url="/login?sso_error=not_authenticated", status_code=303)

    email = auth.get_nameid()
    if not email:
        return RedirectResponse(url="/login?sso_error=missing_claims", status_code=303)

    _log.info("SAML callback: authenticated email=%s", email)

    # Find or auto-provision user by email
    async with db.execute("SELECT * FROM users WHERE email = ?", (email,)) as cur:
        user = await cur.fetchone()

    # Read role from Okta SAML attributes — Okta sends the 'role' attribute per app user config
    _VALID_ROLES = {"admin", "analyst", "viewer"}
    attrs = auth.get_attributes()
    raw_role = (attrs.get("role") or attrs.get("Role") or attrs.get("userRole") or [None])[0]
    okta_role = raw_role.strip().lower() if raw_role else "viewer"
    if okta_role not in _VALID_ROLES:
        okta_role = "viewer"

    if not user:
        import secrets as _secrets
        username = email.split("@")[0]
        async with db.execute("SELECT id FROM users WHERE username = ?", (username,)) as cur:
            if await cur.fetchone():
                username = f"{username}_{_secrets.token_hex(4)}"
        await db.execute(
            "INSERT INTO users (username, email, hashed_password, role, is_active) VALUES (?, ?, NULL, ?, 1)",
            (username, email, okta_role),
        )
        await db.commit()
        async with db.execute("SELECT * FROM users WHERE email = ?", (email,)) as cur:
            user = await cur.fetchone()

    if not user or not user["is_active"]:
        return RedirectResponse(url="/login?sso_error=user_inactive", status_code=303)

    # Always sync role from Okta on every login
    await db.execute(
        "UPDATE users SET role = ?, last_login = datetime('now') WHERE id = ?",
        (okta_role, user["id"]),
    )
    await db.commit()

    token = create_access_token({"sub": user["username"], "role": okta_role, "uid": user["id"]})
    _log.info("SAML callback: issued token for user=%s role=%s", user["username"], okta_role)

    # Deliver token via intermediate HTML page — avoids cross-site cookie restrictions
    # The page writes to localStorage directly and redirects, no cookies needed.
    import html as _html
    token_safe    = _html.escape(token, quote=True)
    role_safe     = _html.escape(okta_role, quote=True)
    username_safe = _html.escape(user["username"], quote=True)

    html_body = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Signing in…</title></head>
<body>
<script>
try {{
  localStorage.setItem('pkthub_token', {repr(token)});
  localStorage.setItem('pkthub_role', {repr(okta_role)});
  localStorage.setItem('pkthub_username', {repr(user["username"])});
  window.location.replace('/');
}} catch(e) {{
  window.location.replace('/login?sso_error=storage_error');
}}
</script>
<p>Signing in, please wait…</p>
</body>
</html>"""

    return Response(content=html_body, media_type="text/html")



@router.post("/proxy-session/{app_id}")
async def create_proxy_session(
    app_id: int,
    response: Response,
    current_user: dict = Depends(get_current_user),
):
    """Create a scoped proxy session cookie so the iframe can authenticate with the proxy."""
    settings = get_settings()

    # Short-lived token scoped to this specific app's proxy
    token = create_access_token(
        {"sub": current_user["username"], "role": current_user["role"], "scope": f"proxy:{app_id}"},
        expires_delta=timedelta(hours=8),
    )

    response.set_cookie(
        key=f"pkthub_proxy_{app_id}",
        value=token,
        httponly=True,
        secure=True,
        samesite="lax",
        path=f"/proxy/{app_id}/",
        max_age=28800,  # 8 hours
    )
    return {"ok": True}

async def ensure_initial_admin(db: aiosqlite.Connection):
    """Create default admin user on first boot if no users exist."""
    settings = get_settings()
    async with db.execute("SELECT COUNT(*) as count FROM users") as cur:
        row = await cur.fetchone()
    if row["count"] == 0:
        hashed = hash_password(settings.initial_admin_password)
        await db.execute(
            "INSERT INTO users (username, email, hashed_password, role) VALUES (?, ?, ?, 'admin')",
            (settings.initial_admin_username, settings.initial_admin_email, hashed)
        )
        await db.commit()
