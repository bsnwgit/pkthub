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
- [IP Intelligence Lookup](#ip-intelligence-lookup)
- [App Registry & Suite Integration](#app-registry--suite-integration)
- [Reg App Settings](#reg-app-settings)
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
| `ai_api.py` | `/api/ai` | Multi-provider AI assistant (Ollama/local, Anthropic, or OpenAI) scoped to pktHub's own registry/audit data |

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

## IP Intelligence Lookup

`GET /api/ip-info/{ip}` (`app/ip_info.py`) combines four external lookups for a single public IP:

- **ipinfo.io** — geolocation/ASN/org info, plus company, privacy (VPN/proxy/Tor/relay/hosting), and abuse contact on paid plans
- **ipapi.is** — geolocation, ASN/org, company, abuse contact, VPN/proxy/Tor/datacenter/abuser detection, all in one call, no plan gating
- **AbuseIPDB** — abuse confidence score and report history
- **MXToolbox** — reverse DNS (PTR), ASN, and a blacklist/RBL check

All four are called concurrently. Private/loopback/link-local/reserved/multicast addresses are rejected — external providers have nothing useful to say about them.

Keys are **per-user**, not app-wide: each logged-in user stores their own under Settings → User Keys (`app/user_api_keys.py`), and lookups run under that user's own key/quota — no shared/admin key, no cross-user visibility. A fifth provider slot, IPQualityScore, can be saved and tested there but isn't consumed by the lookup yet.

MXToolbox's other commands — email/DNS record checks (SPF, DMARC, DKIM, MX, DNS, TXT, SOA, BIMI, MTA-STS, TLSRPT, A, AAAA) and active probes (ping, traceroute, TCP/HTTP/HTTPS/SMTP connect, run from MXToolbox's own infrastructure against the target) — are reachable via `POST /api/mxtoolbox/lookup` (`{command, argument, port?}`, `app/mxtoolbox.py`). Backend only for now — no page in the UI links an IP to this lookup yet.

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
`managed`, automatically reverts that app to `direct` and writes an
`app.lock_drift_detected` audit entry — a fail-safe so a sibling app can never
get silently stuck locked out from itself.

## Reg App Settings

Every registered app gets its own entry in the left nav, under a **REG APP
SETTINGS** divider below Hub Settings — e.g. "pktSNMP - Settings". Clicking
one shows that app's **actual, live Settings page**, embedded full-screen to
the right of pktHub's own menu (no duplicate sidebar/header — pktHub's menu
is the only chrome on screen). This is not a re-implementation: it's the
real app, proxied in, so it can never drift out of sync with what that app's
Settings page actually looks like or does.

**How it works under the hood** (relevant if you're building this into a new
pkt* app, or debugging why it doesn't work for one):
1. pktHub authenticates the embed the same way it authenticates the NOC
   Builder's widget iframes and the Context Viewer's "open full app" view —
   a scoped proxy-session cookie, then `GET /proxy/:appId/settings?chromeless=1`.
2. The sibling app's own React Router needs to recognize it's running under
   that `/proxy/:appId/` path prefix (as its `basename`), or every route
   fails to match and falls through to a `*` redirect — usually landing on
   Dashboard instead of Settings.
3. The sibling app's Layout component needs a `chromeless` mode (driven by
   the `?chromeless=1` query param) that skips its own sidebar/header and
   renders just the page content.
4. The sibling app's auth store needs to recognize it's being accessed via
   a suite token (check `GET /api/suite/whoami` — `via_suite_token: true`)
   and synthesize a logged-in session client-side, instead of showing its
   own login page (a fresh iframe load has no cookie/JWT session of its own).
5. Any app-relative asset (logos, icons) referenced with a **literal
   absolute path** (`src="/logo.png"`) will 404 when proxied — browsers
   resolve a leading-`/` path against the real document origin regardless of
   any `<base>` tag, so it requests the image from pktHub instead of the
   sibling app. Fix: reference it with a **relative** path (`src="logo.png"`)
   and make sure the app's own `index.html` has `<base href="/" />` in
   `<head>` (so direct, non-proxied access still resolves correctly from any
   client-side route depth) — pktHub's proxy injects its own `<base
   href="/proxy/:appId/">` ahead of that one in the served HTML, which
   correctly takes precedence per the HTML spec (only the first `<base>` in
   a document is used) when the page is actually being proxied.

All 8 apps in the suite (pktFlow, pktSNMP, pktLog, pktWiFi, pktIPAM, pktNode,
pktPCAP, pktSecurity) already implement points 1–5 above — treat their
`App.tsx` / `Layout.tsx` / `store/auth.tsx` / `index.html` as the reference
pattern for any new pkt* app.

**"Remotely Managed" lock** — separate from and narrower than the
`direct`/`managed` **Managed Mode** described above (which locks a sibling
app's entire direct login). This lock affects only that app's own **Settings
page**: when pktHub registers or deregisters an app, it calls that app's
`POST /api/suite/settings-lock` (best-effort — silently no-ops on an app that
hasn't implemented it). While locked, a **direct** visit to that app's own
Settings page shows an amber "Remotely Managed" banner and disables editing
in place — steering admins toward configuring it from pktHub instead.
Viewing Settings *through* pktHub's own embed is unaffected (it checks the
same `via_suite_token` signal from point 4 above and skips the banner there),
so there's no lockout-of-itself paradox.

## NOC Displays

**NOC Builder** lets you lay out widgets from any registered app onto a
wallboard-style display; the public `/display/:token` route renders it
full-screen for a TV, with no login required. (This feature was originally
called "kiosk" internally — the `kiosk_layouts` DB table was renamed to
`noc_layouts` — same feature, if you run into the old name in a stale doc or
DB dump elsewhere.)

## Alerting & Notifications

pktHub has two separate, currently-unconnected pieces under this heading —
don't assume one drives the other:

- **Live app-health alerts** (what you actually see day to day): when the
  health poller finds a registered app unreachable (`connection_lost`),
  unhealthy (`unhealthy`), or presenting a mismatched suite token
  (`token_mismatch`), it writes a row to `app_alerts`. Active/unacked alerts
  and full filterable history are visible from the App Registry / Context
  Viewer pages, backed by `/api/alerts` and `/api/alerts/history`, and can be
  acknowledged from there.
- **Notification channels** (**Settings → Notifications**): five outbound
  integrations can be configured and individually enabled — Slack (incoming
  webhook), Email (SMTP), PagerDuty (Events API v2), a generic Webhook
  (POST/PUT to a URL you provide), and TraceCat SOAR (workflow webhook +
  optional bearer token). Each has a **Send test** button
  (`POST /api/notifications/test/{channel}`) that fires a one-off test
  message using the saved config — this is the only thing that actually
  sends through these channels today.
- **Alert Events** (**Settings → Audit** tab, not Notifications): lets you
  define named rules pairing an event type (`app.unreachable`,
  `app.degraded`, `app.recovered`, `app.registered`, `app.deregistered`,
  `app.mode_change`, `token.rotated`, `break_glass.triggered`,
  `user.created`, `user.deleted`) with a severity (`critical`, `warning`,
  `info`) and an enabled flag. These are plain CRUD records — there is no
  `channel` field on a rule and no background dispatcher wired up yet that
  matches a firing event against these rules and pushes it to Slack/Email/
  PagerDuty/Webhook/TraceCat. Configure them as a forward-looking event
  taxonomy, not as working automated alert routing.

## AI Assistant

**Settings → Security → AI Assistant** lets an admin configure multiple providers,
each with its own enable toggle — local/self-hosted (Ollama, or any OpenAI-compatible
endpoint) are tried first, then cloud (Anthropic — from console.anthropic.com, separate
from any Claude Enterprise seat, model Haiku/Sonnet/Opus selectable — and OpenAI). Once
at least one is enabled and configured, an in-app chat panel (available throughout the
authenticated app, backed by `POST /api/ai/chat`) answers questions using a snapshot of
**pktHub's own state only** — the registered-app list with health/mode, and
the 10 most recent audit log entries. It explicitly does not have access to
any individual pktApp's own telemetry (SNMP devices, log lines, packet
captures, etc.) — for those it tells the user to use that app's own AI
assistant, if it has one.

A server-side pre-filter blocks prompt-injection/override attempts (e.g.
"ignore your previous instructions," "reveal your system prompt") before
they ever reach the AI provider, and a post-response check strips any
accidental leak of the system prompt back to the user. Unlike the other
pktApp assistants, there's no cross-app-name block here — discussing other
apps' registration/health status is pktHub's actual job — but their
internal data stays off-limits per the system prompt above.

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
auto-backup toggle are all configurable on the same tab. Each listed
snapshot has a **Restore…** link that restores directly from that
on-server `.tar.gz` — no download/upload round trip required — and lets
you pick just the DB or just `config.yaml` instead of always restoring
both together; the same per-file selection is available on the
bundle-upload restore. **Settings → Data → Storage** covers separate
general storage/retention settings (audit and alert retention windows,
storage connection test) — a different tab from Backups.

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
