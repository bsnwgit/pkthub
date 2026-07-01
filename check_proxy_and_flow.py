import paramiko, io, sys
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)
sftp = c.open_sftp()

# 1. Check pktFlow serve_spa in main.py
_, o, _ = c.exec_command('grep -n "serve_spa\|x-suite\|sso_access\|suite_token\|Request\|FileResponse" /mnt/software/pktflow/app/main.py')
print('=== pktFlow main.py suite refs ===')
print(o.read().decode('utf-8', errors='replace'))

# 2. Check pktHub proxy.py on server for Set-Cookie forwarding
_, o, _ = c.exec_command('grep -n "get_list\|set-cookie\|append\|Set-Cookie" /mnt/software/pkthub/app/proxy.py')
print('=== pktHub proxy.py set-cookie handling ===')
print(o.read().decode('utf-8', errors='replace'))

# 3. Curl pktHub proxy for pktLog root — see if Set-Cookie passes through
_, o, e = c.exec_command(
    'curl -sk -D - -o /dev/null '
    '--cookie "pkthub_proxy_5=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" '
    'https://172.23.80.5:8760/proxy/5/ 2>/dev/null | head -20'
)
print('=== pktHub proxy /proxy/5/ response headers ===')
print(o.read().decode('utf-8', errors='replace'))

# 4. Show full pktFlow serve_spa section (lines around the function)
_, o, _ = c.exec_command('sed -n "130,175p" /mnt/software/pktflow/app/main.py')
print('=== pktFlow main.py lines 130-175 ===')
print(o.read().decode('utf-8', errors='replace'))

sftp.close()
c.close()
