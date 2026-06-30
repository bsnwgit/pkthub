from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
import aiosqlite
import json

from app.config import get_settings
from app.database import get_db
from app.models import LoginRequest, TokenResponse, TokenData, UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    settings = get_settings()
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=settings.jwt_expire_minutes))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.jwt_secret, algorithm=settings.jwt_algorithm)

async def get_current_user(token: str = Depends(oauth2_scheme), db: aiosqlite.Connection = Depends(get_db)) -> dict:
    settings = get_settings()
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    async with db.execute("SELECT * FROM users WHERE username = ? AND is_active = 1", (username,)) as cur:
        row = await cur.fetchone()
    if row is None:
        raise credentials_exception
    return dict(row)

def require_role(*roles):
    async def check(current_user: dict = Depends(get_current_user)):
        if current_user["role"] not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return current_user
    return check

require_admin = require_role("admin")
require_analyst_or_admin = require_role("admin", "analyst")

@router.post("/login", response_model=TokenResponse)
async def login(request: LoginRequest, db: aiosqlite.Connection = Depends(get_db)):
    async with db.execute("SELECT * FROM users WHERE username = ? AND is_active = 1", (request.username,)) as cur:
        user = await cur.fetchone()

    if not user or not verify_password(request.password, user["hashed_password"]):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    token = create_access_token({"sub": user["username"], "role": user["role"], "uid": user["id"]})
    await db.execute("UPDATE users SET last_login = datetime('now') WHERE id = ?", (user["id"],))
    await db.commit()

    return TokenResponse(access_token=token, role=user["role"], username=user["username"])

@router.get("/me", response_model=UserOut)
async def get_me(current_user: dict = Depends(get_current_user)):
    return UserOut(
        id=current_user["id"],
        username=current_user["username"],
        email=current_user["email"],
        role=current_user["role"],
        is_active=bool(current_user["is_active"]),
        created_at=current_user["created_at"],
        last_login=current_user.get("last_login"),
    )

@router.post("/logout")
async def logout():
    # JWT is stateless — client discards the token
    return {"message": "Logged out"}

async def ensure_initial_admin(db: aiosqlite.Connection):
    """Create default admin user on first boot if no users exist."""
    settings = get_settings()
    async with db.execute("SELECT COUNT(*) as count FROM users") as cur:
        row = await cur.fetchone()
    if row["count"] == 0:
        hashed = hash_password(settings.initial_admin_password)
        await db.execute(
            "INSERT INTO users (username, email, hashed_password, role) VALUES (?, ?, ?, 'admin')",
            (settings.initial_admin_username, settings.initial_admin_email, hashed)
        )
        await db.commit()
