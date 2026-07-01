import paramiko, io, sys
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)

# Last 80 lines of pktlog service log
_, o, _ = c.exec_command('sudo journalctl -u pktlog -n 80 --no-pager 2>/dev/null || tail -80 /mnt/software/logs/pktlog.log')
print('=== pktLog service log (last 80 lines) ===')
print(o.read().decode('utf-8', errors='replace'))

# Verify dependencies.py actually has X-Suite-Token
_, o, _ = c.exec_command('grep -n "X-Suite-Token\\|suite_token\\|_via_suite" /mnt/software/pktlog/app/dependencies.py')
print('=== dependencies.py suite token lines ===')
print(o.read().decode('utf-8', errors='replace'))

# Verify config.yaml has suite_token
_, o, _ = c.exec_command('grep -n "suite_token" /mnt/software/pktlog/config.yaml')
print('=== config.yaml suite_token ===')
print(o.read().decode('utf-8', errors='replace'))

# Check if pktlog is actually running the new code (check process)
_, o, _ = c.exec_command('sudo systemctl status pktlog --no-pager | head -20')
print('=== pktlog service status ===')
print(o.read().decode('utf-8', errors='replace'))

c.close()
