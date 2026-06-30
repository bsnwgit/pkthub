from fastapi import APIRouter, Depends, HTTPException
import aiosqlite
from app.database import get_db
from app.auth import get_current_user, require_admin, hash_password, verify_password
from app.models import UserCreate, UserUpdate, UserOut, PasswordChange
from typing import List

router = APIRouter(prefix="/api/users", tags=["users"])

@router.get("", response_model=List[UserOut])
async def list_users(
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    async with db.execute("SELECT * FROM users ORDER BY created_at DESC") as cur:
        rows = await cur.fetchall()
    return [UserOut(
        id=r["id"], username=r["username"], email=r["email"],
        role=r["role"], is_active=bool(r["is_active"]),
        created_at=r["created_at"], last_login=r.get("last_login")
    ) for r in rows]

@router.post("", response_model=UserOut, status_code=201)
async def create_user(
    body: UserCreate,
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    hashed = hash_password(body.password)
    try:
        cur = await db.execute(
            "INSERT INTO users (username, email, hashed_password, role) VALUES (?, ?, ?, ?) RETURNING *",
            (body.username, body.email, hashed, body.role)
        )
        row = await cur.fetchone()
        await db.commit()
    except aiosqlite.IntegrityError:
        raise HTTPException(status_code=409, detail="Username or email already exists")
    return UserOut(id=row["id"], username=row["username"], email=row["email"],
                   role=row["role"], is_active=bool(row["is_active"]), created_at=row["created_at"])

@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: int,
    body: UserUpdate,
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    updates = {}
    if body.email is not None: updates["email"] = body.email
    if body.role is not None: updates["role"] = body.role
    if body.is_active is not None: updates["is_active"] = 1 if body.is_active else 0
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [user_id]
    await db.execute(f"UPDATE users SET {set_clause} WHERE id = ?", values)
    await db.commit()

    async with db.execute("SELECT * FROM users WHERE id = ?", (user_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return UserOut(id=row["id"], username=row["username"], email=row["email"],
                   role=row["role"], is_active=bool(row["is_active"]),
                   created_at=row["created_at"], last_login=row.get("last_login"))

@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: int,
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db)
):
    if user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    await db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    await db.commit()

@router.post("/me/password", status_code=204)
async def change_password(
    body: PasswordChange,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db)
):
    if not verify_password(body.current_password, current_user["hashed_password"]):
        raise HTTPException(status_code=400, detail="Current password incorrect")
    hashed = hash_password(body.new_password)
    await db.execute("UPDATE users SET hashed_password = ? WHERE id = ?", (hashed, current_user["id"]))
    await db.commit()
