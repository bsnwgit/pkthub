"""
pktDashboard — FastAPI entry point.
Serves the single-page frontend and proxies dashboard data from pktFlow.
"""
from __future__ import annotations

import asyncio
import asyncio.subprocess as asp
import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Any, AsyncIterator, List, Optional

import httpx
import yaml
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.pktflow_client import PktFlowClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("pktdashboard")

# ── Config ────────────────────────────────────────────────────────────────────

_CONFIG_CANDIDATES = [
    Path(os.environ.get("PKTDASHBOARD_INSTALL_DIR", "/opt/pktdashboard")) / "config.yaml",
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
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ── Frontend ──────────────────────────────────────────────────────────────────

_install_dir = Path(os.environ.get("PKTDASHBOARD_INSTALL_DIR", "/opt/pktdashboard"))

_frontend_dir = _install_dir / "frontend"
if not _frontend_dir.exists():
    _frontend_dir = Path(__file__).parent.parent / "frontend"

_logos_dir = _install_dir / "logos"
if not _logos_dir.exists():
    _logos_dir = Path(__file__).parent.parent / "logos"

app.mount("/logos", StaticFiles(directory=str(_logos_dir)), name="logos")


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


@app.get("/api/apps")
async def get_apps():
    c = _load_config()
    return c.get("apps", [])


class AppEntry(BaseModel):
    name: str
    url: str
    description: Optional[str] = ""
    icon: Optional[str] = "generic"


@app.post("/api/apps")
async def post_apps(apps: List[AppEntry]):
    try:
        c = _load_config()
        c["apps"] = [a.model_dump() for a in apps]
        _save_config(c)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/restart")
async def restart():
    def _do():
        time.sleep(0.8)
        import os
        os._exit(0)
    threading.Thread(target=_do, daemon=True).start()
    return {"ok": True}


# ── Admin ─────────────────────────────────────────────────────────────────────

_LOG_FILE = Path(os.environ.get("PKTDASHBOARD_LOG_FILE", "/var/log/pktdashboard/pktdashboard.log"))
_LOG_TAIL_LINES = 200


@app.get("/api/admin/status")
async def admin_status():
    """Return systemd active state and start timestamp."""
    async def _run(*args: str) -> str:
        proc = await asp.create_subprocess_exec(
            *args, stdout=asp.PIPE, stderr=asp.PIPE
        )
        out, _ = await proc.communicate()
        return out.decode("utf-8", errors="replace").strip()

    active = await _run("systemctl", "is-active", "pktdashboard")
    ts_raw = await _run(
        "systemctl", "show", "pktdashboard",
        "--property=ActiveEnterTimestamp", "--value"
    )
    pid_raw = await _run(
        "systemctl", "show", "pktdashboard",
        "--property=MainPID", "--value"
    )
    return {
        "active": active,           # "active" | "inactive" | "failed" | "unknown"
        "since": ts_raw,            # human timestamp from systemd
        "pid": pid_raw,
    }


async def _tail_log(path: Path, n: int = _LOG_TAIL_LINES) -> AsyncIterator[str]:
    """Yield SSE events: last N lines then stream new appends."""
    def _last_n(p: Path, count: int) -> list[str]:
        try:
            with p.open("rb") as f:
                f.seek(0, 2)
                size = f.tell()
                buf, pos = b"", max(0, size - 1024 * 64)
                f.seek(pos)
                buf = f.read()
            lines = buf.decode("utf-8", errors="replace").splitlines()
            return lines[-count:]
        except FileNotFoundError:
            return []

    # Send backlog
    backlog = await asyncio.to_thread(_last_n, path, n)
    for line in backlog:
        yield f"data: {json.dumps({'line': line, 'backlog': True})}\n\n"

    # Stream new lines
    def _open_at_end(p: Path):
        try:
            f = p.open("r", errors="replace")
            f.seek(0, 2)
            return f
        except FileNotFoundError:
            return None

    fh = await asyncio.to_thread(_open_at_end, path)
    try:
        while True:
            line = await asyncio.to_thread(lambda: fh.readline() if fh else "")
            if line:
                yield f"data: {json.dumps({'line': line.rstrip()})}\n\n"
            else:
                await asyncio.sleep(0.4)
                yield ": ping\n\n"
    except asyncio.CancelledError:
        pass
    finally:
        if fh:
            await asyncio.to_thread(fh.close)


@app.get("/api/admin/logs")
async def admin_logs():
    """SSE stream — last 200 log lines then live tail."""
    return StreamingResponse(
        _tail_log(_LOG_FILE),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


class TestPktflowBody(BaseModel):
    url: str
    username: str
    password: str


@app.post("/api/admin/test-pktflow")
async def test_pktflow(body: TestPktflowBody):
    """Test pktFlow connectivity and credentials. Returns {ok, error?, latency_ms?}.
    If password is the sentinel '__use_saved__', the stored config password is used."""
    url = body.url.rstrip("/")
    password = body.password
    if password == "__use_saved__":
        c = _load_config()
        password = c.get("pktflow_password", "")
    t0 = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=8, verify=False) as client:
            resp = await client.post(
                f"{url}/api/auth/login",
                json={"username": body.username, "password": password},
            )
        ms = int((time.monotonic() - t0) * 1000)
        if resp.status_code == 200:
            return {"ok": True, "latency_ms": ms}
        return {"ok": False, "error": f"HTTP {resp.status_code} from pktFlow login", "latency_ms": ms}
    except httpx.ConnectError as e:
        return {"ok": False, "error": f"Connection refused — {e}"}
    except httpx.TimeoutException:
        return {"ok": False, "error": "Timed out after 8 s"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


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
