import yaml
import os
from functools import lru_cache
from pathlib import Path
from typing import List

CONFIG_PATH = os.environ.get("PKTSUITE_CONFIG", "config.yaml")

def _resolve_install_dir(config_path: str) -> Path:
    env_dir = os.environ.get("PKTHUB_INSTALL_DIR")
    if env_dir:
        return Path(env_dir)
    if os.path.exists(config_path):
        return Path(config_path).resolve().parent
    return Path.cwd()

_INSTALL_DIR = _resolve_install_dir(CONFIG_PATH)

# Insecure placeholders that must never actually be used to sign JWTs,
# encrypt stored secrets, or gate the admin account — whether from this
# module's own in-code defaults, or from config.example.yaml being copied
# verbatim without editing.
_INSECURE_SECRET_VALUES = {
    "", "changeme",
    "CHANGE_ME_generate_with_openssl_rand_hex_32",
    "CHANGE_ME_generate_with_fernet_generate_key",
    "CHANGE_ME",
}


class Settings:
    def __init__(self, data: dict):
        self.install_dir = str(_INSTALL_DIR)
        self.host = data.get("host", "0.0.0.0")
        self.port = data.get("port", 8760)
        self.https = data.get("https", True)
        self.ssl_certfile = data.get("ssl_certfile", "")
        self.ssl_keyfile = data.get("ssl_keyfile", "")
        self.jwt_secret = data.get("jwt_secret", "changeme")
        self.jwt_algorithm = data.get("jwt_algorithm", "HS256")
        self.jwt_expire_minutes = data.get("jwt_expire_minutes", 60)
        # Fernet key for encrypting stored secrets (user API keys) at rest —
        # separate from jwt_secret since the two serve unrelated purposes.
        self.credential_key = data.get("credential_key", "")
        self.initial_admin_username = data.get("initial_admin_username", "admin")
        self.initial_admin_password = data.get("initial_admin_password", "changeme")
        self.initial_admin_email = data.get("initial_admin_email", "admin@localhost")
        self.okta_domain = data.get("okta_domain", "")
        self.okta_client_id = data.get("okta_client_id", "")
        self.okta_client_secret = data.get("okta_client_secret", "")
        self.db_path = data.get("db_path") or str(_INSTALL_DIR / "pkthub.db")
        self.health_poll_interval = data.get("health_poll_interval", 30)
        self.audit_retention_days = data.get("audit_retention_days", 90)
        self.trusted_cidrs: List[str] = data.get("trusted_cidrs", [])

        self._validate_secrets()

    def _validate_secrets(self) -> None:
        """
        Fail loudly at startup rather than silently running with a
        publicly-known secret. jwt_secret/credential_key sign or encrypt
        real data; initial_admin_password gates the admin account on first
        run — none of them may be missing or left as a placeholder value
        copied from config.example.yaml.
        """
        for field, value in (
            ("jwt_secret", self.jwt_secret),
            ("credential_key", self.credential_key),
            ("initial_admin_password", self.initial_admin_password),
        ):
            if (value or "").strip() in _INSECURE_SECRET_VALUES:
                raise RuntimeError(
                    f"pktHub refuses to start: {field} is missing or still set to a "
                    f"placeholder value from config.example.yaml. Set a real, unique "
                    f"{field} in config.yaml before starting the service "
                    f"(run install.sh, which generates these automatically, or see "
                    f"config.example.yaml for how to generate one manually)."
                )


@lru_cache()
def get_settings() -> Settings:
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "r") as f:
            data = yaml.safe_load(f) or {}
    else:
        data = {}
    return Settings(data)
