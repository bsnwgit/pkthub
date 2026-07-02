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
    {
        "id": "trap_events",
        "title": "Trap Events",
        "description": "Recent SNMP trap events from devices",
        "view_path": "/api/widgets/trap_events",
        "default_w": 640,
        "default_h": 360,
        "min_w": 320,
        "min_h": 200,
    },
    {
        "id": "active_alerts",
        "title": "Active Alerts",
        "description": "SNMP-triggered alert events",
        "view_path": "/api/widgets/active_alerts",
        "default_w": 640,
        "default_h": 360,
        "min_w": 320,
        "min_h": 200,
    },
    {
        "id": "metrics_overview",
        "title": "Metrics Overview",
        "description": "Latest OID poll values across devices",
        "view_path": "/api/widgets/metrics_overview",
        "default_w": 640,
        "default_h": 400,
        "min_w": 340,
        "min_h": 220,
    },
    {
        "id": "metrics_chart",
        "title": "Metrics Chart",
        "description": "SNMP polled metrics — latest values with per-OID sparklines",
        "view_path": "/api/widgets/metrics_chart",
        "default_w": 720,
        "default_h": 420,
        "min_w": 400,
        "min_h": 260,
    }
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
    if s in ('up','online','active'): return 'up'
    if s in ('down','offline','unreachable'): return 'down'
    if s in ('warn','warning','degraded'): return 'warn'
    return 'unk'

def _badge_class(status: str) -> str:
    s = (status or '').lower()
    if s in ('up','online','active'): return 'green'
    if s in ('down','offline','unreachable'): return 'red'
    if s in ('warn','warning','degraded'): return 'yellow'
    return 'gray'

def _fmt_ts(ts: str) -> str:
    if not ts: return '—'
    return str(ts)[:19].replace('T',' ')

def _auth_color(count) -> str:
    return '#f87171' if (count or 0) > 0 else '#475569'


# ── Device Table widget ───────────────────────────────────────────────────────

@router.get("/widgets/device_table", response_class=HTMLResponse, include_in_schema=False)
async def widget_device_table():
    rows = []
    try:
        async with aiosqlite.connect(str(_DB)) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("""
                SELECT name, ip, device_type, status, last_seen, enabled FROM devices
                WHERE enabled = 1
                ORDER BY CASE LOWER(status) WHEN 'down' THEN 0 WHEN 'warn' THEN 1 WHEN 'up' THEN 2 ELSE 3 END, name
                LIMIT 40
            """) as cur:
                rows = [dict(r) for r in await cur.fetchall()]
    except Exception:
        pass

    if rows:
        up = sum(1 for r in rows if _status_class(r['status']) == 'up')
        down = sum(1 for r in rows if _status_class(r['status']) == 'down')
        warn = sum(1 for r in rows if _status_class(r['status']) == 'warn')
        summary = f"""<div style="display:flex;gap:12px;margin-bottom:10px;padding:8px 4px">
  <div style="display:flex;align-items:center;gap:5px"><span class="status-dot status-up"></span><span style="font-size:11px;color:#4ade80;font-weight:600">{up} Up</span></div>
  <div style="display:flex;align-items:center;gap:5px"><span class="status-dot status-down"></span><span style="font-size:11px;color:#f87171;font-weight:600">{down} Down</span></div>
  <div style="display:flex;align-items:center;gap:5px"><span class="status-dot status-warn"></span><span style="font-size:11px;color:#fbbf24;font-weight:600">{warn} Warn</span></div>
  <span style="font-size:11px;color:#475569;margin-left:auto">{len(rows)} devices</span>
</div>"""
        trs = "".join(
            f"<tr><td><span class='status-dot status-{_status_class(r['status'])}'></span>{r['name'] or '—'}</td>"
            f"<td style='font-family:monospace;color:#60a5fa'>{r['ip'] or '—'}</td>"
            f"<td style='color:#64748b'>{r['device_type'] or '—'}</td>"
            f"<td><span class='badge badge-{_badge_class(r['status'])}'>{(r['status'] or 'unknown').upper()}</span></td>"
            f"<td style='font-size:10px;color:#475569'>{_fmt_ts(r['last_seen'])}</td></tr>"
            for r in rows
        )
        table = f"<table><thead><tr><th>Device</th><th>IP</th><th>Type</th><th>Status</th><th>Last Seen</th></tr></thead><tbody>{trs}</tbody></table>"
    else:
        summary = ""
        table = "<div class='empty'>No enabled devices found</div>"

    body = f"""<div class="header"><div style="width:6px;height:6px;border-radius:50%;background:#a78bfa"></div><span class="header-title">Device Status</span></div>
<div class="content">{summary}{table}</div>"""
    return HTMLResponse(_widget_page("Device Status", body))


# ── Collector Status widget ───────────────────────────────────────────────────

