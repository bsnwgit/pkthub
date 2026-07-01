import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)

# Check if rewrite function exists in deployed proxy.py
_, o, e = c.exec_command("grep -n 'rewrite\\|_rewrite\\|base href\\|proxy_prefix' /mnt/software/pkthub/app/proxy.py | head -40")
print("=== GREP RESULTS ===")
print(o.read().decode('utf-8', errors='replace'))

# Also check the full proxy handler to see what it returns
_, o, e = c.exec_command("grep -n 'def proxy\\|return_url\\|HTMLResponse\\|content_type\\|html' /mnt/software/pkthub/app/proxy.py | head -40")
print("\n=== HANDLER RESULTS ===")
print(o.read().decode('utf-8', errors='replace'))

c.close()
