import paramiko, io, sys
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)
sftp = c.open_sftp()

# Read current pktlog main.py to see what actually got written
_, o, _ = c.exec_command('grep -n "Request\|serve_spa\|from fastapi" /mnt/software/pktlog/app/main.py | head -30')
print('=== pktlog main.py key lines ===')
print(o.read().decode('utf-8', errors='replace'))

# pktFlow structure
_, o, _ = c.exec_command('find /mnt/software/pktflow -name "*.py" -not -path "*/venv/*" 2>/dev/null | sort | head -30')
print('=== pktFlow python files ===')
print(o.read().decode('utf-8', errors='replace'))

_, o, _ = c.exec_command('find /mnt/software/pktflow/frontend/src -name "*.ts" -o -name "*.tsx" 2>/dev/null | sort')
print('=== pktFlow frontend files ===')
print(o.read().decode('utf-8', errors='replace'))

_, o, _ = c.exec_command('grep -n "sso_access_token\|sso_role\|suite_token\|X-Suite" /mnt/software/pktflow/frontend/src/store/auth.tsx 2>/dev/null || echo "no auth.tsx"')
print('=== pktFlow auth.tsx suite refs ===')
print(o.read().decode('utf-8', errors='replace'))

c.close()
