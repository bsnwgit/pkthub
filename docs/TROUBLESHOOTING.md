# pktHub — Troubleshooting

Symptom, cause, and the command that proves which cause it is.

`<INSTALL_DIR>` is the install directory (`/opt/pkthub` by default).

pktHub is the front door: it registers and proxies the sibling apps, embeds
their real pages in its own shell, and centralises users, audit and alerting.
Most of what goes wrong here is a **relationship between two apps**, not a fault
in either — so the useful question is usually "which side is failing", and the
answer is usually reachable with one `curl` from the right host.

The mechanisms themselves are documented in [ADMIN_GUIDE.md](ADMIN_GUIDE.md);
this is the diagnostic path through them.

---

## Contents

- [The first five minutes](#the-first-five-minutes)
- [The service will not start](#the-service-will-not-start)
- [The service runs but nothing answers](#the-service-runs-but-nothing-answers)
- [The UI is blank, stale, or 404](#the-ui-is-blank-stale-or-404)
- [Login, SSO and the auto-login bypass](#login-sso-and-the-auto-login-bypass)
- [A registered app shows unhealthy](#a-registered-app-shows-unhealthy)
- [Proxy errors](#proxy-errors)
- [An embedded page renders wrong](#an-embedded-page-renders-wrong)
- [An app has no menu under APPS](#an-app-has-no-menu-under-apps)
- [Managed mode and lockout](#managed-mode-and-lockout)
- [Base URL changes](#base-url-changes)
- [Token rotation](#token-rotation)
- [The Resonance widget never appears](#the-resonance-widget-never-appears)
- [A config change did not take effect](#a-config-change-did-not-take-effect)
- [TLS / HTTPS](#tls--https)
- [Backup, upgrades and uninstall](#backup-upgrades-and-uninstall)
- [What to capture before reporting a problem](#what-to-capture-before-reporting-a-problem)

---

## The first five minutes

```bash
sudo systemctl status pkthub --no-pager
```

```bash
sudo journalctl -u pkthub -n 100 --no-pager
```

```bash
sudo tail -n 100 <INSTALL_DIR>/logs/pkthub.log
```

```bash
sudo ss -ltnp | grep 8760
```

```bash
curl -s http://127.0.0.1:8760/api/health
```

Then, for anything involving a sibling app, the single most useful command —
run **on the pktHub host**, not your laptop:

```bash
curl -s http://<SIBLING_HOST>:<PORT>/api/health
```

If that fails, nothing in pktHub can fix it.

---

## The service will not start

```bash
sudo journalctl -u pkthub -n 200 --no-pager
sudo tail -n 200 <INSTALL_DIR>/logs/pkthub.log
```

| Symptom | Cause | Fix |
|---|---|---|
| Complaint about the JWT secret | pktHub names it **`jwt_secret`**, not `secret_key` like the rest of the suite | Set a real value: `openssl rand -hex 32` |
| Fernet `InvalidToken` | `credential_key` changed after tokens were stored | Every stored suite token is encrypted with it — see [A config change did not take effect](#a-config-change-did-not-take-effect) |
| Permission denied reading cert or key | HTTPS is active and `/etc/ssl/pkthub/` is unreadable by the service user | The most common start failure on an HTTPS deployment |
| Bad `port` value in `config.yaml` | Non-integer or out of range | Fix and restart |
| `ModuleNotFoundError` | venv missing packages | `<INSTALL_DIR>/venv/bin/pip install -r requirements.txt` |
| `Address already in use` | Something else holds 8760 | `sudo ss -ltnp \| grep 8760` |

Note the unit uses `PKTHUB_INSTALL_DIR` and **`PKTSUITE_CONFIG`** (not
`PKTHUB_CONFIG`) — a detail that catches people reproducing a run by hand.

`Restart=always`, so a broken app restarts forever. Read the log rather than
watching the status, and `sudo systemctl stop pkthub` while investigating.

---

## The service runs but nothing answers

```bash
sudo ss -ltnp | grep 8760
curl -sv http://127.0.0.1:8760/api/health
```

Host and port come from `config.yaml`, and **HTTPS is auto-detected** — the
server checks for a cert uploaded via Settings → Security → SSL/TLS at
`/etc/ssl/pkthub/cert.pem` + `key.pem` and switches automatically. No unit edit
is needed for either.

If access is refused from some clients only, check `trusted_cidrs`: empty means
allow all, non-empty means only those ranges.

---

## The UI is blank, stale, or 404

| Symptom | Cause | Fix |
|---|---|---|
| `{"detail":"Not Found"}` at the root | The frontend was never built | `cd frontend && npm install && npm run build`, then restart |
| Blank page, console 404s on `/assets/*` | `dist` stale or half-built | Rebuild, then hard-refresh |
| Old UI after an upgrade | Cached `index.html` pinning old bundles | Hard refresh (Ctrl/Cmd-Shift-R) |
| A tab is missing from the settings row | Only the selected section's tabs are shown | Switch section. Deep links select the right section automatically |

---

## Login, SSO and the auto-login bypass

The first user is always created as `admin` from `config.yaml`'s
`initial_admin_*` fields on first boot. Roles are `admin`, `analyst` (can act on
parts of the registry, sees only their own audit entries) and `viewer`.

| Symptom | Cause | Fix |
|---|---|---|
| 401 immediately after logging in | Clock skew invalidates the token's `exp` | `timedatectl`; fix NTP |
| **The login page is skipped entirely** | Both local auth and SAML are disabled | This is the by-design auto-login bypass — anyone reaching the app signs in as the default admin with no credentials. Intended only for trusted, isolated deployments. If you did not mean to enable it, re-enable local auth immediately |
| SAML user gets `viewer` unexpectedly | Role re-syncs from the Okta `role` / `Role` / `userRole` attribute on **every** login, falling back to `viewer` when missing or invalid | Fix the attribute in Okta; the next login corrects it |
| SAML user auto-provisioned with the wrong identity | Users auto-provision by **email** on first login | Check the email Okta asserts |
| Forgot the admin password | It is only ever shown once at install time | Reset it against SQLite — the ADMIN_GUIDE has the exact snippet |
| Okta login fails outright | `okta_domain`, `okta_client_id`, `okta_client_secret` — blank disables it | |

---

## A registered app shows unhealthy

pktHub polls each registered app's `/api/health` every `health_poll_interval`
seconds (default 30, configurable under Settings → App Registry along with the
timeout).

Diagnose in this order:

1. **From the pktHub host**, `curl http://<app>:<port>/api/health`. If that
   fails, it is the app or the network, not the registry.
2. If it succeeds, the stored **base URL** is probably wrong — compare it
   against what you just curled.
3. If the base URL is right, the stored **suite token** no longer matches. It
   was almost certainly rotated on the app's side without updating pktHub.

| Symptom | Cause |
|---|---|
| Unhealthy, and a DNS-shaped error in the log | The proxy detects name-resolution failures specifically — the base URL's hostname does not resolve from this host. Use an address that does |
| Healthy but no data | Health only proves the app answers. Its own collectors may still be empty |
| Flaps healthy/unhealthy | The health-check timeout is too short for a loaded app — raise it |
| Went unhealthy after the app moved | Base URL, and every managed app's stored redirect — see [Base URL changes](#base-url-changes) |

---

## Proxy errors

Registered apps are proxied at `/proxy/:appId/*`. The proxy deliberately strips
several request headers before forwarding: `host`, `authorization`,
`content-length`, `cookie`, `accept-encoding`, and any client-supplied
suite-identity headers — those last are set authoritatively by pktHub itself, so
a client-supplied one would arrive as a second, conflicting header.

`accept-encoding` is stripped so the upstream returns plain content the HTML
rewriter can operate on. If you are debugging why a response is uncompressed
through the proxy, that is why.

| Symptom | Cause |
|---|---|
| 502 through the proxy | The target app is down, or bound somewhere other than its registered base URL |
| 504 | The app is slower than the proxy timeout |
| Proxy works, direct access does not | Expected under managed mode — see below |
| A client's own auth header is ignored | Stripped by design. Identity is asserted by pktHub, not forwarded |

---

## An embedded page renders wrong

Embedding requires five things on the sibling app's side. The ADMIN_GUIDE lists
them in full; this is how to tell **which** one is failing:

| What you see | Which point |
|---|---|
| Lands on the app's Dashboard instead of the page you clicked | **Point 2** — the app's router does not recognise the `/proxy/:appId/` path prefix as its basename, so every route fails to match and falls through to a redirect |
| The app's own sidebar and header appear inside pktHub's shell | **Point 3** — no `chromeless` mode |
| The page renders **blank** with no error | **Point 3, the height half** — the chromeless wrapper needs a definite height (`h-screen overflow-auto`, not `min-h-screen`). A child sizing itself with `h-full` collapses to zero against an auto-height parent |
| The app shows its own login page inside the embed | **Point 4** — its auth store is not checking `GET /api/suite/whoami` for `via_suite_token: true` and synthesising a session |
| Images and assets 404, page otherwise fine | **Point 5** — an asset referenced with a literal absolute path (`src="/logo.png"`) resolves against pktHub's origin. Assets must be relative, and the app's `index.html` needs `<base href="/" />`; pktHub injects its own `<base href="/proxy/:appId/">` ahead of it, which wins per the HTML spec |

All nine sibling apps implement points 1–5 — use their
`App.tsx` / `Layout.tsx` / `store/auth.tsx` / `index.html` as the reference when
a new app misbehaves.

---

## An app has no menu under APPS

An app gets a collapsible menu group only if it **publishes a nav manifest**.
One that does not gets a single Settings entry under "REG APP SETTINGS"
instead — that is the designed fallback, not a fault.

The manifest is `GET /api/nav/manifest` on the app, gated by `X-Suite-Token`,
returning `{path, label, icon, admin_only, divider_before}` entries. pktHub's
health poller caches it into `registered_apps.nav_manifest`.

| Symptom | Cause |
|---|---|
| No group at all | The app publishes no manifest, or the endpoint 401s on the token pktHub holds |
| A menu change on the app has not appeared | The cache refreshes on the health poll — wait one interval (default 30s) |
| An admin-only entry is visible to a viewer | `admin_only` only filters what the hub **draws**. The real authorisation is the app's own check against the role pktHub asserts in `X-Suite-Role` — if the app is not enforcing that, fix the app |

---

## Managed mode and lockout

Each registered app has an access mode: `direct` (its own login still works) or
`managed` (direct login locked, access only through pktHub).

**A sibling app cannot get silently stuck locked out of itself.** pktHub polls
each managed app's reported lock state; if an app reports itself unlocked while
the hub still expects `managed`, it is automatically reverted to `direct` and an
`app.lock_drift_detected` audit entry is written.

| Symptom | Cause |
|---|---|
| Managed mode is refused | **Base URL is empty.** A locked app has to send visitors somewhere, and that address can only be built by pktHub. Set Settings → General → Base URL first |
| An app reverted to `direct` on its own | Lock drift was detected and healed. Check the audit log for `app.lock_drift_detected` |
| Locked out of a sibling app | This should self-heal. If it has not, check that app's own suite-token and lock state directly rather than only reading pktHub's registry entry |
| A managed app's Settings page shows an amber "Remotely Managed" banner | Separate, narrower lock — it affects only that app's Settings page, and only on a **direct** visit. Viewing Settings *through* pktHub is unaffected, so there is no lockout paradox |
| The Settings lock had no effect on one app | `POST /api/suite/settings-lock` is best-effort and silently no-ops on an app that has not implemented it |

---

## Base URL changes

Every managed app holds a **copy** of the address pktHub told it to redirect to
(`<Base URL>/app/<app id>`). Changing Base URL without propagating it would
leave apps redirecting to wherever the hub used to be — looking perfectly
healthy while sending users somewhere wrong.

Two mechanisms prevent that:

- Saving Base URL pushes the new address to every managed app immediately, and
  reports which took it.
- The health poller re-checks the stored address every cycle, re-pushes on any
  mismatch, and writes `app.redirect_url_resynced`.

| Symptom | Cause |
|---|---|
| An app still redirects to the old hub address | It was down when Base URL changed. It is repaired when it returns — or force it with a health poll cycle |
| Some apps took the new URL, some did not | The save reports exactly which. The rest are resynced by the poller |
| Users land somewhere wrong but every app is healthy | This is the failure mode the resync exists to prevent. Check the audit log for `app.redirect_url_resynced` |

---

## Token rotation

The suite token is shared between pktHub and the app. pktHub can push a rotated
token back via that app's `POST /api/suite/register`.

| Symptom | Cause |
|---|---|
| An app went unhealthy right after rotation | The push failed — the app still holds the old token. Use resync, or re-register |
| Rotation succeeded but embedding broke | The nav manifest endpoint is gated by the token; it will recover on the next poll |
| Everything broke after rotating on the **app's** side | pktHub was not updated. Rotate from pktHub instead, so it can push |

---

## The Resonance widget never appears

Setup has four steps and the failure looks the same for three of them.

| Symptom | Cause |
|---|---|
| Widget never renders | **The origins list.** Resonance refuses to render inside a page nobody authorised, and that refusal looks exactly like a broken widget rather than a configuration gap. Copy pktHub's own address from the Origin field onto the resonance key's origins list |
| Works, then fails on the session call | **The wrong address.** Use the resonance *interface* server address, not its admin portal — the admin portal looks almost right and fails later, at exactly that point |
| Some users see it, others do not | The roles allowed to open it |
| Not sure whether the key is right | Press **Test connection** — it proves the key without the feature being on, and reads back what the key grants |

Diagnostics reports how many users could not load the widget in the last week.
Repeated failures pause the integration for a few minutes rather than hammering
resonance; the panel says so while paused, and a successful Test Connection
clears it.

---

## A config change did not take effect

**Wrong file.** Note the unit sets `PKTSUITE_CONFIG`, not `PKTHUB_CONFIG`:

```bash
systemctl show pkthub -p Environment
```

**Not restarted.** Nothing in `config.yaml` is re-read live, and restoring a
backed-up `config.yaml` never restarts the service.

**The setting is not in `config.yaml`.** That file holds startup and
infrastructure only — host, port, `jwt_secret`, `credential_key`,
`initial_admin_*`, `health_poll_interval`, `audit_retention_days`,
`trusted_cidrs`, Okta fields, `db_path`. The registry, access modes, NOC
wallboards, alert rules and notification channels live in **SQLite**.

### `credential_key` changed or was lost

Every stored suite token is Fernet-encrypted with it. Change it and pktHub can
no longer talk to any registered app — every one goes unhealthy at once.
Restore the old key, or re-register every app. This is why `uninstall.sh` keeps
`config.yaml` by default.

---

## TLS / HTTPS

HTTPS is auto-detected from a cert uploaded via Settings → Security → SSL/TLS at
`/etc/ssl/pkthub/`. `config.yaml`'s `https`, `ssl_certfile` and `ssl_keyfile`
are the manual path, and the comment there is explicit: set `https: true` only
after enabling HTTPS in the unit's `ExecStart`.

| Symptom | Cause |
|---|---|
| Will not start after uploading a cert | Permissions on `/etc/ssl/pkthub/` — the service user must be able to read both files. This is pktHub's single most common start failure |
| Key does not match the cert | Compare `openssl x509 -noout -modulus -in cert.pem \| openssl md5` with `openssl rsa -noout -modulus -in key.pem \| openssl md5` |
| Registered apps go unhealthy after enabling HTTPS on **them** | Their base URLs still say `http://` |
| Embedded pages break over HTTPS | Mixed content — an app serving assets over HTTP inside an HTTPS hub page |

```bash
curl -k https://127.0.0.1:8760/api/health
```

---

## Backup, upgrades and uninstall

Backups write timestamped `backup_*` directories. A restored `config.yaml` never
restarts the service. **Never copy a live SQLite database with `cp`** — take
`pkthub.db`, `-wal` and `-shm` with the service stopped.

Upgrade:

```bash
git pull
cd frontend && npm install && npm run build && cd ..
sudo systemctl restart pkthub
```

`scripts/migrate_settings_encryption.py` exists for a settings-encryption
migration — read it before running it, and back up first.

Re-running `install.sh` is better when a release drops or renames a file; data
is kept, and `PKTHUB_REMOVE_EXISTING=1` (or `0`) answers its prompt from a
script.

Uninstall:

```bash
bash <INSTALL_DIR>/uninstall.sh
```

Data is kept by default — `config.yaml`, `pkthub.db` and its `-wal`/`-shm`,
`logs/`, `backups/` and `ssl/`. `--purge` deletes them and is not recoverable.

Uninstalling pktHub does **not** unlock apps left in managed mode. Set them back
to `direct` first, or they stay locked with nothing to proxy them.

---

## What to capture before reporting a problem

1. `VERSION`, and how it was installed.
2. `systemctl status pkthub` plus the last 200 lines of **both** the journal and
   `logs/pkthub.log`.
3. `config.yaml` **with `jwt_secret`, `credential_key` and passwords removed**.
4. For a sibling-app problem: the result of
   `curl -s http://<app>:<port>/api/health` **run on the pktHub host**, and the
   base URL stored in the registry.
5. For an embedding problem: which of the five points the symptom matches, from
   the table above.
6. For managed-mode or Base URL problems: the relevant audit entries —
   `app.lock_drift_detected`, `app.redirect_url_resynced`.
7. Whether both local auth and SAML are disabled — that changes who can reach
   anything at all.

Never paste real suite tokens, `jwt_secret`, `credential_key`, or an unredacted
`config.yaml`.

## Sign-in lockouts

| Symptom | Cause | Fix |
|---|---|---|
| "Too many failed sign-in attempts from this address" (HTTP 429) | The address made too many failed sign-ins and is blocked for a while, even with correct credentials. Behind a proxy on another host every user shares the proxy's address | It ends by itself (the message says how long). Raise *Failed sign-ins per address* under Settings -> Security -> Auth if real users are hitting it |
| "This account is locked after repeated failed logins" | Too many failed logins: locked 30 minutes the first time, until an admin unlocks it the second time | An admin clicks the unlock icon on Settings -> Security -> Users, or run `scripts/unlock_user.py <username>` on the server |
