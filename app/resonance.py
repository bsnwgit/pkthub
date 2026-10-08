"""
pktHub — resonance embed integration.

Routes (prefix /api/resonance):
  GET  /config   mount configuration for the SPA; also mints the embed cookie
  GET  /code     single-use embed code, called by embed.js itself
  POST /report   a browser reporting that the widget never loaded
  POST /test     admin: prove the configuration end to end
  GET  /status   admin: breaker state, recent load failures, detected origin

Two things differ from the sibling copies, both because pktHub's own auth
differs — see app/integrations/resonance/ for the parts that do not differ.

  1. THE EMBED COOKIE. embed.js fetches /code itself, as a plain browser
     request with no Authorization header, so that route can only be
     authenticated by a cookie. The siblings have a refresh_token cookie to
     lean on; pktHub sets no cookie at login at all — its session is a bearer
     token the SPA holds in memory, which embed.js cannot send.

     So /config mints one. It is already the first authenticated call the
     mount makes, before the script tag exists, so by the time embed.js asks
     for a code the cookie is there. A GET with a side effect is worth the
     note, but the alternative was diverging the vendored mount.

     The cookie is deliberately narrow, and modelled on the proxy session in
     app/auth.py rather than invented: HttpOnly, SameSite=Lax, scoped by path
     to /api/resonance/ so it is never sent anywhere else, and carrying a JWT
     whose scope claim this module checks. It grants one thing — the right to
     ask for an embed code as the user it was minted for.

  2. NO /docs CORPUS ROUTE. The siblings publish their guides for the
     assistant's knowledge, authenticated by the suite token they each hold.
     pktHub holds a token for every registered app but has none of its own, so
     that route has no equivalent gate here and is left out.
"""
from __future__ import annotations

import json
import logging
from datetime import timedelta
from urllib.parse import urlsplit

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from jose import JWTError, jwt
from pydantic import BaseModel

from app.auth import create_access_token, get_current_user, require_admin
from app.config import get_settings
from app.crypto import decrypt_str
from app.database import get_db
from app.integrations.resonance import (
    DEFAULT_EXCLUDE_PATHS,
    DEFAULT_ROLE_LEVELS,
    RESONANCE_MODULE_VERSION,
)
from app.integrations.resonance import limiter, reports
from app.integrations.resonance.client import ResonanceClient, build_user_id
from app.integrations.resonance.errors import (
    ResonanceBreakerOpen,
    ResonanceError,
    ResonanceNotConfigured,
    ResonanceRateLimited,
)

log = logging.getLogger("pkthub.resonance")

router = APIRouter(prefix="/api/resonance", tags=["resonance"])

# ── The embed cookie ──────────────────────────────────────────────────────────
COOKIE_NAME = "pkthub_resonance"
COOKIE_PATH = "/api/resonance/"
COOKIE_SCOPE = "resonance"
COOKIE_HOURS = 8

# Reporting is browser-driven, so it gets its own cheap ceiling. A page that
# fails to load can only say so a handful of times before it stops being news.
REPORT_LIMIT = 5
REPORT_WINDOW_SECONDS = 3600

# Admin-driven, so this only has to stop a runaway UI, not a person.
TEST_LIMIT = 10
TEST_WINDOW_SECONDS = 600

_MASK = "••••••••"


# ── Settings access ───────────────────────────────────────────────────────────
#
# pktHub keeps runtime settings in platform_config as plain strings, so a value
# that is really a list or a dict was JSON-encoded on the way in. Decode
# opportunistically and fall back to the raw string.

async def _get(db: aiosqlite.Connection, key: str, default=None):
    async with db.execute("SELECT value FROM platform_config WHERE key = ?", (key,)) as cur:
        row = await cur.fetchone()
    if not row or row[0] is None:
        return default
    raw = row[0]
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError, ValueError):
        return raw


async def _read_key(db: aiosqlite.Connection) -> str:
    """The embed key, decrypted. Stored encrypted at rest like every other
    secret in platform_config — see _ENCRYPTED_AT_REST_KEYS in settings_api."""
    async with db.execute(
        "SELECT value FROM platform_config WHERE key = 'resonance_key'"
    ) as cur:
        row = await cur.fetchone()
    if not row or not row[0]:
        return ""
    return decrypt_str(row[0]) or ""


