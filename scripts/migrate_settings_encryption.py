#!/usr/bin/env python3
"""
One-time migration: encrypt existing plaintext values of the notification/AI
provider secrets in platform_config, using app.crypto.encrypt_str
(credential_key). See app/settings_api.py's _ENCRYPTED_AT_REST_KEYS.

Also handles ai_local_providers, a JSON list stored under its own key where
each entry has its own api_key field (see _unmask_local_providers) — those
are migrated per-entry rather than as a single flat value.

Safe to run more than once: any value that already decrypts successfully
under credential_key is left untouched.

Usage (from the installed app directory, with its venv active):
    venv/bin/python scripts/migrate_settings_encryption.py
"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings
from app.crypto import encrypt_str, decrypt_str

ENCRYPTED_AT_REST_KEYS = {
    "anthropic_api_key", "openai_api_key",
    "notify_email_password", "notify_pagerduty_integration_key",
    "notify_tracecat_api_token", "notify_webhook_url",
    "notify_slack_webhook_url", "notify_tracecat_webhook_url",
}


def _migrate_local_providers(conn: sqlite3.Connection) -> tuple[int, int, int]:
    """Encrypt each ai_local_providers entry's api_key in place. Returns
    (migrated, already_encrypted, empty) counts, same shape as the flat-key loop."""
    row = conn.execute(
        "SELECT value FROM platform_config WHERE key = 'ai_local_providers'"
    ).fetchone()
    if not row or not row[0]:
        return (0, 0, 0)

    try:
        providers = json.loads(row[0])
    except (ValueError, TypeError):
        return (0, 0, 0)
    if not isinstance(providers, list):
        return (0, 0, 0)

    migrated = already_encrypted = empty = 0
    changed = False
    result = []
    for p in providers:
        if not isinstance(p, dict):
            result.append(p)
            continue
        api_key = p.get("api_key")
        if not api_key:
            empty += 1
            result.append(p)
            continue
        if decrypt_str(api_key):
            already_encrypted += 1
            result.append(p)
            continue
        result.append({**p, "api_key": encrypt_str(api_key)})
        migrated += 1
        changed = True
        print(f"  encrypted ai_local_providers[id={p.get('id')!r}].api_key")

    if changed:
        conn.execute(
            "UPDATE platform_config SET value = ? WHERE key = 'ai_local_providers'",
            (json.dumps(result),),
        )
    return (migrated, already_encrypted, empty)


def main() -> int:
    settings = get_settings()
    if not settings.credential_key:
        print("ERROR: credential_key is not configured in config.yaml — aborting.")
        return 1

    conn = sqlite3.connect(settings.db_path)
    conn.row_factory = sqlite3.Row

    migrated = 0
    already_encrypted = 0
    empty = 0

    rows = conn.execute(
        "SELECT key, value FROM platform_config WHERE key IN ({})".format(
            ",".join("?" for _ in ENCRYPTED_AT_REST_KEYS)
        ),
        tuple(ENCRYPTED_AT_REST_KEYS),
    ).fetchall()

    for row in rows:
        key, value = row["key"], row["value"]
        if not value:
            empty += 1
            continue
        if decrypt_str(value):
            # Already decrypts under credential_key -> already migrated.
            already_encrypted += 1
            continue
        new_value = encrypt_str(value)
        conn.execute(
            "UPDATE platform_config SET value = ? WHERE key = ?",
            (new_value, key),
        )
        migrated += 1
        print(f"  encrypted platform_config.{key}")

    lp_migrated, lp_already, lp_empty = _migrate_local_providers(conn)
    migrated += lp_migrated
    already_encrypted += lp_already
    empty += lp_empty

    conn.commit()

    # Verification pass.
    verify_failures = 0
    rows = conn.execute(
        "SELECT key, value FROM platform_config WHERE key IN ({})".format(
            ",".join("?" for _ in ENCRYPTED_AT_REST_KEYS)
        ),
        tuple(ENCRYPTED_AT_REST_KEYS),
    ).fetchall()
    for row in rows:
        key, value = row["key"], row["value"]
        if not value:
            continue
        if not decrypt_str(value):
            verify_failures += 1
            print(f"  !! VERIFY FAILED: platform_config.{key} does not decrypt under credential_key")

    lp_row = conn.execute(
        "SELECT value FROM platform_config WHERE key = 'ai_local_providers'"
    ).fetchone()
    if lp_row and lp_row[0]:
        try:
            for p in json.loads(lp_row[0]):
                if isinstance(p, dict) and p.get("api_key") and not decrypt_str(p["api_key"]):
                    verify_failures += 1
                    print(f"  !! VERIFY FAILED: ai_local_providers[id={p.get('id')!r}].api_key does not decrypt under credential_key")
        except (ValueError, TypeError):
            pass

    conn.close()

    print()
    print(f"Migrated: {migrated}")
    print(f"Already encrypted: {already_encrypted}")
    print(f"Empty (left as-is): {empty}")
    print(f"Post-migration verify failures: {verify_failures}")

    return 1 if verify_failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
