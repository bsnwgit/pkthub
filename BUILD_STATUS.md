# pktHub Build Status
**Last updated:** 2026-07-01

---

## Status: LIVE — SSO Proxy Auth Complete

pktHub is deployed and running. All four pktApps open inside pktHub without a login screen.

**Access:** `https://<SERVER_IP>:<PORT_HUB>`
**Service:** `sudo systemctl status pkthub`
**Log:** `<INSTALL_DIR>/pkthub/logs/pkthub.log`

See `DEPLOYMENT.md` for full setup instructions and placeholder definitions.

---

## Default Credentials

| Field    | Value       |
|----------|-------------|
| Username | `admin`     |
| Password | `CHANGE_ME` |

Change immediately after first login. Edit `config.yaml` on the server.

---

## Registered pktApps

| App      | Default Port | Status |
|----------|-------------|--------|
| pktLog   | 8768        | SSO complete — opens in pktHub, no login prompt |
| pktFlow  | 8766        | SSO complete — opens in pktHub, no login prompt |
| pktSNMP  | 8767        | SSO complete — opens in pktHub, no login prompt |
| pktPCAP  | 8765        | SSO complete — opens in pktHub, no login prompt |

---

## What Was Built

### Phase 1 — pktHub Core

Backend (FastAPI, Python 3.9, HTTPS):
- `app/auth.py` — JWT login (HS256)
- `app/users.py` — user CRUD
- `app/registry.py` — pktApp register/deregister, health polling, token rotation
- `app/proxy.py` — reverse proxy with X-Suite-Token injection, HTML rewriting,
  fetch/XHR patcher, multi-Set-Cookie forwarding
- `app/kiosk.py` — kiosk layout CRUD, signed display tokens
- `app/settings_api.py` — platform config store
- `app/audit.py` — audit log
- `app/dashboard.py` — aggregated app health + audit counts
- `app/main.py` — FastAPI app assembly, startup, SPA catch-all

Frontend (React + TypeScript + Vite + Tailwind):
- Login, Dashboard, App Manager, Proxied App Viewer (44px thin-bar shell + iframe),
  Kiosk Builder, Settings, Audit Log, Kiosk Display

Infrastructure:
- Systemd service (enabled, auto-restart on failure)
- Self-signed TLS cert
- SQLite WAL database
- Venv + pinned requirements

### Phase 2 — SSO Proxy Auth

Made all four pktApps open inside the pktHub proxy iframe without showing their own
login screens.

**pktHub `app/proxy.py`:**
- `_rewrite_html()` now injects a fetch/XHR patcher script into every proxied HTML
  `<head>`, rewriting `/api/...` → `/proxy/{id}/api/...` so pktApp SPAs hit their
  own backend through the proxy rather than pktHub's own API endpoints
- Multi-Set-Cookie forwarding via `get_list("set-cookie")` + `headers.append()`
- Strip `accept-encoding` from forwarded requests so pktApps return plain (not gzip)
  HTML that the rewriter can operate on

**pktLog `app/dependencies.py`:**
- Synthetic user dict for suite-token auth had `"created_at": None` — Pydantic v2
  raises ValidationError on non-optional `str` fields. Fixed to a placeholder
  datetime string.

**pktLog `app/main.py`:**
- `serve_spa()` sets short-lived `sso_access_token` + `sso_role` cookies when
  X-Suite-Token is valid; React SPA reads them on mount and skips the login page.

**pktSNMP `app/main.py`:**
- `Request` was missing from FastAPI imports — FastAPI treated it as a required
  query parameter, returning HTTP 422 on every page load.
- SSO bootstrap block had wrong indentation (16-space instead of 8-space).

**pktSNMP `config.yaml`:**
- Added `suite_token` field (required for X-Suite-Token validation).

**pktPCAP `server.py`:**
- Added X-Suite-Token check in Flask `require_login()` before the session check.

**pktPCAP — SQLite settings:**
- pktPCAP's `load_config()` reads from SQLite only (config.json was migrated away).
  Suite token must be inserted directly into the `settings` table, not config.json.

**pktFlow:** no pktApp-side changes needed.

---

## Phase 1 Fixes

| Problem | Fix |
|---------|-----|
| SSL certs root-owned | `sudo chown <DEPLOY_USER> /etc/ssl/pkthub/*.pem` |
| bcrypt 4.x / passlib incompatibility | Pin `bcrypt==3.2.2` in requirements.txt |
| Port conflict at startup | `sudo fuser -k <PORT_HUB>/tcp` |
| Venv missing after upload | Create manually with `python3 -m venv venv` |

---

## Local Source Layout

```
pktHub/
  app/                    # pktHub backend
  frontend/               # pktHub frontend (React)
  pktapp_patches/         # server-pulled snapshots of every modified pktApp file
    pkthub/app/proxy.py
    pktlog/app/dependencies.py
    pktlog/app/main.py
    pktsnmp/app/main.py
    pktsnmp/app/dependencies.py
    pktsnmp/config.yaml
    pktpcap/server.py
    pktpcap/config.json
  DEPLOYMENT.md           # full deployment + integration guide
  BUILD_STATUS.md         # this file
  CLAUDE.md               # project context for Claude
  README.md               # project overview
  pktHub_briefing.md      # project overview for new chat sessions
  config.example.yaml     # template — copy to config.yaml on server
  requirements.txt
  deploy.py               # SFTP + remote build deploy script
  backup.py               # local 2-rotation backup
```

---

## Git Status

Branch: `feature/initial-build`
Remote: `git@github.com:bsnwgit/pkthub.git`

Phase 1 + Phase 2 changes committed.
Docs pass (README.md, CLAUDE.md, BUILD_STATUS.md, DEPLOYMENT.md, pktHub_briefing.md,
index.html, backup.py) committed 2026-07-01.
