import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)

# Show pktFlow serve_spa with line numbers
_, o, _ = c.exec_command('grep -n "" /mnt/software/pktflow/app/main.py | sed -n "155,200p"')
print('=== pktFlow main.py 155-200 ===')
print(o.read().decode('utf-8', errors='replace'))

# Same for pktSNMP
_, o, _ = c.exec_command('grep -n "" /mnt/software/pktsnmp/app/main.py | sed -n "135,185p"')
print('=== pktSNMP main.py 135-185 ===')
print(o.read().decode('utf-8', errors='replace'))

c.close()
