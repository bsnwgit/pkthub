import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)

def run(cmd):
    _, o, e = c.exec_command(cmd, timeout=15)
    out = o.read().decode('utf-8', errors='replace').strip()
    if out: print(out)
    err = e.read().decode('utf-8', errors='replace').strip()
    if err: print("ERR:", err)

# Check columns on registered_apps
run("/mnt/software/pkthub/venv/bin/python3 -c \""
    "import sqlite3; db=sqlite3.connect('/mnt/software/pkthub/pkthub.db'); "
    "print('COLUMNS:', [r[1] for r in db.execute(\\\"PRAGMA table_info(registered_apps)\\\")]); "
    "print('ROWS:'); "
    "[print(dict(zip([d[0] for d in db.execute(\\\"SELECT * FROM registered_apps\\\").description], row))) "
    " for row in db.execute(\\\"SELECT id,name,base_url,return_url FROM registered_apps\\\")]; "
    "db.close()"
    "\"")

c.close()
