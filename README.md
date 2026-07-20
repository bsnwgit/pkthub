# pktHub

<p align="center">
  <img src="lockup-256h.png" alt="pktHub" height="64">
</p>

NOC/SOC management hub — part of the pkt suite. Registers and proxies the
sibling pkt* apps (pktSNMP, pktFlow, pktLog, pktPCAP, pktWiFi, pktIPAM) behind
a single login, provides a NOC display builder for wallboards, and centralizes
user management, audit logging, alerting, and (optionally) an AI assistant
across the registered apps.

pktHub is a fully wired FastAPI + React application: real bcrypt/JWT admin
auth, all of registry/users/audit/settings/proxy/NOC/alerting, and a built
React SPA are all live in the running app — not placeholder scaffolding.

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
- [App Registry & Suite Integration](#app-registry--suite-integration)
- [NOC Displays](#noc-displays)
- [Alerting & Notifications](#alerting--notifications)
- [AI Assistant](#ai-assistant)
- [Maintenance](#maintenance)
- [Backup & Restore](#backup--restore)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

---

## Quick Start

```bash
git clone git@github.com:bsnwgit/pkthub.git
cd pkthub
./install.sh
```

Do **not** run `install.sh` with `sudo` — it calls `sudo` itself for the
steps that need root (systemd install/enable). You'll be prompted for an
install directory (default `/opt/pkthub`) and a port (default `8760`). The
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
| `auth.py` | `/api/auth` | Login/JWT, initial admin bootstrap, Okta SAML SSO, auth-disabled auto-login |
| `users.py` | `/api/users` | User CRUD, roles |
| `registry.py` | `/api/apps` | Registering sibling pkt apps, health polling, managed/direct access-mode locking |
| `proxy.py` | (root, `/proxy/*`) | Reverse-proxies registered apps' UIs/APIs through pktHub, rewrites HTML/headers for iframe embedding |
| `noc.py` | `/api/noc` | NOC display builder/layouts (the DB table was renamed from `kiosk_layouts` — same "kiosk wallboard" feature, relabeled NOC everywhere) |
| `audit.py` | `/api/audit` | Audit log (analysts see only their own entries) |
| `settings_api.py` | `/api/settings` | Platform settings (general, SAML, storage, backup, notifications) |
| `dashboard.py` | `/api/dashboard` | Dashboard summary data |
| `notifications.py` | `/api/notifications` | Alert notification channels (Slack, webhook) |
| `alert_rules.py` | `/api/alert-rules` | Alert rule definitions (event type × severity → channel) |
| `app_alerts.py` | `/api/alerts` | Alert/event log from registered apps (unreachable, degraded, recovered, etc.) |
| `ssl_api.py` | `/api/ssl` | Cert status + upload (PEM pair or PFX/P12) |
| `backup_api.py` | `/api/backup` | DB/config backup, export, restore |
| `maintenance_api.py` | `/api/maintenance` | Service restart (via API) and listen-port change |
| `ai_api.py` | `/api/ai` | Claude-powered AI assistant scoped to pktHub's own registry/audit data |

Every on-disk path (`db_path`, backup directory) derives from `install_dir` at
runtime (env var `PKTHUB_INSTALL_DIR` → the directory `config.yaml` was loaded
from → cwd) — no absolute path is ever hardcoded in source.

**Frontend navigation** (top nav in `Layout.tsx`): Dashboard, Context Viewer,
NOC Builder, App Registry (`/apps` — a read-only health view of every
registered app, open to all roles), Audit Log, and Settings (admin only).
The `/apps` page is monitoring-only; actually registering, editing, rotating
tokens for, or deregistering a sibling app lives under
**Settings → Security → Suite Integration**, gated admin-only there because
those actions touch credentials.

## Installation

Requirements: Python 3.10+, Node/npm (for the frontend build), `openssl` CLI.

```bash
git clone git@github.com:bsnwgit/pkthub.git
cd pkthub
./install.sh
```

`install.sh` (run as your normal user — it invokes `sudo` internally where
needed; never run it as `sudo ./install.sh` yourself):

1. Prompts for install directory (`PKTHUB_INSTALL_DIR` env var to skip the
   prompt for scripted installs; default `/opt/pkthub`) and port
   (`PKTHUB_PORT` env var; default `8760`)
2. Builds the frontend (`npm ci && npm run build`) in place, before copying,
   so `frontend/dist` travels with the tree
3. Copies the tree into the install dir via `rsync` (skipped if installing
   in place), excluding `venv/`, `node_modules/`, `.git/`, `__pycache__/`,
   any `*.db*` files, logs, and an existing `config.yaml`
4. Creates the venv and installs `requirements.txt`
5. Generates `config.yaml` from `config.example.yaml` **only if one doesn't
   already exist** — fills in a random `jwt_secret` and `initial_admin_password`,
   writes the chosen port, and prints the admin password once. Re-running the
   installer never overwrites an existing `config.yaml`.
6. Installs and starts the `pkthub` systemd service (`ExecStart` runs
   `python -m app.server`, not a fixed `uvicorn --port` invocation — see
   [Running & Managing the Service](#running--managing-the-service))

## Configuration Reference

`config.yaml` (generated from `config.example.yaml` on first install):

| Key | Default | Notes |
|---|---|---|
| `host` / `port` | `0.0.0.0` / `8760` | Read by `app/server.py` at process start; also editable via **Settings → Maintenance** (writes this file, takes effect on next restart) |
| `https` | `false` | Installs on HTTP — see [Enabling HTTPS](#enabling-https). Informational only: `app/server.py` actually decides HTTP vs HTTPS by checking whether a cert/key pair exists at `/etc/ssl/pkthub/`, regardless of this value |
| `jwt_secret` | random, generated at install | |
| `jwt_expire_minutes` | `60` | |
| `initial_admin_username` / `_password` / `_email` | `admin` / random / `admin@example.com` | Only used the very first time the `users` table is empty |
| `okta_domain` / `_client_id` / `_client_secret` | blank | Legacy OIDC fields, currently unused — Okta SSO is actually configured as **SAML** under Settings → Security → Auth, not via these keys |
| `db_path` | `<install_dir>/pkthub.db` | Leave blank to use the default |
| `health_poll_interval` | `30` | Seconds between registered-app health checks (also editable via Settings → App Registry) |
| `audit_retention_days` | `90` | |
| `trusted_cidrs` | `[]` | Empty = allow all |

## Running & Managing the Service

```bash
sudo systemctl status pkthub
sudo systemctl restart pkthub
journalctl -u pkthub -f
```

The systemd unit's `ExecStart` is `python -m app.server`, not a hardcoded
`uvicorn app.main:app --port ...` invocation. `app/server.py` reads
`host`/`port` from `config.yaml` at process start and auto-detects an SSL
cert/key pair at `/etc/ssl/pkthub/` to decide HTTP vs HTTPS — so changing the
port or uploading a cert only requires a service restart, never a unit-file
edit.

You can also restart the service from the UI: **Settings → Maintenance →
Restart** calls `POST /api/maintenance/restart` (admin only), which schedules
a `systemctl restart pkthub` ~1.5 seconds after responding (falling back to
sending itself `SIGTERM` — relying on systemd's `Restart=always` — if `sudo`
isn't configured for that command).

Logs also append to `<install_dir>/logs/pkthub.log`.

## Enabling HTTPS

pktHub installs on plain HTTP by default, and turning on HTTPS is entirely a
Settings action — **no systemd unit file edit is needed**, unlike some
sibling pkt* apps:

1. Log in as admin, go to **Settings → Security → SSL/TLS**, and upload
   either a combined PFX/P12 file (with its passphrase) or a separate PEM
   cert + key pair. Either path writes to `/etc/ssl/pkthub/cert.pem` and
   `/etc/ssl/pkthub/key.pem`.
2. Restart the service — via **Settings → Maintenance → Restart**, or
   `sudo systemctl restart pkthub`.
3. `app/server.py` detects the cert/key pair on startup and switches to
   HTTPS on the same port automatically.

To remove HTTPS, delete the cert via the SSL/TLS panel (or delete the files
under `/etc/ssl/pkthub/` directly) and restart.

## Roles & Auth

Three roles: `admin` (full access, including Settings and user management),
`analyst` (an elevated operational role — e.g. can act on endpoints gated by
`require_analyst_or_admin` such as parts of the app registry, but the audit
log is self-filtered to only their own entries), and `viewer` (read-only).

Auth methods, toggled under **Settings → Security → Auth**:

- **Local username/password** (bcrypt), the default.
- **Okta SAML SSO** — a full SP-initiated flow (`/api/auth/saml/metadata`,
  `/saml/login`, `/saml/callback`), not just an OIDC stub. Users are
  auto-provisioned by email on first SAML login, and their role is
  re-synced from the Okta `role`/`Role`/`userRole` attribute on every login
  (falls back to `viewer` if the attribute is missing or invalid).
- **Auth-disabled auto-login** — if an admin turns off *both* local auth and
  SAML, `POST /api/auth/auto-login` issues a session for the flagged default
  admin (or the first active admin) with no credentials at all, and the
  login page skips the form entirely. This is meant for trusted/isolated
  deployments only — it is a real authentication bypass by design, gated
  purely on both other auth methods being switched off.

The very first user is always created as `admin` from `config.yaml`'s
`initial_admin_*` fields on first boot.

## App Registry & Suite Integration

pktHub is the hub side of the suite-token mechanism every other pkt app
implements. There are two different places this shows up in the UI — don't
confuse them:

- **`/apps`** ("App Registry" in the nav) and the standalone **Context
  Viewer** (`/context`) are read-only, day-to-day views open to every role:
  see each registered app's health, jump into its proxied UI, and see its
  recent alerts.
- **Settings → Security → Suite Integration** (admin only) is where the
  actual registry management happens:
  1. The sibling app generates its own suite token (that app's
     **Settings → Integrations → Suite Integration → Copy Token**) — grab
     its base URL too.
  2. In pktHub, go to **Settings → Security → Suite Integration → Register
     App** and paste the token + base URL.
  3. pktHub validates via the app's `/api/health` and stores the token; it
     can also push a rotated token back to the app via that app's
     `POST /api/suite/register`.
  4. Registered apps are proxied through pktHub (`/proxy/:appId/*`) and
     appear on the dashboard, with health polled every
     `health_poll_interval` seconds (default 30s — configurable, along with
     the health-check timeout and the default mode assigned to newly
     registered apps, under **Settings → App Registry**).

Each registered app also has an **access mode**: `direct` (the app's own
login page still works standalone) or `managed` ("Managed Mode" / the "Enable
All" bulk action — locks direct login on the sibling app, forcing access
only through pktHub's proxy/SSO). pktHub polls each managed app's reported
lock state and, if an app reports itself unlocked while the hub still expects
`managed`, automatically reverts that app to `direct` and writes a
`break_glass.triggered` audit entry — a fail-safe so a sibling app can never
get silently stuck locked out from itself.

## NOC Displays

**NOC Builder** lets you lay out widgets from any registered app onto a
wallboard-style display; the public `/display/:token` route renders it
full-screen for a TV, with no login required. (This feature was originally
called "kiosk" internally — the `kiosk_layouts` DB table was renamed to
`noc_layouts` — same feature, if you run into the old name in a stale doc or
DB dump elsewhere.)

## Alerting & Notifications

pktHub tracks health-driven and administrative events from the suite and
lets you route them out:

- **Event types**: `app.unreachable`, `app.degraded`, `app.recovered`,
  `app.registered`, `app.deregistered`, `app.mode_change`, `token.rotated`,
  `break_glass.triggered`, `user.created`, `user.deleted`.
- **Severities**: `critical`, `warning`, `info`.
- **Settings → Notifications** configures Slack and generic webhook
  (POST/PUT) channels, and the alert rules that map an event type +
  severity to a channel (individually enabled/disabled).
- Active/unacked alerts and full filterable history are visible from the
  App Registry / Context Viewer pages, backed by `/api/alerts` and
  `/api/alerts/history`.

## AI Assistant

**Settings → Security → AI Assistant** lets an admin add an Anthropic API
key (from console.anthropic.com — separate from any Claude Enterprise seat)
and pick a model (Haiku by default; Sonnet or Opus also selectable). Once
configured, an in-app chat panel (available throughout the authenticated
app, backed by `POST /api/ai/chat`) answers questions using a snapshot of
**pktHub's own state only** — the registered-app list with health/mode, and
the 10 most recent audit log entries. It explicitly does not have access to
any individual pktApp's own telemetry (SNMP devices, log lines, packet
captures, etc.) — for those it tells the user to use that app's own AI
assistant, if it has one.

## Maintenance

**Settings → Maintenance** (admin only):

- **Restart** — restarts the pktHub service itself (see
  [Running & Managing the Service](#running--managing-the-service)).
- **Port** — view/change the listen port. Writes `port:` into `config.yaml`
  immediately but only takes effect after the next restart; the API
  (`GET`/`POST /api/maintenance/port`) does not restart anything itself.

## Backup & Restore

**Settings → Data → Backups** creates a `.tar.gz` snapshot containing a
consistent live copy of the SQLite DB (via SQLite's own backup API, safe to
run against a running database) plus `config.yaml`. Snapshots are written to
`<install_dir>/backups` by default; the path, retention count (oldest
snapshots beyond the configured count are pruned automatically), and an
auto-backup toggle are all configurable on the same tab. **Settings → Data →
Storage** covers separate general storage/retention settings (audit and
alert retention windows, storage connection test) — a different tab from
Backups.

## Troubleshooting

- **Service won't start / restart-loops**: `journalctl -u pkthub -n 50` —
  most common cause is a permissions issue reading the cert/key files at
  `/etc/ssl/pkthub/` if HTTPS is active, or a bad `port` value in
  `config.yaml`.
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
- **Locked out of a sibling app you set to Managed Mode**: this should
  self-heal — pktHub's health poller reverts a managed app to `direct` the
  moment that app reports itself unlocked (see
  [App Registry & Suite Integration](#app-registry--suite-integration)). If
  it hasn't, check the app's own suite-token/lock state directly rather than
  only looking at pktHub's registry entry.

## Development

```bash
cd frontend && npm install && npm run dev   # Vite dev server (proxies /api and /proxy to :8760)
cd .. && venv/bin/uvicorn app.main:app --reload --port 8760
```