async def _embed_config(db: aiosqlite.Connection) -> dict:
    """Everything the SPA needs to mount, and nothing that identifies us to resonance."""
    excluded = await _get(db, "resonance_exclude_paths", None)
    if not isinstance(excluded, list):
        excluded = list(DEFAULT_EXCLUDE_PATHS)
    return {
        "base_url": (await _get(db, "resonance_base_url", "") or "").rstrip("/"),
        "style": await _get(db, "resonance_style", "bubble") or "bubble",
        "target": await _get(db, "resonance_target", "") or "",
        "label": await _get(db, "resonance_label", "") or "",
        "side": await _get(db, "resonance_side", "right") or "right",
        "width": await _get(db, "resonance_width", "") or "",
        "height": await _get(db, "resonance_height", "") or "",
        "open": _truthy(await _get(db, "resonance_open", False)),
        "exclude_paths": excluded,
    }


def _truthy(value) -> bool:
    """platform_config stores everything as text, so "false" arrives as a
    non-empty string and is true to Python. Read the text, not the object."""
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)


# What a role may do with the assistant. Ordered, so a comparison of rank is a
# comparison of permission: "write" implies "read", "none" implies nothing.
LEVEL_RANK = {"none": 0, "read": 1, "write": 2}


async def _role_levels(db: aiosqlite.Connection) -> dict[str, str]:
    """Level per role, falling back to the module default when unset, so a
    freshly enabled widget is not locked against every role at once."""
    stored = await _get(db, "resonance_role_levels", None)
    if not isinstance(stored, dict) or not stored:
        return dict(DEFAULT_ROLE_LEVELS)
    return {str(role): str(level) for role, level in stored.items()}


async def role_level(db: aiosqlite.Connection, role: str) -> str:
    """This role's assistant level, defaulting closed for anything unrecognised."""
    level = (await _role_levels(db)).get(role, "none")
    return level if level in LEVEL_RANK else "none"


async def _allowed_roles(db: aiosqlite.Connection) -> list[str]:
    """Roles that may open the assistant at all — level above "none"."""
    return [role for role, level in (await _role_levels(db)).items()
            if LEVEL_RANK.get(level, 0) > 0]


async def _client(
    db: aiosqlite.Connection, base_url: str = "", key: str = "", ca_bundle: str | None = None
) -> ResonanceClient:
    """Build a client from stored settings, or from values supplied for a test.

    ca_bundle is None when nothing was supplied and "" when the form supplied an
    empty one — the two must not collapse, or clearing the field could never be
    tested and would silently keep testing the stored path.
    """
    if not base_url:
        base_url = await _get(db, "resonance_base_url", "") or ""
    if not key:
        key = await _read_key(db)
    if ca_bundle is None:
        ca_bundle = await _get(db, "resonance_ca_bundle", "") or ""
    return ResonanceClient(base_url, key, ca_bundle=ca_bundle)


# ── Origin, for the admin panel ───────────────────────────────────────────────

def _detected_origin(request: Request) -> str:
    """Best guess at the address a browser used to reach pktHub.

    Only ever a suggestion, displayed for an admin to confirm or replace when
    registering pktHub with resonance — never trusted for a security decision.
    X-Forwarded-* is read because a guess that matches reality most of the time
    beats one that is reliably wrong behind a reverse proxy.
    """
    proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip()
    host = (request.headers.get("x-forwarded-host") or "").split(",")[0].strip()
    if not proto:
        proto = request.url.scheme
    if not host:
        host = request.headers.get("host", "")
    return f"{proto}://{host}" if host else ""


async def _effective_origin(db: aiosqlite.Connection, request: Request) -> str:
    """The configured origin if an admin set one, otherwise the detection."""
    override = (await _get(db, "resonance_origin", "") or "").strip().rstrip("/")
    return override or _detected_origin(request)


