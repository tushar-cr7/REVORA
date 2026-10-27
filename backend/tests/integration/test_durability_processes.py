"""
Durability and configuration, proven with REAL OS processes: each phase below is a separate Python
process that imports the actual application (`backend.app.main`), so nothing carries over except what
the database holds.
"""
import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from backend.app.domain.models import AttemptStatus, CaseState
from backend.tests.support import FakeClock, ScriptedProvider, build_service, case_of, make_tx

ROOT = Path(__file__).resolve().parents[3]
SECRET = "Sup3rS3cretPw"


def run_python(code: str, env_overrides: dict, timeout: int = 300) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items() if k not in ("REVORA_STORAGE", "DATABASE_URL", "REVORA_DB_SCHEMA", "ENV")}
    env.update(env_overrides)
    env["PYTHONPATH"] = str(ROOT)
    env["PYTHONWARNINGS"] = "ignore"
    return subprocess.run(
        [sys.executable, "-c", textwrap.dedent(code)], cwd=str(ROOT), env=env, capture_output=True, text=True, timeout=timeout
    )


def app_env(pg_dsn, schema, **extra):
    return {"REVORA_STORAGE": "postgres", "DATABASE_URL": pg_dsn, "REVORA_DB_SCHEMA": schema, **extra}


def last_json(proc: subprocess.CompletedProcess) -> dict:
    assert proc.returncode == 0, f"process failed ({proc.returncode}):\n{proc.stderr[-3000:]}"
    return json.loads([l for l in proc.stdout.splitlines() if l.startswith("{")][-1])


FIRST_PROCESS = """
    import json
    from fastapi.testclient import TestClient
    from backend.app.main import app
    with TestClient(app) as client:                     # runs the real startup hook
        ready = client.get("/api/health/ready").json()
        scan = client.post("/api/scan", json={"n_total": 80, "seed": 5}).json()
        client.post("/api/analyze")
        opp = next(o for o in client.get("/api/opportunities?limit=100").json() if o["recommended_action"] == "retry" and o["policy_allowed"])
        first = client.post(f"/api/interventions/{opp['transaction_id']}/execute", headers={"Idempotency-Key": "proc-key-1"})
        print(json.dumps({
            "ready": ready, "run_id": scan["run_id"], "tx": opp["transaction_id"],
            "status": first.status_code, "intervention": first.json(),
            "analytics": client.get("/api/analytics").json(),
            "interventions": client.get("/api/interventions").json()["total"],
            "audit": client.get("/api/audit?limit=1000&run_id=all").json()["matched"],
            "cases": client.get("/api/cases?limit=1000").json()["total"],
        }))
"""

SECOND_PROCESS = """
    import json, sys
    from fastapi.testclient import TestClient
    from backend.app.main import app
    tx, first_id = sys.argv[1], sys.argv[2]
    with TestClient(app) as client:
        replay = client.post(f"/api/interventions/{tx}/execute", headers={"Idempotency-Key": "proc-key-1"})
        other = client.post(f"/api/interventions/{tx}/execute", headers={"Idempotency-Key": "proc-key-2"})
        rescan = client.post("/api/scan", json={"n_total": 80, "seed": 5}).json()
        print(json.dumps({
            "ready": client.get("/api/health/ready").json(),
            "run_id": rescan["run_id"], "reused": rescan["reused_existing_run"],
            "replay_status": replay.status_code, "replayed_header": replay.headers.get("idempotent-replayed"),
            "replay_intervention": replay.json(),
            "other_status": other.status_code, "other_code": other.json().get("code"),
            "analytics": client.get("/api/analytics").json(),
            "interventions": client.get("/api/interventions").json()["total"],
            "audit": client.get("/api/audit?limit=1000&run_id=all").json()["matched"],
            "cases": client.get("/api/cases?limit=1000").json()["total"],
        }))
"""


def test_the_whole_application_state_survives_a_real_process_restart(pg_dsn, pg_schema):
    migrate = run_python("import sys; from backend.app.db.migrate import main; sys.exit(main(['upgrade']))", app_env(pg_dsn, pg_schema))
    assert migrate.returncode == 0 and "applied: [1, 2, 3]" in migrate.stdout, migrate.stderr
    status = run_python("import sys; from backend.app.db.migrate import main; sys.exit(main(['status']))", app_env(pg_dsn, pg_schema))
    assert "current=3" in status.stdout and "pending=[]" in status.stdout

    first = last_json(run_python(FIRST_PROCESS, app_env(pg_dsn, pg_schema)))
    assert first["ready"]["status"] == "ok" and first["ready"]["storage"]["durable"] is True
    assert first["ready"]["storage"]["backend"] == "postgres" and first["ready"]["storage"]["schema_version"] == 3
    assert first["status"] == 200 and first["intervention"]["execution_mode"] == "simulation"
    assert first["cases"] == 80 and first["interventions"] == 1 and first["audit"] >= 80

    code = SECOND_PROCESS.replace("sys.argv[1], sys.argv[2]", f"{first['tx']!r}, {first['intervention']['intervention_id']!r}")
    second = last_json(run_python(code, app_env(pg_dsn, pg_schema)))     # a different process, a different memory
    assert second["reused"] is True and second["run_id"] == first["run_id"]       # the same scan is the same run, after restart
    assert second["replay_status"] == 200 and second["replayed_header"] == "true"
    assert second["replay_intervention"] == first["intervention"]               # the stored idempotent result, verbatim
    # A new key can neither double-recover nor re-run. The simulated outcome is random, so the refusal is either
    # "case not executable" (it recovered: terminal, nothing written) or a policy denial (it did not recover and the
    # retry cooldown applies: one ACTION_BLOCKED event is written). Both are exact; anything else is a failure.
    assert second["other_status"] == 409 and second["other_code"] in ("case_not_executable", "policy_denied")
    assert second["analytics"] == first["analytics"]
    assert (second["interventions"], second["cases"]) == (first["interventions"], first["cases"])
    assert second["audit"] == first["audit"] + (1 if second["other_code"] == "policy_denied" else 0)
    assert second["ready"]["storage"]["durable"] is True


