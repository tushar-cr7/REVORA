"""
Configuration preflight: `python -m backend.app.preflight`

Checks, WITHOUT connecting to anything, that the process environment (including a repo-root `.env`, which
`config.py` loads) names a storage mode the backend will accept. `run.bat` runs it before launching the
servers so a missing or invalid setting is explained in the terminal instead of surfacing as "Failed to load
data" in the browser. It uses the same validation as startup (`load_storage_config`); it adds no rules and
never falls back to another storage mode. Exit code 0 = configuration accepted, 1 = refused.
"""
import sys
from pathlib import Path
from typing import Mapping, Optional, TextIO

from backend.app.config import ConfigurationError, load_storage_config

_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


def main(env: Optional[Mapping[str, str]] = None, out: Optional[TextIO] = None, env_file: Optional[Path] = None) -> int:
    out = out or sys.stdout
    env_file = _ENV_FILE if env_file is None else env_file
    try:
        config = load_storage_config(env)
    except ConfigurationError as exc:
        print(f"REVORA cannot start: {exc}", file=out)
        print("", file=out)
        if not env_file.exists():
            print(f"There is no {env_file.name} file ({env_file}).", file=out)
            print("  1. Copy .env.example to .env", file=out)
        else:
            print(f"Fix the setting in {env_file}.", file=out)
        print("  2. Set REVORA_STORAGE=postgres and a real DATABASE_URL (then run", file=out)
        print("     `python -m backend.app.db.migrate upgrade` once), or REVORA_STORAGE=memory for a", file=out)
        print("     NOT durable demo where everything is lost on restart.", file=out)
        return 1
    if config.durable:
        print("Configuration OK: durable PostgreSQL storage (connection is checked when the backend starts).", file=out)
    else:
        print("Configuration OK: IN-MEMORY storage - NOT durable, all data is lost when the backend stops.", file=out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
