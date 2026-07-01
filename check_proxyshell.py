import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)

# Check ProxyShell on server
_, o, _ = c.exec_command('cat /mnt/software/pkthub/frontend/src/pages/ProxyShell.tsx 2>/dev/null || echo MISSING')
print('=== ProxyShell.tsx ===')
print(o.read().decode('utf-8', errors='replace'))

# Also check pktHub proxy.py lines around set-cookie forwarding to verify it's right
_, o, _ = c.exec_command('sed -n "280,325p" /mnt/software/pkthub/app/proxy.py')
print('=== proxy.py set-cookie section ===')
print(o.read().decode('utf-8', errors='replace'))

c.close()
