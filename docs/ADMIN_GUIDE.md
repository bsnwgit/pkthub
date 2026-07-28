# pktHub — Administrator Guide

Covers installing, configuring, and operating pktHub — the central hub for the pkt suite. For day-to-day usage (App Registry, NOC Builder, Alerts), see [USER_GUIDE.md](USER_GUIDE.md). See the [README](../README.md) for the full technical reference.

## Installation

Requires Python 3.10+, Node/npm, and the `openssl` CLI.

```bash
git clone git@github.com:bsnwgit/pkthub.git
cd pkthub
./install.sh
```

**Run it as your normal user — never `sudo ./install.sh`.** It calls `sudo` itself only where actually needed.

Prompts for install directory (default `/opt/pkthub`, or `PKTHUB_INSTALL_DIR` env var for scripted installs) and port (default `8760`, or `PKTHUB_PORT`). It builds the frontend, copies the tree in via rsync, sets up the venv, generates `config.yaml` from the example (only if one doesn't already exist — a random `jwt_secret` and `initial_admin_password` are filled in, and the password is printed once), and installs/starts the systemd service.

## First-time setup checklist

1. **Change the admin password.**
2. **Register your sibling pkt apps** (Settings → Security → Suite Integration → Register App) — see App Registry below.
3. **Decide access mode per app**: `direct` (that app's own login still works standalone) or `managed` (locks direct login, forcing access only through pktHub). Configure defaults for newly registered apps under Settings → App Registry.
4. **Build a NOC display** (NOC Builder) if you want a wallboard view — remember its public `/display/:token` URL needs no login, so only share it with screens/people you're comfortable giving unauthenticated access.
5. **Configure alert notification channels.**
6. **Set up backups** and confirm a manual run succeeds.
7. **Create accounts** for your team.

## Users & roles

`admin` (full access, including Settings and user management), `analyst` (elevated operational role — can act on parts of the app registry, but sees only their own entries in the audit log), `viewer` (read-only). The very first user is always created as `admin` from `config.yaml`'s `initial_admin_*` fields on first boot.

### Auth methods

Settings → Security → Auth:
- **Local username/password** (bcrypt) — the default.
- **Okta SAML SSO** — full SP-initiated flow, not just an OIDC stub. Users auto-provision by email on first login; role re-syncs from the Okta `role`/`Role`/`userRole` attribute every login (falls back to `viewer` if missing/invalid).
- **Auth-disabled auto-login** — if you turn off *both* local auth and SAML, the login page is skipped entirely and anyone reaching the app signs in as the flagged default admin (or the first active admin) with no credentials. This is a real, by-design authentication bypass, intended only for trusted/isolated deployments — know what you're doing before enabling it.

## App Registry & Suite Integration

pktHub is the hub side of the suite-token mechanism every pkt app implements. Two different places show this — don't confuse them:

- **`/apps`** (App Registry, all roles) and **Context Viewer** (`/context`) are read-only day-to-day views: health, proxied access, recent alerts.
- **Settings → Security → Suite Integration** (admin only) is where registration actually happens:
  1. On the sibling app, copy its suite token (that app's own Settings → Security/Integrations → Suite Integration → **Copy Token**) and note its base URL.
  2. In pktHub: Settings → Security → Suite Integration → **Register App**, paste the token + base URL.
  3. pktHub validates via the app's `/api/health` and stores the token; it can also push a rotated token back via that app's `POST /api/suite/register`.
  4. Registered apps are proxied at `/proxy/:appId/*` and appear on the dashboard, health-polled every `health_poll_interval` seconds (default 30s, configurable under Settings → App Registry along with the health-check timeout and default access mode for new registrations).

### Access modes

Each registered app has an access mode: `direct` (its own login still works) or `managed` (locks direct login — "Managed Mode" / the "Enable All" bulk action — forcing access only through pktHub's proxy/SSO). pktHub polls each managed app's reported lock state; if an app reports itself unlocked while the hub still expects `managed`, it's automatically reverted to `direct` and an `app.lock_drift_detected` audit entry is written — so a sibling app can never get silently stuck locked out of itself.

## Reg App Settings (proxy-embedded Settings pages)

Every registered app gets its own nav entry under a "REG APP SETTINGS" divider, showing that app's **real, live Settings page**, embedded full-screen — not a re-implementation, so it can never drift from what the app actually looks like. If you're troubleshooting why this doesn't work for a newly-added app, or building the pattern into a new pkt* app yourself, the mechanism is:

1. pktHub authenticates the embed with a scoped proxy-session cookie, then `GET /proxy/:appId/settings?chromeless=1`.
2. The sibling app's own router must recognize it's running under that `/proxy/:appId/` path prefix (as its `basename`) — otherwise every route fails to match and falls through to a redirect, usually landing on Dashboard instead of Settings.
3. The sibling app's Layout needs a `chromeless` mode (driven by `?chromeless=1`) that skips its own sidebar/header.
4. The sibling app's auth store must check `GET /api/suite/whoami` for `via_suite_token: true` and synthesize a logged-in session client-side, instead of showing its own login page.
5. Any app-relative asset referenced with a **literal absolute path** (`src="/logo.png"`) will 404 when proxied, since a leading-`/` path resolves against pktHub's own origin regardless of any `<base>` tag. Fix: reference assets with **relative** paths and ensure the app's `index.html` has `<base href="/" />` — pktHub's proxy injects its own `<base href="/proxy/:appId/">` ahead of that, which correctly wins per the HTML spec (only the first `<base>` in a document is used) while proxied, without breaking direct access.

All 8 apps in the suite already implement points 1–5 — use their `App.tsx`/`Layout.tsx`/`store/auth.tsx`/`index.html` as the reference pattern for any new pkt* app.

### "Remotely Managed" Settings lock

Separate from and narrower than the `direct`/`managed` access mode above (which locks a sibling app's *entire* direct login) — this lock affects only that app's own Settings page. On register/deregister, pktHub calls that app's `POST /api/suite/settings-lock` (best-effort — silently no-ops on an app that hasn't implemented it). While locked, a direct visit to that app's Settings page shows an amber "Remotely Managed" banner and disables editing in place; viewing Settings *through* pktHub's embed is unaffected, so there's no lockout-of-itself paradox.

## IP Intelligence Lookup

`GET /api/ip-info/{ip}` combines ipinfo.io, ipapi.is, AbuseIPDB, and MXToolbox concurrently for a single public IP. Private/loopback/link-local/reserved/multicast addresses are rejected outright. Keys are per-user (Settings → User Keys) — no shared/admin key, no cross-user visibility. A fifth provider slot, IPQualityScore, can be saved/tested but isn't consumed by the lookup yet. MXToolbox's other commands (DNS/email record checks, active network probes) are reachable via `POST /api/mxtoolbox/lookup` but not linked from any IP in the UI yet.

## NOC Displays

Built in NOC Builder, rendered full-screen with no login at the public `/display/:token` URL — treat that token like a shareable secret; anyone with the link can view the display. (Internally this was originally called "kiosk" — the `kiosk_layouts` table was renamed `noc_layouts`, same feature, in case you run into the old name in a stale doc or DB dump.)

## Maintenance

Settings → Maintenance (admin only): **Restart** restarts the pktHub service itself; **Port** writes a new port into `config.yaml` immediately but only takes effect after the next restart — the API doesn't restart anything on its own.

## Backup & Restore

Settings → Data → Backups creates a `.tar.gz` snapshot (SQLite backup-API copy of the DB + `config.yaml`) written to `<install_dir>/backups` by default. Path, retention count, and an auto-backup toggle are all configurable on the same tab.

**Restoring:**
- Every listed snapshot has a **Restore…** link — restores directly from that on-server `.tar.gz`, no download/upload needed. Expanding it shows a checkbox per file present, so you can restore just the DB or just `config.yaml` instead of both together.
- The same per-file selection is available on the bundle-upload restore.
- Restoring `config.yaml` needs a service restart to take effect.

Settings → Data → Storage covers a different thing entirely — audit/alert retention windows and a storage connection test, not backup.

## Troubleshooting

See the README's [Troubleshooting](../README.md#troubleshooting) section for the full list. Common starting points:

| Symptom | Check |
|---|---|
| Service won't start | Check systemd logs; confirm `config.yaml` exists and has a valid `jwt_secret` |
| A registered app shows unhealthy | Confirm its base URL is reachable from pktHub and its suite token hasn't been rotated on that app's side without updating it here |
| A managed app's Settings page won't embed correctly | Walk through the 5 mechanism points under Reg App Settings above — most failures are one of those |
| A restored `config.yaml` didn't take effect | Restart the service — restoring never does this automatically |

## Upgrading

Pull the latest code, rebuild the frontend if you build manually, then restart the service.
