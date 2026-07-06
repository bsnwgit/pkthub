"""
pktPCAP — Widget routes for pktHub NOC Builder integration.
Registered via: register(app) called from server.py
"""
import os
import sqlite3
import time
from pathlib import Path

from flask import jsonify, Response

BASE = Path(__file__).parent

MANIFEST = [
    {
        "id": "capture_feed",
        "title": "Capture Sessions",
        "description": "Live and buffered PCAP capture sessions",
        "view_path": "/widgets/capture_feed",
        "default_w": 640,
        "default_h": 360,
        "min_w": 320,
        "min_h": 200,
    },
    {
        "id": "recent_captures",
        "title": "Recent Captures",
        "description": "Saved PCAP files with download links",
        "view_path": "/widgets/recent_captures",
        "default_w": 600,
        "default_h": 340,
        "min_w": 300,
        "min_h": 180,
    },
    {
        "id": "protocol_stats",
        "title": "Protocol Stats",
        "description": "Protocol distribution across captured sessions",
        "view_path": "/widgets/protocol_stats",
        "default_w": 460,
        "default_h": 320,
        "min_w": 260,
        "min_h": 180,
    },
]


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
  .content{{flex:1;overflow:hidden;padding:12px}}
  table{{width:100%;border-collapse:collapse}}
  th{{text-align:left;font-size:10px;color:#475569;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;padding:5px 8px;border-bottom:1px solid #1e293b}}
  td{{padding:7px 8px;border-bottom:1px solid #0f172a;font-size:12px;color:#cbd5e1}}
  tr:hover td{{background:#111827}}
  .badge{{display:inline-block;padding:1px 7px;border-radius:4px;font-size:10px;font-weight:600}}
  .badge-green{{background:#052e16;color:#4ade80}}
  .badge-blue{{background:#172554;color:#60a5fa}}
  .badge-gray{{background:#1e293b;color:#64748b}}
  .empty{{text-align:center;padding:40px;color:#334155;font-size:12px}}
  .bar-row{{display:flex;align-items:center;gap:8px;margin-bottom:8px}}
  .bar-label{{font-size:11px;color:#94a3b8;width:80px;flex-shrink:0;text-overflow:ellipsis;overflow:hidden;white-space:nowrap}}
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


def _get_db_path():
    try:
        from db import load_db_config
        p = load_db_config().get("db_path", "pktpcap.db")
        if not os.path.isabs(p): p = str(BASE / p)
        return p
    except Exception:
        return str(BASE / "pktpcap.db")


def _fmt_bytes(b):
    b = b or 0
    if b >= 1_073_741_824: return f"{b/1_073_741_824:.1f} GB"
    if b >= 1_048_576:     return f"{b/1_048_576:.1f} MB"
    if b >= 1_024:         return f"{b/1_024:.1f} KB"
    return f"{b} B"


def _fmt_ts(ts):
    if not ts: return "—"
    return str(ts)[:19].replace("T", " ")


def register(app):
    """Register all widget routes on the Flask app."""

    @app.route("/api/widgets/manifest")
    def widget_manifest():
        return jsonify(MANIFEST)

    @app.route("/widgets/capture_feed")
    def widget_capture_feed():
        from server import _feed_sessions, _feed_sessions_lock
        with _feed_sessions_lock:
            sessions = [s.to_dict() for s in _feed_sessions.values()]
        sessions.sort(key=lambda s: (not s["connected"], -s["last_seen"]))
        now = time.time()

        if sessions:
            trs = "".join(
                f"<tr>"
                f"<td><span class='badge {'badge-green' if s['connected'] else 'badge-gray'}'>"
                f"{'● LIVE' if s['connected'] else '○ idle'}</span></td>"
                f"<td style='color:#e2e8f0'>{s['name']}</td>"
                f"<td style='font-family:monospace;color:#60a5fa'>{s['remote_addr']}</td>"
                f"<td>{_fmt_bytes(s['bytes_buffered'])}</td>"
                f"<td style='color:#475569;font-size:10px'>{int(now - s['last_seen'])}s ago</td>"
                f"</tr>"
                for s in sessions
            )
            table = f"<table><thead><tr><th>State</th><th>Session</th><th>Source</th><th>Buffered</th><th>Last Seen</th></tr></thead><tbody>{trs}</tbody></table>"
        else:
            table = "<div class='empty'>No active or recent capture sessions</div>"

        body = f"""<div class="header"><div style="width:6px;height:6px;border-radius:50%;background:#4ade80"></div><span class="header-title">Capture Sessions</span></div>
<div class="content">{table}</div>"""
        return Response(_widget_page("Capture Sessions", body), mimetype="text/html")

    @app.route("/widgets/recent_captures")
    def widget_recent_captures():
        rows = []
        try:
            conn = sqlite3.connect(_get_db_path())
            conn.row_factory = sqlite3.Row
            for q in [
                "SELECT name, size, created_at FROM captures ORDER BY created_at DESC LIMIT 20",
                "SELECT filename as name, file_size as size, created_at FROM pcap_files ORDER BY created_at DESC LIMIT 20",
                "SELECT name, file_size as size, created_at FROM captures ORDER BY created_at DESC LIMIT 20",
            ]:
                try:
                    rows = [dict(r) for r in conn.execute(q).fetchall()]
                    if rows: break
                except Exception:
                    continue
            conn.close()
        except Exception:
            pass

        if rows:
            trs = "".join(
                f"<tr><td style='color:#e2e8f0'>{r.get('name','—')}</td>"
                f"<td>{_fmt_bytes(r.get('size') or 0)}</td>"
                f"<td style='font-size:10px;color:#475569'>{_fmt_ts(r.get('created_at',''))}</td></tr>"
                for r in rows
            )
            table = f"<table><thead><tr><th>File</th><th>Size</th><th>Captured</th></tr></thead><tbody>{trs}</tbody></table>"
        else:
            table = "<div class='empty'>No captures found</div>"

        body = f"""<div class="header"><div style="width:6px;height:6px;border-radius:50%;background:#60a5fa"></div><span class="header-title">Recent Captures</span></div>
<div class="content">{table}</div>"""
        return Response(_widget_page("Recent Captures", body), mimetype="text/html")

    @app.route("/widgets/protocol_stats")
    def widget_protocol_stats():
        rows = []
        try:
            conn = sqlite3.connect(_get_db_path())
            conn.row_factory = sqlite3.Row
            for q in [
                "SELECT protocol, COUNT(*) as cnt, SUM(packet_count) as packets FROM captures GROUP BY protocol ORDER BY cnt DESC LIMIT 12",
                "SELECT protocol, COUNT(*) as cnt FROM pcap_files GROUP BY protocol ORDER BY cnt DESC LIMIT 12",
                "SELECT protocol, COUNT(*) as cnt FROM captures GROUP BY protocol ORDER BY cnt DESC LIMIT 12",
                "SELECT transport_protocol as protocol, COUNT(*) as cnt FROM captures GROUP BY transport_protocol ORDER BY cnt DESC LIMIT 12",
            ]:
                try:
                    rows = [dict(r) for r in conn.execute(q).fetchall()]
                    if rows and any(r.get("protocol") for r in rows): break
                    rows = []
                except Exception:
                    continue
            conn.close()
        except Exception:
            pass

        COLORS = ["#a78bfa","#60a5fa","#4ade80","#2dd4bf","#f472b6",
                  "#fbbf24","#fb923c","#f87171","#818cf8","#34d399","#e879f9","#38bdf8"]
        max_cnt = max((r.get("cnt") or 0 for r in rows), default=1)

        if rows:
            bars = []
            for i, r in enumerate(rows):
                proto = str(r.get("protocol") or "unknown")
                pct = int(((r.get("cnt") or 0) / max_cnt) * 100)
                color = COLORS[i % len(COLORS)]
                bars.append(
                    f"<div class='bar-row'>"
                    f"<span class='bar-label' title='{proto}'>{proto}</span>"
                    f"<div class='bar-track'><div class='bar-fill' style='width:{pct}%;background:{color}'></div></div>"
                    f"<span class='bar-val'>{r.get('cnt',0)}</span>"
                    f"</div>"
                )
            content = "".join(bars)
        else:
            content = "<div class='empty'>No protocol data available</div>"

        body = f"""<div class="header"><div style="width:6px;height:6px;border-radius:50%;background:#a78bfa"></div><span class="header-title">Protocol Stats</span></div>
<div class="content">{content}</div>"""
        return Response(_widget_page("Protocol Stats", body), mimetype="text/html")
