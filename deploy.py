import os
import time
import paramiko

HOST = "172.23.80.5"
USER = "ec2-user"
KEY  = r"C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem"

PROJECT = r"C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktDashboard"
REMOTE  = "/mnt/software/pktdashboard"

SVC_PASSWORD = "Pkt@Dash2026"


def ssh_connect():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, key_filename=KEY, timeout=15)
    return client


def run(client, cmd):
    print("  $ " + cmd)
    _, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    if out:
        print("    " + out.encode("ascii", errors="replace").decode())
    if err:
        print("    ERR: " + err.encode("ascii", errors="replace").decode())
    return out


def sftp_upload_dir(sftp, local_dir, remote_dir):
    try:
        sftp.mkdir(remote_dir)
    except OSError:
        pass
    for item in os.listdir(local_dir):
        lp = os.path.join(local_dir, item)
        rp = remote_dir + "/" + item
        if os.path.isdir(lp):
            sftp_upload_dir(sftp, lp, rp)
        else:
            print("  upload: " + item + " -> " + rp)
            sftp.put(lp, rp)


def main():
    print("=== pktDashboard Deploy ===")

    client = ssh_connect()
    sftp   = client.open_sftp()

    # 1. Create pktFlow service account
    print("\n[1/5] Creating pktFlow service account...")
    lines = [
        "import sys, sqlite3, bcrypt",
        "DB = '/mnt/software/pktflow/pktflow.db'",
        "hashed = bcrypt.hashpw(b'" + SVC_PASSWORD + "', bcrypt.gensalt()).decode()",
        "conn = sqlite3.connect(DB)",
        "try:",
        "    row = conn.execute(\"SELECT id FROM users WHERE username='pktdashboard'\").fetchone()",
        "    if row:",
        "        print('Service account already exists')",
        "    else:",
        "        conn.execute('INSERT INTO users (username, email, hashed_password, role, is_active) VALUES (?,?,?,?,?)',",
        "            ('pktdashboard','pktdashboard@internal',hashed,'viewer',1))",
        "        conn.commit()",
        "        print('Service account created')",
        "except Exception as e:",
        "    print('ERROR:', e); sys.exit(1)",
        "finally:",
        "    conn.close()",
    ]
    script = "\n".join(lines)
    with sftp.open("/tmp/_pktd_setup.py", "w") as f:
        f.write(script)
    run(client, "/mnt/software/pktflow/venv/bin/python3 /tmp/_pktd_setup.py")
    run(client, "rm /tmp/_pktd_setup.py")

    # 2. Create directories
    print("\n[2/5] Creating remote directories...")
    run(client, "mkdir -p " + REMOTE + "/app " + REMOTE + "/frontend /mnt/software/logs")

    # 3. Upload files
    print("\n[3/5] Uploading files...")
    sftp_upload_dir(sftp, os.path.join(PROJECT, "app"),      REMOTE + "/app")
    sftp_upload_dir(sftp, os.path.join(PROJECT, "frontend"), REMOTE + "/frontend")
    for fname in ["requirements.txt", "config.yaml"]:
        sftp.put(os.path.join(PROJECT, fname), REMOTE + "/" + fname)
        print("  upload: " + fname)

    # 4. Python venv
    print("\n[4/5] Setting up venv...")
    run(client, "python3 -m venv " + REMOTE + "/venv")
    run(client, REMOTE + "/venv/bin/pip install --quiet --upgrade pip")
    run(client, REMOTE + "/venv/bin/pip install --quiet -r " + REMOTE + "/requirements.txt")

    # 5. systemd
    print("\n[5/5] Installing systemd service...")
    sftp.put(os.path.join(PROJECT, "pktdashboard.service"), "/tmp/pktdashboard.service")
    run(client, "sudo cp /tmp/pktdashboard.service /etc/systemd/system/pktdashboard.service")
    run(client, "sudo systemctl daemon-reload")
    run(client, "sudo systemctl enable pktdashboard")
    run(client, "sudo systemctl restart pktdashboard")
    time.sleep(4)
    run(client, "sudo systemctl status pktdashboard --no-pager -l")

    sftp.close()
    client.close()
    print("\n==> Deploy complete: http://172.23.80.5:8760")


if __name__ == "__main__":
    main()
