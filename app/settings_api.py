from fastapi import APIRouter, Depends, HTTPException
import aiosqlite
import json
from typing import List
from app.database import get_db
from app.auth import require_admin
from app.models import ConfigItem

router = APIRouter(prefix="/api/settings", tags=["settings"])

DEFAULTS = {
    "platform.name": "pktSuite",
    "platform.timezone": "UTC",
    "network.trusted_cidrs": "[]",
    "auth.local_enabled": "true",
    "auth.okta_enabled": "false",
    "auth.jwt_expire_minutes": "60",
    "kiosk.default_dwell_seconds": "30",
    "kiosk.display_token_ttl_days": "0",
    "notifications.smtp_host": "",
    "notifications.smtp_port": "587",
    "notifications.smtp_from": "",
    "notifications.smtp_enabled": "false",
    "notifications.webhook_url": "",
    "notifications.webhook_enabled": "false",
    "audit.retention_days": "90",
    "audit.log_level": "info",
}

@router.get("")
async def get_all_settings(
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    async with db.execute("SELECT key, value FROM platform_config") as cur:
        rows = await cur.fetchall()
    stored = {r["key"]: r["value"] for r in rows}
    merged = {**DEFAULTS, **stored}
    return merged

@router.get("/{key}")
async def get_setting(
    key: str,
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    async with db.execute("SELECT value FROM platform_config WHERE key = ?", (key,)) as cur:
        row = await cur.fetchone()
    if row:
        return {"key": key, "value": row["value"]}
    if key in DEFAULTS:
        return {"key": key, "value": DEFAULTS[key]}
    raise HTTPException(status_code=404, detail="Setting not found")

@router.put("/{key}")
async def set_setting(
    key: str,
    body: ConfigItem,
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    await db.execute(
        """INSERT INTO platform_config (key, value, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at""",
        (key, body.value)
    )
    await db.commit()
    return {"key": key, "value": body.value}

@router.post("/bulk")
async def set_settings_bulk(
    items: List[ConfigItem],
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    for item in items:
        await db.execute(
            """INSERT INTO platform_config (key, value, updated_at)
               VALUES (?, ?, datetime('now'))
               ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at""",
            (item.key, item.value)
        )
    await db.commit()
    return {"updated": len(items)}
