from fastapi import APIRouter, Depends, HTTPException
from typing import List
import aiosqlite

from app.database import get_db
from app.auth import require_admin
from app.models import AlertRuleCreate, AlertRuleUpdate, AlertRuleOut

router = APIRouter(prefix="/api/alert-rules", tags=["alert-rules"])

def _parse_rule(row) -> AlertRuleOut:
    return AlertRuleOut(
        id=row["id"],
        name=row["name"],
        event_type=row["event_type"],
        severity=row["severity"],
        description=row["description"] or "",
        enabled=bool(row["enabled"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )

@router.get("", response_model=List[AlertRuleOut])
async def list_rules(
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db),
):
    async with db.execute("SELECT * FROM alert_rules ORDER BY id") as cur:
        rows = await cur.fetchall()
    return [_parse_rule(r) for r in rows]

@router.post("", response_model=AlertRuleOut, status_code=201)
async def create_rule(
    body: AlertRuleCreate,
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db),
):
    cur = await db.execute(
        """INSERT INTO alert_rules (name, event_type, severity, description, enabled)
           VALUES (?, ?, ?, ?, ?) RETURNING *""",
        (body.name, body.event_type, body.severity, body.description, 1 if body.enabled else 0),
    )
    row = await cur.fetchone()
    await db.commit()
    return _parse_rule(row)

@router.patch("/{rule_id}", response_model=AlertRuleOut)
async def update_rule(
    rule_id: int,
    body: AlertRuleUpdate,
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db),
):
    updates: dict = {}
    if body.name        is not None: updates["name"]        = body.name
    if body.event_type  is not None: updates["event_type"]  = body.event_type
    if body.severity    is not None: updates["severity"]    = body.severity
    if body.description is not None: updates["description"] = body.description
    if body.enabled     is not None: updates["enabled"]     = 1 if body.enabled else 0
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    updates["updated_at"] = "datetime('now')"
    set_parts = []
    values = []
    for k, v in updates.items():
        if k == "updated_at":
            set_parts.append(f"{k} = datetime('now')")
        else:
            set_parts.append(f"{k} = ?")
            values.append(v)
    values.append(rule_id)
    await db.execute(f"UPDATE alert_rules SET {', '.join(set_parts)} WHERE id = ?", values)
    await db.commit()

    async with db.execute("SELECT * FROM alert_rules WHERE id = ?", (rule_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Rule not found")
    return _parse_rule(row)

@router.delete("/{rule_id}", status_code=204)
async def delete_rule(
    rule_id: int,
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db),
):
    await db.execute("DELETE FROM alert_rules WHERE id = ?", (rule_id,))
    await db.commit()
