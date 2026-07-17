from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import os
import aiosqlite

from app.config import get_settings
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

app = FastAPI(title="pktHub", version="1.0.0", docs_url="/api/docs")

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

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "pkthub", "version": "1.0.0"}

@app.on_event("startup")
async def startup():
    await init_db()
    settings = get_settings()
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await ensure_initial_admin(db)
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
                    poll_health(app_row["id"], app_row["base_url"], app_row["suite_token"])
                )
        except Exception:
            pass

# Serve React frontend — catch-all for SPA routing
FRONTEND_DIST = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")

if os.path.exists(FRONTEND_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        static_file = os.path.join(FRONTEND_DIST, full_path)
        if full_path and os.path.isfile(static_file):
            return FileResponse(static_file)
        index = os.path.join(FRONTEND_DIST, "index.html")
        if os.path.exists(index):
            return FileResponse(index, headers={"Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache"})
        return {"error": "Frontend not built"}
