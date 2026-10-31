"""The database tests must never silently pretend: with no PostgreSQL they say so (skip) or fail on request."""
from backend.tests import pg_support


def test_without_postgres_the_harness_reports_why_instead_of_returning_a_server(monkeypatch, tmp_path):
    monkeypatch.delenv("REVORA_TEST_DATABASE_URL", raising=False)
    monkeypatch.setattr(pg_support, "find_pg_bin", lambda: None)
    dsn, how, cluster = pg_support.acquire_server(tmp_path)
    assert dsn is None and cluster is None
    assert "no PostgreSQL binaries" in how and "REVORA_TEST_DATABASE_URL" in how


def test_an_explicit_server_is_used_as_given_and_never_started_or_stopped_by_the_harness(monkeypatch, tmp_path):
    monkeypatch.setenv("REVORA_TEST_DATABASE_URL", "postgresql://example.invalid/db")
    dsn, how, cluster = pg_support.acquire_server(tmp_path)
    assert dsn == "postgresql://example.invalid/db" and cluster is None and how == "REVORA_TEST_DATABASE_URL"


def test_the_harness_will_only_drop_schemas_it_created():
    import pytest

    with pytest.raises(AssertionError, match="refusing to drop"):
        pg_support.drop_schema("postgresql://example.invalid/db", "public")
    assert pg_support.new_schema_name().startswith("revora_test_")
