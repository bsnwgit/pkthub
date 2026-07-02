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

# Check config.yaml for admin credentials
run("grep -E 'initial_admin|admin' /mnt/software/pkthub/config.yaml | grep -v '#'", "config admin settings")

# Check the users table in the DB
run(
    "cd /mnt/software/pkthub && /mnt/software/pkthub/venv/bin/python3 -c \""
    "import sqlite3; c=sqlite3.connect('pkthub.db'); "
    "rows=c.execute('SELECT id, username, role FROM users').fetchall(); "
    "print('Users:', rows); c.close()\"",
    "users in DB"
)

# Check auth.py for default admin creation
run("grep -A10 'ensure_initial_admin\|initial_admin' /mnt/software/pkthub/app/auth.py | head -30", "auth.py initial admin")

client.close()