@router.get("/widgets/collector_status", response_class=HTMLResponse, include_in_schema=False)
async def widget_collector_status():
    rows = []
    try:
        async with aiosqlite.connect(str(_DB)) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("SELECT name, ip, status, last_seen, auth_failure_count FROM collectors ORDER BY name LIMIT 20") as cur:
                rows = [dict(r) for r in await cur.fetchall()]
    except Exception:
        pass

    if rows:
        trs = "".join(
            f"<tr><td><span class='status-dot status-{_status_class(r['status'])}'></span>{r['name'] or '—'}</td>"
            f"<td style='font-family:monospace;color:#60a5fa'>{r['ip'] or '—'}</td>"
            f"<td><span class='badge badge-{_badge_class(r['status'])}'>{(r['status'] or 'unknown').upper()}</span></td>"
            f"<td style='font-size:10px;color:#475569'>{_fmt_ts(r['last_seen'])}</td>"
            f"<td style='color:{_auth_color(r['auth_failure_count'])}'>{r['auth_failure_count'] or 0}</td></tr>"
            for r in rows
        )
        table = f"<table><thead><tr><th>Collector</th><th>IP</th><th>Status</th><th>Last Seen</th><th>Auth Fails</th></tr></thead><tbody>{trs}</tbody></table>"
    else:
        table = "<div class='empty'>No collectors registered</div>"

    body = f"""<div class="header"><div style="width:6px;height:6px;border-radius:50%;background:#60a5fa"></div><span class="header-title">Collector Status</span></div>
<div class="content">{table}</div>"""
    return HTMLResponse(_widget_page("Collector Status", body))


# ── Trap Events widget ────────────────────────────────────────────────────────

@router.get("/widgets/trap_events", response_class=HTMLResponse, include_in_schema=False)
async def widget_trap_events():
    rows = []
    try:
        async with aiosqlite.connect(str(_DB)) as db:
            db.row_factory = aiosqlite.Row
            for q in [
                "SELECT received_at as ts, source_ip, snmp_version, trap_oid, community FROM snmp_traps ORDER BY received_at DESC LIMIT 30",
                "SELECT timestamp as ts, source_ip, snmp_version, trap_oid, community FROM traps ORDER BY timestamp DESC LIMIT 30",
            ]:
                try:
                    async with db.execute(q) as cur:
                        rows = [dict(r) for r in await cur.fetchall()]
                    if rows: break
                except Exception:
                    continue
    except Exception:
        pass

    if rows:
        trs = "".join(
            f"<tr>"
            f"<td style='font-size:10px;color:#475569'>{_fmt_ts(r.get('ts',''))}</td>"
            f"<td style='font-family:monospace;color:#60a5fa'>{r.get('source_ip','—')}</td>"
            f"<td><span class='badge badge-gray'>{r.get('snmp_version','—')}</span></td>"
            f"<td style='font-size:10px;color:#94a3b8;font-family:monospace'>{str(r.get('trap_oid','—'))[:40]}</td>"
            f"</tr>"
            for r in rows
        )
        table = f"<table><thead><tr><th>Time</th><th>Source</th><th>Ver</th><th>OID</th></tr></thead><tbody>{trs}</tbody></table>"
    else:
        table = "<div class='empty'>No recent trap events</div>"

    body = f"""<div class="header"><div style="width:6px;height:6px;border-radius:50%;background:#fbbf24"></div><span class="header-title">Trap Events</span></div>
<div class="content">{table}</div>"""
    return HTMLResponse(_widget_page("Trap Events", body))


# ── Active Alerts widget ──────────────────────────────────────────────────────

@router.get("/widgets/active_alerts", response_class=HTMLResponse, include_in_schema=False)
async def widget_active_alerts():
    rows = []
    try:
        async with aiosqlite.connect(str(_DB)) as db:
            db.row_factory = aiosqlite.Row
            for q in [
                "SELECT fired_at as ts, severity, message, rule_name FROM alert_events ORDER BY fired_at DESC LIMIT 30",
                "SELECT created_at as ts, severity, message, rule_name FROM alerts ORDER BY created_at DESC LIMIT 30",
                "SELECT timestamp as ts, level as severity, message, '' as rule_name FROM logs WHERE level IN ('critical','error','warning') ORDER BY timestamp DESC LIMIT 30",
            ]:
                try:
                    async with db.execute(q) as cur:
                        rows = [dict(r) for r in await cur.fetchall()]
                    if rows: break
                except Exception:
                    continue
    except Exception:
        pass

    SEV_MAP = {"critical":"#f87171","high":"#f87171","error":"#fb923c","warning":"#fbbf24","medium":"#fbbf24","low":"#4ade80","info":"#60a5fa"}

    if rows:
        trs = []
        for r in rows:
            sev = str(r.get("severity") or "info").lower()
            color = SEV_MAP.get(sev, "#94a3b8")
            trs.append(
                f"<tr>"
                f"<td style='font-size:10px;color:#475569'>{_fmt_ts(r.get('ts',''))}</td>"
                f"<td><span class='badge' style='background:#1e293b;color:{color}'>{sev.upper()}</span></td>"
                f"<td style='color:#60a5fa;font-size:11px'>{str(r.get('rule_name',''))[:24]}</td>"
                f"<td>{str(r.get('message',''))[:70]}</td>"
                f"</tr>"
            )
        table = f"<table><thead><tr><th>Time</th><th>Sev</th><th>Rule</th><th>Message</th></tr></thead><tbody>{''.join(trs)}</tbody></table>"
    else:
        table = "<div class='empty'>No recent alerts</div>"

    body = f"""<div class="header"><div style="width:6px;height:6px;border-radius:50%;background:#f87171"></div><span class="header-title">Active Alerts</span></div>
<div class="content">{table}</div>"""
    return HTMLResponse(_widget_page("Active Alerts", body))


