import paramiko, sys, time
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r"C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem")
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("172.23.80.5", username="ec2-user", pkey=key, timeout=15, banner_timeout=15)

def run(cmd, label=""):
    if label: print(f">> {label}")
    _, stdout, stderr = client.exec_command(cmd, timeout=60)
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    if out:
        for l in out.splitlines(): print(f"   {l}")
    if err:
        for l in err.splitlines(): print(f"   !! {l}")
    return out

# SFTP updated requirements.txt
sftp = client.open_sftp()
sftp.put(
    r"C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktDashboard\requirements.txt",
    "/mnt/software/pkthub/requirements.txt"
)
sftp.close()
print(">> requirements.txt uploaded")

# Reinstall with pinned bcrypt
run(
    "/mnt/software/pkthub/venv/bin/pip install 'bcrypt==3.2.2' -q && "
    "/mnt/software/pkthub/venv/bin/pip install -r /mnt/software/pkthub/requirements.txt -q",
    "reinstall with bcrypt==3.2.2"
)

# Verify bcrypt version
run("/mnt/software/pkthub/venv/bin/pip show bcrypt | grep Version", "bcrypt version check")

# Test import
run(
    "cd /mnt/software/pkthub && "
    "timeout 10 /mnt/software/pkthub/venv/bin/python -c 'from app.main import app; print(\"app import OK\")'  2>&1",
    "app import test"
)

# Start service
run("sudo systemctl start pkthub", "start")
time.sleep(5)
run("sudo systemctl is-active pkthub", "is-active")
run("sudo systemctl status pkthub --no-pager -l | head -25", "status")
run("tail -30 /mnt/software/logs/pkthub.log 2>/dev/null || echo 'no log'", "app log")

client.close()
