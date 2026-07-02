import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)

_, o, _ = c.exec_command('cat /mnt/software/pktlog/app/api/users.py')
print('=== users.py ===')
print(o.read().decode('utf-8', errors='replace'))

_, o, _ = c.exec_command('cat /mnt/software/pkthub/app/proxy.py')
print('=== pkthub proxy.py ===')
print(o.read().decode('utf-8', errors='replace'))

c.close()
