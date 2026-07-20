"""
Production entrypoint — reads host/port from Settings (config.yaml) at
process start, instead of a fixed --port flag in the systemd unit, and
auto-detects an uploaded SSL cert the same way pktlog's start.sh does.

This is what lets Settings → General "Port" actually take effect on
restart: saving just rewrites config.yaml, and the next process start picks
it up here. Same for SSL: app/ssl_api.py already uploads certs to
/etc/ssl/pkthub/{cert,key}.pem — enabling HTTPS used to require hand-editing
the systemd unit; now it's automatic once a cert/key pair exists there.
"""
from __future__ import annotations

from pathlib import Path

import uvicorn

from app.config import get_settings

CERT_PATH = Path("/etc/ssl/pkthub/cert.pem")
KEY_PATH = Path("/etc/ssl/pkthub/key.pem")


def main() -> None:
    settings = get_settings()
    kwargs = dict(host=settings.host, port=settings.port, log_level="info")

    if CERT_PATH.exists() and KEY_PATH.exists():
        kwargs["ssl_certfile"] = str(CERT_PATH)
        kwargs["ssl_keyfile"] = str(KEY_PATH)

    uvicorn.run("app.main:app", **kwargs)


if __name__ == "__main__":
    main()
