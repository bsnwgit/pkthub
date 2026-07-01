import paramiko, sys, time
sys.stdout.reconfigure(encoding='utf-8')

print("Connecting...")
key = paramiko.RSAKey.from_private_key_file(r"C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem")
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("172.23.80.5", username="ec2-user", pkey=key, timeout=15, banner_timeout=15)
print("Connected.")

def run(cmd, label=""):
    if label: print(f"\n>> {label}")
    _, stdout, stderr = client.exec_command(cmd, timeout=30)
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    if out:
        for l in out.splitlines(): print(f"   {l}")
    if err:
        for l in err.splitlines(): print(f"   !! {l}")
    return out

run("sudo systemctl status pkthub --no-pager -l", "service status")
run("tail -50 /mnt/software/logs/pkthub.log 2>/dev/null || echo 'NO LOG FILE'", "app log")
run("sudo ss -tlnp | grep 8760 || echo 'PORT 8760 NOT IN USE'", "port check")
run("curl -k -s -o /dev/null -w '%{http_code}' https://localhost:8760/api/health 2>&1 || echo 'curl failed'", "health check")

client.close()
print("\nDone.")
