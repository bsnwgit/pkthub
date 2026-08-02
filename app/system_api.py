"""
System version/about info — shown on the Settings → System tab.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth import get_current_user
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
