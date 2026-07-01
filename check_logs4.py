import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)

_, o, _ = c.exec_command('cat /mnt/software/pktlog/frontend/src/store/auth.tsx')
print('=== auth.tsx ===')
print(o.read().decode('utf-8', errors='replace'))

_, o, _ = c.exec_command('cat /mnt/software/pktlog/frontend/src/App.tsx')
print('=== App.tsx ===')
print(o.read().decode('utf-8', errors='replace'))

_, o, _ = c.exec_command('cat /mnt/software/pktlog/frontend/src/api/client.ts')
print('=== client.ts ===')
print(o.read().decode('utf-8', errors='replace'))

c.close()
