from fastapi import APIRouter, Depends
import aiosqlite
import httpx
import asyncio
import json
from app.crypto import decrypt_str
from app.database import get_db
from app.auth import require_analyst_or_admin

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

SUITE_VERSION = 1

@router.get("")
async def get_dashboard(
    current_user: dict = Depends(require_analyst_or_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    async with db.execute("SELECT * FROM registered_apps") as cur:
        apps = await cur.fetchall()

    async with db.execute(
        "SELECT COUNT(*) as count FROM audit_log WHERE timestamp > datetime('now', '-24 hours')"
    ) as cur:
        audit_row = await cur.fetchone()

    async def fetch_app_summary(app):
        suite_token = decrypt_str(app["suite_token"])
        base_url = app["base_url"].rstrip("/")
        headers = {
            "X-Suite-Token": suite_token,
            "X-Suite-Version": str(SUITE_VERSION)
        }
        result = {
            "id": app["id"],
            "name": app["name"],
            "display_name": app["display_name"],
            "app_type": app["app_type"],
            "status": app["status"],
            "access_mode": app["access_mode"] if "access_mode" in app.keys() else "direct",
            "health_status": app["health_status"] or "unknown",
            "last_health_check": app["last_health_check"],
            "base_url": base_url,
            "data": {}
        }
        try:
            async with httpx.AsyncClient(verify=False, timeout=5) as client:
                resp = await client.get(f"{base_url}/api/health", headers=headers)
                if resp.status_code == 200:
                    result["health_status"] = "healthy"
                    result["data"] = resp.json()
                else:
                    result["health_status"] = "degraded"
        except Exception:
            result["health_status"] = "unreachable"
        return result

    app_summaries = await asyncio.gather(*[fetch_app_summary(a) for a in apps])

    healthy = sum(1 for a in app_summaries if a["health_status"] == "healthy")
    degraded = sum(1 for a in app_summaries if a["health_status"] == "degraded")
    unreachable = sum(1 for a in app_summaries if a["health_status"] == "unreachable")

    return {
        "apps": app_summaries,
        "summary": {
            "total_apps": len(apps),
            "healthy": healthy,
            "degraded": degraded,
            "unreachable": unreachable,
            "audit_events_24h": audit_row["count"] if audit_row else 0,
        }
    }
