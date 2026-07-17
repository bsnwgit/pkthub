import aiosqlite
import os
from app.config import get_settings

async def get_db():
    settings = get_settings()
    os.makedirs(os.path.dirname(settings.db_path), exist_ok=True)
    db = await aiosqlite.connect(settings.db_path)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    try:
        yield db
    finally:
        await db.close()

async def init_db():
    settings = get_settings()
    os.makedirs(os.path.dirname(settings.db_path), exist_ok=True)
    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA foreign_keys=ON")

        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                hashed_password TEXT,
                role TEXT NOT NULL DEFAULT 'viewer',
                is_active INTEGER NOT NULL DEFAULT 1,
                okta_sub TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                last_login TEXT
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS registered_apps (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                display_name TEXT NOT NULL,
                base_url TEXT NOT NULL,
                app_type TEXT NOT NULL,
                suite_token TEXT UNIQUE NOT NULL,
                status TEXT NOT NULL DEFAULT 'observe',
                health_status TEXT DEFAULT 'unknown',
                last_health_check TEXT,
                widget_manifest TEXT DEFAULT '[]',
                supported_versions TEXT DEFAULT '[1]',
                registered_at TEXT DEFAULT (datetime('now')),
                registered_by INTEGER REFERENCES users(id),
                return_url TEXT DEFAULT NULL
            )
        """)

        # Migration: add return_url to existing databases that predate this column
        async with db.execute("PRAGMA table_info(registered_apps)") as cur:
            cols = {row[1] for row in await cur.fetchall()}
        if "return_url" not in cols:
            await db.execute("ALTER TABLE registered_apps ADD COLUMN return_url TEXT DEFAULT NULL")
        if "access_mode" not in cols:
            await db.execute("ALTER TABLE registered_apps ADD COLUMN access_mode TEXT DEFAULT 'direct'")
        if "lock_verified_at" not in cols:
            await db.execute("ALTER TABLE registered_apps ADD COLUMN lock_verified_at TEXT DEFAULT NULL")

        # Migration: rename kiosk_layouts → noc_layouts (July 2026 NOC rename)
        async with db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='kiosk_layouts'"
        ) as cur:
            _old_noc = await cur.fetchone()
        async with db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='noc_layouts'"
        ) as cur:
            _new_noc = await cur.fetchone()
        if _old_noc and not _new_noc:
            await db.execute("ALTER TABLE kiosk_layouts RENAME TO noc_layouts")

        await db.execute("""
            CREATE TABLE IF NOT EXISTS noc_layouts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                layout TEXT NOT NULL DEFAULT '[]',
                display_mode TEXT NOT NULL DEFAULT 'static',
                dwell_seconds INTEGER DEFAULT 30,
                display_token TEXT UNIQUE,
                is_published INTEGER DEFAULT 0,
                published_at TEXT,
                created_by INTEGER REFERENCES users(id),
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS app_alerts (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                app_id      INTEGER NOT NULL,
                app_name    TEXT    NOT NULL,
                event_type  TEXT    NOT NULL,
                status      TEXT    NOT NULL DEFAULT 'active',
                resolved_at TEXT    DEFAULT NULL,
                acked_by    TEXT    DEFAULT NULL,
                acked_at    TEXT    DEFAULT NULL,
                created_at  TEXT    DEFAULT (datetime('now')),
                details     TEXT    DEFAULT '{}'
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_app_alerts_app_id ON app_alerts(app_id)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_app_alerts_status ON app_alerts(status)"
        )

        await db.execute("""
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER REFERENCES users(id),
                username TEXT,
                action TEXT NOT NULL,
                resource TEXT,
                details TEXT DEFAULT '{}',
                ip_address TEXT,
                timestamp TEXT DEFAULT (datetime('now'))
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS platform_config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS notification_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                config TEXT NOT NULL DEFAULT '{}',
                enabled INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS alert_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                event_type TEXT NOT NULL,
                severity TEXT NOT NULL DEFAULT 'warning',
                description TEXT DEFAULT '',
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """)

        # Seed default alert rules if table is empty
        async with db.execute("SELECT COUNT(*) FROM alert_rules") as cur:
            row = await cur.fetchone()
        if row[0] == 0:
            defaults = [
                ("App goes unreachable",       "app.unreachable",       "critical", "Fired when a registered pktAPP app stops responding to health checks."),
                ("App health degraded",         "app.degraded",          "warning",  "Fired when a pktAPP app responds but reports a non-healthy status."),
                ("App health recovered",        "app.recovered",         "info",     "Fired when a previously unreachable or degraded app comes back healthy."),
                ("Break-glass unlock triggered","break_glass.triggered", "critical", "Fired when the --emergency-unlock CLI is invoked on a pktAPP app."),
                ("App mode changed",            "app.mode_change",       "info",     "Fired when a pktAPP app is switched between Observe and Managed mode."),
            ]
            for name, event_type, severity, description in defaults:
                await db.execute(
                    "INSERT INTO alert_rules (name, event_type, severity, description, enabled) VALUES (?, ?, ?, ?, 1)",
                    (name, event_type, severity, description)
                )

        await db.commit()
