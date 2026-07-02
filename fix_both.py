import paramiko, io, sys
sys.stdout.reconfigure(encoding='utf-8')

PKTFLOW_SUITE_TOKEN = "MohVa4VeScgGwJ2POwrCyqR43Y7OMo7qpv6dXJ9x7uU"

key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)
sftp = c.open_sftp()

# ── Fix 1: pktLog main.py — add Request to import ────────────────────────────
print("=== Fixing pktLog main.py ===")
with sftp.open('/mnt/software/pktlog/app/main.py', 'r') as f:
    txt = f.read().decode('utf-8')

# Fix the import
txt = txt.replace(
    'from fastapi import FastAPI, HTTPException\n',
    'from fastapi import FastAPI, HTTPException, Request\n'
)
# Remove the spurious inner import (confusing, causes issues)
txt = txt.replace(
    '        from fastapi import Request as _Req  # already imported above, here for clarity\n',
    ''
)

sftp.putfo(io.BytesIO(txt.encode('utf-8')), '/mnt/software/pktlog/app/main.py')
print("  ✓ pktLog main.py fixed — Request now imported at top level")

# Verify
_, o, _ = c.exec_command('grep -n "from fastapi import" /mnt/software/pktlog/app/main.py | head -5')
print("  imports:", o.read().decode().strip())

# ── Fix 2: pktFlow — full suite token implementation ─────────────────────────
print("\n=== Patching pktFlow ===")

# 2a. config.yaml
with sftp.open('/mnt/software/pktflow/config.yaml', 'r') as f:
    cfg = f.read().decode('utf-8')
if 'suite_token' not in cfg:
    cfg += f'\n# pktSuite integration\nsuite_token: "{PKTFLOW_SUITE_TOKEN}"\n'
    sftp.putfo(io.BytesIO(cfg.encode('utf-8')), '/mnt/software/pktflow/config.yaml')
    print("  ✓ pktFlow config.yaml — suite_token added")
else:
    print("  ✓ pktFlow config.yaml already has suite_token")

# 2b. config.py — add suite_token field
with sftp.open('/mnt/software/pktflow/app/config.py', 'r') as f:
    cfg_py = f.read().decode('utf-8')
if 'suite_token' not in cfg_py:
    # Insert before the logging section (common marker)
    for marker in ['    # ── Logging', '    # ── log', '    log_level']:
        if marker in cfg_py:
            cfg_py = cfg_py.replace(marker,
                '    # ── pktSuite integration ─────────────────────────────────────────────────\n'
                '    suite_token: str = Field(default=_yaml_cfg.get("suite_token", ""))\n\n'
                + marker, 1)
            break
    sftp.putfo(io.BytesIO(cfg_py.encode('utf-8')), '/mnt/software/pktflow/app/config.py')
    print("  ✓ pktFlow config.py — suite_token field added")
else:
    print("  ✓ pktFlow config.py already has suite_token")

# 2c. dependencies.py — add X-Suite-Token auth path
with sftp.open('/mnt/software/pktflow/app/dependencies.py', 'r') as f:
    deps = f.read().decode('utf-8')

if 'X-Suite-Token' not in deps:
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

DbDep = Annotated[aiosqlite.Connection, Depends(get_db)]

_bearer = HTTPBearer(auto_error=False)

_SUITE_ROLE_MAP = {
    "admin":   "admin",
    "analyst": "analyst",
    "viewer":  "viewer",
}


async def get_current_user(
    request: Request,
    db: DbDep,
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Security(_bearer)] = None,
) -> dict:
    """
    Auth path 1: X-Suite-Token from pktHub proxy — trust X-Suite-User/Role headers.
    Auth path 2: Authorization: Bearer JWT — normal pktFlow local auth.
    """
    settings = get_settings()
    suite_token = request.headers.get("x-suite-token", "")
    if suite_token and settings.suite_token and suite_token == settings.suite_token:
        hub_user = request.headers.get("x-suite-user", "hub_user")
        hub_role = request.headers.get("x-suite-role", "viewer")
        local_role = _SUITE_ROLE_MAP.get(hub_role, "viewer")
        return {
            "id": 0,
            "username": hub_user,
            "email": f"{hub_user}@pkthub",
            "role": local_role,
            "is_active": True,
            "created_at": "2020-01-01 00:00:00",
            "last_login": None,
            "_via_suite": True,
        }

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


