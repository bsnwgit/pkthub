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

**Failed-login lockout.** A local account is locked for 30 minutes after a set number of failed logins in a row (Settings → Security → Auth → *Failed logins before lockout*, default 3). Failures never expire; only a successful login resets the count. If it then fails that many times again it stays locked until an admin clicks the unlock icon beside it on the Users tab. While locked, even the right password is refused. A wrong current password when changing a password counts as a failed login too, so a signed-in session cannot be used to guess it. A successful login clears the failure count and any earlier lockout. If the only admin is locked, unlock it from the server, in the install directory with the app's own Python:

```bash
python3 scripts/unlock_user.py <username>
```

**Per-address throttle.** Separately from the account lockout, an address that keeps failing to sign in is blocked. Failed credential checks are counted by the address they came from, whatever username was tried, at the sign-in form and at the change-password form: after *Failed sign-ins per address* (default 10) within *Counted over* (default 15 minutes), that address is refused for *Address blocked for* (default 15 minutes), even with correct credentials. All three are under Settings → Security → Auth. A successful sign-in does not reset the count, and failures stop counting when the window ends. Other addresses are unaffected, and the block ends by itself.

The address is the one the connection came from. If pktHub sits behind a proxy on another host (pktHub, for example), every user arrives from the proxy's address and shares one count, so one person guessing could block everyone behind it. In that setup raise the limit well above normal use, or throttle at the proxy. pktHub does not read `X-Forwarded-For`, because any client can send it.


### Okta SAML SSO

Settings → Security → Auth: paste Okta's IdP metadata XML (auto-fills SSO URL/Entity ID/certificate) or enter by hand. ACS URL and SP metadata link are derived from **Base URL** — set that first.

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

## Resonance (the assistant)

Settings → Common → Resonance, admin only. pktHub registers with resonance like any sibling app, but what it can be asked about is every registered app's data, not just its own.

### Setting it up

1. **In resonance**, register pktHub and copy the embed key.
2. **In pktHub**, paste the key and the resonance *interface* server address — not its admin portal, which looks almost right and fails later on the session call. Set the roles allowed to open it.
3. **Copy pktHub's own address** from the Origin field onto the resonance key's origins list. Resonance refuses to render inside a page nobody authorised, and that refusal looks exactly like a broken widget rather than a configuration gap.
4. **Press Test connection.** It proves the key without the feature being on, and reads back what the key grants.
5. **In resonance**, attach pktHub's application and tick the operations. Everything is off until an admin does this — the key alone gets you a conversation that knows nothing about pktHub.

If pktHub's certificate is signed by an internal CA, set **CA bundle** to the system store (`/etc/ssl/certs/ca-certificates.crt` on Debian/Ubuntu). Python verifies against its own bundled roots, so a certificate every browser trusts is still rejected server-side.

### How many operations to enable

This is the setting that decides whether the assistant works at all, and it is not obvious.

pktHub composes **one operation per operation each registered app grants** — with nine apps that is easily 60+. Every enabled operation is sent to the model on *every* question as a tool definition, at roughly **200 tokens each**. Enable all 64 and the prompt is ~13,600 tokens before anyone has typed anything.

A model with a 4,096-token context rejects that outright, and the failure is unhelpful: the assistant answers from general knowledge, or says it could not reach anything. Nothing appears in pktHub's log, because no call was ever made.

Rough budget: **usable tools ≈ (context − 1,500) ÷ 200**.

| Model context | Roughly how many operations |
|---|---|
| 4K | 12 |
| 8K | 32 |
| 16K | 70+ (all of them) |

Beyond arithmetic, prefer **breadth over depth** when choosing. Each app publishes a `…Summary` operation giving estate-wide counts — those answer the most per token. Each also publishes `listAlertEvents`, `listAlertRules` and `searchApplicationLog`, and with nine apps that is 27 tools whose descriptions differ only by app name. A small model picks badly between those; leaving them off usually improves answers rather than limiting them.

### Where things fail

| Symptom | Cause |
|---|---|
| Assistant answers from general knowledge | The operations are not ticked in resonance, or the prompt exceeds the model's context |
| "Could not reach…" with nothing in pktHub's log | Same — the model refused the prompt, so no call was made. Check resonance's `server.log` for `exceed_context_size_error` |
| Launcher never appears | Role set to No access, feature off, or `embed.js` failed to load — the Connection panel counts those failures |
| Panel shows a framing refusal | pktHub's origin is not on the resonance key's origins list |
| Certificate rejected on Test | Set the CA bundle. Test sends the bundle from the form, so it proves what is on screen |

## IP Intelligence Lookup

`GET /api/ip-info/{ip}` combines ipinfo.io, ipapi.is, AbuseIPDB, and MXToolbox concurrently for a single public IP. Private/loopback/link-local/reserved/multicast addresses are rejected outright. Keys are per-user (Settings → User Keys) — no shared/admin key, no cross-user visibility. A fifth provider slot, IPQualityScore, can be saved/tested but isn't consumed by the lookup yet. MXToolbox's other commands (DNS/email record checks, active network probes) are reachable via `POST /api/mxtoolbox/lookup` but not linked from any IP in the UI yet.

## NOC Displays

Built in NOC Screens, rendered full-screen with no login at the public `/display/:token` URL — treat that token like a shareable secret; anyone with the link can view the display. (Internally this was originally called "kiosk" — the `kiosk_layouts` table was renamed `noc_layouts`, same feature, in case you run into the old name in a stale doc or DB dump.)

### What the display token reaches

