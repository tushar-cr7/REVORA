import os
from dataclasses import dataclass
from typing import List, Mapping, Optional

try:  # a local, gitignored .env is a convenience; the process environment always wins
    from dotenv import load_dotenv

    load_dotenv(override=False)
except ImportError:  # python-dotenv is optional at runtime
    pass


class Settings:
    PORT: int = int(os.getenv("PORT", "8000"))
    ENV: str = os.getenv("ENV", "development")
    CORS_ORIGINS: List[str] = [
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,*").split(",")
        if origin.strip()
    ]
    LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "none")
    DEFAULT_MERCHANT_ID: str = os.getenv("DEFAULT_MERCHANT_ID", "merch_001")
    MODEL_PATH: str = os.getenv(
        "MODEL_PATH",
        os.path.join(os.path.dirname(os.path.dirname(__file__)), "recovery_model.joblib")
    )


settings = Settings()


# ── persistence ──────────────────────────────────────────────────────────
class ConfigurationError(RuntimeError):
    """The process is configured in a way that cannot run safely. The message says how to fix it."""


STORAGE_POSTGRES = "postgres"
STORAGE_MEMORY = "memory"

# Sample credentials shipped in .env.example / the docs. Running against them is always a mistake.
_PLACEHOLDER_CREDENTIALS = ("user:password@", ":change_me@")

_TRUE = {"1", "true", "yes", "on"}
_FALSE = {"", "0", "false", "no", "off"}


@dataclass(frozen=True)
class StorageConfig:
    backend: str                      # "postgres" | "memory"
    database_url: Optional[str]
    schema: Optional[str]
    pool_size: int
    auto_migrate: bool
    reservation_timeout_seconds: int

    @property
    def durable(self) -> bool:
        return self.backend == STORAGE_POSTGRES


def _flag(env: Mapping[str, str], name: str, default: bool = False) -> bool:
    raw = env.get(name)
    if raw is None:
        return default
    value = raw.strip().lower()
    if value in _TRUE:
        return True
    if value in _FALSE:
        return False
    raise ConfigurationError(f"{name} must be 1/0 (or true/false), got {raw!r}.")


def _integer(env: Mapping[str, str], name: str, default: int, low: int, high: int) -> int:
    raw = env.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw.strip())
    except ValueError:
        raise ConfigurationError(f"{name} must be an integer, got {raw!r}.") from None
    if not low <= value <= high:
        raise ConfigurationError(f"{name} must be between {low} and {high}, got {value}.")
    return value


def load_storage_config(env: Optional[Mapping[str, str]] = None) -> StorageConfig:
    """
    Decide where REVORA keeps its state, from the environment, and refuse to guess.

    REVORA_STORAGE must be set to 'postgres' (durable; needs DATABASE_URL) or 'memory' (NOT durable:
    demos and tests only). There is no default and no automatic fallback, so a missing or wrong
    database setting can never quietly become a process that looks durable but forgets everything on
    restart. Error messages never echo the database URL (it carries a password).
    """
    env = os.environ if env is None else env
    backend = (env.get("REVORA_STORAGE") or "").strip().lower()
    deployment = (env.get("ENV") or "development").strip().lower()

    if not backend:
        raise ConfigurationError(
            "REVORA_STORAGE is not set. Choose where REVORA keeps its state: "
            "'postgres' (durable; also set DATABASE_URL, then run `python -m backend.app.db.migrate upgrade`) "
            "or 'memory' (NOT durable: everything is lost on restart; for demos and tests only)."
        )
    if backend not in (STORAGE_POSTGRES, STORAGE_MEMORY):
        raise ConfigurationError(f"REVORA_STORAGE must be 'postgres' or 'memory', got {backend!r}.")

    pool_size = _integer(env, "REVORA_DB_POOL_SIZE", 10, 1, 100)
    reservation_timeout = _integer(env, "REVORA_RESERVATION_TIMEOUT_SECONDS", 900, 30, 86400)

    if backend == STORAGE_MEMORY:
        if deployment in ("production", "prod"):
            raise ConfigurationError(
                "REVORA_STORAGE=memory is refused when ENV=production: state would silently vanish on restart. "
                "Use REVORA_STORAGE=postgres."
            )
        return StorageConfig(STORAGE_MEMORY, None, None, pool_size, False, reservation_timeout)

    url = (env.get("DATABASE_URL") or "").strip()
    if not url:
        raise ConfigurationError(
            "REVORA_STORAGE=postgres but DATABASE_URL is not set. "
            "Example: postgresql://revora_app:<password>@localhost:5432/revora (keep it in .env, never in source control)."
        )
    if not url.startswith(("postgresql://", "postgres://")):
        raise ConfigurationError("DATABASE_URL must start with postgresql:// (a libpq connection URI).")
    if any(marker in url.lower() for marker in _PLACEHOLDER_CREDENTIALS):
        raise ConfigurationError(
            "DATABASE_URL still has the placeholder credentials from .env.example (CHANGE_ME / user:password). "
            "Set the real ones."
        )
    schema = (env.get("REVORA_DB_SCHEMA") or "").strip() or None
    if schema is not None:
        from backend.app.db.pool import validate_schema_name

        try:
            validate_schema_name(schema)
        except ValueError as exc:
            raise ConfigurationError(f"REVORA_DB_SCHEMA: {exc}") from None
    return StorageConfig(
        STORAGE_POSTGRES, url, schema, pool_size, _flag(env, "REVORA_DB_AUTO_MIGRATE"), reservation_timeout
    )
