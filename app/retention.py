"""
Retention scheduler.

`audit_retention_days` and `alert_retention_days` were exposed in Settings and
read into config, but nothing anywhere in the app ever read them back to delete
anything — both tables grew for the life of the deployment. The audit log is the
worse of the two, because it gains a row on every administrative action and is
never trimmed by any other path.

This is the same gap that let pktSNMP's poll table reach 129 million rows, and
it is fixed here the same way: a scheduled job that calls a real delete and logs
every run, including the ones that remove nothing.

Only *resolved* alerts are eligible. An active alert is current state rather
than history, so ageing one out would hide a live problem rather than tidy up
after it.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

import aiosqlite

from app.config import get_settings

log = logging.getLogger("pkthub.retention")

# Retention is expressed in days, so once a day is enough.
_INTERVAL_SECONDS = 86_400

# Let startup settle — init_db, the admin check and the first health poll all
# run first, and a prune racing those only makes a slow boot slower.
_FIRST_RUN_DELAY_SECONDS = 300

_DEFAULTS = {"audit_retention_days": 90, "alert_retention_days": 90}

# Deleted in batches so a first run against a table that has never been pruned
# cannot hold a write lock for minutes or balloon the WAL by everything it
# touches. pktLog's database corrupted twice under long unbatched writes.
_BATCH = 20_000


class RetentionScheduler:
    def __init__(self, interval_seconds: int = _INTERVAL_SECONDS):
        self._interval = interval_seconds
        self._task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        self._task = asyncio.create_task(self._run_loop())
        log.info(f"Retention scheduler started (interval={self._interval}s)")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _days(self, db: aiosqlite.Connection, key: str) -> int:
        try:
            async with db.execute(
                "SELECT value FROM platform_config WHERE key = ?", (key,)
            ) as cur:
                row = await cur.fetchone()
            if row and row[0] not in (None, ""):
                return int(str(row[0]).strip('"'))
        except Exception as e:
            log.warning(f"Could not read {key} ({e}) — using default")
        return _DEFAULTS[key]

    async def _delete_batched(self, db: aiosqlite.Connection, sql: str, args: tuple) -> int:
        total = 0
        while True:
            cur = await db.execute(sql, args)
            await db.commit()
            if not cur.rowcount or cur.rowcount <= 0:
                break
            total += cur.rowcount
            if cur.rowcount < _BATCH:
                break
            await asyncio.sleep(0)
        return total

    async def run_once(self) -> dict:
        cfg = get_settings()
        out: dict = {}
        async with aiosqlite.connect(cfg.db_path) as db:
            audit_days = await self._days(db, "audit_retention_days")
            alert_days = await self._days(db, "alert_retention_days")

            if audit_days > 0:
                out["audit_log"] = await self._delete_batched(
                    db,
                    f"DELETE FROM audit_log WHERE id IN ("
                    f"  SELECT id FROM audit_log"
                    f"  WHERE timestamp < datetime('now', ?) LIMIT {_BATCH})",
                    (f"-{audit_days} days",),
                )
            else:
                out["audit_log"] = "disabled"

            if alert_days > 0:
                out["app_alerts"] = await self._delete_batched(
                    db,
                    f"DELETE FROM app_alerts WHERE id IN ("
                    f"  SELECT id FROM app_alerts"
                    f"  WHERE status = 'resolved'"
                    f"    AND COALESCE(resolved_at, created_at) < datetime('now', ?)"
                    f"  LIMIT {_BATCH})",
                    (f"-{alert_days} days",),
                )
            else:
                out["app_alerts"] = "disabled"

        log.info(
            f"Retention run complete: audit_log={out['audit_log']} "
            f"app_alerts={out['app_alerts']} "
            f"(audit={audit_days}d, alerts={alert_days}d)"
        )
        return out

    async def _run_loop(self) -> None:
        await asyncio.sleep(_FIRST_RUN_DELAY_SECONDS)
        while True:
            try:
                await self.run_once()
            except Exception as e:
                log.error(f"Retention error: {e}")
            await asyncio.sleep(self._interval)
