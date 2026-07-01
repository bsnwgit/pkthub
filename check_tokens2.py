import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)

# Find correct pkthub DB
_, o, _ = c.exec_command('find /mnt/software -name "*.db" 2>/dev/null | head -20')
print('=== databases ===')
print(o.read().decode('utf-8', errors='replace'))

# Check pktLog auth middleware
_, o, _ = c.exec_command('grep -r -l "suite_token" /mnt/software/pktlog/ --include="*.py" 2>/dev/null | head -10')
print('=== pktLog files with suite_token ===')
print(o.read().decode('utf-8', errors='replace'))

# Check pktLog auth file
_, o, _ = c.exec_command('find /mnt/software/pktlog -name "auth*.py" -o -name "middleware*.py" -o -name "deps*.py" 2>/dev/null | head -10')
print('=== pktLog auth files ===')
print(o.read().decode('utf-8', errors='replace'))

# Check for any suite references in pktlog python files
_, o, _ = c.exec_command('grep -r -l "X-Suite" /mnt/software/pktlog/ 2>/dev/null | head -10')
print('=== pktLog files with X-Suite header refs ===')
print(o.read().decode('utf-8', errors='replace'))

c.close()
