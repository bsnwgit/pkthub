"""
System version/about info — shown on the Settings → System tab — and the
log-forwarding admin endpoints.
"""
from __future__ import annotations

import logging

import aiosqlite
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.config import get_settings
from app.version import get_version

log = logging.getLogger("pkthub.system")
router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/info")
async def system_info(current_user: dict = Depends(get_current_user)) -> dict:
    cfg = get_settings()
    return {
        "app_name": "pktHub",
        "version": get_version(),
        "install_dir": cfg.install_dir,
        "github": "https://github.com/bsnwgit/pkthub",
        "license": "PolyForm Noncommercial 1.0.0",
        "developer": "Robert Barnett",
        "contact": "inquiry@barsoftnetware.com",
    }


# ── Log forwarding ────────────────────────────────────────────────────────────
# pktHub keeps its settings in platform_config rather than a `settings` table,
# so the queries here differ from the sibling apps even though the endpoints
# and their payloads are identical.


class LogForwardTest(BaseModel):
    host: str
    port: int = 5514
    protocol: str = "udp"


async def _forward_settings() -> dict:
    cfg = get_settings()
    out: dict = {}
    async with aiosqlite.connect(cfg.db_path) as db:
        async with db.execute(
            "SELECT key, value FROM platform_config WHERE key LIKE 'log_forward_%'"
        ) as cur:
            for key, value in await cur.fetchall():
                out[key] = value
    return out


def _apply(fwd: dict) -> None:
    from app.log_forward import configure_forwarding

    configure_forwarding(
        enabled=str(fwd.get("log_forward_enabled", "")).lower() in ("1", "true", "yes"),
        host=str(fwd.get("log_forward_host") or ""),
        port=int(fwd.get("log_forward_port") or 5514),
        protocol=str(fwd.get("log_forward_protocol") or "udp"),
        level=getattr(logging, str(fwd.get("log_forward_level") or "INFO"), logging.INFO),
        app_name=str(fwd.get("log_forward_app_name") or "pkthub"),
    )


@router.get("/log-forward/status", dependencies=[Depends(require_admin)])
async def log_forward_status():
    """Delivery counters for the log forwarder, so it can be seen working."""
    from app.log_forward import get_forward_stats

    return get_forward_stats()


@router.post("/log-forward/test", dependencies=[Depends(require_admin)])
async def log_forward_test(body: LogForwardTest):
    """Send one test line to the collector without touching the live handler."""
    from app.log_forward import send_test_message

    return send_test_message(host=body.host, port=body.port, protocol=body.protocol)


@router.post("/log-forward/reload", dependencies=[Depends(require_admin)])
async def log_forward_reload():
    """Re-read log_forward_* settings and apply them without a restart."""
    from app.log_forward import get_forward_stats

    _apply(await _forward_settings())
    return {"ok": True, **get_forward_stats()}


async def start_log_forwarding() -> None:
    """Called at startup so forwarding is live without hitting reload first."""
    try:
        fwd = await _forward_settings()
        if str(fwd.get("log_forward_enabled", "")).lower() in ("1", "true", "yes"):
            _apply(fwd)
    except Exception:
        # Forwarding must never be able to stop the app from starting.
        logging.getLogger("pkthub").warning("log forwarding failed to start", exc_info=True)


# -- Self-update ---------------------------------------------------------------
# Checks the GitHub releases for a newer version and applies it in place — see
# app/self_update.py. Status is readable by any signed-in user (the Settings →
# System page shows it); checking, configuring and applying are admin-only.

class UpdateConfigBody(BaseModel):
    mode: Optional[str] = None
    window_start: Optional[str] = None
    window_end: Optional[str] = None
    github_token: Optional[str] = None  # None = leave alone, "" = clear


# A page load re-checks GitHub, but not more than once per this many seconds —
# the status route is open to every signed-in user, so it must not be a way to
# hammer the GitHub API.
_REFRESH_MIN_AGE_SECONDS = 300


