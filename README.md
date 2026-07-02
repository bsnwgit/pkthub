# pktHub

Central NOC/SOC management hub for the pktSolution platform.

pktHub provides unified authentication, reverse-proxy access, and a drag-and-drop
kiosk builder for all pktAPP applications (pktFlow, pktSNMP, pktLog, pktPCAP).

**Status:** Built and deployed. SSO proxy auth complete — all four pktApps open
inside pktHub without showing their own login screens.

---

## Platform Features

- **Unified auth** — single login replaces per-app login after registration
- **Reverse proxy** — all pktApp UIs served inside a persistent 44px pktHub shell
- **SSO** — X-Suite-Token injected on every proxied request; pktApp local sessions
  established automatically
- **Kiosk builder** — drag-and-drop widget composer for NOC/SOC wall displays;
  published layouts get signed URL tokens (no login on the display monitor)
- **App registry** — observe mode → managed mode → deregister lifecycle with
  break-glass CLI per pktApp
- **Platform settings** — users, audit log, notifications, SSL, backup

---

## Stack

| Layer     | Technology                                         |
|-----------|----------------------------------------------------|
| Backend   | FastAPI, Python 3.9+, HTTPS (self-signed TLS)      |
| Frontend  | React, TypeScript, Vite, Tailwind CSS              |
| Storage   | SQLite WAL (app registry, users, kiosk, audit log) |
| Auth      | JWT (HS256) + optional Okta SAML 2.0               |
| Service   | systemd, auto-restart on failure                   |

---

## Ports

| Service  | Port  |
|----------|-------|
| pktHub   | 8760  |
| pktFlow  | 8766  |
| pktSNMP  | 8767  |
| pktLog   | 8768  |
| pktPCAP  | 8765  |

---

## Key Files

```
app/                        pktHub backend (FastAPI)
  auth.py                   JWT login
  proxy.py                  Reverse proxy + HTML rewriter + fetch/XHR patcher
  registry.py               App register/deregister, suite token management
  main.py                   FastAPI app + SPA catch-all
  kiosk.py                  Kiosk layout CRUD, signed display tokens
  audit.py                  Audit log API
  dashboard.py              Aggregated health + audit counts
frontend/                   React frontend
  src/pages/                Login, Dashboard, AppManager, ProxyShell,
                            KioskBuilder, Settings, Audit, Users
pktapp_patches/             Server snapshots of every modified pktApp file
  pktflow/                  pktFlow patches (proxy.py — no app-side changes needed)
  pktlog/                   pktLog patches (dependencies.py, main.py)
  pktsnmp/                  pktSNMP patches (main.py, dependencies.py, config.yaml)
  pktpcap/                  pktPCAP patches (server.py, config.json)
pkthub.service              systemd service unit
config.example.yaml         Config template — copy to config.yaml on server
requirements.txt            Python dependencies
deploy.py                   SFTP + remote build deploy script
backup.py                   Local 2-rotation backup script
DEPLOYMENT.md               Full deploy + pktApp integration guide
BUILD_STATUS.md             Current build state and change log
pktHub_briefing.md          Briefing doc for new Claude chat sessions
```

---

## Deploy

See `DEPLOYMENT.md` for the full step-by-step guide.

Quick reference:

```bash
# 1. SFTP source to server
# 2. Create venv + pip install -r requirements.txt
# 3. Build frontend (npm install + npm run build) on server
# 4. Copy config.example.yaml → config.yaml, set jwt_secret + admin password
# 5. Generate SSL cert + fix ownership
# 6. sudo systemctl enable --now pkthub
```

Run `deploy.py` via Python to push local changes and rebuild the frontend.

---

## Backup

Run `backup.py` to rotate a 2-copy local backup before significant changes:

```
python backup.py
```

Backups rotate to: `pktHub_backups\` (backup_1 = most recent, backup_2 = previous)

---

## SSH / Remote Access

SentinelOne blocks system ssh.exe. Use Python + Paramiko via Desktop Commander
`start_process`. One script, one run, no retry loops.

---

## Git

Branch: `feature/initial-build`
Remote: `git@github.com:bsnwgit/pkthub.git`
