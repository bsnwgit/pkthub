from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import os
import aiosqlite

from app.config import get_settings
from app.crypto import decrypt_str
from app.database import init_db, get_db
from app.auth import router as auth_router, ensure_initial_admin
from app.users import router as users_router
from app.registry import router as registry_router, poll_health
from app.proxy import router as proxy_router
from app.noc import router as noc_router
from app.audit import router as audit_router
from app.settings_api import router as settings_router
from app.dashboard import router as dashboard_router
from app.notifications import router as notifications_router
from app.alert_rules import router as alert_rules_router
from app.ssl_api import router as ssl_router
from app.backup_api import router as backup_router
from app.app_alerts import router as app_alerts_router
from app.maintenance_api import router as maintenance_router
from app.user_api_keys import router as user_api_keys_router
from app.ip_info import router as ip_info_router
from app.mxtoolbox import router as mxtoolbox_router
from app.docs_api import router as docs_router
from app.resonance import router as resonance_router
from app.resonance_data import router as resonance_data_router
from app.system_api import router as system_router
from app.version import get_version

app = FastAPI(title="pktHub", version=get_version(), docs_url="/api/docs")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(registry_router)
app.include_router(proxy_router)
app.include_router(noc_router)
app.include_router(audit_router)
app.include_router(settings_router)
app.include_router(dashboard_router)
app.include_router(notifications_router)
app.include_router(alert_rules_router)
app.include_router(ssl_router)
app.include_router(backup_router)
app.include_router(app_alerts_router)
app.include_router(maintenance_router)
app.include_router(system_router)
app.include_router(user_api_keys_router)
app.include_router(ip_info_router)
app.include_router(mxtoolbox_router)
app.include_router(docs_router)
app.include_router(resonance_router)
# Carries its own absolute paths — /api/resonance/data/* plus the two documents
# at /api/resonance/openapi.json and /.well-known/resonance.json — so it is
# mounted without a prefix, and before the SPA catch-all so the grant file wins.
app.include_router(resonance_data_router)

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "pkthub", "version": get_version()}

@app.on_event("startup")
async def startup():
    await init_db()
    settings = get_settings()
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await ensure_initial_admin(db)
    from app.system_api import start_log_forwarding
    await start_log_forwarding()

    from app.retention import RetentionScheduler
    await RetentionScheduler().start()

    asyncio.create_task(health_poller())

async def health_poller():
    """Background loop: poll health of all registered apps every N seconds."""
    settings = get_settings()
    while True:
        await asyncio.sleep(settings.health_poll_interval)
        try:
            async with aiosqlite.connect(settings.db_path) as db:
                db.row_factory = aiosqlite.Row
                async with db.execute("SELECT id, base_url, suite_token FROM registered_apps") as cur:
                    apps = await cur.fetchall()
            for app_row in apps:
                asyncio.create_task(
                    poll_health(app_row["id"], app_row["base_url"], decrypt_str(app_row["suite_token"]))
                )
        except Exception:
            pass

# Serve React frontend — catch-all for SPA routing
FRONTEND_DIST = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")

# First path segments the server owns outright — no SPA route lives under them.
# The catch-all answers every other unmatched GET with index.html, so a backend
# route that goes missing used to return HTML with a 200; the frontend's fetch
# wrapper only parses JSON once res.ok, and failed with "JSON.parse: unexpected
# character" instead of reporting a 404. "proxy" is deliberately absent:
# /proxy/{id} with no trailing slash misses the proxy route and is the SPA's
# own ProxyShell page.
SERVER_OWNED_PREFIXES = ("api", "proxy-display")

if os.path.exists(FRONTEND_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # A miss under a server-owned prefix is a real 404, not a deep link.
        if full_path.split("/", 1)[0] in SERVER_OWNED_PREFIXES:
            raise HTTPException(status_code=404, detail="Not found")

        # Normalize-then-prefix-check. This handler is unauthenticated and
        # config.yaml sits above the dist directory, so "../../config.yaml"
        # previously returned the JWT signing key and the credential
        # encryption key to anyone who asked.
        _dist_root = os.path.normpath(FRONTEND_DIST)
        _candidate = os.path.normpath(os.path.join(_dist_root, full_path))
        if not (_candidate == _dist_root or _candidate.startswith(_dist_root + os.sep)):
            raise HTTPException(status_code=404, detail="Not found")
        static_file = _candidate
        if full_path and os.path.isfile(static_file):
            return FileResponse(static_file)
        index = os.path.join(FRONTEND_DIST, "index.html")
        if os.path.exists(index):
            return FileResponse(index, headers={"Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache"})
        return {"error": "Frontend not built"}
