"""Notification test endpoints."""
from fastapi import APIRouter, Depends
import aiosqlite
from app.database import get_db
from app.auth import require_admin
from app.crypto import decrypt_str

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


async def _get_setting(db: aiosqlite.Connection, key: str, default: str = "") -> str:
    async with db.execute("SELECT value FROM platform_config WHERE key = ?", (key,)) as cur:
        row = await cur.fetchone()
    return row["value"] if row else default


async def _get_secret_setting(db: aiosqlite.Connection, key: str, default: str = "") -> str:
    """Like _get_setting, but for a key that's encrypted at rest (see
    settings_api._ENCRYPTED_AT_REST_KEYS). Falls back to the raw stored
    value if it doesn't decrypt, so this keeps working unattended on a row
    that predates the migrate_settings_encryption.py one-time migration."""
    raw = await _get_setting(db, key, default)
    if not raw:
        return raw
    return decrypt_str(raw) or raw


@router.post("/test/{channel}")
async def test_notification(
    channel: str,
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Fire a test notification for the given channel."""
    if channel == "slack":
        enabled = await _get_setting(db, "notify_slack_enabled") == "true"
        if not enabled:
            return {"status": "skipped", "detail": "Slack is not enabled"}
        webhook_url = await _get_secret_setting(db, "notify_slack_webhook_url")
        if not webhook_url:
            return {"status": "skipped", "detail": "Slack webhook URL is not configured"}
        try:
            import httpx
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.post(webhook_url, json={"text": "[pktHub] Test notification from pktHub — Slack integration is working."})
            if r.status_code < 300:
                return {"status": "sent", "detail": f"HTTP {r.status_code}"}
            return {"status": "failed", "detail": f"HTTP {r.status_code}: {r.text[:120]}"}
        except Exception as e:
            return {"status": "failed", "detail": str(e)[:120]}

    elif channel == "email":
        enabled = await _get_setting(db, "notify_email_enabled") == "true"
        if not enabled:
            return {"status": "skipped", "detail": "Email is not enabled"}
        host = await _get_setting(db, "notify_email_smtp_host")
        if not host:
            return {"status": "skipped", "detail": "SMTP host is not configured"}
        try:
            import smtplib
            from email.mime.text import MIMEText
            port = int(await _get_setting(db, "notify_email_smtp_port") or "587")
            use_tls = await _get_setting(db, "notify_email_smtp_tls", "true") == "true"
            username = await _get_setting(db, "notify_email_username")
            password = await _get_secret_setting(db, "notify_email_password")
            from_addr = await _get_setting(db, "notify_email_from")
            to_addr = await _get_setting(db, "notify_email_default_to")
            if not to_addr:
                return {"status": "skipped", "detail": "No 'default to' address configured"}
            msg = MIMEText("[pktHub] Test notification — email integration is working.")
            msg["Subject"] = "[pktHub] Test notification"
            msg["From"] = from_addr or username
            msg["To"] = to_addr
            if use_tls:
                server = smtplib.SMTP(host, port, timeout=10)
                server.starttls()
            else:
                server = smtplib.SMTP(host, port, timeout=10)
            if username and password:
                server.login(username, password)
            server.sendmail(from_addr or username, [to_addr], msg.as_string())
            server.quit()
            return {"status": "sent", "detail": f"Sent to {to_addr}"}
        except Exception as e:
            return {"status": "failed", "detail": str(e)[:120]}

    elif channel == "pagerduty":
        enabled = await _get_setting(db, "notify_pagerduty_enabled") == "true"
        if not enabled:
            return {"status": "skipped", "detail": "PagerDuty is not enabled"}
        key = await _get_secret_setting(db, "notify_pagerduty_integration_key")
        if not key:
            return {"status": "skipped", "detail": "Integration key is not configured"}
        try:
            import httpx
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.post(
                    "https://events.pagerduty.com/v2/enqueue",
                    json={
                        "routing_key": key,
                        "event_action": "trigger",
                        "payload": {
                            "summary": "[pktHub] Test notification",
                            "severity": "info",
                            "source": "pktHub",
                        }
                    }
                )
            if r.status_code < 300:
                return {"status": "sent", "detail": f"HTTP {r.status_code}"}
            return {"status": "failed", "detail": f"HTTP {r.status_code}: {r.text[:120]}"}
        except Exception as e:
            return {"status": "failed", "detail": str(e)[:120]}

    elif channel == "webhook":
        enabled = await _get_setting(db, "notify_webhook_enabled") == "true"
        if not enabled:
            return {"status": "skipped", "detail": "Webhook is not enabled"}
        url = await _get_secret_setting(db, "notify_webhook_url")
        if not url:
            return {"status": "skipped", "detail": "Webhook URL is not configured"}
        method = await _get_setting(db, "notify_webhook_method", "POST")
        try:
            import httpx
            async with httpx.AsyncClient(timeout=10) as client:
                fn = client.post if method == "POST" else client.put
                r = await fn(url, json={"event": "test", "source": "pktHub"})
            if r.status_code < 300:
                return {"status": "sent", "detail": f"HTTP {r.status_code}"}
            return {"status": "failed", "detail": f"HTTP {r.status_code}: {r.text[:120]}"}
        except Exception as e:
            return {"status": "failed", "detail": str(e)[:120]}

    elif channel == "tracecat":
        enabled = await _get_setting(db, "notify_tracecat_enabled") == "true"
        if not enabled:
            return {"status": "skipped", "detail": "TraceCat is not enabled"}
        url = await _get_secret_setting(db, "notify_tracecat_webhook_url")
        if not url:
            return {"status": "skipped", "detail": "TraceCat webhook URL is not configured"}
        token = await _get_secret_setting(db, "notify_tracecat_api_token")
        try:
            import httpx
            headers = {}
            if token:
                headers["Authorization"] = f"Bearer {token}"
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.post(url, json={"event": "test", "source": "pktHub"}, headers=headers)
            if r.status_code < 300:
                return {"status": "sent", "detail": f"HTTP {r.status_code}"}
            return {"status": "failed", "detail": f"HTTP {r.status_code}: {r.text[:120]}"}
        except Exception as e:
            return {"status": "failed", "detail": str(e)[:120]}

    return {"status": "failed", "detail": f"Unknown channel: {channel}"}
