"""A small, bounded PostgreSQL connection pool over psycopg2.

`ThreadedConnectionPool` raises when it is exhausted; a web server running sync endpoints on a
thread pool would turn a traffic burst into errors. This wrapper bounds concurrency with a
semaphore instead, so extra callers wait (up to a timeout) for a connection.
"""
import re
import threading
from contextlib import contextmanager
from typing import Iterator, Optional

import psycopg2
import psycopg2.extensions
import psycopg2.pool

from backend.app.repositories.errors import RepositoryError

_SCHEMA_RE = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")


def validate_schema_name(schema: Optional[str]) -> Optional[str]:
    if schema is None:
        return None
    if not _SCHEMA_RE.match(schema):
        raise ValueError(f"Invalid schema name {schema!r}: use lower-case letters, digits and underscores.")
    return schema


class PoolTimeout(RepositoryError):
    """No database connection became free in time."""


class ConnectionPool:
    def __init__(
        self,
        dsn: str,
        *,
        maxconn: int = 10,
        schema: Optional[str] = None,
        connect_timeout: int = 10,
        acquire_timeout: float = 30.0,
        lock_timeout_ms: int = 15000,
        statement_timeout_ms: int = 120000,
        application_name: str = "revora-backend",
    ):
        if maxconn < 1:
            raise ValueError("maxconn must be at least 1.")
        self.schema = validate_schema_name(schema)
        self.maxconn = maxconn
        self._acquire_timeout = acquire_timeout
        self._slots = threading.BoundedSemaphore(maxconn)
        options = [
            "-c timezone=UTC",
            "-c client_encoding=UTF8",
            f"-c lock_timeout={int(lock_timeout_ms)}",
            f"-c statement_timeout={int(statement_timeout_ms)}",
        ]
        if self.schema:
            options.append(f"-c search_path={self.schema}")
        self._pool = psycopg2.pool.ThreadedConnectionPool(
            1,
            maxconn,
            dsn,
            connect_timeout=connect_timeout,
            application_name=application_name,
            options=" ".join(options),
        )

    @contextmanager
    def connection(self) -> Iterator["psycopg2.extensions.connection"]:
        """
        Check out a connection for exactly one unit of work. The caller commits or rolls back;
        anything left uncommitted is rolled back on return. A connection that is broken is
        discarded rather than returned to the pool.
        """
        if not self._slots.acquire(timeout=self._acquire_timeout):
            raise PoolTimeout(f"No database connection became available within {self._acquire_timeout:.0f}s.")
        conn = None
        discard = False
        try:
            conn = self._pool.getconn()
            if conn.closed:
                self._pool.putconn(conn, close=True)
                conn = self._pool.getconn()
            conn.autocommit = False
            yield conn
        except (psycopg2.OperationalError, psycopg2.InterfaceError):
            discard = True
            raise
        finally:
            if conn is not None:
                try:
                    if not discard and not conn.closed and conn.status != psycopg2.extensions.STATUS_READY:
                        conn.rollback()
                except Exception:  # noqa: BLE001 - a connection that cannot roll back is not reusable
                    discard = True
                self._pool.putconn(conn, close=discard or conn.closed)
            self._slots.release()

    def close(self) -> None:
        self._pool.closeall()
