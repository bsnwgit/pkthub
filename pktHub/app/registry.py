from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
import aiosqlite
import httpx
import secrets
import json
from datetime import datetime
from typing import List

from app.database import get_db
from app.auth import require_admin, require_analyst_or_admin, get_current_user
from app.models import AppRegisterRequest, AppUpdateRequest, AppOut, AppStatusUpdate
from app.audit import write_audit

router = APIRouter(prefix="/api/apps", tags=["registry"])

SUITE_VERSION = 1

def _parse_app(row) -> AppOut:
    manifest = json.loads(row["widget_manifest"]) if row["widget_manifest"] else []
    versions = json.loads(row["supported_versions"]) if row["supported_versions"] else [1]
    status = row["status"] or "observe"
    return AppOut(
        id=row["id"], name=row["name"], display_name=row["display_name"],
        base_url=row["base_url"], app_type=row["app_type"],
        status=status, mode=status,   # mode mirrors status for frontend compat
        health_status=row["health_status"] or "unknown",
        last_health_check=row["last_health_check"],
        widget_manifest=manifest, supported_versions=versions,
        registered_at=row["registered_at"],
        return_url=row["return_url"] if "return_url" in row.keys() else None,
    )



async def _push_suite_token(base_url: str, old_token: str, new_token: str) -> bool:
    """Push new suite token to pktApp after registration. Best-effort."""
    try:
        async with httpx.AsyncClient(verify=False, timeout=10) as _hx:
            _resp = await _hx.post(
                f"{base_url.rstrip('/')}/api/suite/register",
                json={"suite_token": new_token},
                headers={"X-Suite-Token": old_token or ""},
            )
            return _resp.status_code == 200
    except Exception:
        return False

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
    # Token is provided by the user — they copy it from the pktApp's
    # Settings → Integrations → pktHub Integration section.
    suite_token = (body.suite_token or "").strip()
    if not suite_token:
        raise HTTPException(status_code=400, detail=(
            "suite_token is required. "
            "Get it from the pktApp: Settings → Integrations → pktHub Integration → Copy Token."
        ))

    display_name = body.display_name or body.name
    app_type = body.app_type or "pktapp"

    # Health check — verify the URL is reachable (best-effort; register even if app is temporarily down)
    manifest = []
    supported_versions = [1]
    try:
        async with httpx.AsyncClient(verify=False, timeout=8) as client:
            resp = await client.get(
                f"{body.base_url.rstrip('/')}/api/health",
                headers={"X-Suite-Token": suite_token, "X-Suite-Version": str(SUITE_VERSION)}
            )
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, dict):
                    manifest = data.get("widget_manifest", [])
                    supported_versions = data.get("supported_suite_versions", [1])
    except Exception:
        pass  # URL verification is advisory — don't block registration

    cur = await db.execute(
        """INSERT INTO registered_apps
           (name, display_name, base_url, app_type, suite_token, status,
            widget_manifest, supported_versions, registered_by, return_url)
           VALUES (?, ?, ?, ?, ?, 'observe', ?, ?, ?, ?)
           RETURNING *""",
        (body.name, display_name, body.base_url, app_type,
         suite_token, json.dumps(manifest), json.dumps(supported_versions),
         current_user["id"], body.return_url)
    )
    row = await cur.fetchone()
    await db.commit()

    await write_audit(db, current_user, "app.register", f"app:{body.name}", {"base_url": body.base_url})
    background_tasks.add_task(poll_health, row["id"], body.base_url, suite_token)

    return _parse_app(row)

@router.patch("/{app_id}", response_model=AppOut)
async def update_app(
    app_id: int,
    body: AppUpdateRequest,
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    async with db.execute("SELECT * FROM registered_apps WHERE id = ?", (app_id,)) as cur:
        app = await cur.fetchone()
    if not app:
        raise HTTPException(status_code=404, detail="App not found")

    updates = {}
    if body.name is not None:
        updates["name"] = body.name
    if body.base_url is not None:
        updates["base_url"] = body.base_url
    if body.display_name is not None:
        updates["display_name"] = body.display_name
    if body.return_url is not None:
        # Empty string means clear it
        updates["return_url"] = body.return_url if body.return_url.strip() else None
    elif body.return_url == "":
        updates["return_url"] = None

    if not updates:
        return _parse_app(app)

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [app_id]
    await db.execute(f"UPDATE registered_apps SET {set_clause} WHERE id = ?", values)
    await db.commit()

    async with db.execute("SELECT * FROM registered_apps WHERE id = ?", (app_id,)) as cur:
        row = await cur.fetchone()

    await write_audit(db, current_user, "app.update", f"app:{row['name']}", updates)
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

    try:
        async with httpx.AsyncClient(verify=False, timeout=10) as client:
            await client.post(
                f"{app['base_url'].rstrip('/')}/api/suite/deregister",
                json={"suite_token": app["suite_token"]},
                headers={"X-Suite-Version": str(SUITE_VERSION), "X-Suite-Token": app["suite_token"]}
            )
    except Exception:
        pass

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
