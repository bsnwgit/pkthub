import paramiko, io, sys, urllib.request, ssl
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)
sftp = c.open_sftp()

# 1. Check pktLog service health + recent errors
_, o, _ = c.exec_command('tail -20 /mnt/software/logs/pktlog.log')
print('=== pktlog.log tail ===')
print(o.read().decode('utf-8', errors='replace'))

# 2. Directly curl pktLog root with X-Suite-Token — check what headers come back
_, o, e = c.exec_command(
    'curl -sk -D - -o /dev/null '
    '-H "X-Suite-Token: cGJwcEZ6-14lytdWwVit-MPubqCt5-RAtmjWhAtP5zc" '
    '-H "X-Suite-User: testuser" '
    '-H "X-Suite-Role: admin" '
    'https://172.23.80.5:8768/ 2>/dev/null | head -30'
)
print('=== pktLog direct curl response headers ===')
print(o.read().decode('utf-8', errors='replace'))
print(e.read().decode('utf-8', errors='replace'))

# 3. Check what serve_spa currently looks like in pktLog main.py
_, o, _ = c.exec_command('sed -n "135,175p" /mnt/software/pktlog/app/main.py')
print('=== pktlog main.py serve_spa ===')
print(o.read().decode('utf-8', errors='replace'))

# 4. Check pktFlow same way
_, o, _ = c.exec_command('tail -5 /mnt/software/logs/pktflow.log 2>/dev/null || echo no log')
print('=== pktflow.log tail ===')
print(o.read().decode('utf-8', errors='replace'))

_, o, e = c.exec_command(
    'curl -sk -D - -o /dev/null '
    '-H "X-Suite-Token: MohVa4VeScgGwJ2POwrCyqR43Y7OMo7qpv6dXJ9x7uU" '
    '-H "X-Suite-User: testuser" '
    '-H "X-Suite-Role: admin" '
    'https://172.23.80.5:8766/ 2>/dev/null | head -30'
)
print('=== pktFlow direct curl response headers ===')
print(o.read().decode('utf-8', errors='replace'))

# 5. Check pktSNMP registered in pkthub DB
remote = b"""
import sqlite3
db = sqlite3.connect("/mnt/software/pkthub/pkthub.db")
db.row_factory = sqlite3.Row
rows = db.execute("SELECT id, name, suite_token, base_url FROM registered_apps ORDER BY id").fetchall()
for r in rows:
    print(f"id={r['id']} name={r['name']} url={r['base_url']} token={r['suite_token']}")
db.close()
"""
sftp.putfo(io.BytesIO(remote), '/tmp/dbcheck.py')
_, o, _ = c.exec_command('python3 /tmp/dbcheck.py')
print('=== all registered apps ===')
print(o.read().decode('utf-8', errors='replace'))

sftp.close()
c.close()
