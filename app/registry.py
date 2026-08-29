from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks

import aiosqlite
import httpx
import posixpath
import secrets
import json
from datetime import datetime
from typing import List

from app.database import get_db
from app.auth import require_admin, require_analyst_or_admin, get_current_user
from app.models import AppRegisterRequest, AppUpdateRequest, AppOut, AppStatusUpdate, DirectAccessRequest
from app.audit import write_audit
from app.crypto import decrypt_str, encrypt_str

router = APIRouter(prefix="/api/apps", tags=["registry"])

SUITE_VERSION = 1

# Widget param pickers are served from this namespace on every pktApp. The
# widget-options proxy refuses anything outside it — see get_widget_options.
_OPTIONS_PREFIX = "/api/widgets/options/"

def _parse_app(row) -> AppOut:
    manifest = json.loads(row["widget_manifest"]) if row["widget_manifest"] else []
    versions = json.loads(row["supported_versions"]) if row["supported_versions"] else [1]
    status = row["status"] or "observe"
    nav = []
    if "nav_manifest" in row.keys() and row["nav_manifest"]:
        nav = json.loads(row["nav_manifest"])
    return AppOut(
        id=row["id"], name=row["name"], display_name=row["display_name"],
        base_url=row["base_url"], app_type=row["app_type"],
        status=status, mode=status,   # mode mirrors status for frontend compat
        health_status=row["health_status"] or "unknown",
        last_health_check=row["last_health_check"],
        widget_manifest=manifest, nav_manifest=nav, supported_versions=versions,
        registered_at=row["registered_at"],
        return_url=row["return_url"] if "return_url" in row.keys() else None,
        access_mode=row["access_mode"] if "access_mode" in row.keys() else "direct",
        lock_verified_at=row["lock_verified_at"] if "lock_verified_at" in row.keys() else None,
    )



async def _set_settings_lock(base_url: str, suite_token: str, locked: bool) -> None:
    """Best-effort: tell the app whether pkthub is now managing its Settings
    page, so its own frontend can show a 'remotely managed' banner and
    disable local editing for a direct (non-proxied) visit. Missing on an app
    that hasn't implemented POST /api/suite/settings-lock yet — failure here
    must never block register/deregister."""
    try:
        async with httpx.AsyncClient(verify=False, timeout=8) as client:
            await client.post(
                f"{base_url.rstrip('/')}/api/suite/settings-lock",
                json={"locked": locked},
                headers={"X-Suite-Token": suite_token, "X-Suite-Version": str(SUITE_VERSION)}
            )
    except Exception:
        pass


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

    # Also try to fetch widget manifest directly
    try:
        async with httpx.AsyncClient(verify=False, timeout=8) as client:
            mresp = await client.get(
                f"{body.base_url.rstrip('/')}/api/widgets/manifest",
                headers={"X-Suite-Token": suite_token, "X-Suite-Version": str(SUITE_VERSION)}
            )
            if mresp.status_code == 200:
                manifest = mresp.json()
    except Exception:
        pass

    cur = await db.execute(
        """INSERT INTO registered_apps
           (name, display_name, base_url, app_type, suite_token, status,
            widget_manifest, supported_versions, registered_by, return_url)
           VALUES (?, ?, ?, ?, ?, 'observe', ?, ?, ?, ?)
           RETURNING *""",
        (body.name, display_name, body.base_url, app_type,
         encrypt_str(suite_token), json.dumps(manifest), json.dumps(supported_versions),
         current_user["id"], body.return_url)
    )
    row = await cur.fetchone()
    await db.commit()

    await write_audit(db, current_user, "app.register", f"app:{body.name}", {"base_url": body.base_url})
    background_tasks.add_task(poll_health, row["id"], body.base_url, suite_token)
    background_tasks.add_task(_set_settings_lock, body.base_url, suite_token, True)

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
    app_token = decrypt_str(app["suite_token"])

    try:
        async with httpx.AsyncClient(verify=False, timeout=10) as client:
            await client.post(
                f"{app['base_url'].rstrip('/')}/api/suite/deregister",
                json={"suite_token": app_token},
                headers={"X-Suite-Version": str(SUITE_VERSION), "X-Suite-Token": app_token}
            )
    except Exception:
        pass

    await _set_settings_lock(app["base_url"], app_token, False)

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
    old_token = decrypt_str(app["suite_token"])

    try:
        async with httpx.AsyncClient(verify=False, timeout=10) as client:
            await client.post(
                f"{app['base_url'].rstrip('/')}/api/suite/rotate-token",
                json={"old_token": old_token, "new_token": new_token},
                headers={"X-Suite-Version": str(SUITE_VERSION), "X-Suite-Token": old_token}
            )
    except Exception:
        pass

    await db.execute("UPDATE registered_apps SET suite_token = ? WHERE id = ?", (encrypt_str(new_token), app_id))
    await db.commit()
    await write_audit(db, current_user, "app.rotate_token", f"app:{app['name']}", {})
    return {"message": "Token rotated"}

