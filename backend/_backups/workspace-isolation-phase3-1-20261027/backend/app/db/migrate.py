"""
Versioned SQL migrations, applied in order, each inside its own transaction.

    python -m backend.app.db.migrate status
    python -m backend.app.db.migrate upgrade

Why not Alembic / SQLAlchemy: the repository layer talks SQL directly through psycopg2 (already a
dependency), the schema leans on PostgreSQL-specific constraints (partial unique indexes, CHECKs,
advisory locks) that are clearest written as SQL, and a migration runner is ~100 lines. The cost
is no autogeneration and no downgrade scripts; revisit if the schema starts churning.

Rules
  * Files are `NNNN_name.sql` in `migrations/`, contiguous from 0001.
  * A file that has been applied is never edited: its checksum (line endings normalised) is
    recorded and a mismatch aborts. Fix forward with a new file.
  * Concurrent migrators serialise on a PostgreSQL advisory lock.
"""
import argparse
import hashlib
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

import psycopg2

from backend.app.db.pool import validate_schema_name
from backend.app.repositories.errors import SchemaNotReady

MIGRATIONS_DIR = Path(__file__).parent / "migrations"
_FILE_RE = re.compile(r"^(\d{4})_([a-z0-9_]+)\.sql$")


class MigrationError(RuntimeError):
    """A migration could not be applied, or the recorded history disagrees with the files."""


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    sql: str
    checksum: str


def load_migrations(directory: Path = MIGRATIONS_DIR) -> List[Migration]:
    found: List[Migration] = []
    for path in sorted(directory.glob("*.sql")):
        match = _FILE_RE.match(path.name)
        if not match:
            raise MigrationError(f"Migration file {path.name!r} does not match NNNN_name.sql.")
        sql = path.read_bytes().decode("utf-8").replace("\r\n", "\n")
        found.append(
            Migration(int(match.group(1)), match.group(2), sql, hashlib.sha256(sql.encode("utf-8")).hexdigest())
        )
    versions = [m.version for m in found]
    if versions != list(range(1, len(found) + 1)):
        raise MigrationError(f"Migration versions must be contiguous from 1, found {versions}.")
    return found


def head_version() -> int:
    return len(load_migrations())


def _search_path(cur, schema: Optional[str]) -> None:
    if schema:
        cur.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
        cur.execute(f'SET search_path TO "{schema}"')


def _ensure_history_table(cur) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version     INTEGER PRIMARY KEY,
            name        TEXT NOT NULL,
            checksum    TEXT NOT NULL,
            applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )


def applied_versions(cur) -> Dict[int, Dict[str, str]]:
    cur.execute("SELECT to_regclass('schema_migrations') IS NOT NULL")
    if not cur.fetchone()[0]:
        return {}
    cur.execute("SELECT version, name, checksum FROM schema_migrations ORDER BY version")
    return {v: {"name": n, "checksum": c} for v, n, c in cur.fetchall()}


def current_version(cur) -> int:
    applied = applied_versions(cur)
    return max(applied) if applied else 0


def check_ready(conn) -> int:
    """
    Raise SchemaNotReady unless the database is at exactly the version this code expects.
    `conn` must already have the right search_path (the pool sets it).
    """
    migrations = load_migrations()
    with conn.cursor() as cur:
        applied = applied_versions(cur)
    conn.rollback()
    head = len(migrations)
    current = max(applied) if applied else 0
    if current == 0:
        raise SchemaNotReady(
            "The database has no REVORA schema. Run: python -m backend.app.db.migrate upgrade "
            "(or set REVORA_DB_AUTO_MIGRATE=1 to apply migrations at startup)."
        )
    for migration in migrations:
        recorded = applied.get(migration.version)
        if recorded is not None and recorded["checksum"] != migration.checksum:
            raise SchemaNotReady(
                f"Migration {migration.version:04d}_{migration.name}.sql was modified after it was applied; "
                "refusing to run against a schema that may not match the code."
            )
    if current < head:
        raise SchemaNotReady(
            f"The database schema is at version {current} but this code needs {head}. "
            "Run: python -m backend.app.db.migrate upgrade"
        )
    if current > head:
        raise SchemaNotReady(
            f"The database schema is at version {current}, ahead of this code ({head}). "
            "Deploy the matching code version instead of running against a newer schema."
        )
    return current


