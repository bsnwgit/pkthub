# One-shot deployment: creates the pktdashboard read-only service account in
# pktFlow's DB, uploads app files, sets up the venv, optionally installs SSL
# certs, and installs/starts the systemd service.
#
# Usage:
#   PKTHUB_SSH_HOST=<host> PKTHUB_SSH_USER=<user> PKTHUB_SSH_KEY=<path-to-pem> python3 deploy.py
# or:
#   python3 deploy.py --host <host> --user <user> --key <path-to-pem> \
#       --project-dir <local-project-path> --install-dir /opt/pktdashboard \
#       --pktflow-install-dir /opt/pktflow --svc-password <password>
import argparse
import os
import sys
import time

import paramiko
import yaml

sys.stdout.reconfigure(encoding='utf-8')


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=os.environ.get("PKTHUB_SSH_HOST"),
                         help="SSH host/IP of the target server")
    parser.add_argument("--user", default=os.environ.get("PKTHUB_SSH_USER"),
                         help="SSH username")
    parser.add_argument("--key", default=os.environ.get("PKTHUB_SSH_KEY"),
                         help="Path to SSH private key (.pem)")
    parser.add_argument("--project-dir", default=os.environ.get("PKTHUB_PROJECT_DIR", os.getcwd()),
                         help="Local path to the pktDashboard project (default: cwd)")
    parser.add_argument("--install-dir", default=os.environ.get("PKTHUB_INSTALL_DIR", "/opt/pktdashboard"),
                         help="Remote install directory (default: /opt/pktdashboard)")
    parser.add_argument("--pktflow-install-dir", default=os.environ.get("PKTFLOW_INSTALL_DIR", "/opt/pktflow"),
                         help="Remote pktFlow install directory, used to create the service account "
                              "(default: /opt/pktflow)")
    parser.add_argument("--svc-password", default=os.environ.get("PKTHUB_SVC_PASSWORD"),
                         help="Password for the pktdashboard read-only service account in pktFlow "
                              "(required — no default; generate one with e.g. `openssl rand -base64 18`)")
    args = parser.parse_args()
    missing = [name for name, val in (("--host/PKTHUB_SSH_HOST", args.host),
                                       ("--user/PKTHUB_SSH_USER", args.user),
                                       ("--key/PKTHUB_SSH_KEY", args.key),
                                       ("--svc-password/PKTHUB_SVC_PASSWORD", args.svc_password)) if not val]
    if missing:
        parser.error(f"missing required value(s): {', '.join(missing)}")
    return args


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
    args = parse_args()

    project = args.project_dir
    remote = args.install_dir

    # Read local config.yaml to pick up SSL settings
    cfg_path = os.path.join(project, "config.yaml")
    with open(cfg_path) as f:
        cfg = yaml.safe_load(f) or {}
    ssl_enabled = bool(cfg.get("ssl_enabled", False))
    ssl_cert = cfg.get("ssl_cert", "").strip()
    ssl_key = cfg.get("ssl_key", "").strip()

    print("=== pktDashboard Deploy ===")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(args.host, username=args.user, key_filename=args.key, timeout=15)
    sftp = client.open_sftp()

    # 1. Create pktdashboard service account in pktFlow
    print("\n[1/6] Creating pktdashboard service account...")
    lines = [
        "import sys, sqlite3, bcrypt",
        f"DB = '{args.pktflow_install_dir}/pktflow.db'",
        "hashed = bcrypt.hashpw(b'" + args.svc_password + "', bcrypt.gensalt()).decode()",
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
    run(client, f"{args.pktflow_install_dir}/venv/bin/python3 /tmp/_pktd_setup.py")
    run(client, "rm /tmp/_pktd_setup.py")

    # 2. Create directories
    print("\n[2/6] Creating remote directories...")
    run(client, f"mkdir -p {remote}/app {remote}/frontend {remote}/logos /var/log/pktdashboard")

    # 3. Upload files
    print("\n[3/6] Uploading files...")
    sftp_upload_dir(sftp, os.path.join(project, "app"), remote + "/app")
    sftp_upload_dir(sftp, os.path.join(project, "frontend"), remote + "/frontend")
    sftp_upload_dir(sftp, os.path.join(project, "logos"), remote + "/logos")
    for fname in ["requirements.txt", "config.yaml"]:
        sftp.put(os.path.join(project, fname), remote + "/" + fname)
        print("  upload: " + fname)

    # 4. Python venv
    print("\n[4/6] Setting up venv...")
    run(client, f"python3 -m venv {remote}/venv")
    run(client, f"{remote}/venv/bin/pip install --quiet --upgrade pip")
    run(client, f"{remote}/venv/bin/pip install --quiet -r {remote}/requirements.txt")

    # 5. SSL certs (optional)
    if ssl_enabled:
        print("\n[5/6] Uploading SSL cert and key...")
        if not ssl_cert or not os.path.isfile(ssl_cert):
            raise FileNotFoundError("ssl_cert not found locally: " + ssl_cert)
        if not ssl_key or not os.path.isfile(ssl_key):
            raise FileNotFoundError("ssl_key not found locally: " + ssl_key)
        run(client, f"mkdir -p {remote}/tls && chmod 700 {remote}/tls")
        sftp.put(ssl_cert, remote + "/tls/cert.pem")
        print("  upload: cert.pem")
        sftp.put(ssl_key, remote + "/tls/key.pem")
        print("  upload: key.pem")
        run(client, f"chmod 600 {remote}/tls/key.pem")
    else:
        print("\n[5/6] SSL disabled — skipping cert upload")

    # 6. systemd
    print("\n[6/6] Installing systemd service...")
    sftp.put(os.path.join(project, "pktdashboard.service"), "/tmp/pktdashboard.service")
    run(client, "sudo cp /tmp/pktdashboard.service /etc/systemd/system/pktdashboard.service")
    run(client, "sudo systemctl daemon-reload")
    run(client, "sudo systemctl enable pktdashboard")
    run(client, "sudo systemctl restart pktdashboard")
    time.sleep(4)
    run(client, "sudo systemctl status pktdashboard --no-pager -l")

    sftp.close()
    client.close()
    scheme = "https" if ssl_enabled else "http"
    print(f"\n==> Deploy complete: {scheme}://{args.host}:8760")


if __name__ == "__main__":
    main()
