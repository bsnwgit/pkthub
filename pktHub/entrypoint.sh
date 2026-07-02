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
APP_DB_PATH="${APP_DB_PATH:-/data/pkthub.db}"

# Generate a JWT secret if not provided (stored in config.yaml on the volume)
if [ -z "$APP_JWT_SECRET" ]; then
  APP_JWT_SECRET=$(openssl rand -hex 32)
  echo "INFO: APP_JWT_SECRET not set — generated a random secret."
  echo "      To keep JWT sessions valid across container recreations,"
  echo "      set APP_JWT_SECRET to a fixed value in your .env file."
fi

# ── Create persistent data directories ────────
mkdir -p /data/ssl /data/logs /data/backups

# ── Generate config.yaml (first start only) ───
if [ ! -f /data/config.yaml ]; then
  echo "INFO: Generating /data/config.yaml from environment variables..."
  cat > /data/config.yaml <<EOF
# pktHub configuration — managed by Docker entrypoint
# To change settings, update env vars and recreate the container,
# or edit this file directly and restart the container.

host: "0.0.0.0"
port: ${APP_HTTP_PORT}
https: false
ssl_certfile: "/data/ssl/cert.pem"
ssl_keyfile: "/data/ssl/key.pem"

jwt_secret: "${APP_JWT_SECRET}"
jwt_algorithm: "HS256"
jwt_expire_minutes: 60

# Initial admin account — only used if no users exist in the database.
# To change the admin password after first start, use the Settings UI.
initial_admin_username: "${APP_ADMIN_USER}"
initial_admin_password: "${APP_ADMIN_PASSWORD}"
initial_admin_email: "${APP_ADMIN_EMAIL}"

# Okta / OIDC SSO (optional — leave blank to disable)
okta_domain: "${OKTA_DOMAIN:-}"
okta_client_id: "${OKTA_CLIENT_ID:-}"
okta_client_secret: "${OKTA_CLIENT_SECRET:-}"

db_path: "${APP_DB_PATH}"
health_poll_interval: 30
audit_retention_days: 90
trusted_cidrs: []
EOF
  echo "INFO: /data/config.yaml created."
else
  echo "INFO: /data/config.yaml already exists — skipping generation."
fi

# ── Generate self-signed SSL cert if absent ───
if [ ! -f /data/ssl/cert.pem ] || [ ! -f /data/ssl/key.pem ]; then
  echo "INFO: Generating self-signed SSL certificate..."
  openssl req -x509 -newkey rsa:4096 \
    -keyout /data/ssl/key.pem \
    -out    /data/ssl/cert.pem \
    -days   3650 \
    -nodes  \
    -subj   "/CN=pkthub/O=pktSolution/OU=Self-Signed" \
    2>/dev/null
  echo "INFO: Self-signed certificate created at /data/ssl/ (valid 10 years)."
  echo "      Replace with a CA-signed certificate by placing your cert.pem"
  echo "      and key.pem into the mapped data volume."
fi

# ── Write supervisord program config ──────────
# Generated here so port env vars are expanded at runtime.
cat > /etc/supervisor/conf.d/pkthub.conf <<EOF
[program:pkthub-http]
command=python -m uvicorn app.main:app --host 0.0.0.0 --port ${APP_HTTP_PORT}
directory=/app
autostart=true
autorestart=true
startretries=5
stdout_logfile=/data/logs/pkthub-http.log
stderr_logfile=/data/logs/pkthub-http.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=3

[program:pkthub-https]
command=python -m uvicorn app.main:app --host 0.0.0.0 --port ${APP_HTTPS_PORT} --ssl-certfile /data/ssl/cert.pem --ssl-keyfile /data/ssl/key.pem
directory=/app
autostart=true
autorestart=true
startretries=5
stdout_logfile=/data/logs/pkthub-https.log
stderr_logfile=/data/logs/pkthub-https.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=3
EOF

echo "INFO: Starting pktHub — HTTP :${APP_HTTP_PORT} / HTTPS :${APP_HTTPS_PORT}"
exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf
