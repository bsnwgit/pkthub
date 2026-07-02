# pktHub Deployment Guide

This document covers everything required to deploy pktHub from scratch and integrate
all pktApps with SSO proxy auth. Follow all sections in order.

Placeholder convention used throughout:
- `<SERVER_IP>` — IP address of the target server
- `<INSTALL_DIR>` — base installation path (e.g. `/mnt/software`)
- `<PORT_HUB>` — pktHub port (default 8760)
- `<PORT_LOG>` — pktLog port (default 8768)
- `<PORT_FLOW>` — pktFlow port (default 8766)
- `<PORT_SNMP>` — pktSNMP port (default 8767)
- `<PORT_PCAP>` — pktPCAP port (default 8765)
- `<DEPLOY_USER>` — SSH user with access to the install dir

---

## §1 — Deploy pktHub

### Prerequisites
- Python 3.9+ on the server
- Node 18+ on the server (for frontend build)
- SSH access as `<DEPLOY_USER>`
- Port `<PORT_HUB>` open on internal network

### Steps

```bash
# 1. Upload source
scp -r ./pktHub <DEPLOY_USER>@<SERVER_IP>:<INSTALL_DIR>/pkthub

# 2. Create venv and install deps
ssh <DEPLOY_USER>@<SERVER_IP>
cd <INSTALL_DIR>/pkthub
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 3. Build frontend
cd frontend
npm install
npm run build        # outputs to frontend/dist/

# 4. Copy and edit config
cd ..
cp config.example.yaml config.yaml
# Edit config.yaml: set jwt_secret (random hex), admin password, port

# 5. SSL cert (self-signed)
sudo mkdir -p /etc/ssl/pkthub
sudo openssl req -x509 -newkey rsa:4096 -keyout /etc/ssl/pkthub/key.pem \
  -out /etc/ssl/pkthub/cert.pem -days 3650 -nodes -subj "/CN=pkthub"
sudo chown <DEPLOY_USER>:<DEPLOY_USER> /etc/ssl/pkthub/cert.pem /etc/ssl/pkthub/key.pem

# 6. Install systemd service
sudo cp pkthub.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable pkthub
sudo systemctl start pkthub
```

### Known gotchas

| Problem | Cause | Fix |
|---------|-------|-----|
| `cert.pem: Permission denied` at startup | SSL certs created as root | `sudo chown <DEPLOY_USER> /etc/ssl/pkthub/*.pem` |
| `bcrypt` errors at login | bcrypt 4.x incompatible with passlib | Pin `bcrypt==3.2.2` in requirements.txt |
| Port already in use | Stale process | `sudo fuser -k <PORT_HUB>/tcp` |
| SPA blank / 404 | Frontend not built | Run `npm run build` in `frontend/` |

---

## §2 — Register pktApps

