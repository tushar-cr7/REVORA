"""
`python -m backend.app.preflight` (run by run.bat before it starts anything) must turn a bad configuration into an
actionable message and a non-zero exit, accept exactly what the backend would accept, and never connect anywhere or
fall back to in-memory storage.
"""
import io
from pathlib import Path

import pytest

from backend.app import preflight
from backend.app.config import ConfigurationError, load_storage_config

SECRET = "S3cretPassw0rd"
GOOD_URL = f"postgresql://revora_app:{SECRET}@localhost:5432/revora"


def run(env, env_file):
    out = io.StringIO()
    return preflight.main(env=env, out=out, env_file=env_file), out.getvalue()


def test_missing_configuration_is_refused_with_setup_steps(tmp_path):
    code, text = run({}, tmp_path / ".env")
    assert code == 1
    assert "REVORA_STORAGE is not set" in text
    assert "Copy .env.example to .env" in text and "migrate upgrade" in text and "NOT durable" in text


def test_an_existing_env_file_is_pointed_at_rather_than_recreated(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("REVORA_STORAGE=postgres\n")
    code, text = run({"REVORA_STORAGE": "postgres"}, env_file)
    assert code == 1 and "DATABASE_URL is not set" in text
    assert f"Fix the setting in {env_file}" in text and "Copy .env.example" not in text
    assert env_file.read_text() == "REVORA_STORAGE=postgres\n"                 # never touched


@pytest.mark.parametrize("url", [
    "postgresql://revora_app:CHANGE_ME@localhost:5432/revora",                   # the .env.example sample
    "postgresql://user:password@localhost:5432/revora",
])
def test_the_sample_credentials_are_refused(tmp_path, url):
    code, text = run({"REVORA_STORAGE": "postgres", "DATABASE_URL": url}, tmp_path / ".env")
    assert code == 1 and "placeholder credentials" in text


def test_the_env_example_as_shipped_is_refused_until_edited():
    example = Path(__file__).resolve().parents[3] / ".env.example"
    values = dict(line.split("=", 1) for line in example.read_text().splitlines()
                  if "=" in line and not line.lstrip().startswith("#"))
    values = {k.strip(): v.split("#")[0].strip() for k, v in values.items()}
    assert values["REVORA_STORAGE"] == "postgres"                                # no silent in-memory default
    with pytest.raises(ConfigurationError, match="placeholder credentials"):
        load_storage_config(values)


def test_valid_configuration_passes_and_never_echoes_the_password(tmp_path):
    code, text = run({"REVORA_STORAGE": "postgres", "DATABASE_URL": GOOD_URL}, tmp_path / ".env")
    assert code == 0 and "durable PostgreSQL" in text and SECRET not in text


def test_memory_is_accepted_only_when_chosen_and_is_labelled_not_durable(tmp_path):
    code, text = run({"REVORA_STORAGE": "memory"}, tmp_path / ".env")
    assert code == 0 and "NOT durable" in text
    code, text = run({"REVORA_STORAGE": "memory", "ENV": "production"}, tmp_path / ".env")
    assert code == 1 and "refused" in text


def test_preflight_uses_the_same_validation_as_startup(tmp_path):
    for env in ({}, {"REVORA_STORAGE": "sqlite"}, {"REVORA_STORAGE": "postgres"}, {"REVORA_STORAGE": "memory"},
                {"REVORA_STORAGE": "postgres", "DATABASE_URL": GOOD_URL}, {"REVORA_STORAGE": "postgres", "DATABASE_URL": "mysql://x"}):
        try:
            load_storage_config(env)
            expected = 0
        except ConfigurationError:
            expected = 1
        assert run(env, tmp_path / ".env")[0] == expected, env
