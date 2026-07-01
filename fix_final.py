import paramiko, io, sys
sys.stdout.reconfigure(encoding='utf-8')

PKTSNMP_SUITE_TOKEN = "SNMPsuite-placeholder-needsregistration"

key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)
sftp = c.open_sftp()

SUITE_BODY = """\
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
        return response
"""

def patch_main_spa(sftp, path, settings_varname="settings"):
    """Read main.py and patch serve_spa to inject sso cookies on suite token."""
    with sftp.open(path, 'r') as f:
        txt = f.read().decode('utf-8')

    if 'x-suite-token' in txt.lower():
        print(f"  already patched: {path}")
        return False

    # Ensure Request is imported
    for old_imp in [
        'from fastapi import FastAPI, HTTPException\n',
        'from fastapi import FastAPI, HTTPException, Response\n',
    ]:
        if old_imp in txt and 'Request' not in old_imp:
            txt = txt.replace(old_imp, old_imp.rstrip('\n') + ', Request\n')
            break

    # Find and rewrite serve_spa — replace the final `return FileResponse(str(index))`
    # inside the function.  We look for the function signature first to confirm context.
    import re
    # Pattern: serve_spa function with any signature, ending in return FileResponse(str(index))
    # Replace the bare `return FileResponse(str(index))` with response = ... + cookie logic
    pattern = re.compile(
        r'(async def serve_spa\([^)]*\):.*?)([ \t]+return FileResponse\(str\(index\)\))',
        re.DOTALL
    )
    def replacer(m):
        head = m.group(1)
        ret_line = m.group(2)
        indent = re.match(r'^([ \t]*)', ret_line).group(1)
        new_ret = (
            f'{indent}response = FileResponse(str(index))\n'
            + '\n'.join(f'{indent}{line}' for line in SUITE_BODY.strip('\n').split('\n'))
        )
        return head + new_ret

    new_txt, count = pattern.subn(replacer, txt)
    if count == 0:
        print(f"  ⚠ could not find serve_spa pattern in {path}")
        return False

    # Ensure serve_spa has request: Request param
    new_txt = re.sub(
        r'async def serve_spa\(full_path:',
        'async def serve_spa(request: Request, full_path:',
        new_txt
    )

    sftp.putfo(io.BytesIO(new_txt.encode('utf-8')), path)
    print(f"  ✓ patched: {path}")
    return True


# ── Fix 1: pktFlow serve_spa body ────────────────────────────────────────────
print("=== pktFlow main.py ===")
patch_main_spa(sftp, '/mnt/software/pktflow/app/main.py')

# ── Fix 2: pktSNMP full suite treatment ──────────────────────────────────────
print("\n=== pktSNMP ===")

# Get the real suite token from DB (pktSNMP may or may not be registered)
remote = b"""
import sqlite3
db = sqlite3.connect("/mnt/software/pkthub/pkthub.db")
db.row_factory = sqlite3.Row
row = db.execute("SELECT suite_token FROM registered_apps WHERE name LIKE '%snmp%' OR name LIKE '%SNMP%'").fetchone()
print(row['suite_token'] if row else 'NOT_REGISTERED')
db.close()
"""
sftp.putfo(io.BytesIO(remote), '/tmp/snmp_token.py')
_, o, _ = c.exec_command('python3 /tmp/snmp_token.py')
snmp_token = o.read().decode('utf-8').strip()
print(f"  pktSNMP suite token from DB: {snmp_token}")

# config.yaml
with sftp.open('/mnt/software/pktsnmp/config.yaml', 'r') as f:
    cfg = f.read().decode('utf-8')
if 'suite_token' not in cfg and snmp_token != 'NOT_REGISTERED':
    cfg += f'\n# pktSuite integration\nsuite_token: "{snmp_token}"\n'
    sftp.putfo(io.BytesIO(cfg.encode('utf-8')), '/mnt/software/pktsnmp/config.yaml')
    print("  ✓ config.yaml updated")
elif snmp_token == 'NOT_REGISTERED':
    print("  ⚠ pktSNMP not in pktHub DB — skipping suite_token config (register it in pktHub first)")
else:
    print("  ✓ config.yaml already has suite_token")

# config.py — add suite_token field if missing
with sftp.open('/mnt/software/pktsnmp/app/config.py', 'r') as f:
    cfg_py = f.read().decode('utf-8')
if 'suite_token' not in cfg_py:
    import re
    cfg_py = re.sub(
        r'(    # ── Logging)',
        '    # ── pktSuite integration ─────────────────────────────────────────────────\n'
        '    suite_token: str = Field(default=_yaml_cfg.get("suite_token", ""))\n\n'
        r'\1',
        cfg_py, count=1
    )
    sftp.putfo(io.BytesIO(cfg_py.encode('utf-8')), '/mnt/software/pktsnmp/app/config.py')
    print("  ✓ config.py — suite_token field added")
else:
    print("  ✓ config.py already has suite_token")

# dependencies.py
with sftp.open('/mnt/software/pktsnmp/app/dependencies.py', 'r') as f:
    deps = f.read().decode('utf-8')
if 'X-Suite-Token' not in deps:
    new_deps = '''\"""FastAPI dependency injection helpers.\"""
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

_SUITE_ROLE_MAP = {"admin": "admin", "analyst": "analyst", "viewer": "viewer"}


async def get_current_user(
    request: Request,
    db: DbDep,
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Security(_bearer)] = None,
) -> dict:
    settings = get_settings()
    suite_token = request.headers.get("x-suite-token", "")
    if suite_token and settings.suite_token and suite_token == settings.suite_token:
        hub_user = request.headers.get("x-suite-user", "hub_user")
        hub_role = request.headers.get("x-suite-role", "viewer")
        local_role = _SUITE_ROLE_MAP.get(hub_role, "viewer")
        return {"id": 0, "username": hub_user, "email": f"{hub_user}@pkthub",
                "role": local_role, "is_active": True,
                "created_at": "2020-01-01 00:00:00", "last_login": None, "_via_suite": True}
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

CurrentUser = Annotated[dict, Depends(get_current_user)]
AdminUser   = Annotated[dict, Depends(require_admin)]
AnalystUser = Annotated[dict, Depends(require_analyst)]
'''
    sftp.putfo(io.BytesIO(new_deps.encode('utf-8')), '/mnt/software/pktsnmp/app/dependencies.py')
    print("  ✓ dependencies.py patched")
else:
    print("  ✓ dependencies.py already patched")

# main.py
print("  Patching pktSNMP main.py...")
patch_main_spa(sftp, '/mnt/software/pktsnmp/app/main.py')

sftp.close()

# ── Restart ───────────────────────────────────────────────────────────────────
print("\n=== Restarting services ===")
_, o, _ = c.exec_command('sudo systemctl restart pktflow pktsnmp && sleep 4 && sudo systemctl is-active pktflow pktsnmp')
print(o.read().decode('utf-8').strip())

# Verify cookies now come back from pktFlow
_, o, _ = c.exec_command(
    'curl -sk -D - -o /dev/null '
    '-H "X-Suite-Token: MohVa4VeScgGwJ2POwrCyqR43Y7OMo7qpv6dXJ9x7uU" '
    '-H "X-Suite-User: testuser" -H "X-Suite-Role: admin" '
    'https://172.23.80.5:8766/ 2>/dev/null | grep -i "set-cookie\|HTTP/"'
)
print("\n=== pktFlow curl verify ===")
print(o.read().decode('utf-8').strip())

c.close()
print("\nDone.")
