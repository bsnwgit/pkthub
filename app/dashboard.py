from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
import aiosqlite
import httpx
import asyncio
import json
import re
import time
from app.crypto import decrypt_str
from app.database import get_db
from app.audit import write_audit
from app.auth import require_admin, require_analyst_or_admin

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


# ── Fleet history ────────────────────────────────────────────────────────────
# Feeds the dashboard charts. Everything here is read from pkthub's own tables,
# so it costs no round-trip to any registered app.

_ALERT_KINDS = ("connection_lost", "unhealthy", "token_mismatch")


@router.get("/charts")
async def get_dashboard_charts(
    hours: int = Query(24, ge=1, le=720),
    current_user: dict = Depends(require_analyst_or_admin),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Time-bucketed audit and app-alert counts, plus per-app rankings."""
    # ~48 buckets whatever the window, never finer than five minutes.
    bucket = max(300, (hours * 3600) // 48)
    now = int(time.time())
    end = (now // bucket + 1) * bucket
    start = end - bucket * ((hours * 3600 + bucket - 1) // bucket)
    since = f"-{hours} hours"

    def blank():
        return {t: 0 for t in range(start, end, bucket)}

    async def bucketed(sql: str, params: tuple) -> list[tuple]:
        async with db.execute(sql, params) as cur:
            return [tuple(r) for r in await cur.fetchall()]

    audit = blank()
    for b, n in await bucketed(
        "SELECT CAST(strftime('%s', timestamp) AS INTEGER) / ? * ?, COUNT(*) "
        "FROM audit_log WHERE timestamp > datetime('now', ?) GROUP BY 1",
        (bucket, bucket, since),
    ):
        if b in audit:
            audit[b] = n

    alerts = {t: {k: 0 for k in _ALERT_KINDS} for t in range(start, end, bucket)}
    for b, kind, n in await bucketed(
        "SELECT CAST(strftime('%s', created_at) AS INTEGER) / ? * ?, event_type, COUNT(*) "
        "FROM app_alerts WHERE created_at > datetime('now', ?) GROUP BY 1, 2",
        (bucket, bucket, since),
    ):
        if b in alerts and kind in _ALERT_KINDS:
            alerts[b][kind] = n

    top_apps = [
        {"id": r[0], "name": r[1], "count": r[2]}
        for r in await bucketed(
            "SELECT app_id, app_name, COUNT(*) AS n FROM app_alerts "
            "WHERE created_at > datetime('now', ?) GROUP BY app_id, app_name "
            "ORDER BY n DESC, app_name LIMIT 5",
            (since,),
        )
    ]
    top_actions = [
        {"action": r[0], "count": r[1]}
        for r in await bucketed(
            "SELECT action, COUNT(*) AS n FROM audit_log "
            "WHERE timestamp > datetime('now', ?) GROUP BY action "
            "ORDER BY n DESC, action LIMIT 5",
            (since,),
        )
    ]
    top_users = [
        {"username": r[0], "count": r[1]}
        for r in await bucketed(
            "SELECT username, COUNT(*) AS n FROM audit_log "
            "WHERE timestamp > datetime('now', ?) AND username IS NOT NULL AND username != '' "
            "GROUP BY username ORDER BY n DESC, username LIMIT 5",
            (since,),
        )
    ]
    by_health = [
        {"status": r[0], "count": r[1]}
        for r in await bucketed(
            "SELECT COALESCE(health_status, 'unknown'), COUNT(*) FROM registered_apps "
            "GROUP BY 1 ORDER BY 2 DESC",
            (),
        )
    ]

    return {
        "bucket_seconds": bucket,
        "audit_trend": [{"t": t * 1000, "count": n} for t, n in sorted(audit.items())],
        "alert_trend": [{"t": t * 1000, **v} for t, v in sorted(alerts.items())],
        "top_apps": top_apps,
        "top_actions": top_actions,
        "top_users": top_users,
        "by_health": by_health,
    }


# ── Dashboard widgets ────────────────────────────────────────────────────────
# Any widget a registered app publishes to the NOC Builder can also sit on the
# Dashboard. The layout is one list shared by everyone who can see the
# Dashboard, edited by admins, and stored as JSON in platform_config.
#
# Only {app_id, widget_id, size, config} is stored. The path a tile loads and
# its title are always re-resolved from the app's *current* manifest, so a saved
# layout can never point a tile at a URL the app did not publish — and because
# the generic settings endpoint can also write this key, the same normalisation
# runs on read as on save rather than trusting what is in the table.

_WIDGETS_KEY = "dashboard_widgets"
_MAX_WIDGETS = 24
_SIZES = ("s", "m", "l")
_PARAM_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,40}$")


class DashboardWidget(BaseModel):
    app_id: int = Field(ge=1)
    widget_id: str = Field(min_length=1, max_length=64)
    size: str = "m"
    config: dict[str, str] = Field(default_factory=dict)


class DashboardWidgetsBody(BaseModel):
    widgets: list[DashboardWidget] = Field(max_length=_MAX_WIDGETS)


def _manifest_of(row) -> list[dict]:
    try:
        data = json.loads(row["widget_manifest"]) if row["widget_manifest"] else []
        return [m for m in data if isinstance(m, dict)] if isinstance(data, list) else []
    except (TypeError, ValueError):
        return []


async def _normalise_widgets(db: aiosqlite.Connection, raw) -> list[dict]:
    """Resolve each saved entry against the live manifests. Entries whose app
    or widget has gone are kept, flagged `missing`, so the layout does not
    silently lose a tile because an app was offline when the manifest refreshed."""
    async with db.execute("SELECT id, name, widget_manifest FROM registered_apps") as cur:
        apps = {r["id"]: (r["name"], _manifest_of(r)) for r in await cur.fetchall()}

    out = []
    for item in raw if isinstance(raw, list) else []:
        try:
            w = DashboardWidget(**item)
        except Exception:
            continue
        name, manifest = apps.get(w.app_id, (None, []))
        entry = next((m for m in manifest if m.get("id") == w.widget_id), None)
        view_path = entry.get("view_path") if entry else None
        ok = (isinstance(view_path, str) and view_path.startswith("/api/widgets/")
              and ".." not in view_path and "?" not in view_path)
        allowed = {p.get("key") for p in (entry or {}).get("params", []) if isinstance(p, dict)}
        out.append({
            "app_id": w.app_id,
            "app_name": name,
            "widget_id": w.widget_id,
            "title": (entry or {}).get("title") or w.widget_id,
            "view_path": view_path if ok else None,
            "size": w.size if w.size in _SIZES else "m",
            "config": {k: v[:200] for k, v in w.config.items()
                       if _PARAM_KEY.match(k) and k in allowed},
            "missing": not ok,
        })
        if len(out) >= _MAX_WIDGETS:
            break
    return out


async def _widget_refresh(db: aiosqlite.Connection) -> int:
    try:
        async with db.execute("SELECT value FROM platform_config WHERE key = 'noc_widget_refresh'") as cur:
            row = await cur.fetchone()
        return max(5, min(int(row[0]), 3600)) if row and row[0] else 30
    except Exception:
        return 30


@router.get("/widgets")
async def get_dashboard_widgets(
    current_user: dict = Depends(require_analyst_or_admin),
    db: aiosqlite.Connection = Depends(get_db),
):
    async with db.execute("SELECT value FROM platform_config WHERE key = ?", (_WIDGETS_KEY,)) as cur:
        row = await cur.fetchone()
    try:
        raw = json.loads(row[0]) if row and row[0] else []
    except (TypeError, ValueError):
        raw = []
    return {"widgets": await _normalise_widgets(db, raw), "widget_refresh": await _widget_refresh(db)}


@router.put("/widgets")
async def put_dashboard_widgets(
    body: DashboardWidgetsBody,
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db),
):
    items = [w.model_dump() for w in body.widgets]
    resolved = await _normalise_widgets(db, items)
    # A widget the app does not publish (or an app that is not registered) is a
    # bad request, not something to store and flag later.
    bad = [f"{r['app_id']}/{r['widget_id']}" for r in resolved if r["missing"]]
    if bad:
        raise HTTPException(status_code=422, detail=f"Not a published widget: {', '.join(bad)}")
    stored = [{"app_id": r["app_id"], "widget_id": r["widget_id"], "size": r["size"], "config": r["config"]}
              for r in resolved]
    await db.execute(
        """INSERT INTO platform_config (key, value, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at""",
        (_WIDGETS_KEY, json.dumps(stored)),
    )
    await db.commit()
    await write_audit(db, current_user, "dashboard.widgets_update", "dashboard",
                      {"count": len(stored), "widgets": [f"{r['app_name']}:{r['widget_id']}" for r in resolved]})
    return {"widgets": resolved}
