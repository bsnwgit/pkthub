import paramiko, io, sys
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)
sftp = c.open_sftp()

# The badly-indented injected block (16 spaces) — same in both files
BAD = (
    '                # pktHub suite-token bootstrap — set sso cookies so React logs in automatically\n'
    '                _cfg = settings\n'
    '                _suite_tk = request.headers.get("x-suite-token", "")\n'
    '                if _suite_tk and _cfg.suite_token and _suite_tk == _cfg.suite_token:\n'
    '                    from datetime import datetime, timedelta, timezone\n'
    '                    from jose import jwt as _jose_jwt\n'
    '                    from app.dependencies import _SUITE_ROLE_MAP\n'
    '                    _hub_user = request.headers.get("x-suite-user", "hub_user")\n'
    '                    _hub_role = request.headers.get("x-suite-role", "viewer")\n'
    '                    _local_role = _SUITE_ROLE_MAP.get(_hub_role, "viewer")\n'
    '                    _expire = datetime.now(tz=timezone.utc) + timedelta(hours=8)\n'
    '                    _payload = {"sub": "0", "role": _local_role, "exp": _expire, "type": "access"}\n'
    '                    _jwt = _jose_jwt.encode(_payload, _cfg.secret_key, algorithm=_cfg.algorithm)\n'
    '                    response.set_cookie("sso_access_token", _jwt,       max_age=60, httponly=False, samesite="lax")\n'
    '                    response.set_cookie("sso_role",         _local_role, max_age=60, httponly=False, samesite="lax")\n'
    '                return response\n'
)

# Correctly indented (8 spaces — inside serve_spa which is inside if block)
GOOD = (
    '        # pktHub suite-token bootstrap — set sso cookies so React logs in automatically\n'
    '        _cfg = settings\n'
    '        _suite_tk = request.headers.get("x-suite-token", "")\n'
    '        if _suite_tk and _cfg.suite_token and _suite_tk == _cfg.suite_token:\n'
    '            from datetime import datetime, timedelta, timezone\n'
    '            from jose import jwt as _jose_jwt\n'
    '            from app.dependencies import _SUITE_ROLE_MAP\n'
    '            _hub_user = request.headers.get("x-suite-user", "hub_user")\n'
    '            _hub_role = request.headers.get("x-suite-role", "viewer")\n'
    '            _local_role = _SUITE_ROLE_MAP.get(_hub_role, "viewer")\n'
    '            _expire = datetime.now(tz=timezone.utc) + timedelta(hours=8)\n'
    '            _payload = {"sub": "0", "role": _local_role, "exp": _expire, "type": "access"}\n'
    '            _jwt = _jose_jwt.encode(_payload, _cfg.secret_key, algorithm=_cfg.algorithm)\n'
    '            response.set_cookie("sso_access_token", _jwt,       max_age=60, httponly=False, samesite="lax")\n'
    '            response.set_cookie("sso_role",         _local_role, max_age=60, httponly=False, samesite="lax")\n'
    '        return response\n'
)

for path in ['/mnt/software/pktflow/app/main.py', '/mnt/software/pktsnmp/app/main.py']:
    with sftp.open(path, 'r') as f:
        txt = f.read().decode('utf-8')
    if BAD in txt:
        txt = txt.replace(BAD, GOOD)
        sftp.putfo(io.BytesIO(txt.encode('utf-8')), path)
        print(f'✓ fixed indentation: {path}')
    elif 'x-suite-token' in txt.lower():
        print(f'✓ already correct or different format: {path}')
    else:
        print(f'⚠ suite block not found: {path}')

sftp.close()

_, o, _ = c.exec_command('sudo systemctl restart pktflow pktsnmp && sleep 5 && sudo systemctl is-active pktflow pktsnmp')
print('\nService status:', o.read().decode('utf-8').strip())

# Verify cookies
for name, port, token in [
    ('pktFlow', 8766, 'MohVa4VeScgGwJ2POwrCyqR43Y7OMo7qpv6dXJ9x7uU'),
    ('pktSNMP', 8767, 'placeholder'),
]:
    _, o, _ = c.exec_command(
        f'curl -sk -D - -o /dev/null '
        f'-H "X-Suite-Token: {token}" '
        f'-H "X-Suite-User: test" -H "X-Suite-Role: admin" '
        f'https://172.23.80.5:{port}/ 2>/dev/null | grep -i "set-cookie\\|HTTP/1"'
    )
    out = o.read().decode('utf-8').strip()
    print(f'\n{name} ({port}): {out if out else "no cookies / no response"}')

c.close()
