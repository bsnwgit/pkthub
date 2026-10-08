"""
pktHub — App Alert Log API
Tracks connection-lost and unhealthy events from registered pktApps.
"""
from fastapi import APIRouter, Depends, Query, HTTPException
from typing import Optional
import aiosqlite

from app.database import get_db
from app.auth import get_current_user

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.get("")
async def list_active_alerts(
    db: aiosqlite.Connection = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """All unacked alerts (active or resolved-but-not-yet-acked)."""
    async with db.execute(
        """SELECT id, app_id, app_name, event_type, status,
                  resolved_at, acked_by, acked_at, created_at, details
           FROM app_alerts
           WHERE acked_at IS NULL
           ORDER BY created_at DESC
           LIMIT 200"""
    ) as cur:
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


@router.get("/history")
async def alert_history(
    app_id: Optional[int] = Query(None),
    event_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    limit: int = Query(500, le=2000),
    db: aiosqlite.Connection = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Full alert history with optional filters."""
    clauses: list = []
    params: list = []

    if app_id is not None:
        clauses.append("app_id = ?")
        params.append(app_id)
    if event_type:
        clauses.append("event_type = ?")
        params.append(event_type)
    if status:
        clauses.append("status = ?")
        params.append(status)
    if start:
        clauses.append("created_at >= ?")
        params.append(start)
    if end:
        clauses.append("created_at <= ?")
        params.append(end)

    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    params.append(limit)

    async with db.execute(
        f"""SELECT id, app_id, app_name, event_type, status,
                   resolved_at, acked_by, acked_at, created_at, details
            FROM app_alerts {where}
            ORDER BY created_at DESC
            LIMIT ?""",
        params,
    ) as cur:
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


@router.post("/{alert_id}/ack")
async def ack_alert(
    alert_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Acknowledge (archive) an alert — removes it from the active view."""
    async with db.execute("SELECT id FROM app_alerts WHERE id = ?", (alert_id,)) as cur:
        if not await cur.fetchone():
            raise HTTPException(status_code=404, detail="Alert not found")
    await db.execute(
        """UPDATE app_alerts
           SET acked_by = ?, acked_at = datetime('now')
           WHERE id = ? AND acked_at IS NULL""",
        (current_user.get("username", "unknown"), alert_id),
    )
    await db.commit()
    return {"ok": True}
