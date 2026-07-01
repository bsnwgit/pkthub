"""
pktHub deploy script
Uploads source to pkt server, builds frontend, restarts service.
Run: python deploy.py
"""
import paramiko
import sys
import os
import stat
import time

sys.stdout.reconfigure(encoding='utf-8')

HOST = "172.23.80.5"
USER = "ec2-user"
KEY_PATH = r"C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem"
LOCAL_ROOT = r"C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktHub"
REMOTE_ROOT = "/mnt/software/pkthub"

SKIP_PATTERNS = {".git", "node_modules", "__pycache__", ".pyc", "dist", "*.db", "config.yaml", "pkthub_briefing.md"}

def should_skip(path: str) -> bool:
    name = os.path.basename(path)
    for p in SKIP_PATTERNS:
        if p.startswith("*."):
            if name.endswith(p[1:]):
                return True
        elif name == p:
            return True
    return False

def connect():
    key = paramiko.RSAKey.from_private_key_file(KEY_PATH)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, pkey=key, timeout=15, banner_timeout=15)
    return client

def run(client, cmd, label=""):
    if label:
        print(f"  >> {label}")
    _, stdout, stderr = client.exec_command(cmd, timeout=120)
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    if out:
        for line in out.splitlines():
            print(f"     {line}")
    if err:
        for line in err.splitlines():
            print(f"  !! {line}")
    return out

def sftp_upload(sftp, local_dir, remote_dir):
    """Recursively upload local_dir to remote_dir."""
    if not os.path.exists(local_dir):
        print(f"  !! SKIPPED (not found): {local_dir}")
        return
    for root, dirs, files in os.walk(local_dir):
        # Filter dirs in-place
        dirs[:] = [d for d in dirs if not should_skip(os.path.join(root, d))]
        rel = os.path.relpath(root, local_dir).replace("\\", "/")
        remote_path = f"{remote_dir}/{rel}".replace("//", "/").rstrip("/.")
        if rel == ".":
            remote_path = remote_dir
        # Ensure remote directory exists
        try:
            sftp.stat(remote_path)
        except FileNotFoundError:
            sftp.mkdir(remote_path)
        for fname in files:
            if should_skip(fname):
                continue
            local_file = os.path.join(root, fname)
            remote_file = f"{remote_path}/{fname}"
            sftp.put(local_file, remote_file)
            print(f"  + {remote_file}")

def main():
    print("=" * 60)
    print("pktHub Deploy")
    print("=" * 60)
    print(f"  Source: {LOCAL_ROOT}")

    print("\n[1] Connecting…")
    client = connect()
    sftp = client.open_sftp()
    print("    Connected.")

    # Ensure target dirs exist
    print("\n[2] Creating remote directories…")
    for d in [REMOTE_ROOT, f"{REMOTE_ROOT}/app", f"{REMOTE_ROOT}/frontend", f"{REMOTE_ROOT}/logs"]:
        try:
            sftp.stat(d)
        except FileNotFoundError:
            sftp.mkdir(d)
    print("    OK.")

    # Upload backend
    print("\n[3] Uploading backend (app/)…")
    sftp_upload(sftp, os.path.join(LOCAL_ROOT, "app"), f"{REMOTE_ROOT}/app")

    # Upload root-level Python/config files
    print("\n[4] Uploading root files…")
    for fname in ["requirements.txt", "config.example.yaml", "pkthub.service"]:
        local = os.path.join(LOCAL_ROOT, fname)
        if os.path.exists(local):
            sftp.put(local, f"{REMOTE_ROOT}/{fname}")
            print(f"  + {fname}")

    # Upload frontend source
    print("\n[5] Uploading frontend source…")
    sftp_upload(sftp, os.path.join(LOCAL_ROOT, "frontend"), f"{REMOTE_ROOT}/frontend")

    sftp.close()

    # Install pip deps
    print("\n[6] Installing Python dependencies…")
    run(client,
        f"cd {REMOTE_ROOT} && pip3 install -r requirements.txt -q --user",
        "pip install")

    # Build frontend in /tmp (avoids disk space issues in app dir)
    print("\n[7] Building frontend (npm install + vite build)…")
    build_cmd = (
        f"cd /tmp && rm -rf pkthub_build && cp -r {REMOTE_ROOT}/frontend pkthub_build && "
        f"cd pkthub_build && npm install --silent && npm run build && "
        f"rm -rf {REMOTE_ROOT}/frontend/dist && "
        f"cp -r dist {REMOTE_ROOT}/frontend/dist"
    )
    run(client, build_cmd, "build")

    # Install/reload systemd service
    print("\n[8] Installing systemd service…")
    run(client,
        f"sudo cp {REMOTE_ROOT}/pkthub.service /etc/systemd/system/pkthub.service && sudo systemctl daemon-reload",
        "systemctl daemon-reload")

    # Create config from example if not present
    run(client,
        f"test -f {REMOTE_ROOT}/config.yaml || cp {REMOTE_ROOT}/config.example.yaml {REMOTE_ROOT}/config.yaml",
        "ensure config.yaml")

    # Restart service
    print("\n[9] Restarting pktHub service…")
    run(client, "sudo systemctl restart pkthub", "restart")
    time.sleep(3)
    run(client, "sudo systemctl is-active pkthub", "is-active check")
    run(client, "sudo systemctl status pkthub --no-pager -l | head -30", "status")

    client.close()
    print("\n[DONE] pktHub deployed. https://172.23.80.5:8760")

if __name__ == "__main__":
    main()
