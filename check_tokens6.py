import paramiko, sys, io
sys.stdout.reconfigure(encoding='utf-8')
key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)

# Write remote script via SFTP
remote_script = b"""
import sqlite3

db = sqlite3.connect("/mnt/software/pkthub/pkthub.db")
db.row_factory = sqlite3.Row

tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
print("TABLES:", tables)

if "registered_apps" in tables:
    schema = db.execute("SELECT sql FROM sqlite_master WHERE name='registered_apps'").fetchone()
    print("SCHEMA:", schema[0])
    rows = db.execute("SELECT * FROM registered_apps").fetchall()
    for row in rows:
        print("ROW:", dict(row))
else:
    print("No registered_apps table")

db.close()
"""

sftp = c.open_sftp()
sftp.putfo(io.BytesIO(remote_script), '/tmp/check_pkthub.py')
sftp.close()

_, o, e = c.exec_command('python3 /tmp/check_pkthub.py')
print(o.read().decode('utf-8', errors='replace'))
err = e.read().decode('utf-8', errors='replace')
if err: print('STDERR:', err)

c.close()
