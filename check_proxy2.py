"""Check what pktLog returns and what proxy_prefix the proxy would use."""
import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8')

key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)

def run(cmd, label=""):
    if label: print(f"\n=== {label} ===")
    _, o, e = c.exec_command(cmd, timeout=30)
    out = o.read().decode('utf-8', errors='replace').strip()
    err = e.read().decode('utf-8', errors='replace').strip()
    if out: print(out)
    if err: print("ERR:", err)
    return out

# 1. Fetch pktLog root HTML directly (what pktHub receives before rewriting)
run("""
/mnt/software/pkthub/venv/bin/python3 -c "
import httpx, ssl
resp = httpx.get('https://172.23.80.5:8768/', verify=False, timeout=10)
print('STATUS:', resp.status_code)
print('CONTENT-TYPE:', resp.headers.get('content-type'))
print('BODY HEAD:')
print(resp.text[:3000])
"
""", "pktLog raw HTML (before rewriting)")

# 2. Generate a test JWT and hit the proxy directly to see rewritten HTML
run("""
/mnt/software/pkthub/venv/bin/python3 << 'EOF'
import sys
sys.path.insert(0, '/mnt/software/pkthub')
from jose import jwt
from datetime import datetime, timedelta
import httpx

# Generate a proxy session token for app_id=5
secret = "CHANGE_ME_generate_with_openssl_rand_hex_32"
token = jwt.encode(
    {"sub": "admin", "role": "admin", "scope": "proxy:5",
     "exp": datetime.utcnow() + timedelta(minutes=5)},
    secret, algorithm="HS256"
)
print("Proxy token:", token[:40], "...")

# Fetch /proxy/5/ with the cookie
resp = httpx.get(
    'https://localhost:8760/proxy/5/',
    cookies={"pkthub_proxy_5": token},
    verify=False,
    timeout=10,
    follow_redirects=True
)
print("STATUS:", resp.status_code)
print("X-Pkthub-Rewrote:", resp.headers.get("x-pkthub-rewrote", "MISSING"))
print("X-Pkthub-Prefix:", resp.headers.get("x-pkthub-prefix", "MISSING"))
print("BODY HEAD:")
print(resp.text[:3000])
EOF
""", "proxy rewritten HTML")

c.close()
