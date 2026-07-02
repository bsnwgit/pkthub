import paramiko, sys, time
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)

time.sleep(6)

# Service status
_, o, _ = c.exec_command('sudo systemctl is-active pktlog pktflow pktsnmp')
print('=== service status ===')
print(o.read().decode('utf-8').strip())

# pktLog cookies
_, o, _ = c.exec_command(
    'curl -sk -D - -o /dev/null '
    '-H "X-Suite-Token: cGJwcEZ6-14lytdWwVit-MPubqCt5-RAtmjWhAtP5zc" '
    '-H "X-Suite-User: testuser" -H "X-Suite-Role: admin" '
    'https://172.23.80.5:8768/ 2>/dev/null | grep -i "set-cookie\\|HTTP/"'
)
print('\n=== pktLog cookies ===')
print(o.read().decode('utf-8').strip())

# pktFlow cookies
_, o, _ = c.exec_command(
    'curl -sk -D - -o /dev/null '
    '-H "X-Suite-Token: MohVa4VeScgGwJ2POwrCyqR43Y7OMo7qpv6dXJ9x7uU" '
    '-H "X-Suite-User: testuser" -H "X-Suite-Role: admin" '
    'https://172.23.80.5:8766/ 2>/dev/null | grep -i "set-cookie\\|HTTP/"'
)
print('\n=== pktFlow cookies ===')
print(o.read().decode('utf-8').strip())

# Check any startup errors
_, o, _ = c.exec_command('tail -8 /mnt/software/logs/pktflow.log 2>/dev/null || sudo journalctl -u pktflow -n 10 --no-pager 2>/dev/null | tail -8')
print('\n=== pktFlow recent log ===')
print(o.read().decode('utf-8').strip())

c.close()
