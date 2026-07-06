"""
pktLog — Widget endpoints for pktHub NOC Builder integration.

Manifest: GET /api/widgets/manifest  → list of widget definitions
Views:    GET /api/widgets/{widget_type}  → server-rendered HTML page (iframe target)
"""
from __future__ import annotations

import csv
import io
from pathlib import Path
from typing import Optional

import aiosqlite
from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse

from app.config import get_settings
from app.storage.factory import get_storage

router = APIRouter()
settings = get_settings()

_DB = Path(__file__).parent.parent.parent / "pktlog.db"

# ── Manifest ──────────────────────────────────────────────────────────────────

MANIFEST = [
    {
        "id": "log_stream",
        "title": "Live Log Stream",
        "description": "Scrolling recent syslog events with severity color coding",
        "view_path": "/api/widgets/log_stream",
        "default_w": 700,
        "default_h": 400,
        "min_w": 400,
        "min_h": 200,
    },
    {
        "id": "error_rate",
        "title": "Error Rate",
        "description": "Error and critical event counts by severity over time",
        "view_path": "/api/widgets/error_rate",
        "default_w": 460,
        "default_h": 280,
        "min_w": 280,
        "min_h": 180,
    },
    {
        "id": "facility_breakdown",
        "title": "Facility Breakdown",
        "description": "Syslog message volume by facility",
        "view_path": "/api/widgets/facility_breakdown",
        "default_w": 460,
        "default_h": 320,
        "min_w": 260,
        "min_h": 180,
    },
    {
        "id": "alert_events",
        "title": "Alert Events",
        "description": "High-severity syslog events and alert triggers",
        "view_path": "/api/widgets/alert_events",
        "default_w": 640,
        "default_h": 360,
        "min_w": 320,
        "min_h": 200,
    },
    {
        "id": "log_sources",
        "title": "Log Sources",
        "description": "Syslog senders with message counts over last 24 hours",
        "view_path": "/api/widgets/log_sources",
        "default_w": 640,
        "default_h": 340,
        "min_w": 340,
        "min_h": 200,
    },
    {
        "id": "top_devices",
        "title": "Top Devices",
        "description": "Highest-volume syslog senders in the last hour",
        "view_path": "/api/widgets/top_devices",
        "default_w": 500,
        "default_h": 320,
        "min_w": 300,
        "min_h": 200,
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
  html,body{{background:#0a1628;color:#e2e8f0;font-family:'Inter',system-ui,sans-serif;font-size:13px;height:100vh;overflow:hidden;display:flex;flex-direction:column}}
  .header{{padding:10px 14px;border-bottom:1px solid #1e293b;display:flex;align-items:center;gap:8px;flex-shrink:0}}
  .header-title{{font-size:12px;font-weight:600;color:#94a3b8;letter-spacing:0.03em}}
  .content{{flex:1;overflow:hidden;padding:12px}}
  .log-row{{padding:5px 8px;border-bottom:1px solid #0f172a;font-size:11px;font-family:monospace;display:flex;align-items:center;gap:8px;overflow:hidden}}
  .sev{{display:inline-block;width:14px;height:14px;border-radius:3px;flex-shrink:0;font-size:9px;text-align:center;line-height:14px;font-weight:700}}
  .sev-0,.sev-1,.sev-2{{background:#3f1515;color:#f87171}}
  .sev-3{{background:#431407;color:#fb923c}}
  .sev-4{{background:#422006;color:#fbbf24}}
  .sev-5,.sev-6{{background:#052e16;color:#4ade80}}
  .sev-7{{background:#1e293b;color:#94a3b8}}
  .ts{{color:#475569;font-size:10px;flex-shrink:0}}
  .host{{color:#60a5fa;flex-shrink:0}}
  .msg{{color:#cbd5e1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
  .empty{{text-align:center;padding:40px;color:#334155;font-size:12px}}
  table{{width:100%;border-collapse:collapse}}
  th{{text-align:left;font-size:10px;color:#475569;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;padding:4px 8px;border-bottom:1px solid #1e293b}}
  td{{padding:6px 8px;border-bottom:1px solid #0f172a;font-size:12px;color:#cbd5e1}}
  .badge{{display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600}}
  .bar-row{{display:flex;align-items:center;gap:8px;margin-bottom:8px}}
  .bar-label{{font-size:11px;color:#94a3b8;width:110px;flex-shrink:0;text-overflow:ellipsis;overflow:hidden;white-space:nowrap}}
  .bar-track{{flex:1;background:#1e293b;border-radius:3px;height:8px;overflow:hidden}}
  .bar-fill{{height:8px;border-radius:3px;transition:width 0.3s}}
  .bar-val{{font-size:10px;color:#475569;width:40px;text-align:right;flex-shrink:0}}
</style>
<script>setTimeout(()=>location.reload(),30000)</script>
</head>
<body>
{body}
</body>
</html>"""


_SEV_LABELS = {0: "EMG", 1: "ALT", 2: "CRT", 3: "ERR", 4: "WRN", 5: "NTC", 6: "INF", 7: "DBG"}

FACILITY_NAMES = {
    0: "kern", 1: "user", 2: "mail", 3: "daemon", 4: "auth", 5: "syslog",
    6: "lpr", 7: "news", 8: "uucp", 9: "cron", 10: "authpriv", 11: "ftp",
    16: "local0", 17: "local1", 18: "local2", 19: "local3",
    20: "local4", 21: "local5", 22: "local6", 23: "local7",
}


def _clamp_sev(raw) -> int:
    try:
        return min(7, max(0, int(raw or 7)))
    except Exception:
        return 7


def _fmt_ts(ts: str) -> str:
    if not ts:
        return ""
    return str(ts)[:19].replace("T", " ")


def _esc(s: str) -> str:
    return str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# ── PAN-OS parsing ────────────────────────────────────────────────────────────

_PANOS_TYPES = {"TRAFFIC", "THREAT", "SYSTEM", "CONFIG", "HIPMATCH", "GLOBALPROTECT", "AUTHENTICATION", "USERID"}


def _parse_panos(msg: str) -> Optional[dict]:
    if not msg:
        return None
    log_type = None
    type_start = -1
    for t in _PANOS_TYPES:
        idx = msg.find("," + t + ",")
        if idx != -1:
            type_start = idx
            log_type = t
            break
    if type_start == -1:
        return None

    # Walk back 3 commas to find the CSV start (field 0)
    commas = 0
    csv_start = 0
    for i in range(type_start - 1, -1, -1):
        if msg[i] == ",":
            commas += 1
            if commas == 3:
                csv_start = i + 1
                break

    try:
        reader = csv.reader(io.StringIO(msg[csv_start:]))
        f = next(reader)
    except StopIteration:
        return None

    def g(idx: int) -> str:
        return f[idx].strip() if idx < len(f) else ""

    if len(f) < 5 or f[3] != log_type or len(f) < 9:
        return None

    return {
        "log_type":   log_type,
        "subtype":    g(4),
        "src_ip":     g(7),
        "dst_ip":     g(8),
        "src_port":   g(24),
        "dst_port":   g(25),
        "protocol":   g(29).upper(),
        "action":     g(30) or g(4),
        "application":g(14),
        "rule_name":  g(11),
        "device_name":g(52) if len(f) > 52 else "",
    }


def _try_parse_panos(record: dict) -> Optional[dict]:
    for key in ("raw", "message"):
        val = record.get(key)
        if val:
            pan = _parse_panos(str(val))
            if pan:
                return pan
    return None


# ── Card renderers ────────────────────────────────────────────────────────────

def _render_panos_card(pan: dict) -> str:
    action = (pan["action"] or "deny").lower()
    if action in ("allow", "end", "start"):
        border = "#16a34a"
        chip_bg = "rgba(74,222,128,0.12)"
        chip_bd = "rgba(74,222,128,0.25)"
        chip_tx = "#4ade80"
    elif action.startswith("reset"):
        border = "#d97706"
        chip_bg = "rgba(251,191,36,0.12)"
        chip_bd = "rgba(251,191,36,0.25)"
        chip_tx = "#fbbf24"
    else:
        border = "#dc2626"
        chip_bg = "rgba(248,113,113,0.12)"
        chip_bd = "rgba(248,113,113,0.25)"
        chip_tx = "#f87171"

    action_label = _esc(pan["action"].upper() or action.upper())
    subtype_label = _esc(pan["subtype"]) if pan["subtype"].upper() != action_label else ""

    chip_style = "font-size:8px;font-weight:700;padding:2px 6px;border-radius:3px;text-transform:uppercase;letter-spacing:0.05em"
    chips = (
        f"<span style='{chip_style};background:rgba(96,165,250,0.12);color:#60a5fa;border:1px solid rgba(96,165,250,0.25)'>PAN-OS {_esc(pan['log_type'])}</span>"
        f"<span style='{chip_style};background:{chip_bg};color:{chip_tx};border:1px solid {chip_bd}'>{action_label}</span>"
    )
    if subtype_label:
        chips += f"<span style='{chip_style};background:rgba(148,163,184,0.08);color:#94a3b8;border:1px solid rgba(148,163,184,0.15)'>{subtype_label}</span>"
    if pan["device_name"]:
        chips += f"<span style='color:#334155;font-size:8px;margin-left:auto'>{_esc(pan['device_name'])}</span>"

    proto = pan["protocol"]
    proto_html = (
        f"<span style='font-size:8px;font-weight:700;padding:1px 5px;border-radius:10px;"
        f"background:rgba(255,255,255,0.05);color:#64748b;border:1px solid rgba(255,255,255,0.08)'>{_esc(proto)}</span>"
        if proto else ""
    )

    src = _esc(f"{pan['src_ip']}:{pan['src_port']}" if pan["src_port"] else pan["src_ip"])
    dst = _esc(f"{pan['dst_ip']}:{pan['dst_port']}" if pan["dst_port"] else pan["dst_ip"])

    return (
        f"<div style='background:#0f1a2e;border:1px solid rgba(255,255,255,0.07);"
        f"border-left:3px solid {border};border-radius:4px;padding:6px 10px;margin-bottom:4px'>"
        f"<div style='display:flex;align-items:center;gap:5px;margin-bottom:5px;flex-wrap:wrap'>{chips}</div>"
        f"<div style='display:flex;align-items:center;gap:5px;flex-wrap:wrap;font-family:monospace'>"
        f"<span style='color:#e2e8f0;font-weight:600;font-size:13px'>{src}</span>"
        f"{proto_html}"
        f"<span style='color:#334155;font-size:12px'>──►</span>"
        f"<span style='color:#e2e8f0;font-weight:600;font-size:13px'>{dst}</span>"
        f"</div></div>"
    )


def _render_compact_card(r: dict) -> str:
    sev = _clamp_sev(r.get("severity", 7))
    label = _SEV_LABELS.get(sev, "INF")
    SEV_C = {0:"#f87171",1:"#f87171",2:"#fb923c",3:"#fca5a5",4:"#fbbf24",5:"#60a5fa",6:"#4ade80",7:"#64748b"}
    color = SEV_C.get(sev, "#4ade80")
    host = _esc(str(r.get("source_name") or r.get("source_ip") or ""))
    ts = _esc(_fmt_ts(str(r.get("timestamp", ""))))
    msg = _esc(str(r.get("message") or "")[:300])
    return (
        f"<div style='display:flex;align-items:flex-start;gap:6px;padding:4px 8px;background:#0b1627;"
        f"border:1px solid rgba(255,255,255,0.04);border-radius:3px;margin-bottom:4px'>"
        f"<span style='font-size:7px;font-weight:700;padding:2px 4px;border-radius:2px;flex-shrink:0;"
        f"text-transform:uppercase;color:{color};background:rgba(0,0,0,0.3);margin-top:1px'>{label}</span>"
        f"<div style='flex:1;min-width:0'>"
        f"<div style='color:#64748b;font-size:9px;margin-bottom:2px'>{host} · {ts}</div>"
        f"<div style='color:#94a3b8;font-size:10px;word-break:break-all;line-height:1.4'>{msg}</div>"
        f"</div></div>"
    )


# ── Log Stream widget ─────────────────────────────────────────────────────────

@router.get("/widgets/log_stream", response_class=HTMLResponse, include_in_schema=False)
async def widget_log_stream(
    severity_max: Optional[int] = Query(None, ge=0, le=7,
                                        description="Max severity to display (0=emerg … 7=debug)"),
):
    records = []
    try:
        result = await get_storage().search(limit=60, severity_max=severity_max)
        records = result.get("records", [])
    except Exception:
        pass

    parts = []
    for r in records:
        pan = _try_parse_panos(r)
        if pan:
            parts.append(_render_panos_card(pan))
        else:
            parts.append(_render_compact_card(r))

    content = "".join(parts) if parts else "<div class='empty'>No recent log entries</div>"
    sev_label = f"sev≤{severity_max}" if severity_max is not None else "all severities"

    body = (
        "<div class='header'>"
        "<div style='width:6px;height:6px;border-radius:50%;background:#4ade80'></div>"
        f"<span class='header-title'>Live Log Stream &bull; {sev_label}</span></div>"
        f"<div class='content' style='padding:6px'>{content}</div>"
    )
    return HTMLResponse(_widget_page("Log Stream", body))


# ── Error Rate widget ─────────────────────────────────────────────────────────

@router.get("/widgets/error_rate", response_class=HTMLResponse, include_in_schema=False)
async def widget_error_rate():
    stats: dict[int, int] = {}
    try:
        rows = await get_storage().count_by_severity(hours=1)
        stats = {int(r["severity"]): int(r["count"]) for r in rows}
    except Exception:
        pass

    critical = sum(stats.get(i, 0) for i in range(3))
    error = stats.get(3, 0)
    warning = stats.get(4, 0)
    info = sum(stats.get(i, 0) for i in range(5, 8))
    total = critical + error + warning + info or 1

    def bar(pct: float, color: str) -> str:
        w = max(2, int(pct * 100))
        return f"<div style='height:8px;border-radius:4px;background:{color};width:{w}%;transition:width 0.3s'></div>"

    content = f"""<div style="display:flex;flex-direction:column;gap:14px">
  <div><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:#f87171;font-size:11px;font-weight:600">Critical / Alert / Emergency</span><span style="color:#f87171;font-weight:700">{critical}</span></div>{bar(critical/total,'#f87171')}</div>
  <div><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:#fb923c;font-size:11px;font-weight:600">Error</span><span style="color:#fb923c;font-weight:700">{error}</span></div>{bar(error/total,'#fb923c')}</div>
  <div><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:#fbbf24;font-size:11px;font-weight:600">Warning</span><span style="color:#fbbf24;font-weight:700">{warning}</span></div>{bar(warning/total,'#fbbf24')}</div>
  <div><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:#4ade80;font-size:11px;font-weight:600">Notice / Info / Debug</span><span style="color:#4ade80;font-weight:700">{info}</span></div>{bar(info/total,'#4ade80')}</div>
  <div style="margin-top:8px;padding-top:8px;border-top:1px solid #1e293b;font-size:10px;color:#475569">Last 60 minutes &bull; {total} total events</div>
</div>"""

    body = (
        "<div class='header'>"
        "<div style='width:6px;height:6px;border-radius:50%;background:#fb923c'></div>"
        "<span class='header-title'>Error Rate &mdash; last 60 min</span></div>"
        f"<div class='content'>{content}</div>"
    )
    return HTMLResponse(_widget_page("Error Rate", body))


# ── Facility Breakdown widget ─────────────────────────────────────────────────

@router.get("/widgets/facility_breakdown", response_class=HTMLResponse, include_in_schema=False)
async def widget_facility_breakdown():
    rows = []
    try:
        rows = await get_storage().count_by_facility(hours=1)
    except Exception:
        pass

    COLORS = [
        "#60a5fa", "#a78bfa", "#4ade80", "#2dd4bf", "#f472b6",
        "#fbbf24", "#fb923c", "#f87171", "#818cf8", "#34d399", "#e879f9", "#38bdf8",
    ]
    max_cnt = max((r["count"] for r in rows), default=1)

    if rows:
        bars = []
        for i, r in enumerate(rows):
            label = r.get("facility_name") or FACILITY_NAMES.get(int(r.get("facility") or 0), f"fac{r.get('facility')}")
            pct = int(((r["count"]) / max_cnt) * 100)
            color = COLORS[i % len(COLORS)]
            bars.append(
                f"<div class='bar-row'>"
                f"<span class='bar-label' title='{label}'>{label}</span>"
                f"<div class='bar-track'><div class='bar-fill' style='width:{pct}%;background:{color}'></div></div>"
                f"<span class='bar-val'>{r['count']}</span>"
                f"</div>"
            )
        content = "".join(bars)
    else:
        content = "<div class='empty'>No syslog data in last 60 min</div>"

    body = (
        "<div class='header'>"
        "<div style='width:6px;height:6px;border-radius:50%;background:#818cf8'></div>"
        "<span class='header-title'>Facility Breakdown &mdash; last 60 min</span></div>"
        f"<div class='content'>{content}</div>"
    )
    return HTMLResponse(_widget_page("Facility Breakdown", body))


# ── Alert Events widget ───────────────────────────────────────────────────────

@router.get("/widgets/alert_events", response_class=HTMLResponse, include_in_schema=False)
async def widget_alert_events():
    rows = []
    try:
        async with aiosqlite.connect(str(_DB)) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT fired_at as ts, severity, message as msg, rule_name "
                "FROM alert_events ORDER BY fired_at DESC LIMIT 30"
            ) as cur:
                rows = [dict(r) for r in await cur.fetchall()]
    except Exception:
        pass

    SEV_COLORS = {0: "#f87171", 1: "#f87171", 2: "#f87171", 3: "#fb923c", 4: "#fbbf24"}

    if rows:
        trs = []
        for r in rows:
            try:
                sev_int = min(7, max(0, int(r.get("severity", 3) or 3)))
            except Exception:
                sev_int = 3
            color = SEV_COLORS.get(sev_int, "#94a3b8")
            label = _SEV_LABELS.get(sev_int, "ERR")
            rule = _esc(str(r.get("rule_name") or "")[:24])
            msg = _esc(str(r.get("msg") or "")[:80])
            trs.append(
                f"<tr>"
                f"<td style='font-size:10px;color:#475569'>{_fmt_ts(r.get('ts', ''))}</td>"
                f"<td><span class='badge' style='background:#1e293b;color:{color}'>{label}</span></td>"
                f"<td style='color:#60a5fa;font-size:11px'>{rule}</td>"
                f"<td style='color:#e2e8f0'>{msg}</td>"
                f"</tr>"
            )
        table = (
            "<table><thead><tr><th>Time</th><th>Sev</th><th>Rule</th><th>Message</th></tr></thead>"
            f"<tbody>{''.join(trs)}</tbody></table>"
        )
    else:
        table = "<div class='empty'>No alert events</div>"

    body = (
        "<div class='header'>"
        "<div style='width:6px;height:6px;border-radius:50%;background:#f87171'></div>"
        "<span class='header-title'>Alert Events</span></div>"
        f"<div class='content'>{table}</div>"
    )
    return HTMLResponse(_widget_page("Alert Events", body))


# ── Log Sources widget ────────────────────────────────────────────────────────

@router.get("/widgets/log_sources", response_class=HTMLResponse, include_in_schema=False)
async def widget_log_sources():
    rows = []
    try:
        rows = await get_storage().count_by_host(hours=24, limit=25)
    except Exception:
        pass

    if rows:
        trs = []
        for r in rows:
            host = _esc(str(r.get("source_name") or r.get("source_ip") or "—"))
            ip = _esc(str(r.get("source_ip", "")))
            group = _esc(str(r.get("log_group", "")))
            cnt = f"{int(r.get('count', 0)):,}"
            trs.append(
                f"<tr>"
                f"<td>{host}</td>"
                f"<td style='font-family:monospace;font-size:11px;color:#475569'>{ip}</td>"
                f"<td style='color:#64748b;font-size:11px'>{group}</td>"
                f"<td>{cnt}</td>"
                f"</tr>"
            )
        content = (
            "<table><thead><tr><th>Host</th><th>IP</th><th>Group</th><th>Messages (24h)</th></tr></thead>"
            f"<tbody>{''.join(trs)}</tbody></table>"
        )
    else:
        content = "<div class='empty'>No syslog sources in last 24 hours</div>"

    body = (
        "<div class='header'>"
        "<div style='width:6px;height:6px;border-radius:50%;background:#38bdf8'></div>"
        "<span class='header-title'>Log Sources &mdash; last 24 hr</span></div>"
        f"<div class='content'>{content}</div>"
    )
    return HTMLResponse(_widget_page("Log Sources", body))


# ── Top Devices widget ────────────────────────────────────────────────────────

@router.get("/widgets/top_devices", response_class=HTMLResponse, include_in_schema=False)
async def widget_top_devices():
    rows = []
    try:
        rows = await get_storage().count_by_host(hours=1, limit=15)
    except Exception:
        pass

    max_cnt = max((int(r.get("count", 0)) for r in rows), default=1)

    if rows:
        bars = []
        for r in rows:
            dev = _esc(str(r.get("source_name") or r.get("source_ip") or "—")[:28])
            cnt = int(r.get("count", 0))
            pct = int((cnt / max_cnt) * 100)
            bars.append(
                f"<div class='bar-row'>"
                f"<span class='bar-label' title='{dev}'>{dev}</span>"
                f"<div class='bar-track'><div class='bar-fill' style='width:{pct}%;background:#818cf8'></div></div>"
                f"<span class='bar-val'>{cnt:,}</span>"
                f"</div>"
            )
        content = "".join(bars)
    else:
        content = "<div class='empty'>No device activity in the last hour</div>"

    body = (
        "<div class='header'>"
        "<div style='width:6px;height:6px;border-radius:50%;background:#818cf8'></div>"
        "<span class='header-title'>Top Devices &mdash; last 1 hr</span></div>"
        f"<div class='content'>{content}</div>"
    )
    return HTMLResponse(_widget_page("Top Devices", body))
