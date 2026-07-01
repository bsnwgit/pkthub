"""
Creates a real proxy session cookie for pktLog, then tests the full
pktHub proxy chain to see whether Set-Cookie headers reach the browser.
"""
import paramiko, io, sys
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)
sftp = c.open_sftp()

remote = b"""
import sys, sqlite3, json
from datetime import datetime, timedelta, timezone
from jose import jwt

# Read pkthub config for JWT secret
db = sqlite3.connect("/mnt/software/pkthub/pkthub.db")
db.row_factory = sqlite3.Row

# Get first admin user
user = db.execute("SELECT username, role FROM users WHERE role='admin' AND is_active=1 LIMIT 1").fetchone()
if not user:
    user = db.execute("SELECT username, role FROM users WHERE is_active=1 LIMIT 1").fetchone()

# Read JWT secret from platform_config or guess default
row = db.execute("SELECT value FROM platform_config WHERE key='jwt_secret' LIMIT 1").fetchone()
if not row:
    # Try settings table
    row = db.execute("SELECT value FROM settings WHERE key='jwt_secret' LIMIT 1").fetchone()

db.close()

# Read secret from config file
import yaml, os
cfg_path = "/mnt/software/pkthub/config.yaml"
secret = None
if os.path.exists(cfg_path):
    with open(cfg_path) as f:
        cfg = yaml.safe_load(f) or {}
    secret = cfg.get("jwt_secret") or cfg.get("secret_key")

if not secret:
    print("ERROR: could not find jwt_secret")
    sys.exit(1)

# Forge a proxy session token
expire = datetime.now(tz=timezone.utc) + timedelta(hours=8)
token = jwt.encode(
    {"sub": user["username"], "role": user["role"], "scope": "proxy:5", "exp": expire},
    secret, algorithm="HS256"
)
print("TOKEN:", token)
print("USERNAME:", user["username"])
"""

sftp.putfo(io.BytesIO(remote), '/tmp/make_token.py')
_, o, e = c.exec_command('python3 /tmp/make_token.py')
out = o.read().decode('utf-8').strip()
err = e.read().decode('utf-8').strip()
print("Token script output:", out)
if err: print("STDERR:", err)

token = None
for line in out.split('\n'):
    if line.startswith('TOKEN:'):
        token = line[6:].strip()

if token:
    print(f"\nForged proxy token (first 40 chars): {token[:40]}...")
    # Test full proxy chain
    _, o, e = c.exec_command(
        f'curl -sk -D - -o /dev/null '
        f'--cookie "pkthub_proxy_5={token}" '
        f'https://172.23.80.5:8760/proxy/5/ 2>/dev/null | grep -i "set-cookie\\|HTTP/\\|x-pkthub"'
    )
    print('\n=== Full proxy response headers ===')
    print(o.read().decode('utf-8').strip())
else:
    print("Could not forge token — checking httpx version instead")
    _, o, _ = c.exec_command('python3 -c "import httpx; print(httpx.__version__); h = httpx.Headers([(\'set-cookie\',\'a=1\'),(\'set-cookie\',\'b=2\')]); print(h.get_list(\'set-cookie\'))"')
    print(o.read().decode('utf-8').strip())

sftp.close()
c.close()
