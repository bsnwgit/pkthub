import paramiko, sys, time
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r"C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem")
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("172.23.80.5", username="ec2-user", pkey=key, timeout=15, banner_timeout=15)

def run(cmd, label=""):
    if label: print(f">> {label}")
    _, stdout, stderr = client.exec_command(cmd, timeout=30)
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    if out:
        for l in out.splitlines(): print(f"   {l}")
    if err:
        for l in err.splitlines(): print(f"   !! {l}")
    return out

# Fix SSL cert ownership so ec2-user can read them
run("sudo chown ec2-user:ec2-user /etc/ssl/pkthub/cert.pem /etc/ssl/pkthub/key.pem", "chown certs to ec2-user")
run("sudo chmod 600 /etc/ssl/pkthub/key.pem && sudo chmod 644 /etc/ssl/pkthub/cert.pem", "chmod certs")
run("ls -la /etc/ssl/pkthub/", "verify cert perms")

# Restart
run("sudo systemctl start pkthub", "start service")
time.sleep(4)
run("sudo systemctl is-active pkthub", "is-active")
run("sudo systemctl status pkthub --no-pager -l | head -30", "status")
run("tail -20 /mnt/software/logs/pkthub.log 2>/dev/null || echo 'no log yet'", "app log")

client.close()