@router.post("/{app_id}/resync-token", response_model=dict)
async def resync_token(
    app_id: int,
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Pull the current suite token from the pktApp and update registered_apps."""
    async with db.execute("SELECT * FROM registered_apps WHERE id = ?", (app_id,)) as cur:
        app = await cur.fetchone()
    if not app:
        raise HTTPException(status_code=404, detail="App not found")
    base_url = app["base_url"].rstrip("/")

    try:
        async with httpx.AsyncClient(verify=False, timeout=8) as client:
            resp = await client.get(
                f"{base_url}/api/suite/token",
                headers={"X-Suite-Version": str(SUITE_VERSION)}
            )
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"App returned HTTP {resp.status_code}")
        tok_data = resp.json()
        new_token = tok_data.get("suite_token", "")
        if not new_token:
            raise HTTPException(status_code=502, detail="App returned empty suite_token")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Cannot reach app: {e}")

    previous_token = decrypt_str(app["suite_token"])
    await db.execute(
        "UPDATE registered_apps SET suite_token = ? WHERE id = ?",
        (encrypt_str(new_token), app_id)
    )
    # Resolve any active token_mismatch alert for this app
    await db.execute(
        """UPDATE app_alerts SET status='resolved', resolved_at=datetime('now')
           WHERE app_id = ? AND event_type = 'token_mismatch' AND status = 'active'""",
        (app_id,)
    )
    await db.commit()
    await write_audit(db, current_user, "app.resync_token", f"app:{app['name']}",
                      {"previous_token_prefix": previous_token[:8] + "..."})
    return {"ok": True, "message": "Token synced from app"}


@router.get("/{app_id}/widget-options")
async def get_widget_options(
    app_id: int,
    path: str,
    current_user: dict = Depends(require_analyst_or_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Proxy a widget's `options_path` (from its manifest entry) so the NOC
    editor can populate a param picker (e.g. device/subnet/AP list) without
    the browser needing direct network access or a suite token of its own.

    `path` may carry a query string — dependent pickers narrow their options by
    an already-chosen param (…/interfaces?device_id=3). It is confined to the
    widget-options namespace: this proxy attaches the app's suite token, which
    is the trusted-proxy secret, so an unconstrained path would let any analyst
    read *any* GET endpoint on *any* registered app with that privilege. Every
    manifest in the suite already serves its pickers from this prefix."""
    if "://" in path:
        raise HTTPException(status_code=400, detail="path must be relative to the app")

    raw_path, _, query = path.partition("?")
    # Resolve the path before checking the prefix, so "/api/widgets/options/../../users"
    # is rejected rather than passing on its literal spelling.
    norm = posixpath.normpath("/" + raw_path.lstrip("/"))
    if not norm.startswith(_OPTIONS_PREFIX):
        raise HTTPException(
            status_code=400,
            detail=f"path must be under {_OPTIONS_PREFIX}"
        )

    async with db.execute("SELECT * FROM registered_apps WHERE id = ?", (app_id,)) as cur:
        app = await cur.fetchone()
    if not app:
        raise HTTPException(status_code=404, detail="App not found")

    target_url = f"{app['base_url'].rstrip('/')}{norm}" + (f"?{query}" if query else "")
    try:
        async with httpx.AsyncClient(verify=False, timeout=8) as client:
            resp = await client.get(
                target_url,
                headers={"X-Suite-Token": decrypt_str(app["suite_token"]), "X-Suite-Version": str(SUITE_VERSION)}
            )
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"App returned HTTP {resp.status_code}")
        return resp.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Cannot reach app: {e}")


