"""
pktDashboard — FastAPI entry point.
Serves the single-page frontend and proxies dashboard data from pktFlow.
"""
from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Any

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.pktflow_client import PktFlowClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("pktdashboard")

# ── Config ────────────────────────────────────────────────────────────────────

_CONFIG_CANDIDATES = [
    Path("/mnt/software/pktdashboard/config.yaml"),
    Path("config.yaml"),
]

def _config_path() -> Path:
    for p in _CONFIG_CANDIDATES:
        if p.exists():
            return p
    raise FileNotFoundError("config.yaml not found")

def _load_config() -> dict:
    p = _config_path()
    with p.open() as f:
        cfg = yaml.safe_load(f) or {}
    log.info("Loaded config from %s", p)
    return cfg

def _save_config(data: dict) -> None:
    p = _config_path()
    with p.open("w") as f:
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True)
    log.info("Saved config to %s", p)

cfg = _load_config()

# ── pktFlow client ────────────────────────────────────────────────────────────

pktflow = PktFlowClient(
    base_url=cfg["pktflow_url"],
    username=cfg["pktflow_username"],
    password=cfg["pktflow_password"],
)

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="pktDashboard", docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# ── Frontend ──────────────────────────────────────────────────────────────────

_frontend_dir = Path("/mnt/software/pktdashboard/frontend")
if not _frontend_dir.exists():
    _frontend_dir = Path(__file__).parent.parent / "frontend"


@app.get("/", include_in_schema=False)
async def root():
    return FileResponse(str(_frontend_dir / "index.html"))


@app.get("/settings", include_in_schema=False)
async def settings_page():
    return FileResponse(str(_frontend_dir / "settings.html"))


# ── API ───────────────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/dashboard")
async def dashboard():
    return await pktflow.get_dashboard_data()


@app.get("/api/settings")
async def get_settings():
    c = _load_config()
    return {
        "ssl_enabled":      c.get("ssl_enabled", False),
        "ssl_cert":         c.get("ssl_cert", ""),
        "ssl_key":          c.get("ssl_key", ""),
        "pktflow_url":      c.get("pktflow_url", ""),
        "pktflow_username": c.get("pktflow_username", ""),
        "host":             c.get("host", "0.0.0.0"),
        "port":             c.get("port", 8760),
    }


class SettingsBody(BaseModel):
    ssl_enabled:      bool   = False
    ssl_cert:         str    = ""
    ssl_key:          str    = ""
    pktflow_url:      str    = ""
    pktflow_username: str    = ""
    pktflow_password: str    = ""
    host:             str    = "0.0.0.0"
    port:             int    = 8760


@app.post("/api/settings")
async def post_settings(body: SettingsBody):
    try:
        c = _load_config()
        c["ssl_enabled"]      = body.ssl_enabled
        c["ssl_cert"]         = body.ssl_cert
        c["ssl_key"]          = body.ssl_key
        c["pktflow_url"]      = body.pktflow_url      or c.get("pktflow_url", "")
        c["pktflow_username"] = body.pktflow_username  or c.get("pktflow_username", "")
        if body.pktflow_password:
            c["pktflow_password"] = body.pktflow_password
        c["host"] = body.host or c.get("host", "0.0.0.0")
        c["port"] = body.port or c.get("port", 8760)
        _save_config(c)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/restart")
async def restart():
    def _do():
        time.sleep(0.8)
        import os, sys
        os._exit(0)
    threading.Thread(target=_do, daemon=True).start()
    return {"ok": True}


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import os
    import uvicorn

    host = cfg.get("host", "0.0.0.0")
    port = int(cfg.get("port", 8760))

    ssl_enabled  = cfg.get("ssl_enabled", False)
    ssl_certfile = cfg.get("ssl_cert", "")
    ssl_keyfile  = cfg.get("ssl_key", "")

    ssl_args: dict = {}
    scheme = "http"

    if ssl_enabled:
        if not ssl_certfile or not os.path.isfile(ssl_certfile):
            log.warning("SSL enabled but ssl_cert not found: %s — starting without SSL", ssl_certfile)
        elif not ssl_keyfile or not os.path.isfile(ssl_keyfile):
            log.warning("SSL enabled but ssl_key not found: %s — starting without SSL", ssl_keyfile)
        else:
            ssl_args = {"ssl_certfile": ssl_certfile, "ssl_keyfile": ssl_keyfile}
            scheme = "https"

    log.info("Starting pktDashboard on %s://%s:%d", scheme, host, port)

    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        workers=1,
        log_level="info",
        access_log=False,
        **ssl_args,
    )
