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


@router.get("/update-status")
async def get_update_status(user: dict = Depends(get_current_user), db: aiosqlite.Connection = Depends(get_db)) -> dict:
    from app import self_update
    return await self_update.status(db)


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