After pktHub is running, register each pktApp from the App Manager UI
(https://`<SERVER_IP>`:`<PORT_HUB>` → App Manager → Register App).

Required fields per app:

| App     | Base URL                                     |
|---------|----------------------------------------------|
| pktLog  | `https://<SERVER_IP>:<PORT_LOG>/`            |
| pktFlow | `https://<SERVER_IP>:<PORT_FLOW>/`           |
| pktSNMP | `https://<SERVER_IP>:<PORT_SNMP>/`           |
| pktPCAP | `https://<SERVER_IP>:<PORT_PCAP>/`           |

For each app, generate a unique suite token:
```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

Copy each token — you'll configure it on the pktApp side in §3.

---

## §3 — Configure Each pktApp for SSO Auth

This section explains every change required so pktApps open inside the pktHub proxy
iframe without showing their own login screen.

### Root cause (understand this first)

**Problem A — SPA API calls hit the wrong origin.**

pktApp SPAs use root-relative URLs like `fetch('/api/users/me')`. When the SPA runs
inside pktHub's iframe, the document origin is pktHub, so those calls hit pktHub's
own `/api/` — not the pktApp's. pktHub rejects the pktApp's JWT and the SPA falls
back to its login page.

**Fix A** — already handled in pktHub `app/proxy.py` `_rewrite_html()`: a fetch/XHR
patcher script is injected into every proxied HTML `<head>`, rewriting
`/api/...` → `/proxy/{id}/api/...` before any SPA code runs. No per-app work needed.

**Problem B — pktApps don't trust X-Suite-Token for auth.**

Each pktApp still requires its own session/JWT. The suite-token middleware on each
pktApp must validate `X-Suite-Token` and establish a valid local session or JWT so the
SPA considers the user authenticated.

---

### pktLog (FastAPI + Pydantic v2)

**`app/dependencies.py` — synthetic user dict**

The `created_at` field must be a non-None string. Pydantic v2 raises `ValidationError`
for `None` on a non-optional `str` field, causing HTTP 500 on every API call:

```python
# WRONG — causes HTTP 500:
"created_at": None,

# CORRECT:
"created_at": "2020-01-01T00:00:00",
```

Full correct synthetic user dict for suite-token auth:

```python
return {
    "id": 0,
    "username": hub_user,
    "email": f"{hub_user}@pkthub",
    "role": local_role,
    "is_active": True,
    "created_at": "2020-01-01T00:00:00",
    "last_login": None,
    "_via_suite": True,
}
```

**`app/main.py` — `serve_spa()` SSO cookie bootstrap**

Must set short-lived SSO cookies when X-Suite-Token is valid. The React SPA reads
these on mount, skipping the login page:

```python
if _suite_tk and _cfg.suite_token and _suite_tk == _cfg.suite_token:
    _jwt = ...  # encode with app's secret_key, short expiry
    response.set_cookie("sso_access_token", _jwt, max_age=60, httponly=False, samesite="lax")
    response.set_cookie("sso_role", _local_role, max_age=60, httponly=False, samesite="lax")
```

**Config:** add `suite_token: <your-token>` to the app's `config.yaml`.

---

### pktSNMP (FastAPI)

Same pattern as pktLog, plus two additional issues:

**`app/main.py` — missing `Request` import**

Without this import, FastAPI treats the `request` parameter in `serve_spa` as a
required query parameter and returns HTTP 422 on every page load:

```python
# WRONG:
from fastapi import FastAPI, HTTPException

# CORRECT:
from fastapi import FastAPI, HTTPException, Request
```

**`app/main.py` — indentation**

The SSO cookie bootstrap block inside `serve_spa` must be at 8-space indent (function
body), not 16-space (nested inside a conditional). Verify with:
```bash
python3 -m py_compile app/main.py
```

**Config:** add `suite_token: <your-token>` to `config.yaml`.

---

### pktPCAP (Flask)

pktPCAP uses Flask sessions. Auth is enforced by a `@app.before_request` hook.

**`server.py` — `require_login()` — add suite-token check**

Add the X-Suite-Token block **before** the existing `session.get("user_id")` check:

```python
@app.before_request
def require_login():
    if request.path in _AUTH_PUBLIC or any(request.path.startswith(p) for p in _AUTH_PUBLIC_PFX):
        return None

    # pktHub suite-token auth
    _suite_tk = request.headers.get("X-Suite-Token", "")
    if _suite_tk:
        _st_cfg = load_config()
        _expected = _st_cfg.get("suite_token", "")
        if _expected and _suite_tk == _expected:
            _hub_user = request.headers.get("X-Suite-User", "hub_user")
            _hub_role = request.headers.get("X-Suite-Role", "viewer")
            session["user_id"] = _hub_user
            session["role"] = "admin" if _hub_role == "admin" else "viewer"
            session["login_time"] = time.time()
            return None

    if not session.get("user_id"):
        return redirect(url_for("login"))
```

**CRITICAL — Suite token storage**

pktPCAP's `load_config()` reads **exclusively from SQLite** — the config.json
migration moved all settings to the DB. Adding `suite_token` to `config.json` has
no effect. Insert directly into the SQLite `settings` table:

```bash
python3 - <<'EOF'
import sqlite3
db = sqlite3.connect('<INSTALL_DIR>/pktpcap/pktpcap.db')
db.execute(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    ('suite_token', '<your-suite-token>')
)
db.commit()
db.close()
print('done')
EOF
```

Restart after inserting: `sudo systemctl restart pktpcap`

---

### pktFlow (FastAPI)

No changes required. pktFlow's suite-token middleware was already correctly
implemented. Problem A (SPA API URL rewriting) is handled by pktHub's proxy.py.

---

## §4 — Verification

Test each pktApp directly before opening in the browser:

```bash
# Replace <TOKEN> and <URL> for each app
curl -sk -D - -o /dev/null \
  -H "X-Suite-Token: <TOKEN>" \
  -H "X-Suite-User: testuser" \
  -H "X-Suite-Role: admin" \
  https://<SERVER_IP>:<PORT>/

# Expected results:
# HTTP 200 OK         → suite-token auth working
# HTTP 302 to /login  → suite-token not being accepted (check DB / config)
# HTTP 422            → FastAPI parameter error (check Request import + indentation)
# HTTP 500            → Pydantic validation error (check created_at field)
```

Then open each app through the pktHub proxy and confirm no login screen appears.

---

## §5 — Adding Future pktApps

For any new pktApp added to the suite:

1. Register it in pktHub App Manager with a generated suite token
2. Add `X-Suite-Token` validation to the app's auth layer (Problem B)
3. If it's a React/Vue SPA using root-relative `/api/...` URLs, Problem A is already
   handled by pktHub's proxy.py — no changes needed in the new app
4. Set `suite_token` in the app's config (or DB, per the app's storage pattern)
5. Test with `curl` before testing in the browser

---

## §6 — Backup

Before significant changes, run the local backup script:

```
python "C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktHub\backup.py"
```

This rotates a 2-copy local backup:
- `pktHub_backups\backup_1` — most recent
- `pktHub_backups\backup_2` — previous

The script excludes: `.git`, `node_modules`, `__pycache__`, `venv`, `*.pyc`, `*.log`.