def test_startup_closes_reservations_a_dead_process_left_open(pg_dsn, pg_schema, pg_repo):
    clock = FakeClock()                                                          # an old instant: that reservation is long dead
    provider = ScriptedProvider(["recovered"])
    service = build_service([make_tx(1, amount=1500.0)], provider=provider, clock=clock, repo=pg_repo)
    case = case_of(service, "tx_fp_000001")
    reservation = service.executor._reserve_with_retry(case.case_id, "died-mid-flight", None)
    assert pg_repo.get_case(case.case_id).state == CaseState.EXECUTING

    code = f"""
        import json
        from fastapi.testclient import TestClient
        from backend.app.main import app
        with TestClient(app) as client:                 # the startup hook sweeps interrupted reservations
            detail = client.get("/api/cases/{case.case_id}").json()
            print(json.dumps({{"state": detail["state"], "active": detail["active_attempt_id"],
                              "attempt": detail["attempts"][0]["status"], "reason": detail["attempts"][0]["failure_reason"]}}))
    """
    result = last_json(run_python(code, app_env(pg_dsn, pg_schema)))
    assert result["state"] == "attempted_no_recovery" and result["active"] is None and result["attempt"] == "failed"
    assert result["reason"].startswith("interrupted:")
    assert pg_repo.get_attempt(reservation.attempt_id).status == AttemptStatus.FAILED


@pytest.mark.parametrize(
    "env,expected",
    [
        ({}, "REVORA_STORAGE is not set"),
        ({"REVORA_STORAGE": "sqlite"}, "must be 'postgres' or 'memory'"),
        ({"REVORA_STORAGE": "postgres"}, "DATABASE_URL is not set"),
        ({"REVORA_STORAGE": "postgres", "DATABASE_URL": f"postgresql://u:{SECRET}@127.0.0.1:1/revora"}, "Cannot connect to PostgreSQL"),
        ({"REVORA_STORAGE": "postgres", "DATABASE_URL": "postgresql://user:password@localhost:5432/revora"}, "placeholder credentials"),
        ({"REVORA_STORAGE": "memory", "ENV": "production"}, "refused when ENV=production"),
    ],
)
def test_a_misconfigured_process_refuses_to_start_and_says_why(env, expected):
    proc = run_python("import backend.app.main", env)
    assert proc.returncode != 0, "the application started despite its configuration being invalid"
    assert expected in proc.stderr, proc.stderr[-1500:]
    assert SECRET not in proc.stderr and SECRET not in proc.stdout           # the password is never echoed
    assert "InMemoryRepository" not in proc.stderr                            # and it did not quietly fall back


def test_a_database_without_the_schema_stops_startup_with_the_fix(pg_dsn, pg_schema):
    proc = run_python("import backend.app.main", app_env(pg_dsn, pg_schema))   # the schema exists but was never migrated
    assert proc.returncode != 0
    assert "no REVORA schema" in proc.stderr and "backend.app.db.migrate upgrade" in proc.stderr


def test_auto_migrate_is_opt_in_and_works(pg_dsn, pg_schema):
    proc = run_python(
        "from backend.app.main import app\nfrom fastapi.testclient import TestClient\n"
        "print(TestClient(app).get('/api/health/ready').json())",
        app_env(pg_dsn, pg_schema, REVORA_DB_AUTO_MIGRATE="1"),
    )
    assert proc.returncode == 0, proc.stderr[-2000:]
    assert "'durable': True" in proc.stdout and "'schema_version': 3" in proc.stdout


def test_memory_mode_is_explicit_and_reported_as_not_durable():
    proc = run_python(
        "from backend.app.main import app\nfrom fastapi.testclient import TestClient\n"
        "print(TestClient(app).get('/api/health/ready').json())",
        {"REVORA_STORAGE": "memory"},
    )
    assert proc.returncode == 0, proc.stderr[-2000:]
    assert "'durable': False" in proc.stdout and "'backend': 'memory'" in proc.stdout
    assert "NOT durable" in proc.stderr                                        # and it said so in the log
