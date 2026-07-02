#!/bin/bash
set -e

# ─────────────────────────────────────────────
#  pktHub Docker Entrypoint
#  Validates env vars, generates config and
#  SSL certs if absent, then starts supervisord.
# ─────────────────────────────────────────────

# ── Required env vars ─────────────────────────
if [ -z "$APP_ADMIN_PASSWORD" ]; then
  echo ""
  echo "ERROR: APP_ADMIN_PASSWORD is required but not set."
  echo "       Set it in your .env file or docker-compose environment block."
  echo "       Example: APP_ADMIN_PASSWORD=your_secure_password"
  echo ""
  exit 1
fi

# ── Optional env vars with defaults ───────────
APP_ADMIN_USER="${APP_ADMIN_USER:-admin}"
APP_ADMIN_EMAIL="${APP_ADMIN_EMAIL:-admin@localhost}"
APP_HTTP_PORT="${APP_HTTP_PORT:-80}"
APP_HTTPS_PORT="${APP_HTTPS_PORT:-443}"
DATA_DIR="${DATA_DIR:-/data}"

if [ -z "$APP_JWT_SECRET" ]; then
  APP_JWT_SECRET=$(openssl rand -hex 32)
  echo "INFO: APP_JWT_SECRET not set — generated a random secret."
  echo "      Set APP_JWT_SECRET to a fixed value to keep sessions valid"
  echo "      across container recreations."
fi

CONFIG_FILE="${DATA_DIR}/config.yaml"
CERT_FILE="${DATA_DIR}/ssl/cert.pem"
KEY_FILE="${DATA_DIR}/ssl/key.pem"

# ── Create persistent data directories ────────
mkdir -p "${DATA_DIR}/ssl" "${DATA_DIR}/logs" "${DATA_DIR}/backups"

# ── Generate or update config.yaml ────────────
if [ ! -f "${CONFIG_FILE}" ]; then
  echo "INFO: First start — creating ${CONFIG_FILE}"
  cat > "${CONFIG_FILE}" <<EOF
# pktHub configuration — managed by Docker entrypoint
# To change settings: update env vars and recreate the container,
# or edit this file directly on the data volume and restart.

host: "0.0.0.0"
port: ${APP_HTTP_PORT}
https: false
ssl_certfile: "${CERT_FILE}"
ssl_keyfile: "${KEY_FILE}"

jwt_secret: "${APP_JWT_SECRET}"
jwt_algorithm: "HS256"
jwt_expire_minutes: 60

# Initial admin account — only used if no users exist in the database.
# To change the admin password after first start, use Settings → Users.
initial_admin_username: "${APP_ADMIN_USER}"
initial_admin_password: "${APP_ADMIN_PASSWORD}"
initial_admin_email: "${APP_ADMIN_EMAIL}"

# Okta / OIDC SSO (leave blank to disable)
okta_domain: "${OKTA_DOMAIN:-}"
okta_client_id: "${OKTA_CLIENT_ID:-}"
okta_client_secret: "${OKTA_CLIENT_SECRET:-}"

db_path: "${DATA_DIR}/pkthub.db"
health_poll_interval: 30
audit_retention_days: 90
trusted_cidrs: []
EOF
else
  echo "INFO: ${CONFIG_FILE} exists — applying env var overrides..."
  python3 - <<PYEOF
import yaml, os

cfg_path = os.environ["CONFIG_FILE"]
with open(cfg_path) as f:
    cfg = yaml.safe_load(f) or {}

# Override auth-sensitive fields from env each restart
cfg["jwt_secret"]             = os.environ.get("APP_JWT_SECRET", cfg.get("jwt_secret", ""))
cfg["initial_admin_username"] = os.environ.get("APP_ADMIN_USER", cfg.get("initial_admin_username", "admin"))
cfg["initial_admin_password"] = os.environ.get("APP_ADMIN_PASSWORD", cfg.get("initial_admin_password", ""))
cfg["ssl_certfile"]           = os.environ["CERT_FILE"]
cfg["ssl_keyfile"]            = os.environ["KEY_FILE"]
cfg["db_path"]                = os.path.join(os.environ["DATA_DIR"], "pkthub.db")

with open(cfg_path, "w") as f:
    yaml.dump(cfg, f, default_flow_style=False, allow_unicode=True)
print("INFO: config.yaml updated from env vars.")
PYEOF
fi

export CONFIG_FILE CERT_FILE KEY_FILE DATA_DIR

# ── Generate self-signed SSL cert if absent ───
if [ ! -f "${CERT_FILE}" ] || [ ! -f "${KEY_FILE}" ]; then
  echo "INFO: Generating self-signed SSL certificate (valid 10 years)..."
  openssl req -x509 -newkey rsa:4096 \
    -keyout "${KEY_FILE}" \
    -out    "${CERT_FILE}" \
    -days   3650 \
    -nodes  \
    -subj   "/CN=pkthub/O=pktSolution/OU=Self-Signed" \
    2>/dev/null
  echo "INFO: Certificate written to ${CERT_FILE}"
  echo "      Replace with a CA-signed cert by placing your cert.pem and key.pem"
  echo "      in the data volume's ssl/ directory."
fi

export PKTSUITE_CONFIG="${CONFIG_FILE}"

# ── Write supervisord program config ──────────
# Generated at runtime so port env vars are expanded correctly.
cat > /etc/supervisor/conf.d/pkthub.conf <<EOF
[program:pkthub-http]
command=python -m uvicorn app.main:app --host 0.0.0.0 --port ${APP_HTTP_PORT}
directory=/app
autostart=true
autorestart=true
startretries=5
stdout_logfile=${DATA_DIR}/logs/pkthub-http.log
stderr_logfile=${DATA_DIR}/logs/pkthub-http.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=3

[program:pkthub-https]
command=python -m uvicorn app.main:app --host 0.0.0.0 --port ${APP_HTTPS_PORT} --ssl-certfile ${CERT_FILE} --ssl-keyfile ${KEY_FILE}
directory=/app
autostart=true
autorestart=true
startretries=5
stdout_logfile=${DATA_DIR}/logs/pkthub-https.log
stderr_logfile=${DATA_DIR}/logs/pkthub-https.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=3
EOF

echo "INFO: Starting pktHub — HTTP :${APP_HTTP_PORT} / HTTPS :${APP_HTTPS_PORT}"
exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf
