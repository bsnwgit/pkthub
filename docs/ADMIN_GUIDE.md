# pktHub — Administrator Guide

Covers installing, configuring, and operating pktHub — the central hub for the pkt suite. For day-to-day usage (App Registry, NOC Screens, Alerts), see [USER_GUIDE.md](USER_GUIDE.md). See the [README](../README.md) for the full technical reference.

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
4. **Build a NOC display** (NOC Screens) if you want a wallboard view — remember its public `/display/:token` URL needs no login, so only share it with screens/people you're comfortable giving unauthenticated access.
5. **Configure alert notification channels.**
6. **Set up backups** and confirm a manual run succeeds.
7. **Create accounts** for your team.

## Finding your way around Settings

pktHub's own Settings page has a section bar above its tab bar:

- **pktHub** — Audit, App Registry, NOC, Maintenance. This app's own.

Only the selected section's tabs appear in the row below, so switch sections if a tab isn't where you expect it; they previously shared one long row split by a thin divider. Deep links to a tab select the right section automatically. Don't confuse this with **Reg App Settings** below, which embeds other apps' Settings pages in pktHub's nav.

## Users & roles

`admin` (full access, including Settings and user management), `analyst` (elevated operational role — can act on parts of the app registry, but sees only their own entries in the audit log), `viewer` (read-only). The very first user is always created as `admin` from `config.yaml`'s `initial_admin_*` fields on first boot.

### Auth methods

Settings → Security → Auth:
- **Local username/password** (bcrypt) — the default.
- **Okta SAML SSO** — full SP-initiated flow, not just an OIDC stub. Users auto-provision by email on first login; role re-syncs from the Okta `role`/`Role`/`userRole` attribute every login (falls back to `viewer` if missing/invalid).
- **Auth-disabled auto-login** — if you turn off *both* local auth and SAML, the login page is skipped entirely and anyone reaching the app signs in as the flagged default admin (or the first active admin) with no credentials. This is a real, by-design authentication bypass, intended only for trusted/isolated deployments — know what you're doing before enabling it.

## App Registry & Suite Integration

pktHub is the hub side of the suite-token mechanism every pkt app implements. Two different places show this — don't confuse them:

- **`/apps`** (App Registry, all roles) is the read-only day-to-day view: health, proxied access, recent alerts. The **APPS** section of the left nav mirrors each registered app's own menu, opening its real pages inside the hub shell.
- **Settings → Security → Suite Integration** (admin only) is where registration actually happens:
  1. On the sibling app, copy its suite token (that app's own Settings → Security/Integrations → Suite Integration → **Copy Token**) and note its base URL.
  2. In pktHub: Settings → Security → Suite Integration → **Register App**, paste the token + base URL.
  3. pktHub validates via the app's `/api/health` and stores the token; it can also push a rotated token back via that app's `POST /api/suite/register`.
  4. Registered apps are proxied at `/proxy/:appId/*` and appear on the dashboard, health-polled every `health_poll_interval` seconds (default 30s, configurable under Settings → App Registry along with the health-check timeout and default access mode for new registrations).

### Access modes

Each registered app has an access mode: `direct` (its own login still works) or `managed` (locks direct login — "Managed Mode" / the "Enable All" bulk action — forcing access only through pktHub's proxy/SSO). pktHub polls each managed app's reported lock state; if an app reports itself unlocked while the hub still expects `managed`, it's automatically reverted to `direct` and an `app.lock_drift_detected` audit entry is written — so a sibling app can never get silently stuck locked out of itself.

**Set Base URL first.** A locked app has to send its visitors somewhere, and that address — `<Base URL>/app/<app id>` — can only be built by pktHub, since it needs the hub's own address and the app's id in this registry. pktHub sends it to the app along with the lock, so there is nothing to configure on the app itself. Managed mode is refused outright while Settings → General → **Base URL** is empty.

Because each locked app holds a *copy* of that address, changing Base URL afterwards would otherwise leave them redirecting to wherever the hub used to be — an app that looks perfectly healthy while delivering users somewhere wrong. Two things prevent it: saving Base URL pushes the new address to every managed app immediately and reports which took it, and the health poller re-checks the stored address on every cycle, re-pushing on any mismatch and writing an `app.redirect_url_resynced` audit entry. An app that was down during the change is repaired when it returns.

**The lock expires by itself.** Each app releases its own lock after five minutes without contact from pktHub — the health poll is what keeps it alive. A lock only pktHub can lift would strand an app precisely when pktHub is the thing that broke, so the failsafe matters more than the lock. When it fires, the app reports itself unlocked and the drift detection above returns the hub's record to `direct`.

**Not every app can be managed.** It requires `GET`/`POST /api/suite/direct-access` on the app. An app without them is left as it is and reported by name — "Set All Managed" lists what it skipped and why, rather than silently changing nothing.

## APPS (proxy-embedded pages) and Reg App Settings

Each registered app that publishes a nav manifest gets a collapsible group under the **APPS** divider, carrying that app's own menu. Selecting a row shows that app's **real, live page**, embedded beside pktHub's menu — not a re-implementation, so it can never drift from what the app actually looks like. An app that publishes no manifest gets no group, and instead keeps a Settings entry under the "REG APP SETTINGS" divider.

The manifest is `GET /api/nav/manifest` on the app, gated by `X-Suite-Token` like its widget endpoints, returning `{path, label, icon, admin_only, divider_before}` entries. pktHub's health poller caches it into `registered_apps.nav_manifest`, so a menu change on an app reaches the hub within one poll interval with no hub-side change. `admin_only` filters what the hub *draws*; the real authorisation is the app's own check against the role pktHub asserts in `X-Suite-Role`.

If you're troubleshooting why this doesn't work for a newly-added app, or building the pattern into a new pkt* app yourself, the mechanism is:

1. pktHub authenticates the embed with a scoped proxy-session cookie, then `GET /proxy/:appId/<path>?chromeless=1`.
2. The sibling app's own router must recognize it's running under that `/proxy/:appId/` path prefix (as its `basename`) — otherwise every route fails to match and falls through to a redirect, usually landing on Dashboard instead of the requested page.
3. The sibling app's Layout needs a `chromeless` mode (driven by `?chromeless=1`) that skips its own sidebar/header. Give that wrapper a definite height (`h-screen overflow-auto`, not `min-h-screen`) — a page that fills its container sizes itself with `h-full`, which collapses to zero against an auto-height parent and renders blank.
4. The sibling app's auth store must check `GET /api/suite/whoami` for `via_suite_token: true` and synthesize a logged-in session client-side, instead of showing its own login page.
5. Any app-relative asset referenced with a **literal absolute path** (`src="/logo.png"`) will 404 when proxied, since a leading-`/` path resolves against pktHub's own origin regardless of any `<base>` tag. Fix: reference assets with **relative** paths and ensure the app's `index.html` has `<base href="/" />` — pktHub's proxy injects its own `<base href="/proxy/:appId/">` ahead of that, which correctly wins per the HTML spec (only the first `<base>` in a document is used) while proxied, without breaking direct access.

All 9 apps in the suite implement points 1–5 and publish a nav manifest from `app/api/nav.py` — use their `App.tsx`/`Layout.tsx`/`store/auth.tsx`/`index.html`/`app/api/nav.py` as the reference pattern for any new pkt* app.

### "Remotely Managed" Settings lock

Separate from and narrower than the `direct`/`managed` access mode above (which locks a sibling app's *entire* direct login) — this lock affects only that app's own Settings page. On register/deregister, pktHub calls that app's `POST /api/suite/settings-lock` (best-effort — silently no-ops on an app that hasn't implemented it). While locked, a direct visit to that app's Settings page shows an amber "Remotely Managed" banner and disables editing in place; viewing Settings *through* pktHub's embed is unaffected, so there's no lockout-of-itself paradox.

## IP Intelligence Lookup

`GET /api/ip-info/{ip}` combines ipinfo.io, ipapi.is, AbuseIPDB, and MXToolbox concurrently for a single public IP. Private/loopback/link-local/reserved/multicast addresses are rejected outright. Keys are per-user (Settings → User Keys) — no shared/admin key, no cross-user visibility. A fifth provider slot, IPQualityScore, can be saved/tested but isn't consumed by the lookup yet. MXToolbox's other commands (DNS/email record checks, active network probes) are reachable via `POST /api/mxtoolbox/lookup` but not linked from any IP in the UI yet.

## NOC Displays

Built in NOC Screens, rendered full-screen with no login at the public `/display/:token` URL — treat that token like a shareable secret; anyone with the link can view the display. (Internally this was originally called "kiosk" — the `kiosk_layouts` table was renamed `noc_layouts`, same feature, in case you run into the old name in a stale doc or DB dump.)

### The widget manifest

What the NOC builder can offer is exactly what the apps declare. Each app serves `GET /api/widgets/manifest` (gated by `X-Suite-Token`, like its nav manifest) returning a list of:

```
{id, title, description, category, view_path, default_w, default_h, min_w, min_h, params}
```

`category` groups the entry inside that app's section of the library; an entry without one falls into "Other", so the field is optional and older apps keep working. `view_path` is a server-rendered HTML page on the app, embedded as an iframe through pktHub's proxy — the app owns the rendering, so a widget can never drift from the data behind it.

pktHub's health poller caches the manifest into `registered_apps.widget_manifest`, so a widget added to an app appears in the hub within one poll interval with no hub-side change. `POST /api/apps/refresh-manifests` (analyst or admin) re-fetches all of them immediately; the editor's **⟳** button calls it.

### Widget states

Widget views distinguish three reasons for showing nothing, because on a wallboard a blank tile reads as "all quiet":

- **cfg** — a declared param has not been chosen yet
- **empty** — the query ran and returned nothing; the message says why
- **err** — the query raised

Query helpers record failures in a per-request `ContextVar` rather than swallowing them, and the shared page shell renders the error state *instead of* the body. That matters: previously every query sat in a `try/except` returning an empty list, so a broken widget was indistinguishable from an empty one. Turning this on immediately surfaced several long-standing faults — pktLog widgets querying a `syslog_messages` table that never existed, and a `sqlite3.Row.get()` call in pktFlow that had been silently failing.

Anything that renders its own markup rather than going through the shared shell bypasses this — pktFlow's Geo Map is the one such case.

### Widget refresh interval

**Settings → NOC → Widget refresh** (default 30s, bounded 5s–3600s). pktHub sends it on the NOC payload — including the unauthenticated display payload, which has no session with which to read settings — and both the editor and the display append it to each widget iframe as `?refresh=<seconds>`.

Each app captures it as a router-level dependency into a `ContextVar`, so the page shell can use it without any of the ~150 view functions taking a parameter. An app that receives no `refresh` falls back to 30s.

### Returning to the right page after re-auth

A 401 from any API call triggers a hard `window.location.replace` to the login page, which discards the router history. Both that handler and `RequireAuth` now carry the current path as `?next=`, and the login page returns there.

`next` is accepted only as a same-origin *relative* path — an absolute or protocol-relative URL would make the login page an open redirect, and pktHub is the front door to the whole suite.

### Widget params and live discovery

A manifest entry may declare `params` — the filters shown when a widget is selected. Each is `{key, label, type: "select"}` plus either a fixed `options` list or an `options_path`.

An `options_path` is a relative path on the owning app that returns `[{value, label}]`. pktHub proxies it via `GET /api/apps/{id}/widget-options?path=…`, attaching the suite token so the browser never needs one. **That proxy is confined to `/api/widgets/options/`** — it lends the app's trusted-proxy secret, so an unconstrained path would let any analyst read any GET endpoint on any registered app with that privilege. The path is normalised before the prefix check, so traversal out of the namespace is rejected. Every app in the suite already serves its pickers from that prefix; a new picker must live there too.

This is what keeps a screen current as infrastructure changes: the picker answers from live state, so hardware added or removed after a screen was built needs no manifest edit and no hub change. The same applies to metrics — pktSNMP's metric picker lists whatever OIDs the poller has actually seen, so a newly-polled OID becomes selectable on its own.

An `options_path` may reference another param of the same widget as `{key}` — for example `/api/widgets/options/interfaces?device_id={device_id}`. pktHub substitutes from the widget's saved config, refuses to fetch until the parent is chosen, and clears dependent params when the parent changes so a widget can't end up pointing at a child that belongs to a different parent.

Widgets that take an entity id should check it still exists and say so plainly when it doesn't — a blank tile on a wallboard reads as "all quiet". The apps' `_gone()` helpers are the pattern.

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
