import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8')

key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)

sftp = c.open_sftp()
sftp.put(r'C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktHub\rewrite_test.py',
         '/tmp/rewrite_test.py')
sftp.close()

_, o, e = c.exec_command('/mnt/software/pkthub/venv/bin/python3 /tmp/rewrite_test.py', timeout=20)
print(o.read().decode('utf-8', errors='replace'))
err = e.read().decode('utf-8', errors='replace').strip()
if err: print("ERR:", err)
c.close()
