# pktDashboard

Central landing page and operations hub for the **pktsuite** — a collection of internal network visibility tools deployed on the Vyne infrastructure O2 server.

**Live deployment:** `http://172.23.80.5:8760`

---

## Overview

pktDashboard provides a single-pane-of-glass entry point for the pktsuite applications. It surfaces live operational data from pktFlow and provides quick-launch access to all pktXXX tools from one URL.

Rather than requiring users to bookmark individual app ports, pktDashboard acts as the authoritative home page for the suite — showing system health at a glance and linking out to each application.

---

## pktsuite Applications

| App | Port | Description |
|-----|------|-------------|
| **pktDashboard** | `:8760` | This app — landing page and ops hub |
| **pktFlow** | `:8766` | Real-time NetFlow visualization and alerting |
| **pktAnalyzer** | `:8765` | Deep packet inspection (.pcap file analysis) |

---

## Features

- **System health banner** — real-time operational status shown in the header
- **Live pktFlow metrics** — flows/sec, active device count, and unacknowledged alert count, refreshed every 30 seconds
- **Active alerts panel** — unacknowledged alert events from pktFlow with severity badges (critical / warning / info), rule name, and time elapsed
- **Application launcher** — cards for each pktsuite app with live status indicators and direct links
- **No login required** — uses a dedicated read-only service account to pull data from pktFlow transparently
- **Consistent design** — matches the dark theme of pktFlow and pktAnalyzer (`#0d1117` background, `#58a6ff` blue accent, monospace data values)

---

## Architecture

```
Browser
    │
    ▼
pktDashboard (FastAPI, port 8760)
    │   Serves single-file HTML frontend
    │   /api/dashboard → fetches pktFlow concurrently
    │
    ▼
pktFlow (FastAPI, port 8766) — same host
    │   GET /api/health
    │   GET /api/flows/rate
    │   GET /api/flows/devices
    │   GET /api/alerts/events?unacked_only=true
    │
    ▼
pktFlow service account (viewer role)
    SQLite: /mnt/software/pktflow/pktflow.db
```

**Key design decisions:**

- **Read-only service account** — a `viewer`-role user (`pktdashboard`) is created in pktFlow's SQLite database. pktDashboard authenticates as this account on startup and caches the JWT. No user credentials are ever exposed to the browser.
- **Server-side proxy** — all pktFlow API calls happen in the FastAPI backend. The service account password stays in `config.yaml` on the server, never in client-side JavaScript.
- **Token auto-refresh** — the JWT is refreshed at 13 minutes (before the 15-minute expiry). If a 401 is received unexpectedly, the client re-authenticates immediately.
- **Concurrent fetching** — health, flow rate, devices, and alerts are all fetched in parallel using `asyncio.gather`, so the dashboard response latency is bounded by the slowest single call.
- **Graceful degradation** — all pktFlow fetch errors are caught individually. If pktFlow is unreachable, the dashboard renders with an error state rather than returning a 500.
- **No build step** — the frontend is a single self-contained `index.html` served directly by FastAPI. No Node.js, no bundler, no npm.

---

## Requirements

| Component | Version | Notes |
|-----------|---------|-------|
| Python | 3.9+ | 3.11+ recommended |
| pip | any | For installing dependencies |
| OS | Amazon Linux 2023 / RHEL 8+ / Ubuntu 22+ | systemd required for production |
| pktFlow | running | Required data source — dashboard degrades gracefully if unavailable |

### Python packages

See [requirements.txt](requirements.txt). Dependencies are minimal by design:

| Package | Purpose |
|---------|---------|
| `fastapi` | Web framework |
| `uvicorn[standard]` | ASGI server |
| `httpx` | Async HTTP client for pktFlow API calls |
| `pyyaml` | Config file parsing |

---

## Installation

### 1. Clone the repository

```bash
git clone git@github.com:bsnwgit/pktsuite.git
cd pktsuite
```

### 2. Create the service account in pktFlow

pktDashboard needs a read-only account in pktFlow's SQLite database. Run this once using pktFlow's virtualenv (which has `bcrypt` installed):

```bash
/mnt/software/pktflow/venv/bin/python3 - <<'EOF'
import sqlite3, bcrypt

password = b"your-chosen-password"
hashed = bcrypt.hashpw(password, bcrypt.gensalt()).decode()

conn = sqlite3.connect("/mnt/software/pktflow/pktflow.db")
conn.execute(
    "INSERT OR IGNORE INTO users (username, email, hashed_password, role, is_active) VALUES (?,?,?,?,?)",
    ("pktdashboard", "pktdashboard@internal", hashed, "viewer", 1)
)
conn.commit()
conn.close()
print("Done")
EOF
```

### 3. Configure

```bash
cp config.example.yaml /mnt/software/pktdashboard/config.yaml
# Edit config.yaml — set pktflow_username and pktflow_password
```

Configuration reference:

| Key | Default | Description |
|-----|---------|-------------|
| `pktflow_url` | `http://127.0.0.1:8766` | Internal URL to reach pktFlow |
| `pktflow_username` | `pktdashboard` | Service account username |
| `pktflow_password` | *(required)* | Service account password |
| `host` | `0.0.0.0` | Bind address |
| `port` | `8760` | Listen port |

### 4. Create the Python virtualenv and install dependencies

```bash
python3 -m venv /mnt/software/pktdashboard/venv
/mnt/software/pktdashboard/venv/bin/pip install -r requirements.txt
```

