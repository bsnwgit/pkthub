#!/usr/bin/env bash
# pktHub installer — run as root or via sudo.
set -euo pipefail

APP_NAME="pkthub"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── 1. Install directory + port ─────────────────────────────────────────────
if [ -z "${PKTHUB_INSTALL_DIR:-}" ] && [ -t 0 ]; then
    read -rp "Install directory [/opt/pkthub]: " INSTALL_DIR_INPUT
    INSTALL_DIR="${INSTALL_DIR_INPUT:-/opt/pkthub}"
else
    INSTALL_DIR="${PKTHUB_INSTALL_DIR:-/opt/pkthub}"
fi
if [ -z "${PKTHUB_PORT:-}" ] && [ -t 0 ]; then
    read -rp "Port [8760]: " PORT_INPUT
    PORT="${PORT_INPUT:-8760}"
else
    PORT="${PKTHUB_PORT:-8760}"
fi

echo "Installing pktHub to: $INSTALL_DIR"
echo "Port: $PORT"

# ── 2. Build frontend in place (before copy, so 'dist' travels with the tree)
if command -v npm >/dev/null 2>&1; then
    echo "Building frontend..."
    (cd "$SCRIPT_DIR/frontend" && npm ci --silent && npm run build --silent)
else
    echo "WARNING: npm not found — skipping frontend build."
    echo "         The UI will not load until 'frontend/dist' is built manually."
fi

# ── 3. Copy app tree into install dir (skip if installing in place) ────────
mkdir -p "$INSTALL_DIR"
if [ "$SCRIPT_DIR" != "$INSTALL_DIR" ]; then
    rsync -a \
        --exclude 'venv' \
        --exclude 'node_modules' \
        --exclude '.git' \
        --exclude '__pycache__' \
        --exclude '*.pyc' \
        --exclude '*.db' --exclude '*.db-shm' --exclude '*.db-wal' \
        --exclude 'logs/*.log' \
        --exclude 'config.yaml' \
        "$SCRIPT_DIR"/ "$INSTALL_DIR"/
else
    echo "Running install from within the install directory — skipping copy."
fi

cd "$INSTALL_DIR"
mkdir -p logs backups

# ── 4. Python venv + deps ───────────────────────────────────────────────────
if [ ! -d venv ]; then
    python3 -m venv venv
fi
"$INSTALL_DIR/venv/bin/pip" install --quiet --upgrade pip
"$INSTALL_DIR/venv/bin/pip" install --quiet -r requirements.txt

# ── 5. config.yaml — generate on first install only, never overwrite ───────
if [ ! -f config.yaml ]; then
    cp config.example.yaml config.yaml

    JWT_SECRET="$(openssl rand -hex 32)"
    ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
    # Fernet key for encrypting stored credentials (user API keys) at rest
    CRED_KEY="$(venv/bin/python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")"

    sed -i "s#CHANGE_ME_generate_with_openssl_rand_hex_32#${JWT_SECRET}#" config.yaml
    sed -i "s#CHANGE_ME_generate_with_fernet_generate_key#${CRED_KEY}#" config.yaml
    sed -i "s#initial_admin_password: \"CHANGE_ME\"#initial_admin_password: \"${ADMIN_PASSWORD}\"#" config.yaml
    sed -i "s/^port: 8760/port: ${PORT}/" config.yaml

    echo ""
    echo "==================================================================="
    echo " pktHub initial admin credentials — SAVE THESE, shown only once:"
    echo "   username: admin"
    echo "   password: ${ADMIN_PASSWORD}"
    echo "==================================================================="
    echo ""
else
    echo "Existing config.yaml found — leaving it untouched."
fi

INSTALL_USER="${SUDO_USER:-$(whoami)}"

# ── 6. systemd service ───────────────────────────────────────────────────────
# Installs on plain HTTP. Enabling HTTPS is an admin task: upload a cert via
# Settings > Security > SSL/TLS — app/server.py auto-detects it on the next
# restart, no unit file edit needed.
sed -e "s#__INSTALL_DIR__#${INSTALL_DIR}#g" -e "s#__INSTALL_USER__#${INSTALL_USER}#g" \
    "$INSTALL_DIR/pkthub.service" > /etc/systemd/system/pkthub.service

chown -R "${INSTALL_USER}:${INSTALL_USER}" "$INSTALL_DIR"

systemctl daemon-reload
systemctl enable pkthub
systemctl restart pkthub

echo ""
echo "pktHub installed and running as '${INSTALL_USER}' from ${INSTALL_DIR}."
echo "Visit http://<this-host>:${PORT}"