@router.post("/refresh-manifests", response_model=dict)
async def refresh_manifests(
    current_user: dict = Depends(require_analyst_or_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Re-fetch every registered app's widget manifest now, rather than waiting
    for the next health poll. The NOC editor calls this so an app that has just
    gained widgets shows them in the library without a restart or a poll wait."""
    async with db.execute("SELECT * FROM registered_apps ORDER BY registered_at") as cur:
        apps = await cur.fetchall()

    results = []
    for app in apps:
        count = None
        try:
            async with httpx.AsyncClient(verify=False, timeout=8) as client:
                resp = await client.get(
                    f"{app['base_url'].rstrip('/')}/api/widgets/manifest",
                    headers={"X-Suite-Token": decrypt_str(app["suite_token"]),
                             "X-Suite-Version": str(SUITE_VERSION)}
                )
            if resp.status_code == 200:
                manifest = resp.json()
                if isinstance(manifest, list):
                    await db.execute(
                        "UPDATE registered_apps SET widget_manifest = ? WHERE id = ?",
                        (json.dumps(manifest), app["id"])
                    )
                    count = len(manifest)
        except Exception:
            pass  # an unreachable app keeps its cached manifest — same contract as poll_health
        results.append({"app_id": app["id"], "name": app["name"], "widgets": count})

    await db.commit()
    return {"results": results}


async def poll_health(app_id: int, base_url: str, suite_token: str):
    import aiosqlite as _aio, json as _json
    settings_obj = __import__("app.config", fromlist=["get_settings"]).get_settings()
    health = "unreachable"
    app_direct_ui_locked = None
    widget_manifest = None
    nav_manifest = None

    # ── Health check ──────────────────────────────────────────────────────────
    try:
        async with httpx.AsyncClient(verify=False, timeout=8) as client:
            resp = await client.get(
                f"{base_url.rstrip('/')}/api/health",
                headers={"X-Suite-Token": suite_token, "X-Suite-Version": str(SUITE_VERSION)}
            )
            if resp.status_code == 200:
                health = "healthy"
                data = resp.json()
                if isinstance(data, dict):
                    app_direct_ui_locked = data.get("direct_ui_locked")
            else:
                health = "degraded"
    except Exception:
        health = "unreachable"

    # ── Widget manifest fetch — advisory, never blocks health update ───────────
    try:
        async with httpx.AsyncClient(verify=False, timeout=8) as client:
            mresp = await client.get(
                f"{base_url.rstrip('/')}/api/widgets/manifest",
                headers={"X-Suite-Token": suite_token, "X-Suite-Version": str(SUITE_VERSION)}
            )
            if mresp.status_code == 200:
                widget_manifest = mresp.json()
    except Exception:
        pass  # widget manifest is optional — pktApps without it just show no widgets

    # ── Nav manifest fetch — advisory, same contract as the widget manifest ────
    # An app that publishes one gets its own menu mirrored under APPS in the hub
    # sidebar; an app that doesn't is still reachable from its Dashboard card,
    # it just opens on its root page with no menu to move around by.
    try:
        async with httpx.AsyncClient(verify=False, timeout=8) as client:
            nresp = await client.get(
                f"{base_url.rstrip('/')}/api/nav/manifest",
                headers={"X-Suite-Token": suite_token, "X-Suite-Version": str(SUITE_VERSION)}
            )
            if nresp.status_code == 200:
                nav_manifest = nresp.json()
    except Exception:
        pass  # nav manifest is optional

    # ── Token verification — only when app is reachable ─────────────────────────────────────────
    token_ok = None
    if health != "unreachable":
        try:
            async with httpx.AsyncClient(verify=False, timeout=8) as client:
                tok_resp = await client.get(
                    f"{base_url.rstrip('/')}/api/suite/token",
                    headers={"X-Suite-Version": str(SUITE_VERSION)}
                )
                if tok_resp.status_code == 200:
                    tok_data = tok_resp.json()
                    reported_token = tok_data.get("suite_token", "")
                    token_ok = (reported_token == suite_token)
        except Exception:
            token_ok = None  # network issue — leave alert state unchanged

    async with _aio.connect(settings_obj.db_path) as db:
        db.row_factory = _aio.Row
        async with db.execute(
            "SELECT name, access_mode FROM registered_apps WHERE id = ?", (app_id,)
        ) as cur:
            row = await cur.fetchone()
        app_name    = row["name"] if row else f"app:{app_id}"
        stored_mode = (row["access_mode"] if row and row["access_mode"] else "direct")

        # Drift detection: hub says managed but app reports unlocked (failsafe fired)
        if stored_mode == "managed" and app_direct_ui_locked is False:
            await db.execute(
                """UPDATE registered_apps
                   SET health_status = ?, last_health_check = datetime('now'),
                       access_mode = 'direct', lock_verified_at = NULL
                   WHERE id = ?""",
                (health, app_id)
            )
            await db.execute(
                """INSERT INTO audit_log (user_id, username, action, resource, details)
                   VALUES (NULL, 'system', 'app.lock_drift_detected', ?, ?)""",
                (f"app_id:{app_id}", _json.dumps({"reason": "app reported unlocked while hub expected managed mode"}))
            )
        else:
            await db.execute(
                "UPDATE registered_apps SET health_status = ?, last_health_check = datetime('now') WHERE id = ?",
                (health, app_id)
            )

        # Update widget_manifest if we got a fresh copy from this health cycle
        if widget_manifest is not None:
            await db.execute(
                "UPDATE registered_apps SET widget_manifest = ? WHERE id = ?",
                (_json.dumps(widget_manifest), app_id)
            )

        if nav_manifest is not None:
            await db.execute(
                "UPDATE registered_apps SET nav_manifest = ? WHERE id = ?",
                (_json.dumps(nav_manifest), app_id)
            )

        # ── Alert generation ────────────────────────────────────────────────
        try:
            async with db.execute(
                "SELECT id, event_type FROM app_alerts "
                "WHERE app_id = ? AND acked_at IS NULL AND status = 'active'",
                (app_id,)
            ) as _acur:
                _active = {r["event_type"]: r["id"] for r in await _acur.fetchall()}

            if health == "unreachable":
                if "connection_lost" not in _active:
                    await db.execute(
                        "INSERT INTO app_alerts (app_id, app_name, event_type) VALUES (?, ?, 'connection_lost')",
                        (app_id, app_name)
                    )
                if "unhealthy" in _active:
                    await db.execute(
                        "UPDATE app_alerts SET status='resolved', resolved_at=datetime('now') WHERE id=?",
                        (_active["unhealthy"],)
                    )
            elif health == "degraded":
                if "unhealthy" not in _active:
                    await db.execute(
                        "INSERT INTO app_alerts (app_id, app_name, event_type) VALUES (?, ?, 'unhealthy')",
                        (app_id, app_name)
                    )
                if "connection_lost" in _active:
                    await db.execute(
                        "UPDATE app_alerts SET status='resolved', resolved_at=datetime('now') WHERE id=?",
                        (_active["connection_lost"],)
                    )
            elif health == "healthy":
                for _etype, _aid in _active.items():
                    if _etype in ("connection_lost", "unhealthy"):
                        await db.execute(
                            "UPDATE app_alerts SET status='resolved', resolved_at=datetime('now') WHERE id=?",
                            (_aid,)
                        )

            # Token mismatch alerts
            if token_ok is False:
                if "token_mismatch" not in _active:
                    await db.execute(
                        "INSERT INTO app_alerts (app_id, app_name, event_type) VALUES (?, ?, 'token_mismatch')",
                        (app_id, app_name)
                    )
            elif token_ok is True:
                if "token_mismatch" in _active:
                    await db.execute(
                        "UPDATE app_alerts SET status='resolved', resolved_at=datetime('now') WHERE id=?",
                        (_active["token_mismatch"],)
                    )
        except Exception:
            pass  # alert table may not exist on older DBs yet — migration will fix on restart

        await db.commit()


@router.post("/{app_id}/direct-access", response_model=dict)
async def set_direct_access(
    app_id: int,
    body: DirectAccessRequest,
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Send lock/unlock command to app via suite token. Verifies state after."""
    async with db.execute("SELECT * FROM registered_apps WHERE id = ?", (app_id,)) as cur:
        app = await cur.fetchone()
    if not app:
        raise HTTPException(status_code=404, detail="App not found")
    base_url   = app["base_url"].rstrip("/")
    suite_token = decrypt_str(app["suite_token"])

    if body.locked:
        # Pre-flight: confirm app has hub_redirect_url set
        try:
            async with httpx.AsyncClient(verify=False, timeout=8) as client:
                chk = await client.get(f"{base_url}/api/suite/direct-access",
                    headers={"X-Suite-Token": suite_token, "X-Suite-Version": str(SUITE_VERSION)})
            if chk.status_code != 200:
                raise HTTPException(status_code=503, detail="Cannot reach app to verify redirect URL")
            app_state   = chk.json()
            redirect_url = app_state.get("hub_redirect_url", "")
            if not redirect_url:
                raise HTTPException(status_code=400,
                    detail="hub_redirect_url is not set on the app. Set it in the app Settings → Integrations → pktHub Integration before enabling Managed mode.")
            # Pre-flight: test redirect URL is reachable
            try:
                async with httpx.AsyncClient(verify=False, timeout=6) as hc:
                    pr = await hc.get(redirect_url)
                if pr.status_code >= 500:
                    raise HTTPException(status_code=400, detail=f"Redirect URL returned HTTP {pr.status_code}.")
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(status_code=400,
                    detail=f"Redirect URL '{redirect_url}' is not reachable. Verify the URL before enabling Managed mode.")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=503, detail=f"Cannot reach app: {e}")

    # Send lock command
    try:
        async with httpx.AsyncClient(verify=False, timeout=10) as client:
            resp = await client.post(f"{base_url}/api/suite/direct-access",
                json={"locked": body.locked},
                headers={"X-Suite-Token": suite_token, "X-Suite-Version": str(SUITE_VERSION)})
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"App returned HTTP {resp.status_code}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Could not reach app: {e}")

    # Verify
    verified = False
    try:
        async with httpx.AsyncClient(verify=False, timeout=8) as client:
            vr = await client.get(f"{base_url}/api/suite/direct-access",
                headers={"X-Suite-Token": suite_token, "X-Suite-Version": str(SUITE_VERSION)})
        if vr.status_code == 200:
            verified = vr.json().get("direct_ui_locked") == body.locked
    except Exception:
        pass

    if not verified:
        raise HTTPException(status_code=502,
            detail="Lock command sent but state could not be verified on the app.")

    new_mode = "managed" if body.locked else "direct"
    await db.execute(
        "UPDATE registered_apps SET access_mode = ?, lock_verified_at = datetime('now') WHERE id = ?",
        (new_mode, app_id))
    await db.commit()
    await write_audit(db, current_user, "app.direct_access_change", f"app:{app['name']}",
                      {"locked": body.locked, "access_mode": new_mode})
    async with db.execute("SELECT * FROM registered_apps WHERE id = ?", (app_id,)) as cur:
        row = await cur.fetchone()
    return {"status": "ok", "direct_ui_locked": body.locked, "verified": True,
            "access_mode": new_mode, "app": _parse_app(row).model_dump()}


