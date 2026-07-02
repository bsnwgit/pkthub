import paramiko, io, sys
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)
sftp = c.open_sftp()

with open(r'C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktHub\app\proxy.py', 'r', encoding='utf-8') as f:
    proxy_py = f.read()

sftp.putfo(io.BytesIO(proxy_py.encode('utf-8')), '/mnt/software/pkthub/app/proxy.py')
print("proxy.py uploaded")

sftp.close()

_, o, _ = c.exec_command('sudo systemctl restart pkthub && sleep 3 && sudo systemctl is-active pkthub')
print("pktHub status:", o.read().decode('utf-8').strip())

c.close()
