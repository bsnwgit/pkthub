# pktHub

**Unified NOC/SOC Management Platform for pktSolution**

pktHub is the central hub and sole management plane for all pktAPP applications — pktFlow, pktSNMP, pktLog, pktPCAP, and future apps. It runs on port **8760** and provides unified authentication, reverse-proxy access to all registered apps, a drag-and-drop kiosk builder for wall displays, and platform-wide settings, user management, and audit logging.

---

## Table of Contents

1. [Overview](#overview)
2. [Stack](#stack)
3. [Installation](#installation)
4. [Configuration](#configuration)
5. [First Boot & Initial Setup](#first-boot--initial-setup)
6. [Users & Roles](#users--roles)
7. [Registering pktAPP Apps](#registering-pktapp-apps)
8. [Registration Workflow](#registration-workflow)
9. [Managed Mode & Token Lockout](#managed-mode--token-lockout)
10. [Authentication & Session Security](#authentication--session-security)
11. [Proxied App Shell](#proxied-app-shell)
12. [Kiosk Builder](#kiosk-builder)
13. [Settings](#settings)
14. [API Reference](#api-reference)
15. [Break-Glass Recovery](#break-glass-recovery)
16. [Maintenance & Backup](#maintenance--backup)
17. [Deploy Pattern](#deploy-pattern)

---

## Overview

pktHub provides three distinct platform areas through a single unified interface:

**App Registry** — Register and deregister pktAPP apps. Monitor health, manage suite-token lifecycle, and view app status — all from Settings → App Registry.

**Managed App Viewer** — Proxied pktAPP UI served inside the pktHub shell. A thin 44px top bar stays persistent across all proxied screens — the app gets the full viewport with its own nav rendering naturally.

**Kiosk Builder** — Drag-and-drop widget composer for NOC/SOC wall displays. Build layouts from any registered app's widgets. Publish with a signed URL token — no login required on the display monitor.

---

## Stack

| Component | Technology |
|---|---|
| Backend | FastAPI (Python) |
| Frontend | React + TypeScript + Vite |
| Database | SQLite with WAL mode |
| Authentication | JWT (local) + Okta SAML 2.0 (optional) |
| Service | systemd (pkthub.service) |
| Port | 8760 HTTPS |

---

## Installation

### Prerequisites

- Python 3.11+
- Node.js 18+ (frontend build only)
- A valid TLS certificate and key for the server

### 1. Clone the Repository

```bash
git clone <repo-url> /mnt/software/pkthub
cd /mnt/software/pkthub
```

### 2. Install Python Dependencies

```bash
pip install -r requirements.txt
```

### 3. Build the Frontend

```bash
cd frontend
npm install
npm run build
# Output lands in frontend/dist — served by FastAPI as static files
cd ..
```

### 4. Place Configuration

```bash
cp config.example.yaml config.yaml
# Edit config.yaml — see Configuration section below
```

### 5. Install the systemd Service

```bash
cp pkthub.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable pkthub
systemctl start pkthub
```

---

## Configuration

All configuration lives in `config.yaml` at the application root. A fully annotated example is provided in `config.example.yaml`.

### Full Reference

```yaml
# Network binding
host: "0.0.0.0"          # Interface to bind (0.0.0.0 = all)
port: 8760                # HTTPS port

# TLS
https: true
ssl_certfile: "/etc/ssl/pkthub/cert.pem"
ssl_keyfile:  "/etc/ssl/pkthub/key.pem"

# JWT — generate secret with: openssl rand -hex 32
jwt_secret: "CHANGE_ME"
jwt_algorithm: "HS256"
jwt_expire_minutes: 60    # Session token lifetime

# Initial admin account (created on first boot if no users exist)
initial_admin_username: "admin"
initial_admin_password: "CHANGE_ME"
initial_admin_email: "admin@example.com"

# Okta SAML 2.0 SSO — leave blank to disable
okta_domain: ""
okta_client_id: ""
okta_client_secret: ""

# SQLite database
db_path: "/mnt/software/pkthub/pkthub.db"

# App health polling interval (seconds)
health_poll_interval: 30

# Audit log retention (days) — older records are purged automatically
audit_retention_days: 90

# Trusted CIDRs — empty list = allow all
trusted_cidrs: []
# Example: ["10.0.0.0/8", "172.16.0.0/12"]
```

### Key Decisions

**`jwt_expire_minutes`** — Controls how long a user stays logged in without activity. The pktAPP apps validate the same JWT pktHub issues, so this value applies to proxied app access as well.

**`health_poll_interval`** — pktHub polls each registered app's `/health` endpoint on this interval. Apps that fail three consecutive polls are flagged as degraded on the dashboard.

**`audit_retention_days`** — Audit records are stored in the pktHub SQLite database only. They are never forwarded to pktLog (this prevents a circular dependency). Set to `0` to retain indefinitely.

**`trusted_cidrs`** — When non-empty, requests from outside these ranges receive a 403 before any authentication check. Use to restrict management-plane access to internal networks only.

---

## First Boot & Initial Setup

On first start, pktHub checks whether any users exist in the database. If not, it creates the initial admin account from the values in `config.yaml`.

1. Open `https://<server>:8760` in a browser.
2. Log in with the `initial_admin_username` and `initial_admin_password` from your config.
3. **Immediately change the password** — Settings → Users → edit admin account.
4. Generate a new `jwt_secret` value and update `config.yaml`, then restart the service. The default value is insecure.
5. Configure TLS if you haven't already — the service will refuse to start with `https: true` if the cert or key file is missing.

---

## Users & Roles

pktHub has three roles. These roles also govern access within proxied pktAPP apps — the suite role maps directly to the equivalent pktAPP role.

| Area | Admin | Analyst | Viewer |
|---|---|---|---|
| NOC/SOC Dashboard | Full | Full | View |
| Proxied App Access | Maps to Admin | Maps to Analyst | Maps to Viewer |
| Kiosk Builder | Create / Edit / Delete / Publish | Create / Edit / Publish own | — |
| Kiosk Display | Yes | Yes | Yes |
| App Registry | Register / Deregister / Tokens | View only | — |
| User Management | Full | — | — |
| Platform Settings | Full | — | — |
| Auth / Okta Config | Full | — | — |
| Audit Log | Full | Own sessions only | — |
| Maintenance / Backup | Full | — | — |

### Managing Users

Navigate to **Settings → Users** (Admin only). From here you can:
- Create new users and assign roles
- Reset passwords
- Disable accounts (does not delete — audit history is preserved)
- Promote/demote roles

When Okta SAML 2.0 is enabled, local users remain active unless explicitly disabled. SAML users are created automatically on first login and assigned the Viewer role by default — promote as needed.

---

## Registering pktAPP Apps

Each pktAPP app must be running and reachable from the pktHub server before registration.

### Requirements on the pktAPP Side

Before registering, each pktAPP app must have the following endpoints implemented (Track 2 build items):

| Endpoint | Purpose |
|---|---|
| `GET /api/suite/token` | Returns the current suite token (generates one if absent) |
| `POST /api/suite/regenerate` | Generates and stores a new token (invalidates old one) |
| `GET /api/widgets/manifest` | Returns available kiosk widget definitions |
| `GET /api/health` | Health check — public endpoint, no auth required (returns 200 when healthy) |

The app must also support the `X-Suite-Token` header middleware and the `X-Suite-Version` API versioning header.

### Registering via the UI

1. On the pktApp, navigate to **Settings → Integrations → pktHub Integration**. Click **Copy Token** to copy the suite token.
2. In pktHub, navigate to **Settings → App Registry**. Click **Register App**.
3. Fill in App Name, Base URL, paste the Suite Token, and optionally set Hub Return URL. Click **Register**.

pktHub validates the token by calling the app's `/api/health` endpoint, then stores it.

---

## Registration Workflow

```
Register → Observe Mode → Managed Mode → (Deregister / Break-Glass)
```

### Observe Mode

pktHub monitors and proxies the app, but direct access to the pktAPP remains fully functional. Use this phase to:
- Validate that proxied access works correctly end-to-end
- Confirm JWT passthrough and role mapping
- Test kiosk widgets in the builder

Switch to managed mode only after the operator is satisfied everything works.

### Managed Mode

All requests to the pktAPP must carry the `X-Suite-Token` header. Requests without a valid token receive a `403 Forbidden`. Direct browser access to the pktAPP's native port is blocked.

To flip the mode: **Settings → App Registry → [App] → Toggle Mode → Managed**.

### Suite Token Ownership

Each pktAPP generates and owns its own suite token (stored in its SQLite database). The token does not change on restart. To revoke access, use the **Regen** button in pktApp Settings → Integrations — this generates a new token and invalidates the old one. You must re-register in pktHub after regenerating.

### Deregistration

Full clean break:
- Suite token is removed from the pktAPP
- Direct access is restored
- pktAPP local users are un-dormanted
- The app is removed from the pktHub registry
- All kiosk widgets sourced from this app are marked inactive

To deregister: **Settings → App Registry → [App] → Deregister**.

---

## Managed Mode & Token Lockout

In managed mode the `X-Suite-Token` middleware on the pktAPP side enforces the lockout. The token is a URL-safe random string generated and owned by the pktAPP. It is stored in the pktAPP's SQLite database and does not change on restart. Use the **Regen** button in pktApp Settings → Integrations to generate a new token and invalidate the old one — then re-register in pktHub.

The `X-Suite-Version: 1` header is sent on all pktHub ↔ pktAPP API calls. pktAPP apps advertise their supported versions in the registration payload; pktHub negotiates the highest mutually supported version at registration time.

---

## Authentication & Session Security

pktHub uses a layered token strategy designed so that **no secret ever touches `localStorage` or a readable cookie for longer than necessary**.

### Token Storage

| Token | Where stored | Lifetime | Purpose |
|---|---|---|---|
| Main JWT | React memory (in-process only) | `jwt_expire_minutes` | All SPA API calls via `Authorization: Bearer` |
| `pkthub_session` cookie | HttpOnly, Secure, SameSite=Strict, path=/ | Same as JWT | Page reload recovery — bearer fallback only |
| `pkthub_proxy_{id}` cookie | HttpOnly, Secure, SameSite=Strict, path=/proxy/{id}/ | 5 minutes | Proxy iframe authentication — scoped to one app |

**Why this matters:** Browser iframes and page navigations cannot send custom `Authorization` headers. The traditional fix — storing the JWT in `localStorage` — exposes it to any XSS on the page. pktHub avoids both problems: the main JWT lives only in React memory, and proxy access uses a separate short-lived scoped cookie that the browser sends automatically.

### Proxy Session Flow

```
User clicks pktAPP in pktHub
        │
        ▼
React calls POST /api/auth/proxy-session/{app_id}
  with Authorization: Bearer <in-memory JWT>
        │
        ▼
pktHub validates JWT, issues proxy token:
  - scope = "proxy:{app_id}"   ← rejected by all other auth checks
  - 5-minute TTL
  - path=/proxy/{app_id}/      ← browser only sends to this path
        │
        ▼
Server sets pkthub_proxy_{app_id} HttpOnly cookie
        │
        ▼
ProxyShell renders iframe src=/proxy/{app_id}/
  Browser sends cookie automatically — no header needed
        │
        ▼
ProxyShell renews cookie every 4 minutes (before TTL expires)
```

### Security Properties

- **HttpOnly** — JS cannot read the proxy cookie (XSS cannot steal it)
- **Secure** — HTTPS only, never transmitted in plaintext
- **SameSite=Strict** — no cross-site requests can include the cookie (CSRF blocked)
- **Path-scoped** — `pkthub_proxy_1` is sent only to `/proxy/1/...`, never to other apps
- **Scope claim** — proxy tokens are cryptographically bound to one app; they are explicitly rejected by `get_current_user` for all non-proxy routes
- **5-minute TTL** — a stolen proxy cookie is useless within minutes
- **In-memory main JWT** — gone on tab close; never persisted to disk or browser storage

### Public Endpoints

`/api/health` is a public endpoint (no auth required) on all pktAPPs. pktHub uses this endpoint for health monitoring — polling it on the configured `health_poll_interval` to determine app status. No suite token or JWT is required to reach `/api/health`.

### `get_current_user` Resolution Order

1. `Authorization: Bearer <token>` header — used for all SPA API calls
2. `pkthub_session` HttpOnly cookie — fallback for page reloads and SSO redirects

Proxy-scoped tokens (containing a `scope` claim) are **explicitly rejected** in both paths above — they cannot be used to authenticate general API requests.

---

## Proxied App Shell

When a user navigates into a registered pktAPP through pktHub, the interface switches to a thin persistent top bar (44px):

- **Left**: pktHub lockup logo
- **Center**: current app indicator (colored in that app's accent color — blue for pktFlow, teal for pktSNMP, green for pktLog, purple for pktPCAP)
- **Right**: user menu + home button

The pktAPP gets the full remaining viewport with its own navigation rendering naturally. There is no double-nav. On pktHub-native pages (dashboard, settings, kiosk builder) the full pktHub nav is visible.

---

## Kiosk Builder

### Overview

The Kiosk Builder is a drag-and-drop grid canvas for composing wall-display dashboards from widgets exposed by any registered pktAPP.

### Widget Manifests

At registration, pktHub reads each app's `/api/widgets/manifest` endpoint. The manifest declares:
- Available widget types and their display names
- Data schemas and API endpoints the widget pulls from
- Minimum refresh interval (seconds)
- Required role to view the widget

Widgets are automatically populated into the builder's library panel, grouped by source app. Widget borders are colored in the source app's accent color.

### Building a Layout

1. Navigate to **Kiosk Builder**.
2. Click **New Layout** and give it a name.
3. Drag widgets from the library panel onto the grid canvas. Resize by dragging corners.
4. Configure each widget (title, refresh rate override, optional filter parameters).
5. Set display mode:
   - **Static** — all widgets shown simultaneously, each refreshes at its own interval
   - **Rotating Slides** — panels cycle with configurable per-slide dwell time
6. Click **Save**.

### Publishing a Kiosk

1. Open a saved layout.
2. Click **Publish**.
3. pktHub generates a signed display URL and a revocable token.
4. Copy the URL and load it on the wall monitor. No login is required — the display token authenticates all data requests transparently.
5. Tokens are revocable at any time: **Kiosk Builder → [Layout] → Revoke Token**.

### Permissions

| Action | Admin | Analyst | Viewer |
|---|---|---|---|
| Create layouts | Yes | Yes | — |
| Edit own layouts | Yes | Yes | — |
| Edit any layout | Yes | — | — |
| Delete layouts | Yes | — | — |
| Publish layouts | Yes | Yes (own only) | — |
| View kiosk displays | Yes | Yes | Yes |

---

## Settings

Settings follow the same two-column layout as pktFlow: sticky 260px sidebar with grouped nav + main content area.

| Tab | Contents |
|---|---|
| General | App name, display preferences, timezone |
| Network | Bind address, port, TLS certificate paths, trusted CIDRs |
| App Registry | Registered apps, health status, mode toggle, token rotation |
| Kiosk | Default dwell time, layout defaults, display token expiry |
| Auth | Local auth settings, Okta SAML 2.0 configuration |
| Notifications | Slack, Email, PagerDuty, Webhook, TraceCat integration |
| Audit | Retention policy, log viewer, export |
| Maintenance | Database backup, vacuum, service restart |
| Users | User management (Admin only) |

---

## API Reference

All pktHub API endpoints are under `/api/v1/`. Authentication is via `Authorization: Bearer <jwt>` header.

### Authentication

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Returns JWT + sets `pkthub_session` HttpOnly cookie |
| `POST` | `/api/auth/logout` | Clears `pkthub_session` cookie server-side |
| `GET` | `/api/auth/me` | Returns current user (accepts Bearer or session cookie) |
| `POST` | `/api/auth/proxy-session/{app_id}` | Issues scoped 5-min HttpOnly proxy cookie for one app |

### App Registry

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/apps` | List all registered apps |
| `POST` | `/api/v1/apps/register` | Register a new pktAPP |
| `DELETE` | `/api/v1/apps/{app_id}` | Deregister an app |
| `PATCH` | `/api/v1/apps/{app_id}/mode` | Toggle observe/managed mode |
| `POST` | `/api/v1/apps/{app_id}/rotate-token` | Rotate the suite token |
| `GET` | `/api/v1/apps/{app_id}/health` | Latest health status |

### pktAPP Suite Endpoints (on each pktAPP)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/suite/token` | Returns the current suite token (generates one if absent) |
| `POST` | `/api/suite/regenerate` | Generates and stores a new token (invalidates old one) |

### Kiosk

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/kiosk/layouts` | List saved layouts |
| `POST` | `/api/v1/kiosk/layouts` | Create a new layout |
| `PUT` | `/api/v1/kiosk/layouts/{id}` | Update a layout |
| `DELETE` | `/api/v1/kiosk/layouts/{id}` | Delete a layout |
| `POST` | `/api/v1/kiosk/layouts/{id}/publish` | Publish and generate display token |
| `DELETE` | `/api/v1/kiosk/layouts/{id}/token` | Revoke display token |
| `GET` | `/api/v1/kiosk/display/{token}` | Public display endpoint (no auth required) |

### Users

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/users` | List users (Admin only) |
| `POST` | `/api/v1/users` | Create user (Admin only) |
| `PATCH` | `/api/v1/users/{id}` | Update user (Admin only) |
| `DELETE` | `/api/v1/users/{id}` | Disable user (Admin only) |

### Audit Log

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/audit` | Query audit log (Admin = all; Analyst = own sessions) |
| `GET` | `/api/v1/audit/export` | Export as CSV (Admin only) |

### Health

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Service health — stays live even when main app is degraded |

### pktHub → pktAPP Protocol Headers

All requests pktHub makes to a registered pktAPP carry:

```
X-Suite-Token: <token>
X-Suite-Version: 1
```

---

## Break-Glass Recovery

If pktHub becomes unreachable, each pktAPP has a CLI break-glass command that performs a full deregistration locally without needing to contact pktHub:

```bash
# On the pktAPP server
python app/main.py --emergency-unlock
```

What this does:
1. Removes the `X-Suite-Token` requirement (managed mode disabled immediately)
2. Restores direct browser access to the pktAPP
3. Un-dormants all local pktAPP user accounts
4. Writes a local break-glass audit entry

When pktHub comes back online it will detect the deregistration and mark the app as deregistered in the registry. The break-glass event is logged and alerted (Slack/email if configured). Re-register manually after recovery.

**The break-glass CLI must only be used when pktHub is genuinely unreachable.** Using it while pktHub is healthy will cause a state mismatch until the app is re-registered.

---

## Maintenance & Backup

### Database Backup

```bash
# Manual backup — SQLite WAL safe copy
sqlite3 /mnt/software/pkthub/pkthub.db ".backup '/mnt/software/pkthub/backups/pkthub-$(date +%Y%m%d).db'"
```

The Settings → Maintenance page also exposes a one-click backup that writes to the `backups/` subdirectory under the application root.

### Database Vacuum

SQLite databases accumulate free pages over time. Periodic VACUUM reclaims space:

```bash
sqlite3 /mnt/software/pkthub/pkthub.db "VACUUM;"
```

Run during a low-traffic window. The Settings → Maintenance page includes a Vacuum button.

### Service Management

```bash
systemctl status pkthub      # Check status
systemctl restart pkthub     # Restart
journalctl -u pkthub -f      # Follow logs
```

### Audit Log Purge

Audit records older than `audit_retention_days` are purged automatically on a nightly schedule. To force an immediate purge:

```bash
# Via the Settings → Audit → Purge Now button in the UI
# Or directly:
sqlite3 /mnt/software/pkthub/pkthub.db \
  "DELETE FROM audit_log WHERE created_at < datetime('now', '-90 days');"
```

---

## Deploy Pattern

pktHub uses the same deploy pattern as pktFlow and pktLog:

1. Make changes locally in the project directory.
2. Build the frontend (`npm run build` in `frontend/`).
3. SFTP the `frontend/dist/` output and any changed backend files to `/mnt/software/pkthub/` on the server.
4. `systemctl restart pkthub`

**SSH note:** SentinelOne blocks the system `ssh.exe`. All remote operations must use Python + Paramiko via Desktop Commander's `start_process`. Use `timeout=15, banner_timeout=15` and include `sys.stdout.reconfigure(encoding='utf-8')` at the top of every Paramiko script. One script, one run, no retry loops.

---

*pktHub — Unified NOC/SOC Platform — pktSolution*
