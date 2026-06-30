from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
import aiosqlite
import httpx
import secrets
import json
from datetime import datetime
from typing import List

from app.database import get_db
from app.auth import require_admin, require_analyst_or_admin, get_current_user
from app.models import AppRegisterRequest, AppOut, AppStatusUpdate
from app.audit import write_audit

router = APIRouter(prefix="/api/apps", tags=["registry"])

SUITE_VERSION = 1

def _parse_app(row) -> AppOut:
    manifest = json.loads(row["widget_manifest"]) if row["widget_manifest"] else []
    versions = json.loads(row["supported_versions"]) if row["supported_versions"] else [1]
    return AppOut(
        id=row["id"], name=row["name"], display_name=row["display_name"],
        base_url=row["base_url"], app_type=row["app_type"],
        status=row["status"], health_status=row["health_status"] or "unknown",
        last_health_check=row["last_health_check"],
        widget_manifest=manifest, supported_versions=versions,
        registered_at=row["registered_at"]
    )

@router.get("", response_model=List[AppOut])
async def list_apps(
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db)
):
    async with db.execute("SELECT * FROM registered_apps ORDER BY registered_at") as cur:
        rows = await cur.fetchall()
    return [_parse_app(r) for r in rows]

@router.post("", response_model=AppOut, status_code=201)
async def register_app(
    body: AppRegisterRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    suite_token = secrets.token_urlsafe(32)

    # Attempt handshake with the pktXXXX app
    manifest = []
    supported_versions = [1]
    try:
        async with httpx.AsyncClient(verify=False, timeout=10) as client:
            resp = await client.post(
                f"{body.base_url.rstrip('/')}/api/suite/register",
                json={
                    "suite_token": suite_token,
                    "suite_url": "https://localhost:8760",
                    "suite_version": SUITE_VERSION
                },
                headers={"X-Suite-Version": str(SUITE_VERSION)}
            )
            if resp.status_code == 200:
                data = resp.json()
                manifest = data.get("widget_manifest", [])
                supported_versions = data.get("supported_suite_versions", [1])
    except Exception:
        # Handshake failed — register in observe mode anyway, mark health as unknown
        pass

    cur = await db.execute(
        """INSERT INTO registered_apps
           (name, display_name, base_url, app_type, suite_token, status,
            widget_manifest, supported_versions, registered_by)
           VALUES (?, ?, ?, ?, ?, 'observe', ?, ?, ?)
           RETURNING *""",
        (body.name, body.display_name, body.base_url, body.app_type,
         suite_token, json.dumps(manifest), json.dumps(supported_versions),
         current_user["id"])
    )
    row = await cur.fetchone()
    await db.commit()

    await write_audit(db, current_user, "app.register", f"app:{body.name}", {"base_url": body.base_url})
    background_tasks.add_task(poll_health, row["id"], body.base_url, suite_token)

    return _parse_app(row)

@router.delete("/{app_id}", status_code=204)
async def deregister_app(
    app_id: int,
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    async with db.execute("SELECT * FROM registered_apps WHERE id = ?", (app_id,)) as cur:
        app = await cur.fetchone()
    if not app:
        raise HTTPException(status_code=404, detail="App not found")

    # Notify the pktXXXX app to deregister
    try:
        async with httpx.AsyncClient(verify=False, timeout=10) as client:
            await client.post(
                f"{app['base_url'].rstrip('/')}/api/suite/deregister",
                json={"suite_token": app["suite_token"]},
                headers={"X-Suite-Version": str(SUITE_VERSION), "X-Suite-Token": app["suite_token"]}
            )
    except Exception:
        pass  # Deregister locally regardless

    await db.execute("DELETE FROM registered_apps WHERE id = ?", (app_id,))
    await db.commit()
    await write_audit(db, current_user, "app.deregister", f"app:{app['name']}", {})

@router.patch("/{app_id}/status", response_model=AppOut)
async def set_app_status(
    app_id: int,
    body: AppStatusUpdate,
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    await db.execute("UPDATE registered_apps SET status = ? WHERE id = ?", (body.status, app_id))
    await db.commit()
    async with db.execute("SELECT * FROM registered_apps WHERE id = ?", (app_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="App not found")
    await write_audit(db, current_user, "app.status_change", f"app:{row['name']}", {"status": body.status})
    return _parse_app(row)

@router.post("/{app_id}/rotate-token", response_model=dict)
async def rotate_token(
    app_id: int,
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    new_token = secrets.token_urlsafe(32)
    async with db.execute("SELECT * FROM registered_apps WHERE id = ?", (app_id,)) as cur:
        app = await cur.fetchone()
    if not app:
        raise HTTPException(status_code=404, detail="App not found")

    # Push new token to app
    try:
        async with httpx.AsyncClient(verify=False, timeout=10) as client:
            await client.post(
                f"{app['base_url'].rstrip('/')}/api/suite/rotate-token",
                json={"old_token": app["suite_token"], "new_token": new_token},
                headers={"X-Suite-Version": str(SUITE_VERSION), "X-Suite-Token": app["suite_token"]}
            )
    except Exception:
        pass

    await db.execute("UPDATE registered_apps SET suite_token = ? WHERE id = ?", (new_token, app_id))
    await db.commit()
    await write_audit(db, current_user, "app.rotate_token", f"app:{app['name']}", {})
    return {"message": "Token rotated"}

async def poll_health(app_id: int, base_url: str, suite_token: str):
    """Background task: check app health and update DB."""
    import aiosqlite as _aio
    settings_obj = __import__("app.config", fromlist=["get_settings"]).get_settings()
    try:
        async with httpx.AsyncClient(verify=False, timeout=8) as client:
            resp = await client.get(
                f"{base_url.rstrip('/')}/api/health",
                headers={"X-Suite-Token": suite_token, "X-Suite-Version": str(SUITE_VERSION)}
            )
            health = "healthy" if resp.status_code == 200 else "degraded"
    except Exception:
        health = "unreachable"

    async with _aio.connect(settings_obj.db_path) as db:
        await db.execute(
            "UPDATE registered_apps SET health_status = ?, last_health_check = datetime('now') WHERE id = ?",
            (health, app_id)
        )
        await db.commit()