# ── Metrics Overview widget ───────────────────────────────────────────────────

@router.get("/widgets/metrics_overview", response_class=HTMLResponse, include_in_schema=False)
async def widget_metrics_overview():
    rows = []
    try:
        async with aiosqlite.connect(str(_DB)) as db:
            db.row_factory = aiosqlite.Row
            for q in [
                """SELECT d.name as device_name, d.ip as device_ip, ph.oid_label, ph.value, ph.polled_at as ts
                   FROM snmp_poll_history ph JOIN devices d ON d.id = ph.device_id
                   ORDER BY ph.polled_at DESC LIMIT 40""",
                """SELECT d.name as device_name, d.ip as device_ip, ph.oid_label, ph.value, ph.timestamp as ts
                   FROM poll_history ph JOIN devices d ON d.id = ph.device_id
                   ORDER BY ph.timestamp DESC LIMIT 40""",
                """SELECT '' as device_name, device_ip, oid_label, value, polled_at as ts
                   FROM snmp_poll_history ORDER BY polled_at DESC LIMIT 40""",
            ]:
                try:
                    async with db.execute(q) as cur:
                        rows = [dict(r) for r in await cur.fetchall()]
                    if rows: break
                except Exception:
                    continue
    except Exception:
        pass

    if rows:
        trs = "".join(
            f"<tr>"
            f"<td style='color:#e2e8f0'>{r.get('device_name') or r.get('device_ip','—')}</td>"
            f"<td style='font-size:11px;color:#94a3b8;font-family:monospace'>{str(r.get('oid_label','—'))[:32]}</td>"
            f"<td style='color:#2dd4bf;font-weight:600'>{r.get('value','—')}</td>"
            f"<td style='font-size:10px;color:#475569'>{_fmt_ts(r.get('ts',''))}</td>"
            f"</tr>"
            for r in rows
        )
        table = f"<table><thead><tr><th>Device</th><th>OID</th><th>Value</th><th>Polled</th></tr></thead><tbody>{trs}</tbody></table>"
    else:
        table = "<div class='empty'>No poll history available</div>"

    body = f"""<div class="header"><div style="width:6px;height:6px;border-radius:50%;background:#2dd4bf"></div><span class="header-title">Metrics Overview</span></div>
<div class="content">{table}</div>"""
    return HTMLResponse(_widget_page("Metrics Overview", body))