def _check_is_stale(checked_at: str | None) -> bool:
    if not checked_at:
        return True
    from datetime import datetime, timezone
    try:
        then = datetime.fromisoformat(checked_at)
    except ValueError:
        return True
    return (datetime.now(timezone.utc) - then).total_seconds() > _REFRESH_MIN_AGE_SECONDS


@router.get("/update-status")
async def get_update_status(user: dict = Depends(get_current_user), db: aiosqlite.Connection = Depends(get_db), refresh: bool = False) -> dict:
    """refresh=true re-checks GitHub first when the last check is stale — the
    update banner passes it on every app load."""
    from app import self_update
    st = await self_update.status(db)
    if refresh and _check_is_stale(st.get("checked_at")):
        return await self_update.check_latest(db)
    return st


@router.get("/suite-updates")
async def get_suite_updates(user: dict = Depends(get_current_user), db: aiosqlite.Connection = Depends(get_db)) -> dict:
    """The hub's own update status plus every registered app's, for the
    banner. Each app is asked with its suite token and refresh=true, so its
    own (rate-limited) check runs; an app that is down or too old to have the
    route is reported with update_available false rather than failing the
    whole call."""
    import asyncio
    import httpx
    from app import self_update
    from app.crypto import decrypt_str
    from app.registry import SUITE_VERSION

    own = await self_update.status(db)
    if _check_is_stale(own.get("checked_at")):
        own = await self_update.check_latest(db)

    async with db.execute("SELECT id, name, display_name, base_url, suite_token FROM registered_apps ORDER BY registered_at") as cur:
        apps = await cur.fetchall()

    async def one(app) -> dict:
        row = {"app_id": app["id"], "name": app["name"],
               "display_name": app["display_name"] or app["name"],
               "current_version": None, "latest_tag": None, "update_available": False}
        try:
            async with httpx.AsyncClient(verify=False, timeout=8) as client:
                resp = await client.get(
                    f"{app['base_url'].rstrip('/')}/api/system/update-status",
                    params={"refresh": "true"},
                    headers={"X-Suite-Token": decrypt_str(app["suite_token"]),
                             "X-Suite-Version": str(SUITE_VERSION)},
                )
            if resp.status_code == 200:
                st = resp.json()
                row["current_version"] = st.get("current_version")
                row["latest_tag"] = st.get("latest_tag")
                row["update_available"] = bool(st.get("update_available"))
        except Exception:
            pass  # unreachable app: same contract as the health poll — report nothing, don't fail
        return row

    results = await asyncio.gather(*(one(a) for a in apps))
    return {
        "hub": {
            "current_version": own.get("current_version"),
            "latest_tag": own.get("latest_tag"),
            "update_available": bool(own.get("update_available")),
        },
        "apps": list(results),
    }


@router.post("/update-check")
async def force_update_check(user: dict = Depends(require_admin), db: aiosqlite.Connection = Depends(get_db)) -> dict:
    from app import self_update
    return await self_update.check_latest(db)


@router.put("/update-config")
async def save_update_config(body: UpdateConfigBody, user: dict = Depends(require_admin), db: aiosqlite.Connection = Depends(get_db)) -> dict:
    from app import self_update
    try:
        return await self_update.save_config(
            db, mode=body.mode, window_start=body.window_start,
            window_end=body.window_end, github_token=body.github_token,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.post("/update-apply")
async def apply_update_now(user: dict = Depends(require_admin), db: aiosqlite.Connection = Depends(get_db)) -> dict:
    """Download the newest release, swap it in, and exit shortly after
    answering so systemd starts the new code. The delay is what lets this
    response reach the browser before the process goes away."""
    from app import self_update
    try:
        result = await self_update.apply_now(db)
    except self_update.UpdateRefused as exc:
        raise HTTPException(409, str(exc))
    except Exception as exc:
        log.exception("Update now failed")
        raise HTTPException(502, f"Update failed: {exc}")
    log.info("Self-update applied by %s: %s", user["username"], result.get("applied"))
    self_update.restart_soon()
    return {**result, "restarting": True}
