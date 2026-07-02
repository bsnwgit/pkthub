import paramiko, sys, time
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)
_, o, e = c.exec_command('tail -80 /mnt/software/pkthub/logs/pkthub.log', timeout=15)
print(o.read().decode('utf-8', errors='replace'))
c.close()
