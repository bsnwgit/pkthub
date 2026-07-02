# pktHub — Full Project Briefing

Paste this entire document into a new chat to give Claude full context on pktHub.

---

## What pktHub Is

pktHub is the central hub and sole management plane for all pktApps
(pktFlow, pktSNMP, pktLog, pktPCAP, and future apps). It runs on port **8760** on the
pkt server. The project folder on this machine is:
`C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktHub\`

pktHub provides:
- Unified authentication (replaces per-app login after registration)
- Reverse-proxy access to all pktApps through a single shell
- Drag-and-drop kiosk builder for wall displays
- Platform-wide settings, user management, and audit logging

**Status:** Built and deployed. SSO proxy auth complete — all four pktApps open inside
pktHub without showing their own login screens. Phase 1 + Phase 2 committed to
`feature/initial-build` on `git@github.com:bsnwgit/pkthub.git`.

---

## Stack

Same as all pkt apps: FastAPI backend + React/TypeScript frontend, HTTPS, SQLite WAL.
Deploy pattern identical to pktFlow/pktLog — build frontend on the server,
SFTP source, systemctl restart.

---

## SSH / Deploy Rules (same as all pkt projects)

SentinelOne blocks system ssh.exe. Always use Python + Paramiko via Desktop Commander
start_process. One script, one run, no retry loops. timeout=15, banner_timeout=15.
Always include sys.stdout.reconfigure(encoding='utf-8') at top of every Paramiko script.

---

## SSO Proxy Auth Architecture (COMPLETE)

pktHub proxies all pktApp traffic through `/proxy/{app_id}/{path}`. Every proxied
request carries `X-Suite-Token`, `X-Suite-User`, and `X-Suite-Role` headers.

**Two problems existed that caused pktApps to show their own login screens:**

**Problem A — SPA root-relative API calls hit pktHub instead of the pktApp.**
When a pktApp SPA runs inside pktHub's iframe, `fetch('/api/users/me')` resolves
against the pktHub origin, not the pktApp's origin. pktHub rejects the pktApp's
JWT → SPA falls back to login page.

Fix: `app/proxy.py` `_rewrite_html()` injects a fetch/XHR patcher into every
proxied HTML `<head>` that rewrites `/api/...` → `/proxy/{id}/api/...` before any
SPA script runs. Multi-Set-Cookie forwarding handles pktApps that set two cookies.

**Problem B — pktApps don't trust X-Suite-Token for auth.**
Each pktApp must validate X-Suite-Token and establish a local session/JWT.
Details and per-app gotchas are in `DEPLOYMENT.md §3`.

Key gotchas discovered during integration:
- pktLog/pktSNMP (FastAPI + Pydantic v2): synthetic user `created_at` must be a
  datetime string, not None — Pydantic v2 raises ValidationError for None on
  non-optional str fields (HTTP 500 symptom).
- pktSNMP: `Request` must be explicitly imported from fastapi, or FastAPI treats it
  as a required query parameter (HTTP 422 symptom).
- pktPCAP (Flask): suite token must be in the SQLite `settings` table, not
  config.json — `load_config()` reads from DB only after the config.json migration.

---

## Registration & Lockdown (locked decisions)

- **Observe mode** first: pktHub monitors and proxies but direct pktAPP access still works.
  Operator validates everything before flipping to managed mode.
- **Managed mode**: Every request to pktAPP must carry X-Suite-Token. No token = 403.
- **Deregistration**: Full clean break — suite-token removed, direct access restored,
  pktAPP local users un-dormanted, app removed from registry.
- **Break-glass** (--emergency-unlock CLI on each pktAPP): Triggers full deregister.
  Logged and alerted in pktHub. Re-register manually after recovery.

---

## Authentication & Users

- pktHub is the sole auth provider after registration. Issues JWTs validated by pktApps.
- pktAPP local users stay dormant during managed mode — fully restored on deregister.
- pktHub has its own user store + optional Okta SAML 2.0 SSO.
- pktHub roles map directly to pktAPP roles when proxying.

---

## Role Matrix

| Area                  | Admin              | Analyst                    | Viewer     |
|-----------------------|--------------------|----------------------------|------------|
| Dashboard             | Full               | Full                       | View       |
| Proxied App Access    | Maps to Admin      | Maps to Analyst            | Maps to Viewer |
| Kiosk Builder         | Create/Edit/Delete | Create/Edit/Publish own    | No access  |
| Kiosk Display         | Yes                | Yes                        | Yes        |
| App Registry          | Full               | View only                  | No access  |
| User Management       | Full               | No access                  | No access  |
| Platform Settings     | Full               | No access                  | No access  |
| Auth / Okta Config    | Full               | No access                  | No access  |
| Audit Log             | Full               | View own sessions          | No access  |
| Maintenance / Backup  | Full               | No access                  | No access  |

---

## Three Platform Areas

1. **App Manager** — register/deregister pktApps, health monitoring, token management,
   observe vs managed mode toggle
2. **Managed App Viewer** — proxied pktAPP UI served inside pktHub shell
3. **Kiosk Builder + Display** — drag-and-drop widget composer, saved layouts, wall display pages

---

## Proxied Page Shell

Thin persistent top bar (~44px) stays across all screens:
- Left: pktHub lockup logo
- Center: current app indicator (colored in that app's accent color)
- Right: user menu + home button

When entering a proxied app, pktHub collapses to the thin bar — pktAPP gets the full
viewport with its own nav rendering naturally. No double-nav.

---

## Color / UI Theme

Accent shifts to match the app in scope:
- pktFlow  → blue   #60a5fa
- pktSNMP  → teal   #2dd4bf
- pktLog   → green  #4ade80
- pktPCAP  → purple #a78bfa

Universal pktHub screens → all four colors used simultaneously (gradient treatment).
Background dark: #0a1628

---

## Settings Layout

Two-column shell: sticky sidebar (260px) + main content.
Sidebar grouped nav (uppercase letter-spaced labels).
Tabs: General, Network, App Registry, Kiosk, Auth (Okta SAML 2.0), Notifications,
Audit, Maintenance, Users (admin only).

---

## Kiosk Builder

- Drag-and-drop widget composer: grid canvas + widget library panel per registered app
- Each pktAPP exposes `/api/widgets/manifest` declaring available widgets
- Per-dashboard display mode: static (live-refresh) or rotating slides
- Published kiosks get URL-based signed display token — no login, auto-refresh,
  token revocable from pktHub

---

## Storage

SQLite with WAL mode. Tables: app registry, users, kiosk layouts (JSON blobs),
audit log, notification settings, platform config.

Audit logs stored directly in pktHub DB only. No forwarding to pktLog
(prevents circular dependency).

---

## Key Files

```
app/proxy.py          — reverse proxy + HTML rewriter + fetch/XHR patcher
app/registry.py       — pktApp register/deregister, suite token management
app/auth.py           — pktHub JWT auth
app/main.py           — FastAPI app + SPA catch-all
frontend/src/pages/ProxyShell.tsx  — thin-bar iframe shell component
DEPLOYMENT.md         — step-by-step deploy + pktApp integration guide
BUILD_STATUS.md       — current build state and change log
CLAUDE.md             — project context for Claude (hard rules, SSH, deploy)
README.md             — project overview
pktapp_patches/       — server snapshots of every modified pktApp file
backup.py             — local 2-rotation backup script
```

---

## Backup

```
python "C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktHub\backup.py"
```

Backups rotate to: `pktHub_backups\` (backup_1 = most recent, backup_2 = previous)

---

## Hard Rules for Claude Working in This Project

1. NEVER mark todo items complete without explicit user instruction.
2. NEVER write code or make file changes without explicit user approval.
3. NEVER deploy without being told to.
4. Always use Paramiko (Desktop Commander start_process) for SSH — never system ssh.exe.
5. Project is named **pktHub** — never use "pktDashboard" in paths, code, or comments.
6. Read files and logs before guessing. No assumptions on live server state.
7. All docs must be sanitized: no real IPs, hostnames, or deployment paths.
   Use `<SERVER_IP>`, `<INSTALL_DIR>`, `<PORT_HUB>` etc. as placeholders.

---

## Logo Assets (inline SVG — never use external img src)

### Icon (100x100 viewBox)

Four quadrants on #0a1628 bg, white crosshair dividers at 30% opacity.
FLOW=blue waveform, SNMP=teal signal arcs, LOG=green lines, PCAP=purple magnifying glass.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="#0a1628"/>
  <line x1="50" y1="5" x2="50" y2="95" stroke="white" stroke-width="1.5" opacity="0.3"/>
  <line x1="5" y1="50" x2="95" y2="50" stroke="white" stroke-width="1.5" opacity="0.3"/>
  <path d="M5 24h7l5.5-15.5 7 32 5.5-15.5h7" stroke="#60a5fa" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <rect x="53" y="19" width="7.5" height="7.5" rx="1.8" fill="#2dd4bf"/>
  <path d="M63.5 16.5 a10.5 10.5 0 0 1 0 13" stroke="#2dd4bf" stroke-width="3.5" stroke-linecap="round" fill="none"/>
  <path d="M71 10 a19 19 0 0 1 0 25.5" stroke="#2dd4bf" stroke-width="3.5" stroke-linecap="round" fill="none"/>
  <path d="M7 63h35M7 73h29M7 83h20" stroke="#4ade80" stroke-width="3.5" stroke-linecap="round"/>
  <circle cx="72" cy="72" r="14" stroke="#a78bfa" stroke-width="3.5" fill="none"/>
  <path d="M85 85l7.5 7.5" stroke="#a78bfa" stroke-width="3.5" stroke-linecap="round"/>
</svg>

### Lockup (258x80 viewBox)
Dark icon panel left, large "pkt" in Courier New, FLOW/SNMP/LOG/PCAP stacked in their colors.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 258 80">
  <defs><clipPath id="cs"><rect width="258" height="80" rx="14"/></clipPath></defs>
  <rect width="258" height="80" rx="14" fill="#111827"/>
  <rect width="84" height="80" fill="#0a1628" clip-path="url(#cs)"/>
  <g transform="translate(18,16)">
    <line x1="24" y1="2" x2="24" y2="46" stroke="white" stroke-width="0.75" opacity="0.3"/>
    <line x1="2" y1="24" x2="46" y2="24" stroke="white" stroke-width="0.75" opacity="0.3"/>
    <path d="M2.5 12h3.5l2.75-7.75 3.5 16 2.75-7.75h3.5" stroke="#60a5fa" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <rect x="25.5" y="9.5" width="3.5" height="3.5" rx="0.75" fill="#2dd4bf"/>
    <path d="M30.5 7.8 a5 5 0 0 1 0 6.3" stroke="#2dd4bf" stroke-width="1.75" stroke-linecap="round" fill="none"/>
    <path d="M34 5 a9 9 0 0 1 0 11.8" stroke="#2dd4bf" stroke-width="1.75" stroke-linecap="round" fill="none"/>
    <path d="M3.5 30h17M3.5 35.5h14M3.5 41h9.5" stroke="#4ade80" stroke-width="1.75" stroke-linecap="round"/>
    <circle cx="34.5" cy="35.5" r="7" stroke="#a78bfa" stroke-width="1.75" fill="none"/>
    <path d="M41 42l3.5 3.5" stroke="#a78bfa" stroke-width="1.75" stroke-linecap="round"/>
  </g>
  <text x="96" y="51" font-family="Courier New,Courier,monospace" font-size="46" font-weight="500" fill="white" letter-spacing="-2">pkt</text>
  <text x="188" y="27" font-family="Courier New,Courier,monospace" font-size="13" font-weight="700" fill="#60a5fa" letter-spacing="1.5">FLOW</text>
  <text x="188" y="43" font-family="Courier New,Courier,monospace" font-size="13" font-weight="700" fill="#2dd4bf" letter-spacing="1.5">SNMP</text>
  <text x="188" y="59" font-family="Courier New,Courier,monospace" font-size="13" font-weight="700" fill="#4ade80" letter-spacing="1.5">LOG</text>
  <text x="188" y="75" font-family="Courier New,Courier,monospace" font-size="13" font-weight="700" fill="#a78bfa" letter-spacing="1.5">PCAP</text>
</svg>
