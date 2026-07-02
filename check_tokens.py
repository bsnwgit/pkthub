import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)

# Check suite token pktHub has for pktLog
_, o, _ = c.exec_command("sqlite3 /mnt/software/pkthub/pkthub.db \"SELECT id, name, base_url, suite_token FROM registered_apps;\"")
print("=== pktHub registered apps + suite tokens ===")
print(o.read().decode('utf-8', errors='replace'))

# Check pktLog's own config for what suite token it expects
_, o, _ = c.exec_command("cat /mnt/software/pktlog/config.yaml 2>/dev/null || cat /mnt/software/pktlog/config.yml 2>/dev/null || echo 'config not found'")
print("=== pktLog config ===")
print(o.read().decode('utf-8', errors='replace'))

# Also check pktLog service to find its config path
_, o, _ = c.exec_command("cat /etc/systemd/system/pktlog.service 2>/dev/null || echo 'service not found'")
print("=== pktLog service ===")
print(o.read().decode('utf-8', errors='replace'))

c.close()