CurrentUser  = Annotated[dict, Depends(get_current_user)]
AdminUser    = Annotated[dict, Depends(require_admin)]
AnalystUser  = Annotated[dict, Depends(require_analyst)]
'''
    sftp.putfo(io.BytesIO(new_deps.encode('utf-8')), '/mnt/software/pktflow/app/dependencies.py')
    print("  ✓ pktFlow dependencies.py — X-Suite-Token auth added")
else:
    print("  ✓ pktFlow dependencies.py already patched")

# 2d. main.py — SPA route sets sso cookies
with sftp.open('/mnt/software/pktflow/app/main.py', 'r') as f:
    main = f.read().decode('utf-8')

print("  pktFlow main.py has Request import:", 'Request' in main)

if 'x-suite-token' not in main.lower():
    # Add Request to fastapi import
    for old_imp in [
        'from fastapi import FastAPI, HTTPException\n',
        'from fastapi import FastAPI, HTTPException, Response\n',
    ]:
        if old_imp in main:
            main = main.replace(old_imp, old_imp.rstrip('\n').rstrip() + ', Request\n')
            break
    else:
        # Insert after first 'from fastapi import' line
        lines = main.split('\n')
        for i, line in enumerate(lines):
            if line.startswith('from fastapi import') and 'Request' not in line:
                lines[i] = line.rstrip(', ') + ', Request'
                break
        main = '\n'.join(lines)

    # Find the SPA catch-all pattern and patch it
    # Common patterns across pktLog/pktFlow siblings
    old_patterns = [
        # Pattern A: serve_spa(full_path)
        '    @app.get("/{full_path:path}", include_in_schema=False)\n    async def serve_spa(full_path: str):\n        if full_path.startswith("api/"):\n            raise HTTPException(status_code=404, detail="Not found")\n        index = _frontend_dist / "index.html"\n        return FileResponse(str(index))',
        # Pattern B without the indent
        '@app.get("/{full_path:path}", include_in_schema=False)\nasync def serve_spa(full_path: str):\n    if full_path.startswith("api/"):\n        raise HTTPException(status_code=404, detail="Not found")\n    index = _frontend_dist / "index.html"\n    return FileResponse(str(index))',
    ]

    SUITE_INJECT = '''
        # pktHub suite-token bootstrap — set sso cookies so React logs in automatically
        _cfg = settings
        _suite_tk = request.headers.get("x-suite-token", "")
        if _suite_tk and _cfg.suite_token and _suite_tk == _cfg.suite_token:
            from datetime import datetime, timedelta, timezone
            from jose import jwt as _jose_jwt
            from app.dependencies import _SUITE_ROLE_MAP
            _hub_user = request.headers.get("x-suite-user", "hub_user")
            _hub_role = request.headers.get("x-suite-role", "viewer")
            _local_role = _SUITE_ROLE_MAP.get(_hub_role, "viewer")
            _expire = datetime.now(tz=timezone.utc) + timedelta(hours=8)
            _payload = {"sub": "0", "role": _local_role, "exp": _expire, "type": "access"}
            _jwt = _jose_jwt.encode(_payload, _cfg.secret_key, algorithm=_cfg.algorithm)
            response.set_cookie("sso_access_token", _jwt,       max_age=60, httponly=False, samesite="lax")
            response.set_cookie("sso_role",         _local_role, max_age=60, httponly=False, samesite="lax")
        return response'''

    patched = False
    for pat in old_patterns:
        if pat in main:
            indent = '    ' if pat.startswith('    ') else ''
            new_route = pat.replace(
                'async def serve_spa(full_path: str):',
                'async def serve_spa(request: Request, full_path: str):'
            ).replace(
                f'{indent}        return FileResponse(str(index))',
                f'{indent}        response = FileResponse(str(index))\n{SUITE_INJECT}'
            )
            main = main.replace(pat, new_route)
            patched = True
            break

    if patched:
        sftp.putfo(io.BytesIO(main.encode('utf-8')), '/mnt/software/pktflow/app/main.py')
        print("  ✓ pktFlow main.py — SPA route patched")
    else:
        print("  ⚠ Could not find SPA catch-all in pktFlow main.py — printing it:")
        _, o, _ = c.exec_command('grep -n "serve_spa\|full_path\|FileResponse" /mnt/software/pktflow/app/main.py | head -20')
        print(o.read().decode('utf-8'))
else:
    print("  ✓ pktFlow main.py already patched")

sftp.close()

# ── Restart both ──────────────────────────────────────────────────────────────
print("\nRestarting services...")
_, o, _ = c.exec_command('sudo systemctl restart pktlog pktflow && sleep 4 && sudo systemctl is-active pktlog pktflow')
print(o.read().decode('utf-8').strip())

c.close()
print("\nDone.")
