# pktSuite — Full Project Briefing

Paste this entire document into a new chat to give Claude full context on pktSuite.

---

## What pktSuite Is

pktSuite is the central NOC/SOC hub and sole management plane for all pktXXXX apps
(pktFlow, pktSNMP, pktLog, pktPCAP, and future apps). It runs on port **8760** on the
pkt server (172.23.80.5). The project folder on this machine is:
`C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktDashboard\`

pktSuite provides:
- Unified authentication (replaces per-app login after registration)
- Reverse-proxy access to all pktXXXX apps through a single shell
- Drag-and-drop kiosk builder for NOC/SOC wall displays
- Platform-wide settings, user management, and audit logging

**Status:** Design complete. Codebase scaffolded (pktDashboard). Not yet built.

---

## Stack

Same as all pkt apps: FastAPI backend + React/TypeScript frontend, HTTPS, SQLite WAL storage.
Deploy pattern identical to pktFlow/pktLog — build frontend in Linux /tmp on pkt server,
SFTP source, systemctl restart.

---

## SSH / Deploy Rules (same as all pkt projects)

SentinelOne blocks system ssh.exe. Always use Python + Paramiko via Desktop Commander
start_process. One script, one run, no retry loops. timeout=15, banner_timeout=15.
Always include sys.stdout.reconfigure(encoding='utf-8') at top of every Paramiko script.


---

## Registration & Lockdown (locked decisions)

- **Observe mode** first: pktSuite monitors and proxies but direct pktXXXX access still works.
  Operator validates everything before flipping to managed mode.
- **Managed mode**: Every request to pktXXXX must carry X-Suite-Token header. No token = 403.
  Direct web access to pktXXXX is blocked.
- **Deregistration**: Full clean break — suite-token removed, direct access restored, pktXXXX
  local users un-dormanted, app removed from registry. No lingering connections.
- **Break-glass** (--emergency-unlock CLI on each pktXXXX): Triggers full deregister. Logged
  and alerted in pktSuite. Re-register manually after recovery.

---

## Authentication & Users

- pktSuite is the sole auth provider after registration. Issues JWTs validated by pktXXXX apps.
- pktXXXX local users stay dormant in place during managed mode — fully restored on deregister.
- pktSuite has its own user store + optional Okta/OIDC integration.
- pktSuite roles map directly to pktXXXX roles when proxying.

---

## Role Matrix

| Area                  | Admin              | Analyst                    | Viewer     |
|-----------------------|--------------------|----------------------------|------------|
| NOC/SOC Dashboard     | Full               | Full                       | View       |
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

1. **App Manager** — register/deregister pktXXXX apps, health monitoring, token management,
   observe vs managed mode toggle
2. **Managed App Viewer** — proxied pktXXXX UI served inside pktSuite shell
3. **Kiosk Builder + Display** — drag-and-drop widget composer, saved layouts, wall display pages

---

## Proxied Page Shell

Thin persistent top bar (~44px) stays across all screens:
- Left: pktSuite lockup logo
- Center: current app indicator (colored in that app's accent color)
- Right: user menu + home button

When entering a proxied app, pktSuite collapses to the thin bar — pktXXXX gets the full
viewport with its own nav rendering naturally. No double-nav. On pktSuite-native pages
(dashboard, settings, kiosk builder) the full pktSuite nav is visible.

---

## Color / UI Theme

Accent shifts to match the app in scope:
- pktFlow  → blue   #60a5fa
- pktSNMP  → teal   #2dd4bf
- pktLog   → green  #4ade80
- pktPCAP  → purple #a78bfa

Universal pktSuite screens (not inside a specific app) → all four colors used simultaneously:
gradient treatment, quad colors on section headers/dividers. App Registry list: each card
colored in its app's color. Kiosk builder: widget borders colored by source app.
Background dark: #0a1628

---

## Settings Layout

Follows pktFlow admin guide pattern exactly:
- Two-column shell: sticky sidebar (260px) + main content area
- Sidebar grouped nav (uppercase letter-spaced labels)
- doc-section blocks with icon + h2, accent-colored h3
- Callout boxes (info/tip/warn/danger), numbered step cards, data tables, code blocks

Settings sidebar nav groups:
  Platform: Identity, Theme, Timezone
  Network: Port, TLS, Trusted CIDRs
  Authentication: Local auth, Okta/OIDC, JWT policy, Token management
  App Registry: Registration defaults, Health polling, Suite-token rotation
  Kiosk: Default intervals, Display token policy
  Notifications: SMTP, Webhooks, Alert events
  Audit & Logging: Retention, Log level
  Maintenance: Backup, Maintenance mode, Emergency unlock


---

## Kiosk Builder

- Drag-and-drop widget composer: grid canvas + widget library panel per registered app
- Each pktXXXX exposes /api/widgets/manifest declaring available widgets, data schemas,
  refresh rates, required permissions. pktSuite reads this at registration.
- Per-dashboard display mode: user picks static (live-refresh) or rotating slides with
  configurable dwell time per slide.
- Published kiosks get URL-based signed display token — wall monitor loads once, no login,
  auto-refresh, token revocable from pktSuite.

---

## Storage

SQLite with WAL mode. Tables: app registry, users, kiosk layouts (JSON blobs), audit log,
notification settings, platform config.

IMPORTANT: Audit logs stored directly in pktSuite DB only. No forwarding to pktLog.
This prevents circular dependency.

---

## API Versioning

Header: X-Suite-Version: 1 on all pktSuite <-> pktXXXX API calls.
pktXXXX apps advertise supported versions in their registration payload.
pktSuite negotiates highest mutually supported version.

---

## SPOF Mitigation

- pktSuite runs as hardened systemd service with auto-restart
- Health endpoint stays live even when main app is degraded
- Break-glass CLI (--emergency-unlock) on every pktXXXX for when pktSuite is unreachable

---

## What Needs to Be Built

### Track 1 — pktSuite Application
- FastAPI backend: reverse proxy, JWT auth, Okta/OIDC, app registry, kiosk builder API
- React frontend: App Manager, Proxied App Viewer (thin top bar shell), Kiosk Builder,
  Dashboard, Settings, Users
- SQLite WAL DB with all tables
- Systemd service on pkt server at /mnt/software/pktsuite, port 8760

### Track 2 — Changes needed in each pktXXXX app
- Suite-token middleware (validates X-Suite-Token, returns 403 if invalid in managed mode)
- Break-glass CLI (--emergency-unlock) for full deregister
- /api/widgets/manifest endpoint
- Registration endpoints (/api/suite/register, /api/suite/deregister)
- API versioning header support (X-Suite-Version)

### Docs / Web Pages
Location: C:\Users\robert.barnett\Desktop\pktSolution\pktSuite\
Style: Match pktFlow/pktSNMP/pktLog/pktPCAP exactly — full-screen hero with radial glow
and diagonal texture, inline stats bar, pipeline steps, 2-col architecture, audience cards,
tech stack pills, centered footer. All content sanitized (no IPs, no site names).


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

---

## Hard Rules for Claude Working in This Project

1. NEVER mark todo items complete without explicit user instruction ("mark complete").
2. NEVER write code or make file changes without explicit user approval. Discussion ≠ approval.
3. NEVER deploy without being told to.
4. Run backup.py BEFORE marking any item complete:
   python "C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktDashboard\backup.py"
5. Always render task lists as an interactive show_widget HTML widget, not a markdown table.
   Each task card: Work this / Completed / Commit buttons via sendPrompt.