# ── Metrics Chart ─────────────────────────────────────────────────────────────
@router.get("/widgets/metrics_chart", response_class=HTMLResponse, include_in_schema=False)
async def widget_metrics_chart():
    """Show latest SNMP polled values with mini sparklines from timeseries DB."""
    import os as _os, math as _math, json as _json

    # Locate timeseries DB — try known patterns
    ts_db_candidates = [
        None if None else None,
    ]
    # Find via filesystem relative to main DB
    main_db = str(_DB)
    base_dir = _os.path.dirname(main_db)
    for cand in ("snmp_timeseries.db", "timeseries.db", "pktsnmp_timeseries.db", "metrics.db"):
        ts_db_candidates.append(_os.path.join(base_dir, cand))
    # Also check parent dir
    parent = _os.path.dirname(base_dir)
    for cand in ("snmp_timeseries.db", "timeseries.db"):
        ts_db_candidates.append(_os.path.join(parent, cand))

    ts_path = None
    for c in ts_db_candidates:
        if c and _os.path.exists(str(c)):
            ts_path = str(c)
            break

    rows = []
    sparklines = {}  # oid_name -> list of values (chronological)

    if ts_path:
        try:
            async with aiosqlite.connect(ts_path) as db:
                db.row_factory = aiosqlite.Row
                # Try snmp_latest for current values
                for q in [
                    "SELECT device_ip, oid_name, value, polled_at as ts FROM snmp_latest ORDER BY device_ip, oid_name LIMIT 100",
                    "SELECT host as device_ip, oid as oid_name, value, timestamp as ts FROM snmp_latest ORDER BY host, oid LIMIT 100",
                    "SELECT device as device_ip, metric as oid_name, value, updated_at as ts FROM snmp_latest ORDER BY device, metric LIMIT 100",
                ]:
                    try:
                        async with db.execute(q) as cur:
                            rows = [dict(r) for r in await cur.fetchall()]
                        if rows:
                            break
                    except Exception:
                        continue

                # Sparkline data from poll_results (last 20 readings per oid)
                for q in [
                    "SELECT device_ip, oid_name, value, polled_at FROM snmp_poll_results WHERE polled_at > datetime('now', '-1 hour') ORDER BY device_ip, oid_name, polled_at",
                    "SELECT host as device_ip, oid as oid_name, value, timestamp as polled_at FROM snmp_poll_results ORDER BY host, oid, timestamp DESC LIMIT 500",
                ]:
                    try:
                        async with db.execute(q) as cur:
                            for r in await cur.fetchall():
                                r = dict(r)
                                k = f"{r.get('device_ip','')}/{r.get('oid_name','')}"
                                sparklines.setdefault(k, []).append(r.get("value", 0) or 0)
                        if sparklines:
                            break
                    except Exception:
                        continue
        except Exception as e:
            rows = []

    # If latest table empty, derive from poll_results
    if not rows and ts_path:
        try:
            async with aiosqlite.connect(ts_path) as db:
                db.row_factory = aiosqlite.Row
                for q in [
                    "SELECT device_ip, oid_name, value, MAX(polled_at) as ts FROM snmp_poll_results GROUP BY device_ip, oid_name ORDER BY device_ip, oid_name LIMIT 100",
                    "SELECT host as device_ip, oid as oid_name, value, MAX(timestamp) as ts FROM snmp_poll_results GROUP BY host, oid ORDER BY host, oid LIMIT 100",
                ]:
                    try:
                        async with db.execute(q) as cur:
                            rows = [dict(r) for r in await cur.fetchall()]
                        if rows:
                            break
                    except Exception:
                        continue
        except Exception:
            pass

    def _sparkline_svg(vals, w=80, h=24):
        if not vals or len(vals) < 2:
            return ""
        mn, mx = min(vals), max(vals)
        rng = mx - mn or 1
        pts = []
        for i, v in enumerate(vals[-20:]):
            x = int(i / max(len(vals[-20:]) - 1, 1) * w)
            y = int(h - ((v - mn) / rng) * (h - 2))
            pts.append(f"{x},{y}")
        return (
            f'<svg width="{w}" height="{h}" style="vertical-align:middle">' +
            f'<polyline points="{" ".join(pts)}" fill="none" stroke="#2dd4bf" stroke-width="1.5"/>' +
            f'</svg>'
        )

    def _fmt(v):
        try:
            fv = float(v)
            if fv >= 1_000_000: return f"{fv/1_000_000:.1f}M"
            if fv >= 1_000: return f"{fv/1_000:.1f}K"
            return f"{fv:.2f}"
        except Exception:
            return str(v)[:12]

    if rows:
        trs = []
        for r in rows:
            dev = str(r.get("device_ip","") or r.get("device",""))[:20]
            oid = str(r.get("oid_name","") or r.get("metric",""))[:30]
            val = _fmt(r.get("value","—"))
            ts  = str(r.get("ts",""))[:16].replace("T"," ")
            k   = f"{dev}/{oid}"
            spark = _sparkline_svg(sparklines.get(k, []))
            trs.append(
                f"<tr><td style='font-size:11px;color:#94a3b8'>{dev}</td>"
                f"<td>{oid}</td>"
                f"<td style='text-align:right;font-family:monospace'>{val}</td>"
                f"<td>{spark}</td>"
                f"<td style='font-size:10px;color:#475569'>{ts}</td></tr>"
            )
        content = (
            "<table><thead><tr><th>Device</th><th>Metric</th><th>Value</th><th>Trend</th><th>Polled</th></tr></thead>"
            f"<tbody>{chr(10).join(trs)}</tbody></table>"
        )
    else:
        db_note = f" (checked: {ts_path or 'no timeseries DB found'})" if not rows else ""
        content = f"<div class='empty'>No SNMP metrics data{db_note}</div>"

    body = (
        "<div class='hdr'><div class='hdr-dot' style='background:#f59e0b'></div>"
        "<span class='hdr-title'>SNMP Metrics</span></div>"
        f"<div class='content'>{content}</div>"
    )
    return HTMLResponse(_widget_page("Metrics Chart", body))
