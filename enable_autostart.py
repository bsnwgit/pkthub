# Enables the pkthub systemd service on boot and does a quick post-enable
# health/login smoke test.
#
# Usage:
#   PKTHUB_SSH_HOST=<host> PKTHUB_SSH_USER=<user> PKTHUB_SSH_KEY=<path-to-pem> python3 enable_autostart.py
# or:
#   python3 enable_autostart.py --host <host> --user <user> --key <path-to-pem> [--port 8760]
import argparse
import os
import sys

import paramiko

sys.stdout.reconfigure(encoding='utf-8')


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=os.environ.get("PKTHUB_SSH_HOST"),
                         help="SSH host/IP of the pktHub server")
    parser.add_argument("--user", default=os.environ.get("PKTHUB_SSH_USER"),
                         help="SSH username")
    parser.add_argument("--key", default=os.environ.get("PKTHUB_SSH_KEY"),
                         help="Path to SSH private key (.pem)")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PKTHUB_PORT", "8760")),
                         help="pktHub listen port (default: 8760)")
    args = parser.parse_args()
    missing = [name for name, val in (("--host/PKTHUB_SSH_HOST", args.host),
                                       ("--user/PKTHUB_SSH_USER", args.user),
                                       ("--key/PKTHUB_SSH_KEY", args.key)) if not val]
    if missing:
        parser.error(f"missing required value(s): {', '.join(missing)}")
    return args


def main():
    args = parse_args()

    key = paramiko.RSAKey.from_private_key_file(args.key)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(args.host, username=args.user, pkey=key, timeout=15, banner_timeout=15)

    def run(cmd, label=""):
        if label:
            print(f">> {label}")
        _, stdout, stderr = client.exec_command(cmd, timeout=20)
        out = stdout.read().decode("utf-8", errors="replace").strip()
        err = stderr.read().decode("utf-8", errors="replace").strip()
        if out:
            for l in out.splitlines():
                print(f"   {l}")
        if err:
            for l in err.splitlines():
                print(f"   !! {l}")

    # Enable service to start on boot
    run("sudo systemctl enable pkthub", "enable on boot")

    # Final status
    run("sudo systemctl status pkthub --no-pager | head -10", "final status")

    # Verify the API returns valid JSON
    run(f"curl -k -s https://localhost:{args.port}/api/health", "health response")

    # Check initial admin was created (uses the app's documented default seed
    # credentials — change the admin password immediately after first login)
    run(
        f"curl -k -s -X POST https://localhost:{args.port}/api/auth/login "
        "-H 'Content-Type: application/json' "
        "-d '{\"username\":\"admin\",\"password\":\"changeme\"}' | "
        "python3 -c 'import sys,json; d=json.load(sys.stdin); print(\"Login OK, role:\", d.get(\"role\", d))' "
        "2>&1 || echo 'login check failed'",
        "test admin login"
    )

    client.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
