# pktHub

<p align="center">
  <img src="lockup-256h.png" alt="pktHub" height="64">
</p>

NOC/SOC management hub — the front door to the pkt suite. Registers and
proxies the sibling pkt* apps behind a single login, builds NOC wallboard
displays from any of their data, and centralizes user management, audit
logging and alerting across every registered app.

One sign-in, one alert stream, one place to see whether the estate is healthy —
each app keeps its own data and UI, and pktHub puts them behind one door.

pktHub is a fully wired FastAPI + React application: real bcrypt/JWT admin
auth, all of registry/users/audit/settings/proxy/NOC/alerting, and a built
React SPA are all live in the running app — not placeholder scaffolding.

**Default port:** `8760` (HTTP)

---

---

## The pkt suite

**pktHub** is one of ten apps in the pkt suite — self-hosted tooling for network
and security operations. Each installs and runs standalone, so take only the ones
you need; they share one architecture (FastAPI + React), one look, one
`admin`/`analyst`/`viewer` role model, and a suite token that lets siblings read
one another's data. Default ports don't collide (8760–8769), so any combination
runs on a single host.

| App | Port | What it does |
|---|---|---|
| **[pktFlow](https://github.com/bsnwgit/pktflow)** | `8766` | NetFlow, sFlow and IPFIX collection — flow search, traffic analytics, geo and topology views |
| **[pktSNMP](https://github.com/bsnwgit/pktsnmp)** | `8767` | SNMP polling and trap receiving for any OID — device health and metric history without a full NMS |
| **[pktLog](https://github.com/bsnwgit/pktlog)** | `8768` | Syslog over UDP, TCP and TLS — parsing, enrichment, full-text search and forwarding |
| **[pktPCAP](https://github.com/bsnwgit/pktpcap)** | `8765` | Packet capture analysis in the browser — drop in a `.pcap` for TCP, DNS and threat findings, no Wireshark install |
| **[pktWiFi](https://github.com/bsnwgit/pktwifi)** | `8769` | Access point, RF and client visibility from Meraki and UniFi controllers or plain SNMP polling |
| **[pktIPAM](https://github.com/bsnwgit/pktipam)** | `8761` | IP address management reconciling declared subnets against live DHCP, DNS and device data, flagging conflicts |
| **[pktNode](https://github.com/bsnwgit/pktnode)** | `8764` | Endpoint monitoring and management for Mac, Windows and Linux via a lightweight Go agent |
| **[pktSecurity](https://pktsolution.com/pktSecurity/index.html)** | `8762` | Security operations across the estate — CVE exposure, threat intelligence, ATT&CK-mapped detections and case management |
| **[pktCert](https://github.com/bsnwgit/pktcert)** | `8763` | TLS certificate discovery and expiry tracking, plus an internal CA — issue, revoke and serve CRLs |
| **pktHub** *(you are here)* | `8760` | The front door — one sign-in, one alert stream, NOC wallboards and user management across every registered app |

More at **[pktsolution.com](https://pktsolution.com)**.

## Why pktHub

Running several monitoring tools usually means several logins, several alert
inboxes, and no single view of whether anything is actually wrong.

- **One sign-in** — local accounts or Okta SAML, with `admin`/`analyst`/`viewer`
  roles applied consistently across every registered app
- **One alert stream** — alerts from every app surfaced together
- **Each app's real UI** — proxied and embedded, not reimplemented, so it can
  never drift from the app itself
- **NOC wallboards** — build a display from any app's data and put it on a TV
  at a public URL with no login
- **Self-hosted** — your data stays on your hardware; no external service

## Table of Contents

- [Why pktHub](#why-pkthub)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Installation](#installation)
- [Configuration Reference](#configuration-reference)
- [Running & Managing the Service](#running--managing-the-service)
- [Enabling HTTPS](#enabling-https)
- [Roles & Auth](#roles--auth)
- [IP Intelligence Lookup](#ip-intelligence-lookup)
- [App Registry & Suite Integration](#app-registry--suite-integration)
- [Settings Layout](#settings-layout)
- [Registered apps in the hub's own nav](#registered-apps-in-the-hubs-own-nav)
- [Resonance (the assistant)](#resonance-the-assistant)
- [NOC Displays](#noc-displays)
- [Alerting & Notifications](#alerting--notifications)
- [Maintenance](#maintenance)
- [Backup & Restore](#backup--restore)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

---

## Quick Start

```bash
git clone https://github.com/bsnwgit/pkthub.git
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

Every on-disk path (`db_path`, backup directory) derives from `install_dir` at
runtime (env var `PKTHUB_INSTALL_DIR` → the directory `config.yaml` was loaded
from → cwd) — no absolute path is ever hardcoded in source.

**Frontend navigation** (side nav in `Layout.tsx`), in order:

| | |
|---|---|
| Dashboard | health across every registered app |
| **APPS** | collapsible; one collapsible group per registered app that publishes a nav manifest — that app's own menu, mirrored. See [Registered apps in the hub's own nav](#registered-apps-in-the-hubs-own-nav) |
| App Registry (`/apps`) | read-only health view of every registered app, all roles |
| App Alerts | analyst and admin |
| *— rule —* | everything above is about the registered apps, everything below is the hub's own tooling |
| NOC Screens | wallboard layouts |
| Audit Log | analyst and admin |
| Settings | admin only |
| **REG APP SETTINGS** | collapsible; admin only, and only for apps that publish *no* nav manifest — one that does exposes its own Settings row inside its APPS group instead |

The `/apps` page is monitoring-only; actually registering, editing, rotating
tokens for, or deregistering a sibling app lives under
**Settings → Security → Suite Integration**, gated admin-only there because
those actions touch credentials.

Sidebar state persists in `localStorage`: `pkthub_apps_section_expanded` for
the APPS band, `pkthub_app_nav_expanded` for which single app group is open
(one at a time — opening another closes it), and
`pkthub_reg_app_settings_expanded` for the Reg App Settings tree.

## Installation

Requirements: Python 3.10+, Node/npm (for the frontend build), `openssl` CLI.

```bash
git clone https://github.com/bsnwgit/pkthub.git
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
   already exist** — fills in a random `jwt_secret`, `credential_key`, and
   `initial_admin_password`, writes the chosen port, and prints the admin
   password once. Re-running the installer never overwrites an existing
   `config.yaml`.
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
| `credential_key` | random, generated at install | Fernet key encrypting stored secrets (user API keys) at rest — separate from `jwt_secret`, which only signs JWTs |
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

Keys are **per-user**, not app-wide: each logged-in user stores their own under Settings → User Keys (`app/user_api_keys.py`), and lookups run under that user's own key/quota — no shared/admin key, no cross-user visibility. Keys are Fernet-encrypted at rest (`app/crypto.py`, using a dedicated `credential_key` — separate from `jwt_secret`, which only signs JWTs) — decrypted only in memory when a lookup runs or the owning user views their own key. A fifth provider slot, IPQualityScore, can be saved and tested there but isn't consumed by the lookup yet.

MXToolbox's other commands — email/DNS record checks (SPF, DMARC, DKIM, MX, DNS, TXT, SOA, BIMI, MTA-STS, TLSRPT, A, AAAA) and active probes (ping, traceroute, TCP/HTTP/HTTPS/SMTP connect, run from MXToolbox's own infrastructure against the target) — are reachable via `POST /api/mxtoolbox/lookup` (`{command, argument, port?}`, `app/mxtoolbox.py`). Backend only for now — no page in the UI links an IP to this lookup yet.

## App Registry & Suite Integration

pktHub is the hub side of the suite-token mechanism every other pkt app
implements. There are two different places this shows up in the UI — don't
confuse them:

- **`/apps`** ("App Registry" in the nav) is the read-only, day-to-day view
  open to every role: see each registered app's health, jump into its proxied
  UI, and see its recent alerts.
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

## Settings Layout

pktHub's own **Settings** page is organized into two **sections**, chosen
from a section bar above the tab bar:

| Section | Tabs |
|---|---|
| **Common** | General · Security (Users, Auth, Suite Integration, SSL/TLS) · Data (Storage, Backups, Log Forwarding) · Notifications · Resonance · User Keys · System |
| **pktHub** | Audit · App Registry · NOC · Maintenance |

Common holds the settings that are identical across every pkt* app;
pktHub holds this app's own. Selecting a section swaps the tab bar
underneath it, so only one group's tabs are visible at a time — these used
to share a single long row separated by a thin divider. Deep links such as
`/settings?tab=registry` still work and select the section automatically.

This is separate from **Reg App Settings** below, which embeds *other*
apps' Settings pages in pktHub's nav.

---

## Registered apps in the hub's own nav

Under an **APPS** divider in the left nav, each registered app that publishes
a nav manifest gets a collapsible group holding **that app's own menu** —
same labels, same glyphs, same separators. Selecting a row shows that app's
**actual, live page**, embedded to the right of pktHub's menu with no
duplicate sidebar or header, so pktHub's menu is the only chrome on screen.
This is not a re-implementation: it's the real app, proxied in, so it can
never drift out of sync with what that page actually looks like or does.

One group is open at a time — opening another closes the first.

**The manifest.** Each app serves its menu at `GET /api/nav/manifest`, behind
the same `X-Suite-Token` gate as its widget endpoints, as a list of
`{path, label, icon, admin_only, divider_before}`. pktHub's health poller
reads it on every cycle and caches it in `registered_apps.nav_manifest`, so a
page added to an app appears in the hub within a poll interval with no hub
change. The manifest can be computed rather than static — pktCert omits its
Approvals row unless separation of duties is actually switched on, matching
what its own sidebar does. An app that publishes no manifest gets no group;
it's still reachable from its Dashboard card, and its Settings still appear
under **Reg App Settings**.

**How it works under the hood** (relevant if you're building this into a new
pkt* app, or debugging why it doesn't work for one):
1. pktHub authenticates the embed the same way it authenticates the NOC
   Builder's widget iframes — a scoped proxy-session cookie, then
   `GET /proxy/:appId/<path>?chromeless=1`.
2. The sibling app's own React Router needs to recognize it's running under
   that `/proxy/:appId/` path prefix (as its `basename`), or every route
   fails to match and falls through to a `*` redirect — usually landing on
   Dashboard instead of the requested page.
3. The sibling app's Layout component needs a `chromeless` mode (driven by
   the `?chromeless=1` query param) that skips its own sidebar/header and
   renders just the page content. Give that wrapper a **definite** height
   (`h-screen overflow-auto`, not `min-h-screen`): a page that fills its
   container sizes itself with `h-full`, which collapses to zero against an
   auto-height parent and renders blank — maps and canvases especially.
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

All 9 apps in the suite (pktCert, pktFlow, pktSNMP, pktLog, pktWiFi, pktIPAM,
pktNode, pktPCAP, pktSecurity) implement points 1–5 above and publish a nav
manifest from `app/api/nav.py` — treat their `App.tsx` / `Layout.tsx` /
`store/auth.tsx` / `index.html` / `app/api/nav.py` as the reference pattern
for any new pkt* app. Each app's `NAV_MANIFEST` and the `NAV` const in its
own `Layout.tsx` are separate declarations of one menu, and each carries a
comment pointing at the other; a page added to one belongs in both.

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

## Resonance (the assistant)

pktHub registers with resonance the same way a sibling app does, and mounts the
same vendored embed. What differs is what it can be asked about: a sibling
exposes its own data, and pktHub exposes **every registered app's**.

Configure it under **Settings → Common → Resonance** (admin only): the resonance
interface server address, the embed key, pktHub's own origin, an optional CA
bundle, and which roles may open the launcher. **Test connection** proves the
key without switching the feature on, and reads back what that key actually
grants so a missing control has an explanation.

### The federated data surface

Every sibling app already publishes two documents for its own assistant — a
grant naming the operations it permits, and an OpenAPI narrowed to them. pktHub
does not re-describe them. It fetches what each registered app declares and
merges the lot into one document, the same way the APPS sidebar composes their
menus: the app declares, the hub mirrors.

| Path | What it is |
|---|---|
| `/.well-known/resonance.json` | The composed grant. Operation names only, public by contract |
| `/api/resonance/openapi.json` | The composed OpenAPI, narrowed to those operations |
| `/api/resonance/data/…` | pktHub's own operations |
| `/api/resonance/data/{app}/…` | A registered app's operation, proxied |

Operations are namespaced by app — `pktipam_listSubnets`, `pktFlow_getFlowSummary`
— and each summary is prefixed `[pktIPAM]`, `[pktFlow]`, because nine
near-identical "List alert events" descriptions are nine coin flips for a model.
Schemas are namespaced for the same reason: two apps both defining `AlertEvent`
would make the document unusable.

Composition is cached for five minutes and dropped immediately when an app is
registered or deregistered, so a new app is never invisible for a whole TTL.

`HUB_GRANTED` in `app/resonance_data.py` declares pktHub's *own* operations, in
the same shape a sibling's `GRANTED` tuple takes — the grant is generated from
it and the spec filtered to it, so the two cannot disagree.

### The ceiling

pktHub holds a suite token for every registered app, so a proxy that forwarded
whatever it was asked would be an authenticated open door to all of them. It is
not one:

- An operation reaches the composed documents only if it is in **that app's own
  grant**. pktHub can narrow what an app permits, never widen it.
- Every proxied call is matched against the granted method-and-path pairs from
  that app's spec *before* anything is forwarded. No match answers 404 — the
  same answer as an unknown app, so it does not disclose which operations exist.
- **Writes are withheld.** An app granting a write to its own assistant is a
  decision about one app; passing it through would make it a decision about the
  whole estate. `resonance_allow_writes` is off by default.
- Calls carry the asking person's identity and role to the owning app, so its
  own checks still apply — the assistant is not a way around them.

### Two things that differ from the sibling copies

Both are consequences of pktHub's own auth, and both are commented where they
live:

1. **The embed cookie.** `embed.js` fetches `/api/resonance/code` itself, as a
   plain browser request with no Authorization header, so that route can only be
   cookie-authenticated. Siblings lean on their `refresh_token` cookie; pktHub
   sets no cookie at login at all. `/api/resonance/config` therefore mints one —
   it is already the first authenticated call the mount makes, before the script
   tag exists. The cookie is HttpOnly, SameSite=Lax and path-scoped to
   `/api/resonance/`, modelled on the proxy session in `app/auth.py`.
2. **No `/docs` corpus route.** Siblings publish their guides for the
   assistant's knowledge, authenticated by the suite token they each hold.
   pktHub holds a token for every registered app and none of its own, so that
   route has no equivalent gate here.

---

## NOC Displays

**NOC Screens** lets you lay out widgets from any registered app onto a
wallboard-style display; the public `/display/:token` route renders it
full-screen for a TV, with no login required.

Around **150 widgets** are available across the suite — charts, KPI tiles,
inventory tables, alert feeds and trend views — grouped by app and category
and searchable across all of them at once. Each app declares what it offers
via `GET /api/widgets/manifest`, so the library grows as the apps do, with no
change needed here.

Widgets that need a target (a device, subnet, access point, interface, metric)
read their choices live from the owning app, so hardware added or removed
after a screen was built appears or drops out on its own. A widget pinned to
something since deleted says so rather than rendering blank.

A tile showing nothing tells you which kind of nothing: **needs configuring**
(amber), **genuinely empty** with the reason stated (grey), or **query failed**
(red). On an unattended wall a blank tile reads as "all quiet", which is
exactly wrong if the widget is broken.

Widgets reload on the interval set in Settings → NOC → Widget refresh.

(This feature was originally called "kiosk" internally — the `kiosk_layouts`
DB table was renamed to `noc_layouts` — same feature, if you run into the old
name in a stale doc or DB dump elsewhere.)

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

## License

This project is distributed under the PolyForm Noncommercial License 1.0.0 — see [`LICENSE`](LICENSE).