Each tile is an iframe on `/proxy-display/:token/:app_id/:path`, and pktHub attaches the target app's suite token to that request — the apps accept it as an authenticated viewer. Since the display itself has no login, the token is not an identity and cannot be the only check, so the route is confined to what a tile on **that** layout actually needs:

- `:app_id` must be an app with a widget placed somewhere on the same layout. An app that is registered but not on the layout is a 404.
- `:path` must resolve inside `/api/widgets/` (the widget views and their option lists) or `/assets/` (the static bundle a widget page loads same-origin). The path is resolved before it is checked, so `..` and its encoded spellings cannot climb out.
- Anything else is a 404, and only `GET` is routed at all.

So the reach of a leaked display link is the widgets on that one layout, not each registered app's whole API. It is still worth guarding — those widgets show live network data — but a wallboard URL is no longer a read-only key to the suite.

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

### Dashboard widgets

Any widget an app publishes to the NOC Builder can also sit on the Dashboard, under **Live widgets**. Admins place them with **Edit widgets**: pick from the same library the NOC Builder uses, set each widget's parameters (device, port, capture, window), choose a size and an order, and save. The layout is one list shared by everyone who can see the Dashboard, and each save is recorded in the audit log as `dashboard.widgets_update`.

Only the app, the widget id, the size and the parameters are stored. The path a tile loads is always taken from the app's *current* manifest, so a saved layout cannot point a tile at anything the app did not publish; a save naming a widget the app does not publish is refused. If an app later stops publishing a widget, its tile shows "no longer published" rather than disappearing. Tiles load through the same authenticated app proxy as everything else on the Dashboard and refresh on **Settings → NOC → Widget refresh**. With nothing placed, non-admins see no widget section at all.

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

[TROUBLESHOOTING.md](TROUBLESHOOTING.md) is the full diagnostic guide — health,
proxy, embedding, managed mode, Base URL, token rotation, Resonance. The
README's [Troubleshooting](../README.md#troubleshooting) section keeps a few
quick recipes. Common starting points:

| Symptom | Check |
|---|---|
| Service won't start | Check systemd logs; confirm `config.yaml` exists and has a valid `jwt_secret` |
| A registered app shows unhealthy | Confirm its base URL is reachable from pktHub and its suite token hasn't been rotated on that app's side without updating it here |
| A managed app's Settings page won't embed correctly | Walk through the 5 mechanism points under Reg App Settings above — most failures are one of those |
| A restored `config.yaml` didn't take effect | Restart the service — restoring never does this automatically |

## Upgrading

### Updating from Settings

**Settings → System → Updates** checks the pktHub repository on GitHub for a newer
release and can install it for you.

- **Check for updates** compares the installed version with the latest GitHub
  release (it also checks by itself every hour). When a newer one exists, the
  panel shows **Update to vX.Y.Z**.
- **Update** downloads the release package, replaces the application files, and
  restarts the service. The page reloads when pktHub is back, usually within a few
  seconds. Your `config.yaml`, database, `venv/`, logs and backups are never
  touched.
- **Update mode** is *Manual* by default: nothing installs until an admin presses
  the button. *Automatic* installs a new release by itself, but only inside the
  update window you set (the window may cross midnight).
- **GitHub token** is only needed when the repository is private. It needs read
  access to the repository's contents, is stored encrypted, and is never shown
  again after you save it.
- An install that is a git checkout (it has a `.git` directory) can check for
  updates but will not apply them — update those with `git pull` and restart.
- Restart relies on the service manager: the unit must restart the service after
  it exits (`Restart=on-failure` or `Restart=always`, which is how `install.sh`
  sets it up).
- A package is published when the `VERSION` file is raised on `main`. The
  release is tagged `v<Major>.<Minor>.<Patch>`; a change that only moves the
  codename or hotfix number does not publish a new release.

### Updating by hand

Pull the latest code, rebuild the frontend if you build manually, then restart the service.

Re-running `install.sh` also works, and is the better route when a release drops
or renames a file: it detects the existing install, reports the version it
found, and offers to uninstall it first so no stale module is left importable.
Your data is kept either way, and the port you enter at the prompt is applied to
the existing `config.yaml` without touching another line of it. Set
`PKTHUB_REMOVE_EXISTING=1` (or `0`) to answer that prompt from a script;
non-interactive runs upgrade in place.

## Uninstalling

`install.sh` copies `uninstall.sh` into the install directory, so it is on the
host without the repo:

```bash
bash /opt/pkthub/uninstall.sh
```

It reads the install directory from the systemd unit, stops and removes the
service, and deletes the application code and the virtualenv. **Data is kept by
default** — `config.yaml` (which holds the JWT secret and the credential
encryption key), `pkthub.db` and its `-wal`/`-shm`, `logs/`, `backups/` and
anything uploaded under `ssl/`. It asks separately before removing those,
and that prompt defaults to no.

| Flag | Effect |
|---|---|
| *(none)* | Remove the service, the code and the venv; keep data. Prompts first. |
| `--purge` | Also delete the config, database, logs, backups and TLS material. Not recoverable. |
| `--dry-run` | Print what would be removed; change nothing. |
| `--yes` | Skip the prompts — required for a non-interactive run. |
| `--dir PATH` | Install directory, if the unit file is already gone. |

Re-running `install.sh` afterwards against the same directory picks the kept
data back up, so the admin password and every setting survive an uninstall that
was not a `--purge`.

An install directory that is itself a git checkout (an in-place install) is
detected, and its source tree is never deleted — only the unit and the venv go.

