"""
pktSNMP — Widget endpoints for pktHub NOC Builder integration.

Manifest: GET /api/widgets/manifest  → list of widget definitions
Views:    GET /widgets/{widget_type}  → server-rendered HTML page (iframe target)
"""
from __future__ import annotations

from pathlib import Path

import aiosqlite
from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from app.config import get_settings

router = APIRouter()
settings = get_settings()

_DB = Path(__file__).parent.parent.parent / "pktsnmp.db"

# ── Manifest ──────────────────────────────────────────────────────────────────

MANIFEST = [
    {
        "id": "device_table",
        "title": "Device Status",
        "description": "SNMP-monitored device health overview",
        "view_path": "/api/widgets/device_table",
        "default_w": 700,
        "default_h": 420,
        "min_w": 360,
        "min_h": 220,
    },
    {
        "id": "collector_status",
        "title": "Collector Status",
        "description": "SNMP collector health and last-seen",
        "view_path": "/api/widgets/collector_status",
        "default_w": 480,
        "default_h": 280,
        "min_w": 280,
        "min_h": 160,
    },
]


@router.get("/widgets/manifest")
async def widget_manifest():
    return MANIFEST


# ── Shared HTML shell ─────────────────────────────────────────────────────────

def _widget_page(title: str, body: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>
  *{{box-sizing:border-box;margin:0;padding:0}}
  body{{background:#0a1628;color:#e2e8f0;font-family:'Inter',system-ui,sans-serif;font-size:13px;height:100vh;overflow:hidden;display:flex;flex-direction:column}}
  .header{{padding:10px 14px;border-bottom:1px solid #1e293b;display:flex;align-items:center;gap:8px;flex-shrink:0}}
  .header-title{{font-size:12px;font-weight:600;color:#94a3b8;letter-spacing:0.03em}}
  .content{{flex:1;overflow:auto;padding:12px}}
  table{{width:100%;border-collapse:collapse}}
  th{{text-align:left;font-size:10px;color:#475569;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;padding:5px 8px;border-bottom:1px solid #1e293b}}
  td{{padding:7px 8px;border-bottom:1px solid #0f172a;font-size:12px;color:#cbd5e1}}
  tr:hover td{{background:#111827}}
  .status-dot{{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}}
  .status-up{{background:#4ade80}}
  .status-down{{background:#f87171}}
  .status-warn{{background:#fbbf24}}
  .status-unk{{background:#475569}}
  .badge{{display:inline-block;padding:1px 7px;border-radius:4px;font-size:10px;font-weight:600}}
  .badge-green{{background:#052e16;color:#4ade80}}
  .badge-red{{background:#3f1515;color:#f87171}}
  .badge-yellow{{background:#422006;color:#fbbf24}}
  .badge-gray{{background:#1e293b;color:#64748b}}
  .empty{{text-align:center;padding:40px;color:#334155;font-size:12px}}
</style>
<script>setTimeout(()=>location.reload(),30000)</script>
</head>
<body>
{body}
</body>
</html>"""


def _status_class(status: str) -> str:
    s = (status or '').lower()
    if s in ('up', 'online', 'active'): return 'up'
    if s in ('down', 'offline', 'unreachable'): return 'down'
    if s in ('warn', 'warning', 'degraded'): return 'warn'
    return 'unk'

def _badge_class(status: str) -> str:
    s = (status or '').lower()
    if s in ('up', 'online', 'active'): return 'green'
    if s in ('down', 'offline', 'unreachable'): return 'red'
    if s in ('warn', 'warning', 'degraded'): return 'yellow'
    return 'gray'

def _fmt_ts(ts: str) -> str:
    if not ts: return '—'
    return str(ts)[:19].replace('T', ' ')


# ── Device Table widget ───────────────────────────────────────────────────────

@router.get("/widgets/device_table", response_class=HTMLResponse, include_in_schema=False)
async def widget_device_table():
    rows = []
    try:
        async with aiosqlite.connect(str(_DB)) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("""
                SELECT name, ip, device_type, status, last_seen, enabled
                FROM devices
                WHERE enabled = 1
                ORDER BY
                  CASE LOWER(status)
                    WHEN 'down' THEN 0
                    WHEN 'warn' THEN 1
                    WHEN 'up'   THEN 2
                    ELSE 3
                  END,
                  name
                LIMIT 40
            """) as cur:
                rows = [dict(r) for r in await cur.fetchall()]
    except Exception:
        pass

    if rows:
        trs = "".join(
            f"<tr>"
            f"<td><span class='status-dot status-{_status_class(r['status'])}'></span>{r['name'] or '—'}</td>"
            f"<td style='font-family:monospace;color:#60a5fa'>{r['ip'] or '—'}</td>"
            f"<td style='color:#64748b'>{r['device_type'] or '—'}</td>"
            f"<td><span class='badge badge-{_badge_class(r[\"status\"])}'>{(r['status'] or 'unknown').upper()}</span></td>"
            f"<td style='font-size:10px;color:#475569'>{_fmt_ts(r['last_seen'])}</td>"
            f"</tr>"
            for r in rows
        )
        table = f"""<table>
<thead><tr><th>Device</th><th>IP</th><th>Type</th><th>Status</th><th>Last Seen</th></tr></thead>
<tbody>{trs}</tbody></table>"""

        # Status summary bar
        up = sum(1 for r in rows if _status_class(r['status']) == 'up')
        down = sum(1 for r in rows if _status_class(r['status']) == 'down')
        warn = sum(1 for r in rows if _status_class(r['status']) == 'warn')
        total = len(rows)
        summary = f"""
<div style="display:flex;gap:12px;margin-bottom:10px;padding:8px 4px">
  <div style="display:flex;align-items:center;gap:5px">
    <span class="status-dot status-up"></span>
    <span style="font-size:11px;color:#4ade80;font-weight:600">{up} Up</span>
  </div>
  <div style="display:flex;align-items:center;gap:5px">
    <span class="status-dot status-down"></span>
    <span style="font-size:11px;color:#f87171;font-weight:600">{down} Down</span>
  </div>
  <div style="display:flex;align-items:center;gap:5px">
    <span class="status-dot status-warn"></span>
    <span style="font-size:11px;color:#fbbf24;font-weight:600">{warn} Warn</span>
  </div>
  <span style="font-size:11px;color:#475569;margin-left:auto">{total} devices</span>
</div>"""
    else:
        summary = ""
        table = "<div class='empty'>No enabled devices found</div>"

    body = f"""
<div class="header">
  <div style="width:6px;height:6px;border-radius:50%;background:#a78bfa"></div>
  <span class="header-title">Device Status</span>
</div>
<div class="content">{summary}{table}</div>"""
    return HTMLResponse(_widget_page("Device Status", body))


# ── Collector Status widget ───────────────────────────────────────────────────

@router.get("/widgets/collector_status", response_class=HTMLResponse, include_in_schema=False)
async def widget_collector_status():
    rows = []
    try:
        async with aiosqlite.connect(str(_DB)) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("""
                SELECT name, ip, status, last_seen, auth_failure_count
                FROM collectors
                ORDER BY name
                LIMIT 20
            """) as cur:
                rows = [dict(r) for r in await cur.fetchall()]
    except Exception:
        pass

    if rows:
        trs = "".join(
            f"<tr>"
            f"<td><span class='status-dot status-{_status_class(r[\"status\"])}'></span>{r['name'] or '—'}</td>"
            f"<td style='font-family:monospace;color:#60a5fa'>{r['ip'] or '—'}</td>"
            f"<td><span class='badge badge-{_badge_class(r[\"status\"])}'>{(r['status'] or 'unknown').upper()}</span></td>"
            f"<td style='font-size:10px;color:#475569'>{_fmt_ts(r['last_seen'])}</td>"
            f"<td style='color:{\"#f87171\" if (r[\"auth_failure_count\"] or 0) > 0 else \"#475569\"}'>{r['auth_failure_count'] or 0}</td>"
            f"</tr>"
            for r in rows
        )
        table = f"""<table>
<thead><tr><th>Collector</th><th>IP</th><th>Status</th><th>Last Seen</th><th>Auth Fails</th></tr></thead>
<tbody>{trs}</tbody></table>"""
    else:
        table = "<div class='empty'>No collectors registered</div>"

    body = f"""
<div class="header">
  <div style="width:6px;height:6px;border-radius:50%;background:#60a5fa"></div>
  <span class="header-title">Collector Status</span>
</div>
<div class="content">{table}</div>"""
    return HTMLResponse(_widget_page("Collector Status", body))
