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

        # Migration: add is_default_admin to existing databases that predate this column
        async with db.execute("PRAGMA table_info(users)") as cur:
            user_cols = {row[1] for row in await cur.fetchall()}
        if "is_default_admin" not in user_cols:
            await db.execute("ALTER TABLE users ADD COLUMN is_default_admin INTEGER NOT NULL DEFAULT 0")

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
                nav_manifest TEXT DEFAULT '[]',
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
        if "nav_manifest" not in cols:
            await db.execute("ALTER TABLE registered_apps ADD COLUMN nav_manifest TEXT DEFAULT '[]'")

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

        await db.execute("""
            CREATE TABLE IF NOT EXISTS user_api_keys (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                username    TEXT NOT NULL,
                provider    TEXT NOT NULL,
                api_key     TEXT NOT NULL DEFAULT '',
                updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE (username, provider)
            )
        """)

        # ── Resonance embed integration ───────────────────────────────────────
        # Three pieces of state, deliberately in SQLite rather than in-process:
        # the worker count is configurable, and an in-process counter silently
        # multiplies its own limit once there is more than one worker. The
        # sibling apps carry the same schema as migrations/029_resonance.sql;
        # pktHub has no migrations directory, so it lives here instead.

        # Fixed-window counters for /api/resonance/code.
        await db.execute("""
            CREATE TABLE IF NOT EXISTS resonance_rate (
                bucket       TEXT PRIMARY KEY,
                window_start TEXT NOT NULL,
                count        INTEGER NOT NULL DEFAULT 0
            )
        """)

        # One row. A rejected key makes resonance apply a geometric per-IP
        # backoff; this app is a single IP, so continuing to call with a bad key
        # would take the widget down for every user at once. The breaker stops
        # calling instead, and Settings reads this row so a paused integration
        # says so rather than looking like a feature that quietly does nothing.
        await db.execute("""
            CREATE TABLE IF NOT EXISTS resonance_breaker (
                id                   INTEGER PRIMARY KEY CHECK (id = 1),
                consecutive_failures INTEGER NOT NULL DEFAULT 0,
                open_until           TEXT,
                last_error           TEXT NOT NULL DEFAULT '',
                last_failure_at      TEXT
            )
        """)
        await db.execute("INSERT OR IGNORE INTO resonance_breaker (id) VALUES (1)")

        # embed.js gives up permanently and silently when its script fails to
        # load (ad blocker, wrong address, resonance down), so a broken widget is
        # invisible to the admin. The mount reports failures here, keyed by
        # day+user+reason so the table is bounded by users x reasons x retained
        # days rather than by how often a loop retries.
        await db.execute("""
            CREATE TABLE IF NOT EXISTS resonance_load_failures (
                day       TEXT NOT NULL,
                username  TEXT NOT NULL DEFAULT '',
                reason    TEXT NOT NULL DEFAULT '',
                count     INTEGER NOT NULL DEFAULT 0,
                last_seen TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (day, username, reason)
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_resonance_load_failures_day "
            "ON resonance_load_failures(day DESC)"
        )

        # Migration: per-user ipinfo.io section display preference (geolocation/
        # asn/company/privacy/abuse/domains), JSON array, NULL = all enabled.
        async with db.execute("PRAGMA table_info(user_api_keys)") as cur:
            uak_cols = {row[1] for row in await cur.fetchall()}
        if "enabled_fields" not in uak_cols:
            await db.execute("ALTER TABLE user_api_keys ADD COLUMN enabled_fields TEXT DEFAULT NULL")

        # Migration: per-user "use ipapi.is's free tier (no key)" preference.
        if "free_tier" not in uak_cols:
            await db.execute("ALTER TABLE user_api_keys ADD COLUMN free_tier INTEGER NOT NULL DEFAULT 0")

        # Migration: per-provider "show this provider's section in the IP
        # Lookup modal at all" preference (ipinfo/ipapi_is/abuseipdb/mxtoolbox).
        if "enabled" not in uak_cols:
            await db.execute("ALTER TABLE user_api_keys ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1")

        await db.commit()

        await _encrypt_legacy_api_keys(db)
        await _encrypt_legacy_suite_tokens(db)
        await _drop_ai_assistant_config(db)


async def _drop_ai_assistant_config(db):
    """One-time data migration: the in-app AI Assistant has been removed, so
    its provider configuration is deleted rather than left orphaned.

    These rows hold third-party API keys (Anthropic, OpenAI, and a per-entry
    key inside the ai_local_providers JSON blob). With no code left that
    reads them, leaving them behind would strand credentials in the database.
    Same _data_migrations marker table as the encryption migrations above."""
    await db.execute("""
        CREATE TABLE IF NOT EXISTS _data_migrations (
            name TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    await db.commit()

    marker = "drop_ai_assistant_config"
    async with db.execute(
        "SELECT 1 FROM _data_migrations WHERE name = ?", (marker,)
    ) as cur:
        if await cur.fetchone():
            return

    # Matched by pattern rather than an enumerated key list, deliberately.
    # Key names drifted between apps as the assistant was built out, so an
    # enumerated list silently purges nothing on an install whose names don't
    # happen to match. The ai\_% prefix is anchored so ordinary keys that merely
    # contain the letters (domain_name, available_slots, email_from) survive.
    await db.execute(
        r"""DELETE FROM platform_config WHERE
                   key LIKE 'ai\_%' ESCAPE '\'
                OR key LIKE '%anthropic%'
                OR key LIKE '%openai%'
                OR key LIKE '%ollama%'
                OR key LIKE '%claude%'"""
    )
    await db.execute("INSERT INTO _data_migrations (name) VALUES (?)", (marker,))
    await db.commit()


async def _encrypt_legacy_suite_tokens(db):
    """One-time data migration: registered_apps.suite_token (the token pkthub
    uses to authenticate into every sibling app it proxies) used to be
    stored in plaintext. Encrypt any row that isn't already a valid Fernet
    token. Same _data_migrations marker table as _encrypt_legacy_api_keys."""
    await db.execute("""
        CREATE TABLE IF NOT EXISTS _data_migrations (
            name TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    await db.commit()

    marker = "encrypt_legacy_suite_tokens"
    async with db.execute(
        "SELECT 1 FROM _data_migrations WHERE name = ?", (marker,)
    ) as cur:
        if await cur.fetchone():
            return

    from app.crypto import decrypt_str, encrypt_str

    async with db.execute(
        "SELECT id, suite_token FROM registered_apps WHERE suite_token != ''"
    ) as cur:
        rows = await cur.fetchall()

    for row_id, suite_token in rows:
        try:
            already_encrypted = bool(decrypt_str(suite_token))
        except Exception:
            already_encrypted = False
        if already_encrypted:
            continue
        await db.execute(
            "UPDATE registered_apps SET suite_token = ? WHERE id = ?",
            (encrypt_str(suite_token), row_id),
        )

    await db.execute("INSERT INTO _data_migrations (name) VALUES (?)", (marker,))
    await db.commit()


async def _encrypt_legacy_api_keys(db):
    """One-time data migration: user_api_keys.api_key used to be stored in
    plaintext. Encrypt any row that isn't already a valid Fernet token. This
    app has no _migrations version table (schema is inline ALTER-TABLE
    checks), so a tiny marker table tracks whether this has already run."""
    await db.execute("""
        CREATE TABLE IF NOT EXISTS _data_migrations (
            name TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    await db.commit()

    marker = "encrypt_legacy_user_api_keys"
    async with db.execute(
        "SELECT 1 FROM _data_migrations WHERE name = ?", (marker,)
    ) as cur:
        if await cur.fetchone():
            return

    from app.crypto import decrypt_str, encrypt_str

    async with db.execute(
        "SELECT id, api_key FROM user_api_keys WHERE api_key != ''"
    ) as cur:
        rows = await cur.fetchall()

    for row_id, api_key in rows:
        try:
            already_encrypted = bool(decrypt_str(api_key))
        except Exception:
            already_encrypted = False
        if already_encrypted:
            continue
        await db.execute(
            "UPDATE user_api_keys SET api_key = ? WHERE id = ?",
            (encrypt_str(api_key), row_id),
        )

    await db.execute("INSERT INTO _data_migrations (name) VALUES (?)", (marker,))
    await db.commit()
