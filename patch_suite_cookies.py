"""
Two patches to make pktLog's React SPA authenticate via pktHub suite token:

Part A — pktLog main.py:
  The SPA catch-all route now detects X-Suite-Token. If valid, it generates a
  pktLog JWT and sets sso_access_token + sso_role cookies — the same pattern
  pktLog already uses for SAML SSO. React reads these on boot and logs in.

Part B — pktHub proxy.py:
  Set-Cookie headers are multi-valued. The dict comprehension was keeping only
  the last value. Now they're forwarded correctly after Response construction.
"""
import paramiko, io, sys
sys.stdout.reconfigure(encoding='utf-8')

key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)
sftp = c.open_sftp()

# ──────────────────────────────────────────────────────────────────────────────
# Part A: Patch pktLog main.py — SPA route sets SSO cookies for suite token
# ──────────────────────────────────────────────────────────────────────────────

print("Reading pktLog main.py...")
with sftp.open('/mnt/software/pktlog/app/main.py', 'r') as f:
    main_py = f.read().decode('utf-8')

if 'x-suite-token' in main_py.lower():
    print("  ✓ main.py already patched")
else:
    old_spa = '''    # Catch-all: serve index.html for all non-API routes (SPA client-side routing)
    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        index = _frontend_dist / "index.html"
        return FileResponse(str(index))'''

    new_spa = '''    # Catch-all: serve index.html for all non-API routes (SPA client-side routing)
    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(request: Request, full_path: str):
        from fastapi import Request as _Req  # already imported above, here for clarity
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        index = _frontend_dist / "index.html"
        response = FileResponse(str(index))

        # pktHub suite-token bootstrap:
        # When this SPA is loaded through pktHub's proxy, pktHub sends X-Suite-Token
        # on every request.  If the token is valid, generate a pktLog JWT and set
        # the same sso_access_token + sso_role cookies that the SAML flow uses.
        # React's AuthProvider reads these on mount and logs the user in
        # without showing a login screen.
        _cfg = settings
        _suite_tk = request.headers.get("x-suite-token", "")
        if _suite_tk and _cfg.suite_token and _suite_tk == _cfg.suite_token:
            from datetime import datetime, timedelta, timezone
            from jose import jwt as _jose_jwt
            from app.dependencies import _SUITE_ROLE_MAP
            _hub_user = request.headers.get("x-suite-user", "hub_user")
            _hub_role = request.headers.get("x-suite-role", "viewer")
            _local_role = _SUITE_ROLE_MAP.get(_hub_role, "analyst")
            # 8-hour JWT — sub="0" (synthetic; get_current_user handles id=0 via X-Suite-Token)
            _expire = datetime.now(tz=timezone.utc) + timedelta(hours=8)
            _payload = {"sub": "0", "role": _local_role, "exp": _expire, "type": "access"}
            _jwt = _jose_jwt.encode(_payload, _cfg.secret_key, algorithm=_cfg.algorithm)
            # httponly=False so JS can read via document.cookie (same as SAML flow)
            response.set_cookie("sso_access_token", _jwt,    max_age=60, httponly=False, samesite="lax")
            response.set_cookie("sso_role",         _local_role, max_age=60, httponly=False, samesite="lax")

        return response'''

    if old_spa in main_py:
        main_py = main_py.replace(old_spa, new_spa)
        # Also add Request import to the serve_spa imports if not present
        if 'from fastapi import Request' not in main_py:
            main_py = main_py.replace(
                'from fastapi import FastAPI, HTTPException',
                'from fastapi import FastAPI, HTTPException, Request'
            )
        sftp.putfo(io.BytesIO(main_py.encode('utf-8')), '/mnt/software/pktlog/app/main.py')
        print("  ✓ main.py patched — SPA route sets sso cookies for suite token")
    else:
        print("  ⚠ Could not find expected SPA route in main.py — check indentation/content")
        print("  Looking for:", repr(old_spa[:80]))

sftp.close()

# ──────────────────────────────────────────────────────────────────────────────
# Part B: Patch pktHub proxy.py — forward Set-Cookie headers properly
# ──────────────────────────────────────────────────────────────────────────────

print("Reading pktHub proxy.py...")
with open(r'C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktHub\app\proxy.py', 'r', encoding='utf-8') as f:
    proxy_py = f.read()

if 'get_list("set-cookie")' in proxy_py or "get_list('set-cookie')" in proxy_py:
    print("  ✓ proxy.py already handles multi-value Set-Cookie")
else:
    old_response_headers = '''    response_headers = {
        k: v for k, v in resp.headers.items()
        if k.lower() not in _STRIP_RESPONSE_HEADERS
    }'''

    new_response_headers = '''    # Exclude set-cookie from the dict — dicts can't hold duplicate keys,
    # so multi-cookie responses (e.g. sso_access_token + sso_role from pktLog)
    # would lose all but the last.  We forward them separately below.
    response_headers = {
        k: v for k, v in resp.headers.items()
        if k.lower() not in _STRIP_RESPONSE_HEADERS and k.lower() != "set-cookie"
    }'''

    old_return = '''    return Response(
        content=content,
        status_code=resp.status_code,
        headers=response_headers,
    )'''

    new_return = '''    proxy_response = Response(
        content=content,
        status_code=resp.status_code,
        headers=response_headers,
    )
    # Forward every Set-Cookie header from the pktApp response.
    # This allows pktApps to set their sso_access_token / sso_role cookies
    # (used by pktLog's React SPA to bootstrap auth without showing a login page).
    for cookie_val in resp.headers.get_list("set-cookie"):
        proxy_response.headers.append("set-cookie", cookie_val)
    return proxy_response'''

    if old_response_headers in proxy_py and old_return in proxy_py:
        proxy_py = proxy_py.replace(old_response_headers, new_response_headers)
        proxy_py = proxy_py.replace(old_return, new_return)
        with open(r'C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktHub\app\proxy.py', 'w', encoding='utf-8') as f:
            f.write(proxy_py)
        print("  ✓ proxy.py patched — Set-Cookie headers forwarded correctly")
    else:
        print("  ⚠ Could not find expected blocks in proxy.py")
        print("  old_response_headers found:", old_response_headers in proxy_py)
        print("  old_return found:", old_return in proxy_py)

# ──────────────────────────────────────────────────────────────────────────────
# Restart pktLog (proxy.py changes are on the local project, need separate deploy)
# ──────────────────────────────────────────────────────────────────────────────
print("Restarting pktLog...")
_, o, e = c.exec_command('sudo systemctl restart pktlog && sleep 3 && sudo systemctl is-active pktlog')
print("  pktLog status:", o.read().decode('utf-8').strip())

c.close()
print("\nDone.")
print("NOTE: pktHub proxy.py was patched locally — also upload to server and restart pktHub.")
