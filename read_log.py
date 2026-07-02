import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)

def run(cmd):
    _, o, e = c.exec_command(cmd, timeout=20)
    print(o.read().decode('utf-8', errors='replace'))
    err = e.read().decode('utf-8', errors='replace').strip()
    if err: print("STDERR:", err)

# Full log since last restart
run("tail -150 /mnt/software/pkthub/logs/pkthub.log")

# Also dump the platform_config SAML settings from the DB
run("""sqlite3 /mnt/software/pkthub/pkthub.db "SELECT key, substr(value,1,80) FROM platform_config WHERE key LIKE '%saml%' OR key = 'base_url' OR key = 'auth_local_enabled';" """)

# And list users
run("""sqlite3 /mnt/software/pkthub/pkthub.db "SELECT id, username, email, role, is_active FROM users;" """)

c.close()
