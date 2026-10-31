"""
PostgreSQL for the database tests.

Resolution order
  1. REVORA_TEST_DATABASE_URL  - a server you point us at. Tests only ever create and drop schemas
     named `revora_test_*` inside it; nothing in `public` or any other schema is touched.
  2. A throwaway cluster started from the PostgreSQL binaries found on this machine (initdb /
     pg_ctl on PATH, or the standard install locations), on a free localhost port with trust auth
     and fsync off, deleted at the end of the session. The installed PostgreSQL service, its data
     and its credentials are never used.
  3. Neither: the database tests are SKIPPED, with the reason, and the run says so. Set
     REVORA_REQUIRE_POSTGRES=1 to make that a failure instead (use it in CI).

The tested database is therefore real PostgreSQL (version reported by `server_version`); nothing
here is emulated with SQLite.
"""
import glob
import os
import shutil
import socket
import subprocess
import uuid
from pathlib import Path
from typing import List, Optional, Tuple

import psycopg2


def _candidate_bin_dirs() -> List[Path]:
    dirs: List[Path] = []
    for exe in ("initdb", "initdb.exe"):
        found = shutil.which(exe)
        if found:
            dirs.append(Path(found).parent)
    patterns = [
        r"C:\Program Files\PostgreSQL\*\bin",
        r"C:\Program Files (x86)\PostgreSQL\*\bin",
        "/usr/lib/postgresql/*/bin",
        "/opt/homebrew/opt/postgresql@*/bin",
        "/usr/local/opt/postgresql@*/bin",
    ]
    for pattern in patterns:
        dirs.extend(sorted((Path(p) for p in glob.glob(pattern)), reverse=True))
    return dirs


def find_pg_bin() -> Optional[Path]:
    suffix = ".exe" if os.name == "nt" else ""
    for directory in _candidate_bin_dirs():
        if (directory / f"initdb{suffix}").exists() and (directory / f"pg_ctl{suffix}").exists():
            return directory
    return None


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class TempCluster:
    """A disposable single-user PostgreSQL server."""

    def __init__(self, bin_dir: Path, root: Path):
        self.bin_dir = bin_dir
        self.data_dir = root / "data"
        self.log_file = root / "postgres.log"
        self.port = _free_port()
        self.suffix = ".exe" if os.name == "nt" else ""

    @property
    def dsn(self) -> str:
        return f"postgresql://postgres@127.0.0.1:{self.port}/postgres"

    def _run(self, name: str, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [str(self.bin_dir / f"{name}{self.suffix}"), *args],
            capture_output=True, text=True, timeout=180,
        )

    def start(self) -> None:
        init = self._run("initdb", "-D", str(self.data_dir), "-U", "postgres", "--auth=trust", "-E", "UTF8", "--locale=C")
        if init.returncode != 0:
            raise RuntimeError(f"initdb failed: {init.stderr or init.stdout}")
        options = (
            f"-p {self.port} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off "
            "-c full_page_writes=off -c max_connections=200"
        )
        # The server process inherits pg_ctl's stdout/stderr. If those were pipes we are reading, the
        # read would never reach EOF while the server lives (it hangs on Windows), so discard them:
        # the server's own output goes to the log file via -l.
        started = subprocess.run(
            [str(self.bin_dir / f"pg_ctl{self.suffix}"), "-D", str(self.data_dir), "-o", options,
             "-l", str(self.log_file), "-w", "-t", "60", "start"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120,
        )
        if started.returncode != 0:
            log = self.log_file.read_text(errors="replace") if self.log_file.exists() else ""
            raise RuntimeError(f"pg_ctl start failed (exit {started.returncode})\n{log[-2000:]}")

    def stop(self) -> None:
        try:
            self._run("pg_ctl", "-D", str(self.data_dir), "-m", "immediate", "-w", "stop")
        except Exception:  # noqa: BLE001 - best effort during teardown
            pass


def acquire_server(root: Path) -> Tuple[Optional[str], str, Optional[TempCluster]]:
    """(dsn, human description, cluster-to-stop). dsn is None when no PostgreSQL could be provided."""
    configured = os.getenv("REVORA_TEST_DATABASE_URL", "").strip()
    if configured:
        return configured, "REVORA_TEST_DATABASE_URL", None
    bin_dir = find_pg_bin()
    if bin_dir is None:
        return None, "no PostgreSQL binaries (initdb/pg_ctl) found and REVORA_TEST_DATABASE_URL is not set", None
    cluster = TempCluster(bin_dir, root)
    try:
        cluster.start()
    except Exception as exc:  # noqa: BLE001
        return None, f"could not start a temporary PostgreSQL cluster from {bin_dir}: {exc}", None
    return cluster.dsn, f"temporary cluster from {bin_dir} on port {cluster.port}", cluster


def server_version(dsn: str) -> str:
    conn = psycopg2.connect(dsn)
    try:
        with conn.cursor() as cur:
            cur.execute("SHOW server_version")
            return cur.fetchone()[0]
    finally:
        conn.close()


def new_schema_name() -> str:
    return f"revora_test_{uuid.uuid4().hex[:12]}"


def create_schema(dsn: str, schema: str) -> None:
    conn = psycopg2.connect(dsn)
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(f'CREATE SCHEMA "{schema}"')
    finally:
        conn.close()


def drop_schema(dsn: str, schema: str) -> None:
    assert schema.startswith("revora_test_"), "refusing to drop a schema this harness did not create"
    conn = psycopg2.connect(dsn)
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
    finally:
        conn.close()
