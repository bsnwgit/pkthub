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
    return out

print("=== pktHub Verification ===\n")

# Health
run("curl -k -s https://localhost:8760/api/health", "GET /api/health")

# Login
run(
    "curl -k -s -X POST https://localhost:8760/api/auth/login "
    "-H 'Content-Type: application/json' "
    "-d '{\"username\":\"admin\",\"password\":\"CHANGE_ME\"}' | python3 -c "
    "'import sys,json; d=json.load(sys.stdin); "
    "tok=d.get(\"access_token\",\"\"); "
    "print(\"Token:\", tok[:40]+\"...\" if tok else d)'",
    "POST /api/auth/login (admin/CHANGE_ME)"
)

# Get token and test /me endpoint
run(
    "TOKEN=$(curl -k -s -X POST https://localhost:8760/api/auth/login "
    "-H 'Content-Type: application/json' "
    "-d '{\"username\":\"admin\",\"password\":\"CHANGE_ME\"}' | python3 -c 'import sys,json; print(json.load(sys.stdin).get(\"access_token\",\"\"))') && "
    "curl -k -s https://localhost:8760/api/auth/me -H \"Authorization: Bearer $TOKEN\"",
    "GET /api/auth/me"
)

# Dashboard
run(
    "TOKEN=$(curl -k -s -X POST https://localhost:8760/api/auth/login "
    "-H 'Content-Type: application/json' "
    "-d '{\"username\":\"admin\",\"password\":\"CHANGE_ME\"}' | python3 -c 'import sys,json; print(json.load(sys.stdin).get(\"access_token\",\"\"))') && "
    "curl -k -s https://localhost:8760/api/dashboard -H \"Authorization: Bearer $TOKEN\"",
    "GET /api/dashboard"
)

# App list
run(
    "TOKEN=$(curl -k -s -X POST https://localhost:8760/api/auth/login "
    "-H 'Content-Type: application/json' "
    "-d '{\"username\":\"admin\",\"password\":\"CHANGE_ME\"}' | python3 -c 'import sys,json; print(json.load(sys.stdin).get(\"access_token\",\"\"))') && "
    "curl -k -s https://localhost:8760/api/apps -H \"Authorization: Bearer $TOKEN\"",
    "GET /api/apps"
)

# Frontend (SPA)
run("curl -k -s -o /dev/null -w '%{http_code}' https://localhost:8760/", "GET / (SPA)")
run("curl -k -s -o /dev/null -w '%{http_code}' https://localhost:8760/login", "GET /login (SPA)")

print("\n=== All checks done ===")
client.close()
