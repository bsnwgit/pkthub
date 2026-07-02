"""Push auth.py to server and restart pktHub."""
import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8')

key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)

sftp = c.open_sftp()
sftp.put(
    r'C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktHub\app\auth.py',
    '/mnt/software/pkthub/app/auth.py'
)
sftp.close()
print("Uploaded auth.py")

def run(cmd, label=""):
    if label: print(f"  >> {label}")
    _, o, e = c.exec_command(cmd, timeout=20)
    out = o.read().decode('utf-8', errors='replace').strip()
    err = e.read().decode('utf-8', errors='replace').strip()
    if out:
        for line in out.splitlines(): print(f"     {line}")
    if err:
        for line in err.splitlines(): print(f"  !! {line}")

run("sudo systemctl restart pkthub", "restart")
import time; time.sleep(3)
run("sudo systemctl is-active pkthub", "is-active")
run("tail -5 /mnt/software/pkthub/logs/pkthub.log", "log")

c.close()
print("Done.")