def _same_origin(request: Request) -> bool:
    """Reject anything presenting as cross-site before the embed cookie is used.

    SameSite=Lax already stops a hostile page's fetch from carrying it. This is
    the second lock, on the same reasoning the siblings use.
    """
    fetch_site = request.headers.get("sec-fetch-site", "")
    if fetch_site:
        # Browser-generated and not settable from page script, so where it
        # exists it is the whole answer. Every current browser sends it.
        return fetch_site in ("same-origin", "none")

    origin = request.headers.get("origin", "")
    if not origin:
        return True

    seen = urlsplit(origin).netloc
    candidates = {
        request.headers.get("host", ""),
        (request.headers.get("x-forwarded-host") or "").split(",")[0].strip(),
    }
    return seen in {c for c in candidates if c}


# ── Embed cookie ──────────────────────────────────────────────────────────────

def _issue_cookie(response: Response, request: Request, user: dict) -> None:
    """Mint the narrow cookie /code authenticates with.

    Modelled on create_proxy_session in app/auth.py, including why `secure` is
    computed rather than hardcoded: a Secure cookie is silently dropped over
    plain HTTP, which would present as the assistant never loading, with
    nothing in any log to say why.
    """
    token = create_access_token(
        {"sub": user["username"], "role": user.get("role", "viewer"), "scope": COOKIE_SCOPE},
        expires_delta=timedelta(hours=COOKIE_HOURS),
    )
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=(request.url.scheme == "https"),
        samesite="lax",
        path=COOKIE_PATH,
        max_age=COOKIE_HOURS * 3600,
    )


