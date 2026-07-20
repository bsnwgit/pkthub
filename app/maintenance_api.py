"""
Maintenance endpoints — service restart and the actual (config.yaml-backed)
listen port. The frontend's RestartServiceRow already calls
POST /api/maintenance/restart; this file is what makes that route exist.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import signal
import subprocess
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import require_admin
from app.config import CONFIG_PATH, get_settings

log = logging.getLogger("pkthub.maintenance")
router = APIRouter(prefix="/api/maintenance", tags=["maintenance"])


async def _delayed_restart(delay: float = 1.5) -> None:
    """Wait briefly, then signal systemd to restart this service."""
    await asyncio.sleep(delay)
    proc = subprocess.run(
        ["sudo", "systemctl", "restart", "pkthub"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if proc.returncode != 0:
        # Sudo isn't configured — kill the master process; systemd
        # Restart=always will revive it.
        os.kill(os.getppid(), signal.SIGTERM)


@router.post("/restart", dependencies=[Depends(require_admin)])
async def restart_service() -> dict:
    """
    Restart the pktHub service. Response is sent immediately; the service
    process exits ~1.5s later and systemd brings it back up.
    """
    log.warning("Service restart requested via API")
    asyncio.create_task(_delayed_restart())
    return {"status": "restarting", "message": "Service will restart in ~2 seconds"}


def _config_file_path() -> Path:
    """Locate the on-disk config.yaml — same resolution app/config.py uses."""
    cfg = get_settings()
    for candidate in [Path(CONFIG_PATH), Path(cfg.install_dir) / "config.yaml"]:
        if candidate.exists():
            return candidate
    raise HTTPException(500, "config.yaml not found")


class PortUpdate(BaseModel):
    port: int


@router.get("/port", dependencies=[Depends(require_admin)])
async def get_port() -> dict:
    """
    The port pktHub listens on. Lives in config.yaml (startup config, read
    before the DB connects) — see app/config.py and app/server.py.
    """
    return {"port": get_settings().port}


@router.post("/port", dependencies=[Depends(require_admin)])
async def set_port(body: PortUpdate) -> dict:
    """
    Update the listen port in config.yaml. Takes effect on the next service
    restart — this only writes the file, it doesn't restart anything itself.
    """
    if not (1 <= body.port <= 65535):
        raise HTTPException(400, "Port must be between 1 and 65535")

    path = _config_file_path()
    text = path.read_text()
    new_line = f"port: {body.port}"
    if re.search(r"(?m)^port:\s*\d+", text):
        text = re.sub(r"(?m)^port:\s*\d+", new_line, text, count=1)
    else:
        text = text.rstrip("\n") + f"\n{new_line}\n"
    path.write_text(text)

    log.warning(f"Listen port changed to {body.port} in config.yaml — restart required to take effect")
    return {"port": body.port, "message": "Saved — restart the service to apply"}
