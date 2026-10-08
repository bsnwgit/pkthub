from fastapi import APIRouter, Depends, Query
import aiosqlite
import json
from typing import List, Optional
from app.database import get_db
from app.auth import get_current_user, require_admin
from app.models import AuditEntry

router = APIRouter(prefix="/api/audit", tags=["audit"])

async def write_audit(db: aiosqlite.Connection, user: dict, action: str, resource: str, details: dict, ip: str = None):
    await db.execute(
        """INSERT INTO audit_log (user_id, username, action, resource, details, ip_address)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (user.get("id"), user.get("username"), action, resource, json.dumps(details), ip)
    )
    await db.commit()

@router.get("", response_model=List[AuditEntry])
async def get_audit_log(
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    action: Optional[str] = None,
    username: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db)
):
    # Analysts see only their own entries
    if current_user["role"] == "analyst":
        username = current_user["username"]

    query = "SELECT * FROM audit_log WHERE 1=1"
    params = []
    if action:
        query += " AND action LIKE ?"
        params.append(f"%{action}%")
    if username:
        query += " AND username = ?"
        params.append(username)
    query += " ORDER BY timestamp DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    async with db.execute(query, params) as cur:
        rows = await cur.fetchall()

    return [AuditEntry(
        id=r["id"], user_id=r["user_id"], username=r["username"],
        action=r["action"], resource=r["resource"],
        details=json.loads(r["details"] or "{}"),
        ip_address=r["ip_address"], timestamp=r["timestamp"]
    ) for r in rows]
