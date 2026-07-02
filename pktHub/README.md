# pktHub

**Unified NOC/SOC Management Platform for pktSolution**

pktHub is the central hub and sole management plane for all pktAPP applications — pktFlow, pktSNMP, pktLog, pktPCAP, and future apps. It provides unified authentication, reverse-proxy access to all registered apps, a drag-and-drop NOC builder for wall displays, and platform-wide settings, user management, and audit logging.

---

## Table of Contents

1. [Overview](#overview)
2. [Stack](#stack)
3. [Docker Deployment](#docker-deployment) ← **Recommended**
4. [Manual Installation](#manual-installation)
5. [Configuration](#configuration)
6. [First Boot & Initial Setup](#first-boot--initial-setup)
7. [Users & Roles](#users--roles)
8. [Registering pktAPP Apps](#registering-pktapp-apps)
9. [Registration Workflow](#registration-workflow)
10. [Managed Mode & Token Lockout](#managed-mode--token-lockout)
11. [Authentication & Session Security](#authentication--session-security)
12. [Context Viewer](#context-viewer)
13. [Proxied App Shell](#proxied-app-shell)
14. [NOC Builder](#noc-builder)
15. [Settings](#settings)
16. [API Reference](#api-reference)
17. [Break-Glass Recovery](#break-glass-recovery)
18. [Maintenance & Backup](#maintenance--backup)

---

## Overview

pktHub provides three distinct platform areas through a single unified interface:

**App Registry** — Register and deregister pktAPP apps. Monitor health, manage suite-token lifecycle, and view app status — all from Settings → App Registry.

**Managed App Viewer** — Proxied pktAPP UI served inside the pktHub shell. A thin 44px top bar stays persistent across all proxied screens — the app gets the full viewport with its own nav rendering naturally.

**Context Viewer** — Full-screen dedicated viewer for any registered pktAPP, accessible at `/context`. Opens in its own full-viewport view (no pktHub sidebar) with a 44px header and an app-selector dropdown. Useful when you want to focus on a single app without switching contexts.

**NOC Builder** — Drag-and-drop widget composer for NOC/SOC wall displays. Build layouts from any registered app's widgets on a 1920×1080 canvas. Publish with a signed URL token — no login required on the display monitor.

---

## Stack

| Component | Technology |
|---|---|
| Backend | FastAPI (Python) |
| Frontend | React + TypeScript + Vite |
| Database | SQLite with WAL mode |
| Authentication | JWT (local) + Okta SAML 2.0 (optional) |
| Distribution | Docker (`ghcr.io/bsnwgit/pkthub`) |
| Service (non-Docker) | systemd (pkthub.service) |

---

## Docker Deployment

This is the recommended way to run pktHub. A single image serves both HTTP and HTTPS and persists all data (database, config, SSL certs, logs) in a named Docker volume.

### Prerequisites

- Docker Engine 20.10+ and Docker Compose v2

### Quick Start

```bash
# Pull the image
docker pull ghcr.io/bsnwgit/pkthub:latest

# Copy the example env file
cp .env.example .env

# Set your admin password (required)
nano .env      # set APP_ADMIN_PASSWORD=your_secure_password

# Start
docker compose up -d
```

pktHub is now available at:
- **HTTP**: `http://<host>:80`
- **HTTPS**: `https://<host>:443` (self-signed cert by default)

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `APP_ADMIN_PASSWORD` | **Yes** | — | Password for the initial admin account |
| `APP_ADMIN_USER` | No | `admin` | Username for the initial admin account |
| `APP_ADMIN_EMAIL` | No | `admin@localhost` | Email for the initial admin account |
| `APP_HTTP_PORT` | No | `80` | Host + container port for HTTP |
| `APP_HTTPS_PORT` | No | `443` | Host + container port for HTTPS |
| `APP_JWT_SECRET` | No | auto-generated | JWT signing secret. Set a fixed value to keep sessions valid across container recreations. Generate one with `openssl rand -hex 32`. |
| `OKTA_DOMAIN` | No | `` | Okta domain for SAML SSO |
| `OKTA_CLIENT_ID` | No | `` | Okta client ID |
| `OKTA_CLIENT_SECRET` | No | `` | Okta client secret |

### Persistent Volume

All runtime data is stored in a Docker named volume (`pkthub-data`) mapped to `/data` inside the container:

```
/data/
  config.yaml     # Generated from env vars on first start
  pkthub.db       # SQLite database
  ssl/
    cert.pem      # TLS certificate (auto-generated self-signed if absent)
    key.pem       # TLS private key
  logs/
    pkthub-http.log
    pkthub-https.log
  backups/        # Database backups from Settings → Maintenance
```

**Important:** Mount this volume to retain data across container updates and host reboots. Without a volume, all data (including user accounts and registered apps) is lost when the container is recreated.

### Custom TLS Certificate

To use a CA-signed certificate instead of the auto-generated self-signed one, place your cert and key in the volume before first start:

```bash
# Find the volume mount path on the host
docker volume inspect pkthub-data

# Copy your cert files (adjust the host path from the inspect output)
cp your-cert.pem /path/to/volume/ssl/cert.pem
cp your-key.pem  /path/to/volume/ssl/key.pem

# Restart to pick up the new cert
docker compose restart
```

### Changing Ports

Edit `.env`, then recreate the container:

```bash
# .env
APP_HTTP_PORT=8080
APP_HTTPS_PORT=8443

docker compose down
docker compose up -d
```

### Updating

```bash
docker compose pull
docker compose down
docker compose up -d
```

Data on the named volume is preserved across updates.

### Run Without Docker Compose

```bash
docker run -d \
  --name pkthub \
  --restart unless-stopped \
  -p 80:80 \
  -p 443:443 \
  -v pkthub-data:/data \
  -e APP_ADMIN_PASSWORD=your_secure_password \
  ghcr.io/bsnwgit/pkthub:latest
```

---

## Manual Installation

Use this section for bare-metal or VM installs without Docker.

### Prerequisites

- Python 3.11+
- Node.js 18+ (frontend build only)
- A user account to run the service (e.g., `appuser`)

### 1. Clone the Repository

```bash
git clone <repo-url> /opt/pkthub
cd /opt/pkthub
```

### 2. Install Python Dependencies

```bash
python3 -m venv venv
source venv/bin/activate
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

> **Docker users:** `config.yaml` is auto-generated from env vars on first start and stored in `/data/config.yaml` on the persistent volume. You do not need to edit it manually.

### Full Reference

```yaml
# Network binding
host: "0.0.0.0"          # Interface to bind (0.0.0.0 = all)
port: 8760                # Port (for systemd installs; Docker uses env vars)

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
db_path: "/opt/pkthub/pkthub.db"

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

On first start, pktHub checks whether any users exist in the database. If not, it creates the initial admin account from `config.yaml` (systemd) or `APP_ADMIN_USER` / `APP_ADMIN_PASSWORD` env vars (Docker).

1. Open `https://<host>` (Docker) or `https://<host>:8760` (systemd) in a browser.
2. Log in with the initial admin credentials.
3. **Immediately change the password** — Settings → Users → edit admin account.
4. Generate a new `jwt_secret` value and update your config, then restart. The default value is insecure.
5. Configure TLS if using a CA-signed certificate — see [Custom TLS Certificate](#custom-tls-certificate) (Docker) or place cert files in the paths set in `config.yaml` (systemd).

---

## Users & Roles

pktHub has three roles. These roles also govern access within proxied pktAPP apps — the suite role maps directly to the equivalent pktAPP role.

| Area | Admin | Analyst | Viewer |
|---|---|---|---|
| NOC/SOC Dashboard | Full | Full | View |
| Proxied App Access | Maps to Admin | Maps to Analyst | Maps to Viewer |
| NOC Builder | Create / Edit / Delete / Publish | Create / Edit / Publish own | — |
| NOC Display | Yes | Yes | Yes |
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

Before registering, each pktAPP app must have the following endpoints implemented:

| Endpoint | Purpose |
|---|---|
| `GET /api/suite/token` | Returns the current suite token (generates one if absent) |
| `POST /api/suite/regenerate` | Generates and stores a new token (invalidates old one) |
| `GET /api/widgets/manifest` | Returns available noc widget definitions |
| `GET /api/health` | Health check — public endpoint, no auth required (returns 200 when healthy) |

The app must also support the `X-Suite-Token` header middleware and the `X-Suite-Version` API versioning header.

### Registering via the UI

1. On the pktApp, navigate to **Settings → Integrations → pktHub Integration**. Click **Copy Token** to copy the suite token.
2. In pktHub, navigate to **Settings → App Registry**. Click **Register App**.
3. Fill in App Name, Base URL (use the Docker service name or hostname), paste the Suite Token, and optionally set Hub Return URL. Click **Register**.

pktHub validates the token by calling the app's `/api/health` endpoint, then stores it.

> **Docker note:** When pktHub and pktAPP apps run in separate containers, use container names or hostnames as the base URL rather than `localhost`. Ensure containers are on a shared Docker network.

---

## Registration Workflow

```
Register → Observe Mode → Managed Mode → (Deregister / Break-Glass)
```

### Observe Mode

pktHub monitors and proxies the app, but direct access to the pktAPP remains fully functional. Use this phase to:
- Validate that proxied access works correctly end-to-end
- Confirm JWT passthrough and role mapping
- Test noc widgets in the builder

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
- All noc widgets sourced from this app are marked inactive

To deregister: **Settings → App Registry → [App] → Deregister**.

---

## Managed Mode & Token Lockout

In managed mode the `X-Suite-Token` middleware on the pktAPP side enforces the lockout. The token is a URL-safe random string generated and owned by the pktAPP. It is stored in the pktAPP's SQLite database and does not change on restart. Use the **Regen** button in pktApp Settings → Integrations to generate a new token and invalidate the old one — then re-register in pktHub.

The `X-Suite-Version: 1` header is sent on all pktHub ↔ pktAPP API calls. pktAPP apps advertise their supported versions in the registration payload; pktHub negotiates the highest mutually supported version at registration time.

### Token Mismatch Alert

If pktHub's stored suite token no longer matches the token a pktAPP is actually using, pktHub raises a **Token Mismatch** alert. This prevents silent proxy failures caused by regenerating the pktApp token without re-registering.

- A pulsing **⚠️ Token Mismatch** badge appears on the app card in App Registry.
- A blocking overlay appears in the Context Viewer to prevent confusion from failed proxied requests.
- Click the **Re-sync** button (admin only) to automatically fetch the live token from the pktApp and update the registry — no manual copy/paste required.

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

## Context Viewer

The Context Viewer is a full-screen dedicated page at `/context` for focusing on a single registered pktAPP without any pktHub sidebar or navigation chrome.

**Layout:**
- 44px header: pktHub icon · app name (color-coded) · username · **app-selector dropdown** (ChevronDown) · Home icon
- Below: full-viewport iframe showing the selected app via the standard proxy session mechanism

**Use case:** When you want to use a specific pktAPP tool without the multi-app navigation context — e.g. a secondary monitor showing pktFlow live while working in pktHub on the primary screen.

The Context Viewer creates a short-lived proxy session for each app switch, exactly like the main Proxied App Shell, so the same cookie-based auth applies.

---

## Proxied App Shell

When a user navigates into a registered pktAPP through pktHub, the interface switches to a thin persistent top bar (44px):

- **Left**: pktHub lockup logo
- **Center**: current app indicator (colored in that app's accent color — blue for pktFlow, teal for pktSNMP, green for pktLog, purple for pktPCAP)
- **Right**: user menu + home button

The pktAPP gets the full remaining viewport with its own navigation rendering naturally. There is no double-nav. On pktHub-native pages (dashboard, settings, NOC builder) the full pktHub nav is visible.

---

## NOC Builder

### Overview

The NOC Builder is a drag-and-drop grid canvas for composing wall-display dashboards from widgets exposed by any registered pktAPP.

### Widget Manifests

pktHub polls each registered app's `/api/widgets/manifest` endpoint every **60 seconds** (not only at registration). New widgets appear in the builder library automatically within one poll cycle — no restart or re-registration needed.

Each manifest entry declares:
- `id`, `title`, `description` — identity shown in the library panel
- `view_path` — the iframe URL pktHub loads for the widget
- `default_w` / `default_h` / `min_w` / `min_h` — canvas placement hints

Widgets are rendered as server-side HTML pages delivered inside iframes. Each widget auto-reloads on its own 30-second timer. In slide-rotation mode, iframes are force-remounted on every slide change to guarantee fresh data.

Widget borders are colored in the source app's accent color. Current widget catalog:

| App | Count | Widgets |
|---|---|---|
| pktFlow | 9 | top_talkers, flow_summary, active_alerts, top_ports, protocol_breakdown, geo_map, recent_flows, network_topology, collector_status |
| pktLog | 6 | log_stream, error_rate, facility_breakdown, alert_events, log_sources, top_devices |
| pktSNMP | 6 | device_table, collector_status, trap_events, active_alerts, metrics_overview, metrics_chart |
| pktPCAP | 3 | capture_feed, recent_captures, protocol_stats |
| **Total** | **24** | — |

### Building a Layout

1. Navigate to **NOC Builder**.
2. Click **New Layout** and give it a name.
3. Drag widgets from the library panel onto the **1920×1080 canvas** (matches full-HD wall monitors exactly). Resize by dragging widget corners or edges.
4. Use the **zoom controls** (top bar: `−` / `100%` / `+`, range 25%–200%) to scale the canvas view for comfortable editing — zoom does not affect the published display size.
5. Set display mode:
   - **Static** — all widgets shown simultaneously, each auto-refreshes every 30 s
   - **Rotating Slides** — panels cycle with configurable per-slide dwell time; iframes remount on each rotation for guaranteed fresh data
6. Click **Save**.

### Publishing a NOC

1. Open a saved layout.
2. Click **Publish**.
3. pktHub generates a signed display URL and a revocable token.
4. Copy the URL and load it on the wall monitor. No login is required — the display token authenticates all data requests transparently.
5. Tokens are revocable at any time: **NOC Builder → [Layout] → Revoke Token**.

### NOC Display

The published display URL renders at `/display/{token}` and is designed for wall monitors of any resolution:

- **Scale-to-fit**: the 1920×1080 canvas is scaled uniformly (`scale = min(viewport_width / 1920, viewport_height / 1080)`) so it fills the screen without cropping or scroll bars — identical behaviour to presentation software on any screen size.
- **Zero-login**: the display token authenticates all widget data requests transparently. No browser login prompt.
- **Slide rotation**: each widget iframe gets a unique `key` that changes on slide transitions, forcing a full remount and guaranteed fresh data load.
- **Proxy-display route**: widget iframes use `/proxy-display/{token}/{app_id}/{path}` so the display page works without any user session.

### Permissions

| Action | Admin | Analyst | Viewer |
|---|---|---|---|
| Create layouts | Yes | Yes | — |
| Edit own layouts | Yes | Yes | — |
| Edit any layout | Yes | — | — |
| Delete layouts | Yes | — | — |
| Publish layouts | Yes | Yes (own only) | — |
| View NOC displays | Yes | Yes | Yes |

---

## Settings

Settings follow the same two-column layout as pktFlow: sticky 260px sidebar with grouped nav + main content area.

| Tab | Contents |
|---|---|
| General | App name, display preferences, timezone |
| Network | Bind address, port, TLS certificate paths, trusted CIDRs |
| App Registry | Registered apps, health status, mode toggle, token rotation |
| NOC | Default dwell time, layout defaults, display token expiry |
| Auth | Local auth settings, Okta SAML 2.0 configuration |
| Notifications | Slack, Email, PagerDuty, Webhook, TraceCat integration |
| Audit | Retention policy, log viewer, export |
| Maintenance | Database backup, vacuum, service restart |
| Users | User management (Admin only) |

---

## API Reference

All pktHub API endpoints are under `/api/`. Authentication is via `Authorization: Bearer <jwt>` header.

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
| `GET` | `/api/apps` | List all registered apps |
| `POST` | `/api/apps/register` | Register a new pktAPP |
| `DELETE` | `/api/apps/{app_id}` | Deregister an app |
| `PATCH` | `/api/apps/{app_id}/mode` | Toggle observe/managed mode |
| `POST` | `/api/apps/{app_id}/rotate-token` | Rotate the suite token |
| `GET` | `/api/apps/{app_id}/health` | Latest health status |
| `POST` | `/api/apps/{app_id}/resync-token` | Fetch live token from pktApp and update registry |

### pktAPP Suite Endpoints (on each pktAPP)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/suite/token` | Returns the current suite token (generates one if absent) |
| `POST` | `/api/suite/regenerate` | Generates and stores a new token (invalidates old one) |

### Alerts

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/alerts` | List active alerts |
| `GET` | `/api/alerts/history` | Alert history with date/type filters |
| `POST` | `/api/alerts/{id}/ack` | Acknowledge an alert |

### NOC

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/noc/layouts` | List saved layouts |
| `POST` | `/api/noc/layouts` | Create a new layout |
| `PUT` | `/api/noc/layouts/{id}` | Update a layout |
| `DELETE` | `/api/noc/layouts/{id}` | Delete a layout |
| `POST` | `/api/noc/layouts/{id}/publish` | Publish and generate display token |
| `DELETE` | `/api/noc/layouts/{id}/token` | Revoke display token |
| `GET` | `/api/noc/display/{token}` | Public display endpoint (no auth required) |

### Users

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/users` | List users (Admin only) |
| `POST` | `/api/users` | Create user (Admin only) |
| `PATCH` | `/api/users/{id}` | Update user (Admin only) |
| `DELETE` | `/api/users/{id}` | Disable user (Admin only) |

### Audit Log

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/audit` | Query audit log (Admin = all; Analyst = own sessions) |
| `GET` | `/api/audit/export` | Export as CSV (Admin only) |

### NOC Display (Public)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/display/{token}` | Renders the published NOC display page (no auth required) |
| `GET` | `/proxy-display/{token}/{app_id}/{path}` | Proxies widget iframe requests using the display token — no user session needed |

### Health

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service health — public endpoint |

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
sqlite3 /opt/pkthub/pkthub.db ".backup '/opt/pkthub/backups/pkthub-$(date +%Y%m%d).db'"

# Docker
docker exec pkthub sqlite3 /data/pkthub.db ".backup '/data/backups/pkthub-$(date +%Y%m%d).db'"
```

The Settings → Maintenance page also exposes a one-click backup.

### Database Vacuum

```bash
sqlite3 /opt/pkthub/pkthub.db "VACUUM;"

# Docker
docker exec pkthub sqlite3 /data/pkthub.db "VACUUM;"
```

Run during a low-traffic window. The Settings → Maintenance page includes a Vacuum button.

### Service Management

```bash
# systemd
systemctl status pkthub
systemctl restart pkthub
journalctl -u pkthub -f

# Docker
docker compose ps
docker compose restart
docker compose logs -f pkthub
```

### Audit Log Purge

Audit records older than `audit_retention_days` are purged automatically on a nightly schedule. To force an immediate purge, use **Settings → Audit → Purge Now** in the UI.

---

*pktHub — Unified NOC/SOC Platform — pktSolution*
