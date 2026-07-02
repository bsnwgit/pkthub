import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r"C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem")
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("172.23.80.5", username="ec2-user", pkey=key, timeout=15, banner_timeout=15)

def run(cmd, label=""):
    if label: print(f">> {label}")
    _, stdout, stderr = client.exec_command(cmd, timeout=20)
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    if out:
        for l in out.splitlines(): print(f"   {l}")
    if err:
        for l in err.splitlines(): print(f"   !! {l}")

# Enable service to start on boot
run("sudo systemctl enable pkthub", "enable on boot")

# Final status
run("sudo systemctl status pkthub --no-pager | head -10", "final status")

# Verify the API returns valid JSON
run(
    "curl -k -s https://localhost:8760/api/health",
    "health response"
)

# Check initial admin was created
run(
    "curl -k -s -X POST https://localhost:8760/api/auth/login "
    "-H 'Content-Type: application/json' "
    "-d '{\"username\":\"admin\",\"password\":\"changeme\"}' | python3 -c 'import sys,json; d=json.load(sys.stdin); print(\"Login OK, role:\", d.get(\"role\", d))'  2>&1 || echo 'login check failed'",
    "test admin login"
)

client.close()
print("\nDone.")
