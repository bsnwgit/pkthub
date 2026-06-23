"""
pktDashboard — FastAPI entry point.
Serves the single-page frontend and proxies dashboard data from pktFlow.
"""
from __future__ import annotations

import logging
from pathlib import Path

import yaml
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.pktflow_client import PktFlowClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("pktdashboard")

# ── Config ────────────────────────────────────────────────────────────────────

def _load_config() -> dict:
    candidates = [
        Path("/mnt/software/pktdashboard/config.yaml"),
        Path("config.yaml"),
    ]
    for p in candidates:
        if p.exists():
            with p.open() as f:
                cfg = yaml.safe_load(f) or {}
            log.info("Loaded config from %s", p)
            return cfg
    raise FileNotFoundError("config.yaml not found")

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

_frontend = Path("/mnt/software/pktdashboard/frontend/index.html")
if not _frontend.exists():
    _frontend = Path(__file__).parent.parent / "frontend" / "index.html"


@app.get("/", include_in_schema=False)
async def root():
    return FileResponse(str(_frontend))


# ── API ───────────────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/dashboard")
async def dashboard():
    return await pktflow.get_dashboard_data()