@router.post("/direct-access/bulk", response_model=dict)
async def bulk_direct_access(
    body: DirectAccessRequest,
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Set all registered apps to managed or direct mode (best-effort)."""
    async with db.execute("SELECT * FROM registered_apps ORDER BY registered_at") as cur:
        apps = await cur.fetchall()
    results = []
    for app in apps:
        ok = False
        try:
            async with httpx.AsyncClient(verify=False, timeout=10) as client:
                r = await client.post(f"{app['base_url'].rstrip('/')}/api/suite/direct-access",
                    json={"locked": body.locked},
                    headers={"X-Suite-Token": decrypt_str(app["suite_token"]), "X-Suite-Version": str(SUITE_VERSION)})
            ok = r.status_code == 200
        except Exception:
            pass
        if ok:
            new_mode = "managed" if body.locked else "direct"
            await db.execute(
                "UPDATE registered_apps SET access_mode = ?, lock_verified_at = datetime('now') WHERE id = ?",
                (new_mode, app["id"]))
        results.append({"app_id": app["id"], "name": app["name"], "success": ok})
    await db.commit()
    await write_audit(db, current_user, "app.bulk_direct_access_change", "all_apps",
                      {"locked": body.locked, "results": results})
    return {"results": results}


@router.get("/{app_id}/access-log", response_model=list)
async def get_app_access_log(
    app_id: int,
    limit: int = 20,
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Recent direct-access audit events for a specific app."""
    import json as _j
    async with db.execute("SELECT name FROM registered_apps WHERE id = ?", (app_id,)) as cur:
        app = await cur.fetchone()
    if not app:
        raise HTTPException(status_code=404, detail="App not found")
    async with db.execute(
        """SELECT * FROM audit_log
           WHERE (action LIKE 'app.direct_access%' OR action = 'app.lock_drift_detected')
             AND (resource LIKE ? OR resource LIKE ?)
           ORDER BY timestamp DESC LIMIT ?""",
        (f"app:{app['name']}%", f"app_id:{app_id}", limit)
    ) as cur:
        rows = await cur.fetchall()
    return [{"id": r["id"], "username": r["username"], "action": r["action"],
             "details": _j.loads(r["details"] or "{}"), "timestamp": r["timestamp"]}
            for r in rows]
