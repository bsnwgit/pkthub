import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)

# pktHub DB schema
_, o, _ = c.exec_command('sqlite3 /mnt/software/pkthub/pkthub.db ".tables"')
print('=== pktHub tables ===')
print(o.read().decode('utf-8', errors='replace'))

_, o, _ = c.exec_command('sqlite3 /mnt/software/pkthub/pkthub.db ".schema registered_apps"')
print('=== registered_apps schema ===')
print(o.read().decode('utf-8', errors='replace'))

_, o, _ = c.exec_command('sqlite3 /mnt/software/pkthub/pkthub.db "SELECT * FROM registered_apps LIMIT 10;"')
print('=== registered_apps data ===')
print(o.read().decode('utf-8', errors='replace'))

# pktLog dependencies and auth
_, o, _ = c.exec_command('cat /mnt/software/pktlog/app/dependencies.py')
print('=== pktLog dependencies.py ===')
print(o.read().decode('utf-8', errors='replace'))

_, o, _ = c.exec_command('cat /mnt/software/pktlog/app/auth/local.py')
print('=== pktLog auth/local.py ===')
print(o.read().decode('utf-8', errors='replace'))

_, o, _ = c.exec_command('cat /mnt/software/pktlog/app/config.py')
print('=== pktLog config.py ===')
print(o.read().decode('utf-8', errors='replace'))

c.close()
