"""Copy real settings from pktsuite config into pkthub config, fix auth."""
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
    if err and err: print("ERR:", err)
    return out

# Read the real pktsuite config so we can copy secrets
print("\n=== pktsuite config.yaml ===")
run("cat /mnt/software/pktsuite/config.yaml")

c.close()