def upgrade(dsn: str, schema: Optional[str] = None, target: Optional[int] = None) -> List[int]:
    """Apply every pending migration (up to `target`). Returns the versions applied."""
    schema = validate_schema_name(schema)
    migrations = load_migrations()
    if target is not None and not 1 <= target <= len(migrations):
        raise MigrationError(f"No migration version {target}.")
    conn = psycopg2.connect(dsn, application_name="revora-migrate", options="-c lock_timeout=60000")
    try:
        conn.autocommit = False
        with conn.cursor() as cur:
            _search_path(cur, schema)
            # Serialise migrators: held for the session, released explicitly below.
            cur.execute("SELECT pg_advisory_lock(hashtextextended(%s, 0))", (f"revora:migrate:{schema or ''}",))
        conn.commit()
        try:
            with conn.cursor() as cur:
                _ensure_history_table(cur)
            conn.commit()
            with conn.cursor() as cur:
                applied = applied_versions(cur)
            conn.commit()

            for version, recorded in applied.items():
                known = next((m for m in migrations if m.version == version), None)
                if known is None:
                    raise MigrationError(
                        f"Database has migration {version} ({recorded['name']}) that this code does not know; "
                        "refusing to continue."
                    )
                if known.checksum != recorded["checksum"]:
                    raise MigrationError(
                        f"Migration {version:04d}_{known.name}.sql changed after it was applied "
                        f"(recorded {recorded['checksum'][:12]}, file {known.checksum[:12]})."
                    )

            done: List[int] = []
            for migration in migrations:
                if migration.version in applied:
                    continue
                if target is not None and migration.version > target:
                    break
                try:
                    with conn.cursor() as cur:
                        cur.execute(migration.sql)  # no parameters: '%' in the SQL is not interpolated
                        cur.execute(
                            "INSERT INTO schema_migrations (version, name, checksum) VALUES (%s, %s, %s)",
                            (migration.version, migration.name, migration.checksum),
                        )
                    conn.commit()
                except Exception as exc:
                    conn.rollback()
                    raise MigrationError(
                        f"Migration {migration.version:04d}_{migration.name}.sql failed and was rolled back: {exc}"
                    ) from exc
                done.append(migration.version)
            return done
        finally:
            with conn.cursor() as cur:
                cur.execute("SELECT pg_advisory_unlock(hashtextextended(%s, 0))", (f"revora:migrate:{schema or ''}",))
            conn.commit()
    finally:
        conn.close()


def status(dsn: str, schema: Optional[str] = None) -> Dict[str, object]:
    schema = validate_schema_name(schema)
    migrations = load_migrations()
    conn = psycopg2.connect(dsn, application_name="revora-migrate")
    try:
        with conn.cursor() as cur:
            if schema:
                cur.execute(f'SET search_path TO "{schema}"')
            applied = applied_versions(cur)
        conn.rollback()
    finally:
        conn.close()
    return {
        "head": len(migrations),
        "current": max(applied) if applied else 0,
        "pending": [m.version for m in migrations if m.version not in applied],
        "applied": sorted(applied),
    }


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="REVORA database migrations")
    parser.add_argument("command", choices=["status", "upgrade"])
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    parser.add_argument("--schema", default=os.getenv("REVORA_DB_SCHEMA") or None)
    parser.add_argument("--target", type=int, default=None, help="upgrade only up to this version")
    args = parser.parse_args(argv)
    if not args.database_url:
        print("DATABASE_URL is not set (or pass --database-url).", file=sys.stderr)
        return 2
    try:
        if args.command == "status":
            info = status(args.database_url, args.schema)
            print(f"schema head={info['head']} current={info['current']} pending={info['pending']}")
        else:
            applied = upgrade(args.database_url, args.schema, args.target)
            print(f"applied: {applied}" if applied else "already up to date")
    except (MigrationError, psycopg2.Error) as exc:
        print(f"migration failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
