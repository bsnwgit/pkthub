"""
pktLog — Widget endpoints for pktHub NOC Builder integration.

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
  .log-row{{padding:5px 8px;border-bottom:1px solid #0f172a;font-size:11px;font-family:monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:8px}}
  .sev{{display:inline-block;width:14px;height:14px;border-radius:3px;flex-shrink:0;font-size:9px;text-align:center;line-height:14px;font-weight:700}}
  .sev-0,.sev-1,.sev-2{{background:#3f1515;color:#f87171}}
  .sev-3{{background:#431407;color:#fb923c}}
  .sev-4{{background:#422006;color:#fbbf24}}
  .sev-5,.sev-6{{background:#052e16;color:#4ade80}}
  .sev-7{{background:#1e293b;color:#94a3b8}}
  .ts{{color:#475569;font-size:10px;flex-shrink:0}}
  .host{{color:#60a5fa;flex-shrink:0}}
  .msg{{color:#cbd5e1;overflow:hidden;text-overflow:ellipsis}}
  .empty{{text-align:center;padding:40px;color:#334155;font-size:12px}}
  table{{width:100%;border-collapse:collapse}}
  th{{text-align:left;font-size:10px;color:#475569;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;padding:4px 8px;border-bottom:1px solid #1e293b}}
  td{{padding:6px 8px;border-bottom:1px solid #0f172a;font-size:12px;color:#cbd5e1}}
</style>
<script>setTimeout(()=>location.reload(),30000)</script>
</head>
<body>
{body}
</body>
</html>"""


_SEV_LABELS = {0:'EMG',1:'ALT',2:'CRT',3:'ERR',4:'WRN',5:'NTC',6:'INF',7:'DBG'}


# ── Log Stream widget ─────────────────────────────────────────────────────────

@router.get("/widgets/log_stream", response_class=HTMLResponse, include_in_schema=False)
async def widget_log_stream():
    rows = []
    try:
        async with aiosqlite.connect(str(_DB)) as db:
            db.row_factory = aiosqlite.Row
            # Try syslog_messages table first, fall back to logs
            try:
                async with db.execute("""
                    SELECT received_at as ts, hostname as host, severity, message as msg
                    FROM syslog_messages
                    ORDER BY received_at DESC LIMIT 60
                """) as cur:
                    rows = [dict(r) for r in await cur.fetchall()]
            except Exception:
                async with db.execute("""
                    SELECT created_at as ts, level as severity, message as msg, '' as host
                    FROM logs ORDER BY created_at DESC LIMIT 60
                """) as cur:
                    rows = [dict(r) for r in await cur.fetchall()]
    except Exception:
        pass

    def fmt_ts(ts: str) -> str:
        if not ts: return ''
        return str(ts)[:19].replace('T', ' ')

    if rows:
        log_rows = "".join(
            f"<div class='log-row'>"
            f"<span class='sev sev-{min(7,max(0,int(r.get(\"severity\",7) or 7)))}'>"
            f"{_SEV_LABELS.get(min(7,max(0,int(r.get(\"severity\",7) or 7))), 'INF')}</span>"
            f"<span class='ts'>{fmt_ts(r.get('ts',''))}</span>"
            f"<span class='host'>{r.get('host','')[:20] if r.get('host') else ''}</span>"
            f"<span class='msg'>{str(r.get('msg',''))[:200]}</span>"
            f"</div>"
            for r in rows
        )
        content = f"<div>{log_rows}</div>"
    else:
        content = "<div class='empty'>No recent log entries</div>"

    body = f"""
<div class="header">
  <div style="width:6px;height:6px;border-radius:50%;background:#4ade80"></div>
  <span class="header-title">Live Log Stream</span>
</div>
<div class="content" style="padding:0">{content}</div>"""
    return HTMLResponse(_widget_page("Log Stream", body))


# ── Error Rate widget ─────────────────────────────────────────────────────────

@router.get("/widgets/error_rate", response_class=HTMLResponse, include_in_schema=False)
async def widget_error_rate():
    stats: dict = {}
    try:
        async with aiosqlite.connect(str(_DB)) as db:
            db.row_factory = aiosqlite.Row
            try:
                async with db.execute("""
                    SELECT severity, COUNT(*) as cnt
                    FROM syslog_messages
                    WHERE received_at > datetime('now', '-60 minutes')
                    GROUP BY severity
                    ORDER BY severity
                """) as cur:
                    for r in await cur.fetchall():
                        stats[int(r['severity'])] = r['cnt']
            except Exception:
                pass
    except Exception:
        pass

    # Group: critical (0-2), error (3), warning (4), info (5-7)
    critical = sum(stats.get(i, 0) for i in range(3))
    error = stats.get(3, 0)
    warning = stats.get(4, 0)
    info = sum(stats.get(i, 0) for i in range(5, 8))
    total = critical + error + warning + info or 1

    def bar(pct: float, color: str) -> str:
        w = max(2, int(pct * 100))
        return f"<div style='height:8px;border-radius:4px;background:{color};width:{w}%;transition:width 0.3s'></div>"

    rows_html = f"""
<div style="display:flex;flex-direction:column;gap:14px">
  <div>
    <div style="display:flex;justify-content:space-between;margin-bottom:4px">
      <span style="color:#f87171;font-size:11px;font-weight:600">Critical / Alert / Emergency</span>
      <span style="color:#f87171;font-weight:700">{critical}</span>
    </div>
    {bar(critical/total, '#f87171')}
  </div>
  <div>
    <div style="display:flex;justify-content:space-between;margin-bottom:4px">
      <span style="color:#fb923c;font-size:11px;font-weight:600">Error</span>
      <span style="color:#fb923c;font-weight:700">{error}</span>
    </div>
    {bar(error/total, '#fb923c')}
  </div>
  <div>
    <div style="display:flex;justify-content:space-between;margin-bottom:4px">
      <span style="color:#fbbf24;font-size:11px;font-weight:600">Warning</span>
      <span style="color:#fbbf24;font-weight:700">{warning}</span>
    </div>
    {bar(warning/total, '#fbbf24')}
  </div>
  <div>
    <div style="display:flex;justify-content:space-between;margin-bottom:4px">
      <span style="color:#4ade80;font-size:11px;font-weight:600">Notice / Info / Debug</span>
      <span style="color:#4ade80;font-weight:700">{info}</span>
    </div>
    {bar(info/total, '#4ade80')}
  </div>
  <div style="margin-top:8px;padding-top:8px;border-top:1px solid #1e293b;font-size:10px;color:#475569">
    Last 60 minutes &bull; {total} total events
  </div>
</div>"""

    body = f"""
<div class="header">
  <div style="width:6px;height:6px;border-radius:50%;background:#fb923c"></div>
  <span class="header-title">Error Rate — last 60 min</span>
</div>
<div class="content">{rows_html}</div>"""
    return HTMLResponse(_widget_page("Error Rate", body))
