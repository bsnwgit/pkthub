"""Backup, export, and restore endpoints for pktHub."""
import os, shutil, tarfile, tempfile, glob, logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse
import aiosqlite

from app.auth import require_admin
from app.database import get_db
from app.config import get_settings, CONFIG_PATH

router = APIRouter(prefix="/api/backup", tags=["backup"])
_log = logging.getLogger(__name__)

DB_PATH = get_settings().db_path


async def _get_backup_cfg(db: aiosqlite.Connection) -> dict:
    async with db.execute(
        "SELECT key, value FROM platform_config WHERE key IN (?, ?, ?)",
        ("backup_path", "backup_retain_count", "backup_auto_enabled"),
    ) as cur:
        rows = await cur.fetchall()
    kv = {r["key"]: r["value"] for r in rows}
    return {
        "path": kv.get("backup_path", "/mnt/software/pkthub_backups"),
        "retain": int(kv.get("backup_retain_count", "5") or "5"),
        "auto": kv.get("backup_auto_enabled", "false") == "true",
    }


def _create_snapshot(backup_dir: str, retain: int) -> str:
    """Create a .tar.gz snapshot of the DB and config. Returns snapshot filename."""
    os.makedirs(backup_dir, exist_ok=True)
    ts = datetime.utcnow().strftime("%Y-%m-%dT%H-%M-%S")
    snap_name = f"pkthub_backup_{ts}.tar.gz"
    snap_path = os.path.join(backup_dir, snap_name)

    with tempfile.TemporaryDirectory() as tmp:
        # Safe DB copy via sqlite3 backup API
        import sqlite3
        src = sqlite3.connect(DB_PATH)
        dst_db = os.path.join(tmp, "pkthub.db")
        dst = sqlite3.connect(dst_db)
        src.backup(dst)
        dst.close()
        src.close()

        # Copy config if present
        if os.path.exists(CONFIG_PATH):
            shutil.copy2(CONFIG_PATH, os.path.join(tmp, "config.yaml"))

        with tarfile.open(snap_path, "w:gz") as tar:
            tar.add(tmp, arcname="pkthub_backup")

    # Prune old snapshots
    snaps = sorted(glob.glob(os.path.join(backup_dir, "pkthub_backup_*.tar.gz")))
    while len(snaps) > retain:
        os.remove(snaps.pop(0))

    return snap_name


@router.post("/run")
async def run_backup(
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db),
):
    cfg = await _get_backup_cfg(db)
    try:
        name = _create_snapshot(cfg["path"], cfg["retain"])
        return {"ok": True, "snapshot": name, "message": f"Backup created: {name}"}
    except Exception as exc:
        _log.error("Backup failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/snapshots")
async def list_snapshots(
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db),
):
    cfg = await _get_backup_cfg(db)
    pattern = os.path.join(cfg["path"], "pkthub_backup_*.tar.gz")
    snaps = sorted(glob.glob(pattern), reverse=True)
    result = []
    for p in snaps:
        stat = os.stat(p)
        result.append({
            "name": os.path.basename(p),
            "size_mb": round(stat.st_size / 1024 / 1024, 2),
            "created": datetime.utcfromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M UTC"),
        })
    return result


@router.get("/export")
async def export_bundle(
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Create and stream an export bundle as a download."""
    cfg = await _get_backup_cfg(db)
    try:
        snap_name = _create_snapshot(cfg["path"], cfg["retain"])
        snap_path = os.path.join(cfg["path"], snap_name)
        return FileResponse(
            path=snap_path,
            filename=snap_name,
            media_type="application/gzip",
        )
    except Exception as exc:
        _log.error("Export failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/restore")
async def restore_bundle(
    file: UploadFile = File(...),
    current_user: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Upload a backup .tar.gz and restore the DB and config from it."""
    if not file.filename.endswith(".tar.gz"):
        raise HTTPException(status_code=400, detail="File must be a .tar.gz backup bundle")

    cfg = await _get_backup_cfg(db)
    os.makedirs(cfg["path"], exist_ok=True)

    try:
        with tempfile.TemporaryDirectory() as tmp:
            upload_path = os.path.join(tmp, "upload.tar.gz")
            contents = await file.read()
            with open(upload_path, "wb") as f:
                f.write(contents)

            # Validate it contains pkthub.db
            with tarfile.open(upload_path, "r:gz") as tar:
                members = tar.getnames()
                db_member = next((m for m in members if m.endswith("pkthub.db")), None)
                if not db_member:
                    raise HTTPException(status_code=400, detail="Invalid bundle: pkthub.db not found")
                tar.extractall(tmp)

            extracted_db = os.path.join(tmp, db_member)
            backup_existing = DB_PATH + ".pre_restore"
            shutil.copy2(DB_PATH, backup_existing)

            # Replace DB (service must be restarted for full effect)
            shutil.copy2(extracted_db, DB_PATH)

            # Restore config if present
            cfg_member = next((m for m in members if m.endswith("config.yaml")), None)
            if cfg_member:
                extracted_cfg = os.path.join(tmp, cfg_member)
                shutil.copy2(extracted_cfg, CONFIG_PATH)

        return {
            "ok": True,
            "message": "Restore complete. Restart the service for all changes to take effect.",
        }
    except HTTPException:
        raise
    except Exception as exc:
        _log.error("Restore failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))
