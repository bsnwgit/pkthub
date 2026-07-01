import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)

# pktLog frontend auth/store files
_, o, _ = c.exec_command('find /mnt/software/pktlog/frontend/src -name "*.ts" -o -name "*.tsx" 2>/dev/null | sort')
print('=== pktLog frontend src files ===')
print(o.read().decode('utf-8', errors='replace'))

# Check for auth-related frontend files
_, o, _ = c.exec_command('grep -rl "sso_access_token\\|access_token\\|useAuth\\|AuthContext\\|authStore" /mnt/software/pktlog/frontend/src/ 2>/dev/null | head -10')
print('=== frontend auth files ===')
print(o.read().decode('utf-8', errors='replace'))

c.close()
