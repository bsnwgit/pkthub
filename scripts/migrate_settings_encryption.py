#!/usr/bin/env python3
"""
One-time migration: encrypt existing plaintext values of the notification
secrets in platform_config, using app.crypto.encrypt_str (credential_key).
See app/settings_api.py's _ENCRYPTED_AT_REST_KEYS.

Safe to run more than once: any value that already decrypts successfully
under credential_key is left untouched.

Usage (from the installed app directory, with its venv active):
    venv/bin/python scripts/migrate_settings_encryption.py
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings
from app.crypto import encrypt_str, decrypt_str

ENCRYPTED_AT_REST_KEYS = {
    "notify_email_password", "notify_pagerduty_integration_key",
    "notify_tracecat_api_token", "notify_webhook_url",
    "notify_slack_webhook_url", "notify_tracecat_webhook_url",
}


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

    conn.close()

    print()
    print(f"Migrated: {migrated}")
    print(f"Already encrypted: {already_encrypted}")
    print(f"Empty (left as-is): {empty}")
    print(f"Post-migration verify failures: {verify_failures}")

    return 1 if verify_failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
