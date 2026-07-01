"""Fix pkthub.service on server — update all pktsuite paths to pkthub."""
import paramiko
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')

HOST = "172.23.80.5"
USER = "ec2-user"
KEY_PATH = r"C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem"

SERVICE = """[Unit]
Description=pktHub NOC/SOC Management Hub
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/mnt/software/pkthub
Environment=PKTSUITE_CONFIG=/mnt/software/pkthub/config.yaml
ExecStart=/mnt/software/pkthub/venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8760 --ssl-certfile /etc/ssl/pkthub/cert.pem --ssl-keyfile /etc/ssl/pkthub/key.pem
Restart=always
RestartSec=5
StandardOutput=append:/mnt/software/pkthub/logs/pkthub.log
StandardError=append:/mnt/software/pkthub/logs/pkthub.log

[Install]
WantedBy=multi-user.target
"""

def run(c, cmd, label=""):
    if label:
        print(f"  >> {label}")
    _, o, e = c.exec_command(cmd, timeout=30)
    out = o.read().decode("utf-8", errors="replace").strip()
    err = e.read().decode("utf-8", errors="replace").strip()
    if out:
        for line in out.splitlines():
            print(f"     {line}")
    if err:
        for line in err.splitlines():
            print(f"  !! {line}")
    return out

key = paramiko.RSAKey.from_private_key_file(KEY_PATH)
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, pkey=key, timeout=15)
print("Connected.")

# Write service file via echo to avoid sftp issues
escaped = SERVICE.replace("'", "'\\''")
run(c, f"printf '%s' '{escaped}' > /tmp/pkthub_new.service", "write service to /tmp")
run(c, "sudo cp /tmp/pkthub_new.service /etc/systemd/system/pkthub.service", "install service")
run(c, "cat /etc/systemd/system/pkthub.service", "verify installed content")
run(c, "sudo systemctl daemon-reload", "daemon-reload")
run(c, "sudo systemctl restart pkthub", "restart pkthub")
time.sleep(5)
run(c, "sudo systemctl is-active pkthub", "is-active")
run(c, "sudo systemctl status pkthub --no-pager -l | head -20", "status")
run(c, "tail -30 /mnt/software/pkthub/logs/pkthub.log 2>/dev/null || echo 'no log yet'", "log tail")

c.close()
