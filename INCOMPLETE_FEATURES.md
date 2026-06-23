# pktDashboard — Incomplete & Planned Features

Generated: 2026-06-23  
Status of every planned feature that is not yet built or fully production-verified.

---

## Alert Acknowledgment — NOT BUILT

**Frontend:** `frontend/index.html` — alerts panel renders alert events from pktFlow but has no acknowledge button.  
**Backend:** pktFlow exposes `POST /api/alerts/events/{id}/ack` but pktDashboard does not proxy it.

The dashboard is currently read-only by design. To support acknowledgment, the service account would need at minimum an `operator` role in pktFlow (viewer role cannot write), and pktDashboard would need an auth mechanism to identify which dashboard user performed the action.

**What needs building:**
- Decision: keep dashboard read-only or promote service account to operator role
- `POST /api/dashboard/alerts/{id}/ack` proxy endpoint in `app/main.py`
- Acknowledge button in the alerts panel with optimistic UI update

---

## Traffic Sparklines / Mini-Charts — NOT BUILT

**Frontend:** Metrics panel shows current flows/sec as a single number. No historical trend is visible.  
**Backend:** pktFlow `GET /api/flows/rate` returns only the current rate — no time-series endpoint available.

**What needs building:**
- A rolling buffer in `pktflow_client.py` to accumulate the last N data points across poll cycles (in-memory, no persistence)
- SVG sparkline rendered in JavaScript alongside the flows/sec metric
- Optional: expose `GET /api/dashboard/history` so the frontend can request the buffer on load

---

## Additional pktsuite App Cards — PLACEHOLDER

**Frontend:** `frontend/index.html` — the app launcher section is hardcoded for pktFlow and pktAnalyzer.  

As new pktsuite apps are added, each needs a card entry. There is no dynamic registration mechanism — new apps require a manual edit of `index.html`.

**What needs building:**
- Config-driven app registry (add `apps:` block to `config.yaml` listing name, URL, description, icon)
- Backend `GET /api/apps` endpoint returning the registry
- Frontend renders cards dynamically from this endpoint

---

## User-Configurable Refresh Interval — NOT BUILT

**Frontend:** `setInterval(fetchData, 30000)` is hardcoded at 30 seconds. Users cannot change it.

**What needs building:**
- A refresh interval control in the dashboard UI (e.g. 15s / 30s / 60s / manual)
- `localStorage` persistence so the preference survives page reload

---

## Mobile / Responsive Layout — NOT BUILT

The dashboard layout uses fixed panel widths. On narrow viewports (phones, small tablets), the metrics panel and alerts panel stack awkwardly.

**What needs building:**
- CSS media queries to collapse the two-column layout to single-column below ~768px
- Touch-friendly alert row sizing
- Responsive header that collapses or wraps gracefully

---

## Per-Device Flow Breakdown — NOT BUILT

**Backend:** `GET /api/flows/devices` returns a device list but pktDashboard only uses it for a count.  
**Frontend:** Device count is displayed as a single number — no per-device drill-down.

**What needs building:**
- Expandable device list in the dashboard showing sampler IP, name, site, and per-device flow rate
- Requires rendering the `devices` array already present in `GET /api/dashboard` — the data is there, just not displayed

---

## pktFlow Status Detail — MINIMAL

**Frontend:** The header shows "ONLINE" or "OFFLINE" for pktFlow. No additional version or uptime information is surfaced.  
**Backend:** `GET /api/health` from pktFlow returns `{"status": "ok", "version": "0.1.0"}` but the version field is discarded.

**What needs building:**
- Display pktFlow version in the status banner or a hover tooltip
- Optionally surface uptime / last-restart from pktFlow's health response if available

---

## Notification on pktFlow Outage — NOT BUILT

If pktFlow goes down, the dashboard shows an error state — but no one is proactively alerted.

**What needs building:**
- State tracking: detect transition from `pktflow_up=true` to `pktflow_up=false`
- Optional outbound webhook or SMTP notification on state change
- Would require adding notification config keys to `config.yaml`

---

## HTTPS / TLS — NOT CONFIGURED

pktDashboard listens on HTTP (port 8760). Traffic between browser and server is unencrypted on the internal network.

For production deployments where the dashboard is accessible beyond the O2 host:
- Put an nginx reverse proxy in front with a self-signed or internal CA cert
- Or configure uvicorn with `--ssl-keyfile` / `--ssl-certfile`

**Not built.** Acceptable for internal-only LAN access today, but should be addressed if the server is ever reachable from untrusted segments.

---

## Log Rotation — NOT CONFIGURED

The systemd unit in `pktdashboard.service` writes stdout/stderr to `/mnt/software/logs/pktdashboard.log` via `StandardOutput=append:...`.

There is no logrotate configuration. The log file will grow indefinitely.

**What needs building:**
- `/etc/logrotate.d/pktdashboard` config file
- Add to `deploy.py` so it is installed alongside the service

---

## Summary Table

| Feature | Backend | Frontend | Status |
|---------|---------|----------|--------|
| Alert acknowledgment | ❌ Not built | ❌ Not built | Blocked on role decision |
| Traffic sparklines | ❌ Not built | ❌ Not built | Needs rolling buffer |
| Dynamic app cards | ❌ Not built | ❌ Not built | Config-driven registry needed |
| Configurable refresh interval | N/A | ❌ Hardcoded | Simple localStorage task |
| Mobile responsive layout | N/A | ❌ Not built | CSS media queries needed |
| Per-device flow breakdown | N/A | ❌ Data available, not rendered | Low effort |
| pktFlow version display | N/A | ❌ Data discarded | Low effort |
| Outage notification | ❌ Not built | N/A | Requires notification config |
| HTTPS / TLS | ❌ Not configured | N/A | nginx or uvicorn SSL |
| Log rotation | ❌ Not configured | N/A | logrotate config needed |
