# pktHub

NOC/SOC management hub — part of the pkt suite. Registers and proxies the
sibling pkt* apps (pktSNMP, pktFlow, pktLog, pktPCAP, pktWiFi) behind a single
login, provides a NOC display builder for wallboards, and centralizes user
management, audit logging, and alerting across the registered apps.

**Default port:** `8760` (HTTP)

---

## Table of Contents

- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Installation](#installation)
- [Configuration Reference](#configuration-reference)
- [Running & Managing the Service](#running--managing-the-service)
- [Enabling HTTPS](#enabling-https)
- [Roles & Auth](#roles--auth)
- [App Registry (Suite Integration)](#app-registry-suite-integration)
- [NOC Displays](#noc-displays)
- [Backup & Restore](#backup--restore)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

---

## Quick Start

```bash
git clone git@github.com:bsnwgit/pkthub.git
cd pkthub
sudo ./install.sh
```

You'll be prompted for an install directory (default `/opt/pkthub`). The
installer builds the frontend, creates a Python venv, generates `config.yaml`
with a random JWT secret and admin password (printed once — save it), and
starts the systemd service on plain HTTP.

## Architecture

FastAPI backend (`app/`) + React/TypeScript frontend (`frontend/`), SQLite for
all app state. No data ships with the app — `app/database.py`'s `init_db()`
creates an empty schema on first boot, and the only row it seeds is the
initial `admin` user from `config.yaml`.

Backend modules, each mounted as its own router in `app/main.py`:

| Module | Prefix | Responsibility |
|---|---|---|
| `auth.py` | `/api/auth` | Login/JWT, initial admin bootstrap, Okta SAML SSO |
| `users.py` | `/api/users` | User CRUD, roles |
| `registry.py` | `/api/apps` | Registering sibling pkt apps, health polling |
| `proxy.py` | (root) | Reverse-proxies registered apps' UIs/APIs through pktHub |
| `noc.py` | `/api/noc` | NOC display builder/layouts |
| `audit.py` | `/api/audit` | Audit log |
| `settings_api.py` | `/api/settings` | Platform settings (general, SAML, backup, notifications) |
| `dashboard.py` | `/api/dashboard` | Dashboard summary data |
| `notifications.py` | `/api/notifications` | Alert notification channels |
| `alert_rules.py` | `/api/alert-rules` | Alert rule definitions |
| `app_alerts.py` | `/api/alerts` | Alert events from registered apps |
| `ssl_api.py` | `/api/ssl` | Cert status + upload |
| `backup_api.py` | `/api/backup` | DB/config backup, export, restore |

Every on-disk path (`db_path`, backup directory) derives from `install_dir` at
runtime (env var `PKTHUB_INSTALL_DIR` → the directory `config.yaml` was loaded
from → cwd) — no absolute path is ever hardcoded in source.

## Installation

Requirements: Python 3.10+, Node/npm (for the frontend build), `openssl` CLI.

```bash
git clone git@github.com:bsnwgit/pkthub.git
cd pkthub
sudo ./install.sh
```

`install.sh`:
1. Prompts for install directory (`PKTHUB_INSTALL_DIR` env var to skip the
   prompt for scripted installs; default `/opt/pkthub`)
2. Builds the frontend (`npm ci && npm run build`)
3. Copies the tree into the install dir (skipped if installing in place)
4. Creates the venv and installs `requirements.txt`
5. Generates `config.yaml` from `config.example.yaml` **only if one doesn't
   already exist** — fills in a random `jwt_secret` and `initial_admin_password`
   and prints the admin password once. Re-running the installer never
   overwrites an existing `config.yaml`.
6. Installs and starts the `pkthub` systemd service

## Configuration Reference

`config.yaml` (generated from `config.example.yaml` on first install):

| Key | Default | Notes |
|---|---|---|
| `host` / `port` | `0.0.0.0` / `8760` | |
| `https` | `false` | Installs on HTTP — see [Enabling HTTPS](#enabling-https) |
| `jwt_secret` | random, generated at install | |
| `jwt_expire_minutes` | `60` | |
| `initial_admin_username` / `_password` / `_email` | `admin` / random / `admin@example.com` | Only used the very first time the `users` table is empty |
| `okta_domain` / `_client_id` / `_client_secret` | blank | Optional OIDC (unused if SAML is configured via Settings instead) |
| `db_path` | `<install_dir>/pkthub.db` | Leave blank to use the default |
| `health_poll_interval` | `30` | Seconds between registered-app health checks |
| `audit_retention_days` | `90` | |
| `trusted_cidrs` | `[]` | Empty = allow all |

## Running & Managing the Service

```bash
sudo systemctl status pkthub
sudo systemctl restart pkthub
journalctl -u pkthub -f
```

Logs also append to `<install_dir>/logs/pkthub.log`.

## Enabling HTTPS

pktHub installs on plain HTTP by default. To enable HTTPS:

1. Log in as admin, go to **Settings → SSL**, and upload a cert + key (stored
   at `/etc/ssl/pkthub/cert.pem` + `key.pem`)
2. Edit `/etc/systemd/system/pkthub.service` and add to `ExecStart`:
   `--ssl-certfile /etc/ssl/pkthub/cert.pem --ssl-keyfile /etc/ssl/pkthub/key.pem`
3. `sudo systemctl daemon-reload && sudo systemctl restart pkthub`

## Roles & Auth

Local username/password (bcrypt) or Okta SAML SSO (configured under
**Settings → General**, not via `config.yaml`). Roles: `admin` (full access),
`viewer` (read-only). The very first user is always created as `admin` from
`config.yaml`'s `initial_admin_*` fields on first boot.

## App Registry (Suite Integration)

pktHub is the hub side of the suite-token mechanism every other pkt app
implements — sibling apps generate their own suite token
(**Settings → Integrations → Suite Integration → Copy Token**) and are
registered here:

1. **Settings → App Registry → Register App**
2. Paste the sibling app's suite token and base URL, click **Register**
3. pktHub validates via the app's `/api/health` and stores the token
4. Registered apps are proxied through pktHub and appear on the dashboard,
   with health polled every `health_poll_interval` seconds

## NOC Displays

**NOC → Builder** lets you lay out widgets from any registered app onto a
wallboard-style display; **NOC → Display** renders it full-screen for a TV/kiosk.

## Backup & Restore

**Settings → Backup** creates a `.tar.gz` snapshot of the DB and config.
Backups are written to `<install_dir>/backups` by default (configurable).

## Troubleshooting

- **Service won't start / restart-loops**: `journalctl -u pkthub -n 50` —
  most common cause is a bad `--ssl-certfile`/`--ssl-keyfile` path or
  permissions if HTTPS was enabled manually (the service user must be able to
  read the key file).
- **Forgot the admin password**: it's only ever shown once at install time.
  Reset directly in the DB:
  ```bash
  python3 -c "
  import sqlite3, bcrypt
  conn = sqlite3.connect('<install_dir>/pkthub.db')
  h = bcrypt.hashpw(b'NewPassword1!', bcrypt.gensalt()).decode()
  conn.execute(\"UPDATE users SET hashed_password=? WHERE username='admin'\", (h,))
  conn.commit()
  "
  ```

## Development

```bash
cd frontend && npm install && npm run dev   # Vite dev server
cd .. && venv/bin/uvicorn app.main:app --reload --port 8760
```
