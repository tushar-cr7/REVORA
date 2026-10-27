import os
import sys

# Add root directory to python path for test discovery
root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

# `backend.app.main` builds its repository from the environment when it is first imported, and the
# application refuses to start without an explicit choice. The legacy API tests drive that
# module-level app, so make the choice here — EXPLICITLY in-memory, and forced rather than defaulted
# so a developer's shell (REVORA_STORAGE=postgres, a real DATABASE_URL, ENV=production) can never make
# the suite write synthetic records into a real database. Database tests build their own repositories
# against a disposable PostgreSQL (see backend/tests/pg_support.py).
os.environ["REVORA_STORAGE"] = "memory"
os.environ["ENV"] = "test"

import pytest  # noqa: E402

from backend.app.db import migrate  # noqa: E402
from backend.tests import pg_support  # noqa: E402


@pytest.fixture(scope="session")
def pg_dsn(tmp_path_factory):
    """DSN of a real PostgreSQL for database tests, or a skip (a failure with REVORA_REQUIRE_POSTGRES=1)."""
    dsn, how, cluster = pg_support.acquire_server(tmp_path_factory.mktemp("revora_pg"))
    if dsn is None:
        if os.getenv("REVORA_REQUIRE_POSTGRES") == "1":
            pytest.fail(f"PostgreSQL is required but unavailable: {how}")
        pytest.skip(f"PostgreSQL unavailable: {how}")
    try:
        yield dsn
    finally:
        if cluster is not None:
            cluster.stop()


@pytest.fixture
def pg_schema(pg_dsn):
    """A fresh, empty schema for one test; dropped afterwards."""
    schema = pg_support.new_schema_name()
    pg_support.create_schema(pg_dsn, schema)
    try:
        yield schema
    finally:
        pg_support.drop_schema(pg_dsn, schema)


@pytest.fixture
def pg_repo(pg_dsn, pg_schema):
    """A PostgresRepository on a freshly migrated schema."""
    from backend.app.repositories.postgres import PostgresRepository

    migrate.upgrade(pg_dsn, pg_schema)
    repository = PostgresRepository.connect(pg_dsn, schema=pg_schema, pool_size=8, allow_destructive=True)
    try:
        yield repository
    finally:
        repository.close()


@pytest.fixture
def pg_connect(pg_dsn, pg_schema):
    """Open another repository on the SAME schema — a second 'process' with its own connection pool."""
    from backend.app.repositories.postgres import PostgresRepository

    opened = []

    def connect(pool_size: int = 8):
        repository = PostgresRepository.connect(pg_dsn, schema=pg_schema, pool_size=pool_size)
        opened.append(repository)
        return repository

    try:
        yield connect
    finally:
        for repository in opened:
            repository.close()


@pytest.fixture(params=["memory", "postgres"])
def any_repo(request):
    """The repository contract holds for both implementations; tests using this run against each."""
    if request.param == "memory":
        from backend.app.repositories.in_memory import InMemoryRepository

        return InMemoryRepository()
    return request.getfixturevalue("pg_repo")