async def resonance_session_user(request: Request) -> dict:
    """Dependency for the data operations in app/resonance_data.py.

    Those calls are made by the browser on the person's behalf, so they arrive
    with the embed cookie and no Authorization header — get_current_user would
    refuse every one of them. The cookie is already path-scoped to
    /api/resonance/, which is exactly the namespace those routes live in.
    """
    user = _user_from_cookie(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def _user_from_cookie(request: Request) -> dict | None:
    """Identify the caller of /code. Returns None rather than raising, so the
    caller answers uniformly whatever the reason."""
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None
    if payload.get("scope") != COOKIE_SCOPE:
        return None
    username = payload.get("sub")
    if not username:
        return None
    return {"username": username, "role": payload.get("role", "viewer")}


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/config")
async def resonance_config(
    request: Request,
    response: Response,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Mount configuration for the SPA, plus the embed cookie.

    Answers {"enabled": false} for every reason the widget should not appear —
    switched off, unconfigured, or this user's role is not on the list — so the
    frontend has one thing to check and no way to infer whether a key exists
    from the shape of the response. The cookie is only minted when the answer
    is yes, so a user who may not use the assistant never holds one.
    """
    enabled = _truthy(await _get(db, "resonance_enabled", False))
    cfg = await _embed_config(db)
    if not enabled or not cfg["base_url"]:
        return {"enabled": False}

    if current_user.get("role") not in await _allowed_roles(db):
        return {"enabled": False}

    _issue_cookie(response, request, current_user)
    return {"enabled": True, **cfg}


@router.get("/code")
async def resonance_code(request: Request, db: aiosqlite.Connection = Depends(get_db)):
    """Mint a single-use embed code for the logged-in user. Called by embed.js."""
    if not _same_origin(request):
        raise HTTPException(status_code=403, detail="Cross-site request refused")

    user = _user_from_cookie(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    if not _truthy(await _get(db, "resonance_enabled", False)):
        raise HTTPException(status_code=404, detail="Resonance is not enabled")

    if user["role"] not in await _allowed_roles(db):
        raise HTTPException(status_code=403, detail="Not permitted to use resonance")

    try:
        await limiter.consume_for_user(db, user["username"])
        await limiter.assert_closed(db)
        client = await _client(db)
        body = await client.create_session(user["username"], [user["role"]])
    except ResonanceError as err:
        # Our own limiter and an open breaker are not resonance failures and
        # must not count towards opening it further.
        if isinstance(err, ResonanceRateLimited):
            return JSONResponse({"error": err.admin_message}, status_code=429)
        if isinstance(err, ResonanceBreakerOpen):
            return JSONResponse({"error": err.admin_message}, status_code=503)

        await limiter.record_failure(db, err)
        log.warning("resonance session failed for %s: %s", user["username"], err)
        return JSONResponse({"error": err.admin_message}, status_code=502)

    await limiter.record_success(db)
    # embed.js reads .code; expires_in is passed through so the mount can time
    # its own watchdog against the same session the frame is using.
    return {"code": body["code"], "expires_in": body.get("expires_in")}


class ReportBody(BaseModel):
    reason: str


@router.post("/report")
async def resonance_report(
    body: ReportBody,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """A browser reporting that the widget did not load. See reports.py for why."""
    try:
        await limiter.consume(
            db, f"r:{current_user['username']}", REPORT_LIMIT, REPORT_WINDOW_SECONDS
        )
    except ResonanceError:
        # Nothing to tell the browser: it cannot act on this, and the failure is
        # already recorded from an earlier report in the same window.
        return {"recorded": False}

    recorded = await reports.record(db, current_user["username"], body.reason)
    return {"recorded": recorded}


class TestBody(BaseModel):
    base_url: str | None = None
    key: str | None = None
    # Sent from the form like the other two, so Test proves what is on screen
    # rather than what was last saved. Testing an edited bundle against the
    # stored one is the trap this closes: the fix looks like it did not work.
    ca_bundle: str | None = None


@router.post("/test")
async def resonance_test(
    body: TestBody,
    request: Request,
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Prove the configuration end to end, whether or not the feature is enabled.

    Deliberately independent of resonance_enabled: an admin has to be able to
    test a key before turning it on, and to diagnose one after turning it off.
    On success it returns what the key actually grants, read back from
    resonance rather than retyped, so the panel can show that (for example) mic
    is off on this key instead of leaving the user wondering.
    """
    base_url = (body.base_url or "").strip()
    key = (body.key or "").strip()
    # The UI sends the mask back when the stored key was not retyped.
    if key == _MASK:
        key = ""

    client = await _client(db, base_url, key, body.ca_bundle)
    origin = await _effective_origin(db, request)

    if not client.configured:
        return {"ok": False, "error": ResonanceNotConfigured().admin_message, "origin": origin}

    # Capped though admin-only: resonance backs off per source IP after failed
    # key attempts, so a panel stuck retrying would dig the whole install into
    # that hole while the admin watched.
    try:
        await limiter.consume(db, f"t:{current_user['username']}", TEST_LIMIT, TEST_WINDOW_SECONDS)
    except ResonanceError as err:
        return {"ok": False, "error": err.admin_message, "origin": origin}

    try:
        result = await client.create_session(current_user["username"], [current_user["role"]])
    except ResonanceError as err:
        # A failed test must NOT open the breaker. The values under test are
        # often not the stored ones, and an admin trying a key that turns out to
        # be wrong would otherwise take down a working widget for everyone.
        return {"ok": False, "error": err.admin_message, "detail": err.detail, "origin": origin}

    # A successful test does clear it: fixing the key and pressing Test is the
    # intended way back from a breaker opened by the broken one.
    await limiter.record_success(db)
    return {
        "ok": True,
        "origin": origin,
        "detected_origin": _detected_origin(request),
        "user_id_sent": build_user_id(current_user["username"]),
        "parts": result.get("parts", []),
        "cap": result.get("cap", {}),
        "expires_in": result.get("expires_in"),
        "code_expires_in": result.get("code_expires_in"),
    }


@router.get("/status")
async def resonance_status(
    request: Request,
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Panel diagnostics: breaker state, recent client-side load failures, origin.

    `origin` is the value to register with resonance as an allowed frame
    ancestor — resonance refuses to render inside a page nobody authorised, and
    that refusal looks like a broken widget rather than a configuration gap.
    """
    await reports.prune(db)
    return {
        "module_version": RESONANCE_MODULE_VERSION,
        "origin": await _effective_origin(db, request),
        "detected_origin": _detected_origin(request),
        "breaker": await limiter.state(db),
        "load_failures": await reports.summary(db, days=7),
    }
