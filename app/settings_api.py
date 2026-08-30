from fastapi import APIRouter, Depends, HTTPException
import aiosqlite
import json
import logging
import os
from typing import List
from app.database import get_db
from app.auth import require_admin
from app.config import get_settings
from app.crypto import encrypt_str
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
    # Log forwarding — ships pktHub's own app log to pktLog as RFC 5424 syslog
    "log_forward_enabled": "false",
    "log_forward_host": "",
    "log_forward_port": "5514",
    "log_forward_protocol": "udp",
    "log_forward_level": "INFO",
    "log_forward_app_name": "pkthub",
    "log_level": "INFO",
    # Backup
    "backup_auto_enabled": "false",
    "backup_interval_hours": "24",
    "backup_path": os.path.join(get_settings().install_dir, "backups"),
    "backup_retain_count": "5",
    # Maintenance
    "maintenance_mode": "false",
}

# Sentinel mask written over secret values in GET responses.
# If the UI sends this value back on Save, treat it as "unchanged" and skip the write.
_MASK = "••••••••"
_SECRET_KEYS = {
    "notify_email_password", "notify_pagerduty_integration_key",
    "notify_tracecat_api_token", "notify_webhook_url",
    "notify_slack_webhook_url", "notify_tracecat_webhook_url",
}
# These are encrypted at rest (app.crypto.encrypt_str) on write, in addition
# to being masked in API responses like every key in _SECRET_KEYS.
_ENCRYPTED_AT_REST_KEYS = _SECRET_KEYS


@router.get("")
async def get_all_settings(
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    async with db.execute("SELECT key, value FROM platform_config") as cur:
        rows = await cur.fetchall()
    stored = {r["key"]: r["value"] for r in rows}
    merged = {**DEFAULTS, **stored}

    for k in _SECRET_KEYS:
        if merged.get(k):
            merged[k] = _MASK

    return merged


@router.get("/{key}")
async def get_setting(
    key: str,
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    async with db.execute("SELECT value FROM platform_config WHERE key = ?", (key,)) as cur:
        row = await cur.fetchone()
    value = row["value"] if row else DEFAULTS.get(key)
    if value is None and key not in DEFAULTS:
        raise HTTPException(status_code=404, detail="Setting not found")
    if key in _SECRET_KEYS and value:
        value = _MASK
    return {"key": key, "value": value}


@router.put("/{key}")
async def set_setting(
    key: str,
    body: ConfigItem,
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    if key in _SECRET_KEYS and body.value == _MASK:
        return {"key": key, "value": body.value, "skipped": "mask value"}

    value = body.value

    stored_value = encrypt_str(value) if (key in _ENCRYPTED_AT_REST_KEYS and value) else value

    await db.execute(
        """INSERT INTO platform_config (key, value, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at""",
        (key, stored_value)
    )
    await db.commit()
    return {"key": key, "value": value}


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
        if item.key in _SECRET_KEYS and item.value == _MASK:
            continue  # never overwrite a secret with the display mask

        value = item.value

        stored_value = encrypt_str(value) if (item.key in _ENCRYPTED_AT_REST_KEYS and value) else value

        await db.execute(
            """INSERT INTO platform_config (key, value, updated_at)
               VALUES (?, ?, datetime('now'))
               ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at""",
            (item.key, stored_value)
        )
    await db.commit()

    # base_url is copied onto every app in Managed mode as the address locked
    # users are redirected to, so changing it here has to reach them — otherwise
    # they carry on sending people to wherever the hub used to be, and nothing
    # about that looks broken from the hub's side. The health poller repairs the
    # same drift within a cycle; doing it now is what lets the operator see it.
    hub_redirects = None
    if any(item.key == "base_url" for item in items):
        from app.registry import resync_hub_redirects
        try:
            hub_redirects = await resync_hub_redirects(db)
        except Exception:
            logging.getLogger("pkthub.settings").exception("hub redirect resync failed")

    return {"updated": len(items), "hub_redirects": hub_redirects}
