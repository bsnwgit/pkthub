import paramiko, io, sys
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)

# Recent pktlog.log entries
_, o, _ = c.exec_command('tail -60 /mnt/software/logs/pktlog.log 2>/dev/null')
print('=== pktlog.log (last 60 lines) ===')
print(o.read().decode('utf-8', errors='replace'))

# pktLog main.py
_, o, _ = c.exec_command('cat /mnt/software/pktlog/app/main.py')
print('=== pktLog main.py ===')
print(o.read().decode('utf-8', errors='replace'))

# pktLog api/auth.py (the login endpoint)
_, o, _ = c.exec_command('cat /mnt/software/pktlog/app/api/auth.py')
print('=== pktLog api/auth.py ===')
print(o.read().decode('utf-8', errors='replace'))

c.close()
