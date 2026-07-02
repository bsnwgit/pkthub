import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)

# pktHub registered apps
_, o, _ = c.exec_command('sqlite3 /mnt/software/pkthub/pkthub.db "SELECT id, name, base_url, suite_token FROM registered_apps;"')
print('=== pktHub registered apps + suite tokens ===')
print(o.read().decode('utf-8', errors='replace'))

# pktLog app structure
_, o, _ = c.exec_command('find /mnt/software/pktlog -name "*.py" -not -path "*/venv/*" 2>/dev/null | sort')
print('=== pktLog python files (no venv) ===')
print(o.read().decode('utf-8', errors='replace'))

c.close()
