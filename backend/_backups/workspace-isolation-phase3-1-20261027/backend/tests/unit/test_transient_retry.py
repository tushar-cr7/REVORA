"""run_with_retry: transient database aborts are retried as whole units; nothing else is swallowed."""
import pytest

from backend.app.repositories import errors
from backend.app.repositories.errors import TransientStorageError, run_with_retry


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(errors.time, "sleep", lambda _s: None)


def test_a_unit_that_succeeds_runs_once():
    calls = []
    assert run_with_retry(lambda: calls.append(1) or "done") == "done" and calls == [1]


def test_a_transient_abort_is_rerun_from_the_start_until_it_succeeds():
    calls = []

    def unit():
        calls.append(len(calls) + 1)
        if len(calls) < 3:
            raise TransientStorageError("deadlock")
        return "ok"

    assert run_with_retry(unit, attempts=4) == "ok" and calls == [1, 2, 3]


def test_a_persistent_transient_abort_is_raised_after_the_attempts_are_used():
    calls = []

    def unit():
        calls.append(1)
        raise TransientStorageError("deadlock")

    with pytest.raises(TransientStorageError):
        run_with_retry(unit, attempts=3)
    assert len(calls) == 3


@pytest.mark.parametrize("error", [ValueError("bad input"), RuntimeError("bug"), KeyError("x")])
def test_other_errors_are_never_retried_or_swallowed(error):
    calls = []

    def unit():
        calls.append(1)
        raise error

    with pytest.raises(type(error)):
        run_with_retry(unit)
    assert calls == [1]
