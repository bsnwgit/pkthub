# Changelog

All notable changes to pktDashboard are documented here.

---

## [0.1.0] — 2026-06-23

### Added
- Initial release — pktsuite landing page and operations hub
- FastAPI backend with read-only pktFlow service account authentication
- JWT token management: auto-login on startup, refresh at 13 min, re-auth on 401
- Concurrent data fetching via `asyncio.gather` (health, flow rate, devices, alerts)
- Single-file HTML frontend — no build step, no npm, no bundler
- Dark theme matching pktFlow and pktAnalyzer (`#0d1117` / `#58a6ff`)
- Live metrics panel: flows/sec, active device count, unacknowledged alert count
- Active alerts panel with severity badges (critical / warning / info), rule name, elapsed time
- Graceful degradation when pktFlow is unreachable
- Application launcher cards for pktFlow (`:8766`) and pktAnalyzer (`:8765`)
- 30-second auto-refresh with last-updated indicator
- `pktdashboard.service` systemd unit
- `deploy.py` — Paramiko-based one-shot deployment script for Windows (SentinelOne EDR compatible)
- `config.example.yaml` — documented configuration template
- Deployed to production server at `http://<server-ip>:8760`
