"""
System version/about info — shown on the Settings → System tab — and the
log-forwarding admin endpoints.
"""
from __future__ import annotations

import logging

import aiosqlite
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth import get_current_user, require_admin
from app.config import get_settings
from app.version import get_version

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
