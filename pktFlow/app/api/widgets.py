"""
pktFlow — Widget endpoints for pktHub NOC Builder integration.

Manifest: GET /api/widgets/manifest  → list of widget definitions
Views:    GET /widgets/{widget_type}  → server-rendered HTML page (iframe target)
"""
from __future__ import annotations

import json
from pathlib import Path

import aiosqlite
from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse

from app.config import get_settings

router = APIRouter()
settings = get_settings()

_DB = Path(__file__).parent.parent.parent / "pktflow.db"

# ── Manifest ──────────────────────────────────────────────────────────────────

MANIFEST = [
    {
        "id": "top_talkers",
        "title": "Top Talkers",
        "description": "Highest-volume source/destination pairs",
        "view_path": "/api/widgets/top_talkers",
        "default_w": 640,
        "default_h": 380,
        "min_w": 320,
        "min_h": 200,
    },
    {
        "id": "flow_summary",
        "title": "Flow Summary",
        "description": "Recent flow counts, bytes, and protocols",
        "view_path": "/api/widgets/flow_summary",
        "default_w": 480,
        "default_h": 300,
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
  .header-dot{{width:6px;height:6px;border-radius:50%;background:#60a5fa}}
  .content{{flex:1;overflow:auto;padding:12px}}
  table{{width:100%;border-collapse:collapse}}
  th{{text-align:left;font-size:10px;color:#475569;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;padding:4px 8px;border-bottom:1px solid #1e293b}}
  td{{padding:6px 8px;border-bottom:1px solid #0f172a;font-size:12px;color:#cbd5e1}}
  tr:hover td{{background:#111827}}
  .badge{{display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600}}
  .badge-blue{{background:#172554;color:#60a5fa}}
  .badge-green{{background:#052e16;color:#4ade80}}
  .empty{{text-align:center;padding:40px;color:#334155;font-size:12px}}
</style>
<script>setTimeout(()=>location.reload(),30000)</script>
</head>
<body>
{body}
</body>
</html>"""


# ── Top Talkers widget ────────────────────────────────────────────────────────

@router.get("/widgets/top_talkers", response_class=HTMLResponse, include_in_schema=False)
async def widget_top_talkers():
    rows = []
    try:
        async with aiosqlite.connect(str(_DB)) as db:
            db.row_factory = aiosqlite.Row
            # Query recent flows grouped by src→dst, summed bytes
            async with db.execute("""
                SELECT src_ip, dst_ip, protocol,
                       SUM(bytes) as total_bytes,
                       COUNT(*) as flow_count
                FROM flows
                WHERE timestamp > datetime('now', '-10 minutes')
                GROUP BY src_ip, dst_ip, protocol
                ORDER BY total_bytes DESC
                LIMIT 20
            """) as cur:
                rows = [dict(r) for r in await cur.fetchall()]
    except Exception:
        pass

    def fmt_bytes(b: int) -> str:
        if b >= 1_073_741_824: return f"{b/1_073_741_824:.1f} GB"
        if b >= 1_048_576:     return f"{b/1_048_576:.1f} MB"
        if b >= 1_024:         return f"{b/1_024:.1f} KB"
        return f"{b} B"

    if rows:
        trs = "".join(
            f"<tr><td>{r['src_ip']}</td><td>{r['dst_ip']}</td>"
            f"<td><span class='badge badge-blue'>{r['protocol'] or '—'}</span></td>"
            f"<td>{fmt_bytes(r['total_bytes'] or 0)}</td>"
            f"<td>{r['flow_count']}</td></tr>"
            for r in rows
        )
        table = f"""<table>
<thead><tr><th>Source</th><th>Destination</th><th>Proto</th><th>Bytes</th><th>Flows</th></tr></thead>
<tbody>{trs}</tbody></table>"""
    else:
        table = "<div class='empty'>No recent flow data</div>"

    body = f"""
<div class="header"><div class="header-dot"></div><span class="header-title">Top Talkers — last 10 min</span></div>
<div class="content">{table}</div>"""
    return HTMLResponse(_widget_page("Top Talkers", body))


# ── Flow Summary widget ───────────────────────────────────────────────────────

@router.get("/widgets/flow_summary", response_class=HTMLResponse, include_in_schema=False)
async def widget_flow_summary():
    stats = {"total_flows": 0, "total_bytes": 0, "unique_src": 0, "unique_dst": 0}
    proto_rows = []
    try:
        async with aiosqlite.connect(str(_DB)) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("""
                SELECT COUNT(*) as total_flows, SUM(bytes) as total_bytes,
                       COUNT(DISTINCT src_ip) as unique_src,
                       COUNT(DISTINCT dst_ip) as unique_dst
                FROM flows
                WHERE timestamp > datetime('now', '-10 minutes')
            """) as cur:
                row = await cur.fetchone()
                if row:
                    stats = dict(row)
            async with db.execute("""
                SELECT protocol, COUNT(*) as cnt, SUM(bytes) as bytes
                FROM flows
                WHERE timestamp > datetime('now', '-10 minutes')
                GROUP BY protocol ORDER BY cnt DESC LIMIT 8
            """) as cur:
                proto_rows = [dict(r) for r in await cur.fetchall()]
    except Exception:
        pass

    def fmt(n: int) -> str:
        if n >= 1_000_000: return f"{n/1_000_000:.1f}M"
        if n >= 1_000:     return f"{n/1_000:.1f}K"
        return str(n)

    def fmt_bytes(b: int) -> str:
        if b >= 1_073_741_824: return f"{b/1_073_741_824:.1f} GB"
        if b >= 1_048_576:     return f"{b/1_048_576:.1f} MB"
        if b >= 1_024:         return f"{b/1_024:.1f} KB"
        return f"{b} B"

    stat_cards = f"""
<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
  <div style="background:#111827;border:1px solid #1e293b;border-radius:8px;padding:10px">
    <div style="font-size:10px;color:#475569;margin-bottom:4px">Flows (10 min)</div>
    <div style="font-size:20px;font-weight:700;color:#60a5fa">{fmt(stats.get('total_flows') or 0)}</div>
  </div>
  <div style="background:#111827;border:1px solid #1e293b;border-radius:8px;padding:10px">
    <div style="font-size:10px;color:#475569;margin-bottom:4px">Bytes (10 min)</div>
    <div style="font-size:20px;font-weight:700;color:#2dd4bf">{fmt_bytes(stats.get('total_bytes') or 0)}</div>
  </div>
  <div style="background:#111827;border:1px solid #1e293b;border-radius:8px;padding:10px">
    <div style="font-size:10px;color:#475569;margin-bottom:4px">Unique Sources</div>
    <div style="font-size:20px;font-weight:700;color:#a78bfa">{fmt(stats.get('unique_src') or 0)}</div>
  </div>
  <div style="background:#111827;border:1px solid #1e293b;border-radius:8px;padding:10px">
    <div style="font-size:10px;color:#475569;margin-bottom:4px">Unique Dest</div>
    <div style="font-size:20px;font-weight:700;color:#f472b6">{fmt(stats.get('unique_dst') or 0)}</div>
  </div>
</div>"""

    if proto_rows:
        trs = "".join(
            f"<tr><td><span class='badge badge-blue'>{r['protocol'] or '—'}</span></td>"
            f"<td>{fmt(r['cnt'] or 0)}</td><td>{fmt_bytes(r['bytes'] or 0)}</td></tr>"
            for r in proto_rows
        )
        table = f"""<table>
<thead><tr><th>Protocol</th><th>Flows</th><th>Bytes</th></tr></thead>
<tbody>{trs}</tbody></table>"""
    else:
        table = "<div class='empty'>No recent flow data</div>"

    body = f"""
<div class="header"><div class="header-dot" style="background:#2dd4bf"></div><span class="header-title">Flow Summary — last 10 min</span></div>
<div class="content">{stat_cards}{table}</div>"""
    return HTMLResponse(_widget_page("Flow Summary", body))
