"""Diagnose Okta/SAML auth issue on pktHub server."""
import paramiko, sys, time
sys.stdout.reconfigure(encoding='utf-8')

key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)

def run(cmd, label=""):
    if label: print(f"\n=== {label} ===")
    _, o, e = c.exec_command(cmd, timeout=20)
    out = o.read().decode('utf-8', errors='replace').strip()
    err = e.read().decode('utf-8', errors='replace').strip()
    if out: print(out)
    if err: print("ERR:", err)
    return out

# 1. Check if python-saml is in pkthub venv
run("/mnt/software/pkthub/venv/bin/pip show python3-saml 2>&1 || echo MISSING", "python3-saml in pkthub venv")

# 2. Check if jose is in pkthub venv
run("/mnt/software/pkthub/venv/bin/pip show python-jose 2>&1 || echo MISSING", "python-jose in pkthub venv")

# 3. Check what's in pktsuite venv for comparison
run("/mnt/software/pktsuite/venv/bin/pip show python3-saml 2>&1 || echo MISSING", "python3-saml in pktsuite venv")

# 4. Check config.yaml on pkthub
run("cat /mnt/software/pkthub/config.yaml", "pkthub config.yaml")

# 5. Check recent app errors from log
run("grep -i 'error\\|exception\\|traceback\\|warn' /mnt/software/pkthub/logs/pkthub.log | tail -30", "recent errors in log")

c.close()
