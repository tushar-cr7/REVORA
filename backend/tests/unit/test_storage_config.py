"""
Persistence must be chosen explicitly and a misconfiguration must stop the process with a message
that says how to fix it — never fall back to in-memory storage, never echo the database password.
"""
import pytest

from backend.app.config import ConfigurationError, load_storage_config
from backend.app.container import build_repository

SECRET = "S3cretPassw0rd"
GOOD_URL = f"postgresql://revora_app:{SECRET}@localhost:5432/revora"


def env(**values):
    return {k: v for k, v in values.items() if v is not None}


def test_storage_must_be_chosen_explicitly():
    with pytest.raises(ConfigurationError) as err:
        load_storage_config(env())
    assert "REVORA_STORAGE is not set" in str(err.value)
    assert "postgres" in str(err.value) and "memory" in str(err.value)


def test_a_database_url_alone_does_not_select_postgres():
    with pytest.raises(ConfigurationError, match="REVORA_STORAGE is not set"):
        load_storage_config(env(DATABASE_URL=GOOD_URL))


@pytest.mark.parametrize("value", ["sqlite", "mongo", "durable", "true"])
def test_unknown_backends_are_refused(value):
    with pytest.raises(ConfigurationError, match="must be 'postgres' or 'memory'"):
        load_storage_config(env(REVORA_STORAGE=value))


def test_postgres_requires_a_database_url():
    with pytest.raises(ConfigurationError, match="DATABASE_URL is not set"):
        load_storage_config(env(REVORA_STORAGE="postgres"))
    with pytest.raises(ConfigurationError, match="DATABASE_URL is not set"):
        load_storage_config(env(REVORA_STORAGE="postgres", DATABASE_URL="   "))


def test_a_non_postgres_url_is_refused_without_echoing_it():
    with pytest.raises(ConfigurationError) as err:
        load_storage_config(env(REVORA_STORAGE="postgres", DATABASE_URL=f"mysql://u:{SECRET}@h/db"))
    assert "postgresql://" in str(err.value)
    assert SECRET not in str(err.value)


def test_the_env_example_placeholder_credentials_are_refused():
    with pytest.raises(ConfigurationError, match="placeholder credentials"):
        load_storage_config(env(REVORA_STORAGE="postgres", DATABASE_URL="postgresql://user:password@localhost:5432/revora"))


def test_valid_postgres_configuration():
    config = load_storage_config(env(REVORA_STORAGE="Postgres", DATABASE_URL=GOOD_URL, REVORA_DB_SCHEMA="revora_x"))
    assert config.backend == "postgres" and config.durable
    assert config.schema == "revora_x" and config.pool_size == 10 and config.auto_migrate is False
    assert config.reservation_timeout_seconds == 900


def test_memory_is_explicit_and_labelled_non_durable():
    config = load_storage_config(env(REVORA_STORAGE="memory"))
    assert config.backend == "memory" and not config.durable and config.database_url is None


def test_memory_is_refused_in_production():
    for deployment in ("production", "PROD"):
        with pytest.raises(ConfigurationError, match="refused when ENV=production"):
            load_storage_config(env(REVORA_STORAGE="memory", ENV=deployment))


@pytest.mark.parametrize(
    "name,value,message",
    [
        ("REVORA_DB_POOL_SIZE", "0", "between 1 and 100"),
        ("REVORA_DB_POOL_SIZE", "many", "must be an integer"),
        ("REVORA_RESERVATION_TIMEOUT_SECONDS", "5", "between 30"),
        ("REVORA_DB_AUTO_MIGRATE", "maybe", "must be 1/0"),
        ("REVORA_DB_SCHEMA", "Robert'; DROP TABLE x;--", "Invalid schema name"),
    ],
)
def test_bad_tuning_values_are_rejected(name, value, message):
    with pytest.raises(ConfigurationError, match=message):
        load_storage_config(env(REVORA_STORAGE="postgres", DATABASE_URL=GOOD_URL, **{name: value}))


def test_auto_migrate_flag_parses():
    config = load_storage_config(env(REVORA_STORAGE="postgres", DATABASE_URL=GOOD_URL, REVORA_DB_AUTO_MIGRATE="1"))
    assert config.auto_migrate is True


def test_an_unreachable_database_is_a_configuration_error_not_an_in_memory_fallback():
    # Nothing listens on port 1: the connection is refused immediately.
    config = load_storage_config(
        env(REVORA_STORAGE="postgres", DATABASE_URL=f"postgresql://u:{SECRET}@127.0.0.1:1/revora")
    )
    with pytest.raises(ConfigurationError) as err:
        build_repository(config)
    message = str(err.value)
    assert "Cannot connect to PostgreSQL" in message and "will not fall back to in-memory" in message
    assert SECRET not in message


def test_memory_backend_builds_the_in_memory_repository_and_says_it_is_not_durable(caplog):
    from backend.app.repositories.in_memory import InMemoryRepository

    with caplog.at_level("WARNING", logger="revora.container"):
        repository = build_repository(load_storage_config(env(REVORA_STORAGE="memory")))
    assert isinstance(repository, InMemoryRepository)
    assert repository.describe() == {"backend": "memory", "durable": False}
    assert "NOT durable" in caplog.text
