import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)

# Check if sqlite3 works at all
_, o, e = c.exec_command('sqlite3 --version')
print('sqlite3 version:', o.read().decode() + e.read().decode())

# Try dumping pkthub DB
_, o, e = c.exec_command('sqlite3 /mnt/software/pkthub/pkthub.db ".tables" 2>&1')
stdout = o.read().decode('utf-8', errors='replace')
stderr = e.read().decode('utf-8', errors='replace')
print('tables stdout:', repr(stdout))
print('tables stderr:', repr(stderr))

# Try schema
_, o, e = c.exec_command('sqlite3 /mnt/software/pkthub/pkthub.db "SELECT name FROM sqlite_master WHERE type=\'table\';" 2>&1')
print('master tables:', o.read().decode('utf-8', errors='replace'))
print('stderr:', e.read().decode('utf-8', errors='replace'))

c.close()
