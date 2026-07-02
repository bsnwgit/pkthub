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

# Kill anything holding port 8760
run("sudo fuser -k 8760/tcp 2>/dev/null; sleep 1; echo 'cleared'", "kill port 8760 holders")
run("sudo systemctl stop pkthub 2>/dev/null; sleep 1; echo 'stopped'", "stop service")

# Double-check port is free
run("sudo ss -tlnp | grep 8760 || echo 'port 8760 is free'", "port check")

# Start fresh
run("sudo systemctl start pkthub", "start")
time.sleep(6)
run("sudo systemctl is-active pkthub", "is-active")
run("sudo systemctl status pkthub --no-pager -l | head -20", "status")
run("tail -15 /mnt/software/logs/pkthub.log 2>/dev/null", "recent log")

# Test the HTTPS endpoint
run(
    "curl -k -s -o /dev/null -w '%{http_code}' https://localhost:8760/api/health 2>&1 || echo 'curl failed'",
    "HTTP health check"
)

client.close()
