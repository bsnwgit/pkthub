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
# Normalize: expand a leading ~ (read/env vars don't do this automatically —
# a literal "~" ends up baked into the config and the systemd unit, and
# systemd rejects a WorkingDirectory that isn't an absolute path), and
# strip any trailing slash so the SCRIPT_DIR/INSTALL_DIR string-equality
# check below (in-place install guard) isn't fooled by "/path/" vs "/path".
case "$INSTALL_DIR" in
    "~") INSTALL_DIR="$HOME" ;;
    "~/"*) INSTALL_DIR="$HOME/${INSTALL_DIR#\~/}" ;;
esac
INSTALL_DIR="${INSTALL_DIR%/}"
case "$INSTALL_DIR" in
    /*) ;;
    *)  echo "ERROR: install directory must be an absolute path (got '$INSTALL_DIR')." >&2
        exit 1 ;;
esac
if [ -z "${PKTHUB_PORT:-}" ] && [ -t 0 ]; then
    read -rp "Port [8760]: " PORT_INPUT
    PORT="${PORT_INPUT:-8760}"
else
    PORT="${PKTHUB_PORT:-8760}"
fi
# An unusable port reaches systemd unnoticed otherwise: the unit starts, the
# server fails to bind, systemd retries, and the install "succeeds" with
# nothing listening. Reject it here, while someone is watching.
case "$PORT" in
    ''|*[!0-9]*)
        echo "ERROR: port must be a number (got '$PORT')." >&2
        exit 1 ;;
esac
if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
    echo "ERROR: port must be between 1 and 65535 (got $PORT)." >&2
    exit 1
fi

echo "Installing pktHub to: $INSTALL_DIR"
echo "Port: $PORT"

# -- Existing installation ------------------------------------------------------
# Installing a new release over an old one leaves the previous app/ and
# migrations/ in place: modules the new version no longer ships stay
# importable, and the venv keeps pins requirements.txt has since moved past.
# Offer to clear that out first. Data — the config, the database, logs,
# backups and uploaded TLS material — is kept either way.
PREV_INSTALL=0
REMOVE_EXISTING=0
UNIT_FILE="/etc/systemd/system/pkthub.service"
if [ -f "$UNIT_FILE" ] || [ -d "$INSTALL_DIR/app" ] || [ -d "$INSTALL_DIR/venv" ]; then
    PREV_INSTALL=1
fi

if [ "$PREV_INSTALL" -eq 1 ]; then
    PREV_VERSION="(unknown)"
    if [ -f "$INSTALL_DIR/VERSION" ]; then
        PREV_VERSION="$(head -1 "$INSTALL_DIR/VERSION" 2>/dev/null || echo '(unknown)')"
    fi
    echo "Found an existing pktHub installation at $INSTALL_DIR (version $PREV_VERSION)."

    # A unit pointing somewhere else means the operator is moving the install.
    # Say so — the old directory keeps its database, and that is not obvious.
    PREV_UNIT_DIR=""
    if [ -f "$UNIT_FILE" ]; then
        PREV_UNIT_DIR="$(sed -n 's/^WorkingDirectory=//p' "$UNIT_FILE" | head -1)"
    fi
    if [ -n "$PREV_UNIT_DIR" ] && [ "$PREV_UNIT_DIR" != "$INSTALL_DIR" ]; then
        echo "  NOTE: the installed service runs from $PREV_UNIT_DIR, not $INSTALL_DIR."
        echo "        That directory and its data are left alone; this install takes"
        echo "        over the service name and the port."
    fi

    if [ "$SCRIPT_DIR" = "$INSTALL_DIR" ]; then
        # Nothing to remove — the install dir is this checkout, so the "old"
        # files and the new ones are the same files.
        echo "  Installing in place; the upgrade applies to this tree directly."
    elif [ -n "${PKTHUB_REMOVE_EXISTING:-}" ]; then
        REMOVE_EXISTING="$PKTHUB_REMOVE_EXISTING"
    elif [ -t 0 ]; then
        echo "  Uninstalling it first gives a clean install — stale modules and a"
        echo "  stale venv are removed. Your data is kept either way."
        read -rp "Uninstall the existing version first? [Y/n]: " REMOVE_INPUT
        case "$REMOVE_INPUT" in
            [nN]|[nN][oO]) REMOVE_EXISTING=0 ;;
            *)             REMOVE_EXISTING=1 ;;
        esac
    else
        # Non-interactive: upgrade over the top unless explicitly told
        # otherwise, so an unattended re-run never removes more than it must.
        REMOVE_EXISTING=0
    fi

    if [ "$REMOVE_EXISTING" = "1" ]; then
        if [ -f "$SCRIPT_DIR/uninstall.sh" ]; then
            echo "  Removing the existing installation (keeping data)..."
            bash "$SCRIPT_DIR/uninstall.sh" --keep-data --yes --dir "$INSTALL_DIR"
        else
            echo "  WARNING: uninstall.sh is not next to install.sh — continuing with"
            echo "           an in-place upgrade instead."
        fi
    fi
    echo ""
fi

# A port already answered by something else is the other common way a fresh
# install comes up dead. Only checked on a fresh install: on a re-install the
# listener is this app's own service, which is expected.
if [ "$PREV_INSTALL" -eq 0 ] && command -v ss &>/dev/null; then
    if ss -ltn "sport = :$PORT" 2>/dev/null | grep -q LISTEN; then
        echo "WARNING: port $PORT is already in use on this host:"
        ss -ltn "sport = :$PORT" 2>/dev/null | sed 's/^/    /' || true
        if [ -t 0 ]; then
            read -rp "Continue anyway? [y/N]: " PORT_CONFIRM
            case "$PORT_CONFIRM" in
                [yY]|[yY][eE][sS]) ;;
                *) echo "Aborted. Re-run and choose a free port."; exit 1 ;;
            esac
        else
            echo "         Continuing anyway (non-interactive)."
        fi
        echo ""
    fi
fi

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
    # Keep the existing config — it holds the JWT secret, the credential
    # encryption key and anything edited since. The port, though, was just
    # typed at the prompt, so apply that and leave every other line alone.
    CURRENT_PORT="$(sed -n 's/^port:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$INSTALL_DIR/config.yaml" | head -1)"
    if [ -n "$CURRENT_PORT" ] && [ "$CURRENT_PORT" != "$PORT" ]; then
        sed -i "s/^port:[[:space:]]*[0-9][0-9]*/port: $PORT/" "$INSTALL_DIR/config.yaml"
        echo "Existing config kept — port updated ($CURRENT_PORT -> $PORT)."
    else
        echo "Existing config kept (port is already $PORT)."
    fi
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
