# ─────────────────────────────────────────────
#  Stage 1 — Build React/Vite frontend
# ─────────────────────────────────────────────
FROM node:18-alpine AS frontend-builder

WORKDIR /build

COPY frontend/package*.json ./
RUN npm ci --silent

COPY frontend/ ./
RUN npm run build


# ─────────────────────────────────────────────
#  Stage 2 — Runtime image
# ─────────────────────────────────────────────
FROM python:3.11-slim

# System dependencies: openssl for cert generation, supervisor for process management
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl \
      supervisor \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code
COPY app/ ./app/

# Frontend build output from Stage 1
COPY --from=frontend-builder /build/dist ./frontend/dist/

# Entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# /data is the persistent volume mount point:
#   /data/config.yaml     — generated from env vars on first start
#   /data/pkthub.db       — SQLite database
#   /data/ssl/            — TLS certificate and key
#   /data/logs/           — application logs
#   /data/backups/        — database backups
VOLUME ["/data"]

# Default ports — override with APP_HTTP_PORT / APP_HTTPS_PORT env vars
EXPOSE 80 443

# Point the app at the volume-backed config
ENV PKTSUITE_CONFIG=/data/config.yaml

ENTRYPOINT ["/entrypoint.sh"]
