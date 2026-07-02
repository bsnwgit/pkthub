"""
Patches pktLog on the remote server to accept X-Suite-Token from pktHub.

Changes:
  1. config.yaml  — add suite_token field
  2. config.py    — add suite_token to Settings class
  3. dependencies.py — check X-Suite-Token header before requiring own JWT
  4. Restart pktlog service
"""
import paramiko, io, sys
sys.stdout.reconfigure(encoding='utf-8')

SUITE_TOKEN = "cGJwcEZ6-14lytdWwVit-MPubqCt5-RAtmjWhAtP5zc"

key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)

sftp = c.open_sftp()

# ── 1. Patch config.yaml ─────────────────────────────────────────────────────
print("Reading config.yaml...")
with sftp.open('/mnt/software/pktlog/config.yaml', 'r') as f:
    config_yaml = f.read().decode('utf-8')

if 'suite_token' not in config_yaml:
    config_yaml += f'\n# ── pktSuite integration ─────────────────────────────────────────────────────\nsuite_token: "{SUITE_TOKEN}"\n'
    sftp.putfo(io.BytesIO(config_yaml.encode('utf-8')), '/mnt/software/pktlog/config.yaml')
    print("  ✓ config.yaml updated")
else:
    print("  ✓ config.yaml already has suite_token")

# ── 2. Patch config.py ───────────────────────────────────────────────────────
print("Reading config.py...")
with sftp.open('/mnt/software/pktlog/app/config.py', 'r') as f:
    config_py = f.read().decode('utf-8')

if 'suite_token' not in config_py:
    # Add suite_token field after cors_origins block
    old = '    # ── Logging ───────────────────────────────────────────────────────────────'
    new = (
        '    # ── pktSuite integration ─────────────────────────────────────────────────\n'
        '    # Token must match the suite_token registered in pktHub App Registry.\n'
        '    # Leave blank to disable suite token auth.\n'
        '    suite_token: str = Field(default=_yaml_cfg.get("suite_token", ""))\n'
        '\n'
        '    # ── Logging ───────────────────────────────────────────────────────────────'
    )
    if old in config_py:
        config_py = config_py.replace(old, new)
        sftp.putfo(io.BytesIO(config_py.encode('utf-8')), '/mnt/software/pktlog/app/config.py')
        print("  ✓ config.py updated")
    else:
        print("  ⚠ Could not find insertion point in config.py — manual edit needed")
else:
    print("  ✓ config.py already has suite_token")

# ── 3. Patch dependencies.py ─────────────────────────────────────────────────
print("Reading dependencies.py...")
with sftp.open('/mnt/software/pktlog/app/dependencies.py', 'r') as f:
    deps_py = f.read().decode('utf-8')

if 'X-Suite-Token' not in deps_py:
    new_deps = '''\"""
FastAPI dependency injection helpers.
\"""
from __future__ import annotations

from typing import Annotated, Optional

import aiosqlite
from fastapi import Depends, HTTPException, Request, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.database import get_db
from app.auth.local import decode_access_token
from app.config import get_settings

# ── Database ──────────────────────────────────────────────────────────────────

DbDep = Annotated[aiosqlite.Connection, Depends(get_db)]

# ── Auth ─────────────────────────────────────────────────────────────────────

_bearer = HTTPBearer(auto_error=False)

# Role mapping from pktHub roles to pktLog roles
_SUITE_ROLE_MAP = {
    "admin":   "admin",
    "analyst": "analyst",
    "viewer":  "analyst",   # pktLog has no viewer role; map to analyst (read-only feels)
}


async def get_current_user(
    request: Request,
    db: DbDep,
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Security(_bearer)] = None,
) -> dict:
    """
    Validates authentication.  Two accepted paths:

    1. X-Suite-Token header — sent by pktHub proxy on every proxied request.
       If the token matches our configured suite_token, we trust pktHub's
       X-Suite-User and X-Suite-Role headers and return a synthetic user dict.
       No DB lookup needed — pktHub already authenticated the user.

    2. Authorization: Bearer <jwt> — normal pktLog JWT issued at login.
       Validates against our own secret_key and looks up the user in DB.
    """
    settings = get_settings()

    # ── Path 1: pktHub suite token ────────────────────────────────────────────
    suite_token = request.headers.get("x-suite-token", "")
    if suite_token and settings.suite_token and suite_token == settings.suite_token:
        hub_user = request.headers.get("x-suite-user", "hub_user")
        hub_role = request.headers.get("x-suite-role", "viewer")
        local_role = _SUITE_ROLE_MAP.get(hub_role, "analyst")
        return {
            "id": 0,
            "username": hub_user,
            "email": f"{hub_user}@pkthub",
            "role": local_role,
            "is_active": True,
            "created_at": None,
            "last_login": None,
            "_via_suite": True,
        }

    # ── Path 2: pktLog JWT ────────────────────────────────────────────────────
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    payload = decode_access_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    async with db.execute(
        "SELECT id, username, email, role, is_active, created_at, last_login FROM users WHERE id = ?",
        (payload["sub"],),
    ) as cur:
        user = await cur.fetchone()

    if not user or not user["is_active"]:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    return dict(user)


async def require_admin(user: Annotated[dict, Depends(get_current_user)]) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return user


async def require_analyst(user: Annotated[dict, Depends(get_current_user)]) -> dict:
    if user["role"] not in ("admin", "analyst"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Analyst role or higher required")
    return user


# Type aliases for route signatures
CurrentUser = Annotated[dict, Depends(get_current_user)]
AdminUser = Annotated[dict, Depends(require_admin)]
AnalystUser = Annotated[dict, Depends(require_analyst)]
'''
    sftp.putfo(io.BytesIO(new_deps.encode('utf-8')), '/mnt/software/pktlog/app/dependencies.py')
    print("  ✓ dependencies.py updated with X-Suite-Token support")
else:
    print("  ✓ dependencies.py already has X-Suite-Token support")

sftp.close()

# ── 4. Restart pktLog ─────────────────────────────────────────────────────────
print("Restarting pktlog service...")
_, o, e = c.exec_command('sudo systemctl restart pktlog && sleep 3 && sudo systemctl is-active pktlog')
stdout = o.read().decode('utf-8', errors='replace').strip()
stderr = e.read().decode('utf-8', errors='replace').strip()
print(f"  Service status: {stdout}")
if stderr:
    print(f"  stderr: {stderr}")

c.close()
print("\nDone. pktLog should now accept X-Suite-Token from pktHub.")
