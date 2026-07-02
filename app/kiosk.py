from fastapi import APIRouter, Depends, HTTPException
import aiosqlite
import json
import secrets
from typing import List
from app.database import get_db
from app.auth import get_current_user, require_admin, require_analyst_or_admin
from app.models import KioskCreate, KioskUpdate, KioskOut

router = APIRouter(prefix="/api/kiosks", tags=["kiosk"])

def _parse_kiosk(row) -> KioskOut:
    return KioskOut(
        id=row["id"], name=row["name"], description=row["description"] or "",
        layout=json.loads(row["layout"] or "[]"),
        display_mode=row["display_mode"], dwell_seconds=row["dwell_seconds"],
        display_token=row["display_token"], is_published=bool(row["is_published"]),
        published_at=row["published_at"],
        created_at=row["created_at"], updated_at=row["updated_at"]
    )

@router.get("", response_model=List[KioskOut])
async def list_kiosks(
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db)
):
    async with db.execute("SELECT * FROM kiosk_layouts ORDER BY created_at DESC") as cur:
        rows = await cur.fetchall()
    return [_parse_kiosk(r) for r in rows]

@router.post("", response_model=KioskOut, status_code=201)
async def create_kiosk(
    body: KioskCreate,
    current_user: dict = Depends(require_analyst_or_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    cur = await db.execute(
        """INSERT INTO kiosk_layouts (name, description, layout, display_mode, dwell_seconds, created_by)
           VALUES (?, ?, ?, ?, ?, ?) RETURNING *""",
        (body.name, body.description, json.dumps(body.layout),
         body.display_mode, body.dwell_seconds, current_user["id"])
    )
    row = await cur.fetchone()
    await db.commit()
    return _parse_kiosk(row)

@router.get("/{kiosk_id}", response_model=KioskOut)
async def get_kiosk(
    kiosk_id: int,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db)
):
    async with db.execute("SELECT * FROM kiosk_layouts WHERE id = ?", (kiosk_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Kiosk not found")
    return _parse_kiosk(row)

@router.patch("/{kiosk_id}", response_model=KioskOut)
async def update_kiosk(
    kiosk_id: int,
    body: KioskUpdate,
    current_user: dict = Depends(require_analyst_or_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    updates = {}
    if body.name is not None: updates["name"] = body.name
    if body.description is not None: updates["description"] = body.description
    if body.layout is not None: updates["layout"] = json.dumps(body.layout)
    if body.display_mode is not None: updates["display_mode"] = body.display_mode
    if body.dwell_seconds is not None: updates["dwell_seconds"] = body.dwell_seconds
    updates["updated_at"] = "datetime('now')"

    set_parts = [f"{k} = ?" if k != "updated_at" else f"{k} = datetime('now')" for k in updates]
    vals = [v for k, v in updates.items() if k != "updated_at"] + [kiosk_id]
    await db.execute(f"UPDATE kiosk_layouts SET {', '.join(set_parts)} WHERE id = ?", vals)
    await db.commit()

    async with db.execute("SELECT * FROM kiosk_layouts WHERE id = ?", (kiosk_id,)) as cur:
        row = await cur.fetchone()
    return _parse_kiosk(row)

@router.delete("/{kiosk_id}", status_code=204)
async def delete_kiosk(
    kiosk_id: int,
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    await db.execute("DELETE FROM kiosk_layouts WHERE id = ?", (kiosk_id,))
    await db.commit()

@router.post("/{kiosk_id}/publish", response_model=KioskOut)
async def publish_kiosk(
    kiosk_id: int,
    current_user: dict = Depends(require_analyst_or_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    token = secrets.token_urlsafe(24)
    await db.execute(
        """UPDATE kiosk_layouts SET is_published = 1, display_token = ?,
           published_at = datetime('now') WHERE id = ?""",
        (token, kiosk_id)
    )
    await db.commit()
    async with db.execute("SELECT * FROM kiosk_layouts WHERE id = ?", (kiosk_id,)) as cur:
        row = await cur.fetchone()
    return _parse_kiosk(row)

@router.post("/{kiosk_id}/unpublish", response_model=KioskOut)
async def unpublish_kiosk(
    kiosk_id: int,
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    await db.execute(
        "UPDATE kiosk_layouts SET is_published = 0, display_token = NULL WHERE id = ?",
        (kiosk_id,)
    )
    await db.commit()
    async with db.execute("SELECT * FROM kiosk_layouts WHERE id = ?", (kiosk_id,)) as cur:
        row = await cur.fetchone()
    return _parse_kiosk(row)

# Public display endpoint — no auth, uses signed token
@router.get("/display/{token}", response_model=KioskOut)
async def display_kiosk(token: str, db: aiosqlite.Connection = Depends(get_db)):
    async with db.execute(
        "SELECT * FROM kiosk_layouts WHERE display_token = ? AND is_published = 1", (token,)
    ) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Kiosk not found or not published")
    return _parse_kiosk(row)
