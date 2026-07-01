import paramiko, io, sys
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)
sftp = c.open_sftp()

remote = b"""
import sqlite3
db = sqlite3.connect("/mnt/software/pkthub/pkthub.db")
db.row_factory = sqlite3.Row
rows = db.execute("SELECT name, suite_token, base_url FROM registered_apps ORDER BY id").fetchall()
for r in rows:
    print(f"{r['name']}|{r['suite_token']}|{r['base_url']}")
db.close()
"""
sftp.putfo(io.BytesIO(remote), '/tmp/recon.py')

_, o, _ = c.exec_command('python3 /tmp/recon.py')
print('=== registered apps ===')
print(o.read().decode('utf-8'))

for app in ['pktsnmp', 'pktpcap']:
    base = f'/mnt/software/{app}'

    _, o, _ = c.exec_command(f'cat {base}/config.yaml 2>/dev/null || echo MISSING')
    print(f'=== {app} config.yaml ===')
    print(o.read().decode('utf-8', errors='replace'))

    _, o, _ = c.exec_command(f'grep -n "suite_token\|log_level\|# .. Log" {base}/app/config.py 2>/dev/null | head -10')
    print(f'=== {app} config.py markers ===')
    print(o.read().decode('utf-8', errors='replace'))

    _, o, _ = c.exec_command(f'grep -n "X-Suite\|suite_token\|get_current_user\|from fastapi import" {base}/app/dependencies.py 2>/dev/null | head -10')
    print(f'=== {app} dependencies.py markers ===')
    print(o.read().decode('utf-8', errors='replace'))

    _, o, _ = c.exec_command(f'grep -n "serve_spa\|full_path\|FileResponse\|from fastapi import\|x-suite" {base}/app/main.py 2>/dev/null | head -15')
    print(f'=== {app} main.py markers ===')
    print(o.read().decode('utf-8', errors='replace'))

    _, o, _ = c.exec_command(f'grep -n "sso_access_token" {base}/frontend/src/store/auth.tsx 2>/dev/null | head -5')
    print(f'=== {app} frontend auth.tsx ===')
    print(o.read().decode('utf-8', errors='replace'))

sftp.close()
c.close()
