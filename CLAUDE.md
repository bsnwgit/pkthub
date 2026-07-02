# pktHub — Project Context for Claude

This file is the ground truth for working in this project. Read it before doing anything.

---

## HARD RULES — THESE OVERRIDE EVERYTHING. NO EXCEPTIONS. EVER.

**RULE 1 — NEVER MARK TODO ITEMS COMPLETE WITHOUT EXPLICIT USER INSTRUCTION.**
The user must say "mark complete". Claude never marks items done on its own.

**RULE 2 — NEVER WRITE CODE OR MAKE FILE CHANGES WITHOUT EXPLICIT USER APPROVAL.**
"Let's work on X" = discussion only. Always discuss and plan first. Wait for go-ahead.

**RULE 3 — NEVER DEPLOY WITHOUT BEING TOLD TO.**
Do not run any deploy script unless the user explicitly says "deploy."

**RULE 4 — ALWAYS USE pktHub AS THE PROJECT NAME. NEVER "pktDashboard" or "pktSuite".**

**SANITIZATION — ALL DOCS, COMMENTS, AND CODE MUST USE PLACEHOLDERS:**
Never write real IPs, hostnames, deployment paths, org names, or group names.
Use: `<SERVER_IP>`, `<INSTALL_DIR>`, `<PORT_HUB>`, `<DEPLOY_USER>` etc.

---

## Backup Before Marking Complete

Every time the user says to mark a todo item done, run the backup script FIRST:

```
python "C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktHub\backup.py"
```

Backups rotate to: `pktHub_backups\` (backup_1 = most recent, backup_2 = previous)

---

## What This Is

pktHub is the central NOC/SOC management hub for all pktAPP applications
(pktFlow, pktSNMP, pktLog, pktPCAP). It runs HTTPS on port **8760** on the pkt server.

**Status:** Built and deployed. SSO proxy auth complete.

**Server path:** `<INSTALL_DIR>/pkthub`
**DB path:** `<INSTALL_DIR>/pkthub/pkthub.db`
**Live URL:** `https://<SERVER_IP>:<PORT_HUB>`

---

## Infrastructure

| Role        | Placeholder     | User         | SSH Key placeholder        |
|-------------|-----------------|--------------|----------------------------|
| pkt server  | `<SERVER_IP>`   | `<DEPLOY_USER>` | `<SSH_KEY_PATH>`        |

**pktHub on pkt server:**
- Service: `systemctl status pkthub`
- App dir: `<INSTALL_DIR>/pkthub`
- Venv: `<INSTALL_DIR>/pkthub/venv`
- Config: `<INSTALL_DIR>/pkthub/config.yaml`
- HTTPS port: **8760**
- Systemd: `/etc/systemd/system/pkthub.service`
- DB: `<INSTALL_DIR>/pkthub/pkthub.db` (SQLite WAL)

---

## SSH Rules — CRITICAL

**SentinelOne EDR blocks system ssh.exe.** Always use Python + Paramiko.

- Python path: `C:\Users\robert.barnett\AppData\Local\Programs\Python\Python313\python.exe`
- **ONE script, ONE run, NO retry loops** — hammering the connection locks the server
- `timeout=15, banner_timeout=15` on every connect call
- Run scripts via Desktop Commander `start_process`, not the bash sandbox

```python
import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8')  # REQUIRED — Windows defaults to cp1252
key = paramiko.RSAKey.from_private_key_file(r"<SSH_KEY_PATH>")
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("<SERVER_IP>", username="<DEPLOY_USER>", pkey=key, timeout=15, banner_timeout=15)
_, stdout, _ = client.exec_command("your command", timeout=20)
print(stdout.read().decode('utf-8', errors='replace'))
client.close()
```

**Always include `sys.stdout.reconfigure(encoding='utf-8')` at the top of every
Paramiko script.** Without it, Unicode output causes UnicodeEncodeError.

---

## Deployment Process

### Backend changes
1. Edit local file in `C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktHub\`
2. Run `deploy.py` to SFTP changed files to `<INSTALL_DIR>/pkthub/` on pkt server
3. `sudo systemctl restart pkthub`
4. Wait 5 seconds, check `systemctl is-active pkthub`
5. Check `curl -sk https://<SERVER_IP>:<PORT_HUB>/api/health`

### Frontend changes
Run deploy.py (full sync + remote build). Never build frontend on Windows — always
build in Linux `/tmp` on the pkt server (same as pktFlow/pktLog pattern).

---

## Current State

- Phase 1 complete: FastAPI backend, React frontend, SQLite WAL, systemd, HTTPS
- Phase 2 complete: SSO proxy auth — all four pktApps open inside pktHub without
  their own login screens
- All pktApp patches in `pktapp_patches/`

**Registered pktApps:**

| App     | Default Port | SSO Status                    |
|---------|-------------|-------------------------------|
| pktLog  | 8768        | SSO complete, no login prompt |
| pktFlow | 8766        | SSO complete, no login prompt |
| pktSNMP | 8767        | SSO complete, no login prompt |
| pktPCAP | 8765        | SSO complete, no login prompt |

**What still needs to be built:**
- Managed mode toggle (observe → managed lockout)
- Break-glass CLI on each pktApp
- /api/widgets/manifest per pktApp
- Kiosk builder drag-and-drop UI
- Okta SAML 2.0 integration
- Notifications

---

## Git

- Branch: `feature/initial-build`
- Remote: `git@github.com:bsnwgit/pkthub.git`
- Workflow: feature branches + PRs; never push directly to main