### 5. Deploy application files

```bash
mkdir -p /mnt/software/pktdashboard/app /mnt/software/pktdashboard/frontend
cp app/*.py /mnt/software/pktdashboard/app/
cp frontend/index.html /mnt/software/pktdashboard/frontend/
cp config.yaml /mnt/software/pktdashboard/config.yaml
```

### 6. Install and start the systemd service

```bash
sudo cp pktdashboard.service /etc/systemd/system/pktdashboard.service
sudo systemctl daemon-reload
sudo systemctl enable --now pktdashboard
sudo systemctl status pktdashboard
```

### 7. Verify

```bash
curl -s http://localhost:8760/api/health
# Expected: {"status": "ok"}

curl -s http://localhost:8760/api/dashboard | python3 -m json.tool
# Expected: JSON with pktflow_up, flow_rate, devices, alerts
```

---

## Automated Deployment

The included `deploy.py` script handles the full deployment in one step using Python + Paramiko (no system SSH required — compatible with SentinelOne EDR):

```bash
# Run from Windows (Python 3.13 required, Paramiko must be installed)
C:\Users\robert.barnett\AppData\Local\Programs\Python\Python313\python.exe deploy.py
```

The script:
1. Creates the `pktdashboard` service account in pktFlow's SQLite database (idempotent — skips if already exists)
2. Creates the remote directory structure
3. Uploads all application files via SFTP
4. Creates a Python virtualenv and installs dependencies
5. Installs, enables, and starts the systemd service
6. Prints final service status

> **Note:** SSH access to O2 uses the `VyneCorpNetInfra.pem` key and goes through Python + Paramiko because SentinelOne EDR blocks non-interactive spawning of `ssh.exe`. See [pktFlow's O2_SSH_CONNECTION.md](../pktFlow/O2_SSH_CONNECTION.md) for details.

---

## Directory Structure

```
pktDashboard/
├── app/
│   ├── __init__.py
│   ├── main.py               # FastAPI app — serves frontend, /api/dashboard, /api/health
│   └── pktflow_client.py     # pktFlow HTTP client — JWT management, concurrent fetching
├── frontend/
│   └── index.html            # Single-file dashboard UI (no build step)
├── config.example.yaml       # Config template (copy to config.yaml and edit)
├── config.yaml               # Live config — NOT committed (contains credentials)
├── requirements.txt          # Python dependencies
├── pktdashboard.service      # systemd unit file
└── deploy.py                 # One-shot Windows deployment script (Paramiko)
```

---

## API Reference

pktDashboard exposes two endpoints:

### `GET /`

Returns the dashboard HTML page.

### `GET /api/health`

```json
{ "status": "ok" }
```

### `GET /api/dashboard`

Returns a combined snapshot from pktFlow. All fields degrade gracefully — if pktFlow is unreachable, `pktflow_up` is `false` and data arrays are empty.

```json
{
  "pktflow_up": true,
  "health": { "status": "ok", "version": "0.1.0" },
  "flow_rate": { "flows_per_sec": 148.3 },
  "devices": [
    {
      "sampler_ip": "192.168.44.7",
      "name": "OneNeck-fw1",
      "site": "oneneck"
    }
  ],
  "alerts": [
    {
      "id": 12,
      "rule_id": 2,
      "rule_name": "Collector data gap",
      "severity": "critical",
      "message": "No flows from 10.19.56.186 in 12 minutes",
      "details": {},
      "fired_at": "2026-06-23T19:45:00Z",
      "acked_at": null,
      "acked_by": null
    }
  ]
}
```

pktFlow endpoints consumed:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Service up/down check |
| `GET /api/flows/rate` | Current flows/sec (last 60s) |
| `GET /api/flows/devices` | Per-sampler device summaries |
| `GET /api/alerts/events?unacked_only=true&limit=20` | Active unacknowledged alert events |

---

## Updating

### Frontend only (no restart needed)

The frontend is a static HTML file. Update it by uploading the new file — FastAPI serves it directly from disk on each request:

```bash
# Via Paramiko/SFTP from Windows
sftp.put("frontend/index.html", "/mnt/software/pktdashboard/frontend/index.html")
```

### Backend code

```bash
# Upload changed Python files, then restart
sudo systemctl restart pktdashboard
sudo systemctl status pktdashboard
```

### Logs

```bash
tail -f /mnt/software/logs/pktdashboard.log
```

---

## pktFlow Client — Token Lifecycle

The `PktFlowClient` in `app/pktflow_client.py` manages the service account JWT automatically:

1. On first API call, logs in via `POST /api/auth/login` with the configured credentials
2. Caches the token with a monotonic expiry set at 13 minutes (pktFlow tokens expire at 15)
3. All API calls include `Authorization: Bearer <token>`
4. If a `401` is received mid-session (e.g. server restart), the client immediately re-authenticates and retries the request once
5. An `asyncio.Lock` prevents concurrent login races if multiple requests arrive simultaneously before the first token is ready

---

## Security Notes

- `config.yaml` is excluded from git (see `.gitignore`) — it contains the service account password
- The service account has `viewer` role only — it cannot create/modify/delete anything in pktFlow
- The dashboard is read-only by design — no write operations are exposed
- The service account password is never sent to the browser; all pktFlow calls are server-side

---

## License

Internal — Vyne Dental. Not for public distribution.
