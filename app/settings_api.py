from fastapi import APIRouter, Depends, HTTPException
import aiosqlite
import json
import os
from typing import List
from app.database import get_db
from app.auth import require_admin
from app.config import get_settings
from app.models import ConfigItem

router = APIRouter(prefix="/api/settings", tags=["settings"])

DEFAULTS = {
    # General
    "app_name": "pktHub",
    "base_url": "",
    "timezone": "UTC",
    # Network
    "listen_port": "8760",
    "ssl_cert_path": "",
    "ssl_key_path": "",
    "trusted_cidrs": "",
    # Auth
    "auth_local_enabled": "true",
    "session_timeout_minutes": "480",
    "okta_saml_enabled": "false",
    "okta_saml_idp_entity_id": "",
    "okta_saml_idp_sso_url": "",
    "okta_saml_idp_cert": "",
    "okta_saml_sp_entity_id": "",
    "okta_saml_sp_cert": "",
    "okta_saml_sp_key": "",
    # App Registry
    "default_app_mode": "observe",
    "health_poll_interval": "30",
    "health_timeout": "5",
    "auto_rotate_days": "0",
    # NOC
    "noc_default_dwell": "30",
    "noc_widget_refresh": "60",
    "display_token_expire_days": "0",
    # Notifications — Slack
    "notify_slack_enabled": "false",
    "notify_slack_webhook_url": "",
    "notify_slack_channel": "#alerts",
    # Notifications — Email
    "notify_email_enabled": "false",
    "notify_email_smtp_host": "",
    "notify_email_smtp_port": "587",
    "notify_email_smtp_tls": "true",
    "notify_email_username": "",
    "notify_email_password": "",
    "notify_email_from": "",
    "notify_email_default_to": "",
    # Notifications — PagerDuty
    "notify_pagerduty_enabled": "false",
    "notify_pagerduty_integration_key": "",
    # Notifications — Webhook
    "notify_webhook_enabled": "false",
    "notify_webhook_url": "",
    "notify_webhook_method": "POST",
    "notify_webhook_payload_template": "",
    # Notifications — TraceCat
    "notify_tracecat_enabled": "false",
    "notify_tracecat_webhook_url": "",
    "notify_tracecat_api_token": "",
    # Alert events
    "notify_on_unreachable": "true",
    "notify_on_break_glass": "true",
    "notify_on_mode_change": "true",
    # Audit / Storage
    "audit_retention_days": "90",
    "alert_retention_days": "90",
    "log_level": "INFO",
    # Backup
    "backup_auto_enabled": "false",
    "backup_interval_hours": "24",
    "backup_path": os.path.join(get_settings().install_dir, "backups"),
    "backup_retain_count": "5",
    # Maintenance
    "maintenance_mode": "false",
    # AI Assistant
    "anthropic_api_key": "",
    "ai_model": "claude-haiku-4-5-20251001",
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

@router.get("/storage/test")
async def test_storage_connection(
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Verify the SQLite database is accessible and readable."""
    try:
        async with db.execute("SELECT COUNT(*) as count FROM audit_log") as cur:
            row = await cur.fetchone()
        async with db.execute("PRAGMA integrity_check") as cur:
            ic = await cur.fetchone()
        ok = ic and ic[0] == "ok"
        return {"ok": ok, "message": "SQLite (built-in) — connection verified" if ok else "Integrity check failed"}
    except Exception as exc:
        return {"ok": False, "message": str(exc)}


@router.post("/storage/cleanup")
async def run_storage_cleanup(
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Delete audit log entries older than audit_retention_days and alert events older than alert_retention_days."""
    async with db.execute("SELECT value FROM platform_config WHERE key = 'audit_retention_days'") as cur:
        row = await cur.fetchone()
    audit_days = int(row["value"]) if row and row["value"] else 90

    async with db.execute("SELECT value FROM platform_config WHERE key = 'alert_retention_days'") as cur:
        row = await cur.fetchone()
    alert_days = int(row["value"]) if row and row["value"] else 90

    audit_deleted = 0
    if audit_days > 0:
        cur = await db.execute(
            "DELETE FROM audit_log WHERE created_at < datetime('now', ? || ' days')",
            (f"-{audit_days}",)
        )
        audit_deleted = cur.rowcount

    await db.commit()
    return {"ok": True, "message": f"Cleanup complete — {audit_deleted} audit log entries removed"}


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
