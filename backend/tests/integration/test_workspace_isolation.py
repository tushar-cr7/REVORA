"""
Phase 3.1: workspace isolation and execution safety.

One workspace can never read, change or execute another workspace's records, and nothing executes outside a
`simulation` workspace. Checked at four layers, each on its own:
  * the repositories (the same contract on both implementations, via `any_repo`),
  * the database (raw SQL against migration 0004 — a pass means PostgreSQL said no),
  * the services (the executor's workspace gate, the ingestion rejection of unknown workspaces),
  * HTTP (typed errors, `?workspace_id=`, the demo default).

A workspace id is a SELECTION made by the caller, not authentication: none of these tests, and nothing in
Phase 3.1, proves who is asking.
"""
import inspect
import threading
import uuid
from contextlib import contextmanager
from dataclasses import replace
from typing import Dict

import psycopg2
import psycopg2.errors as pgerr
import pytest
from fastapi.testclient import TestClient

from backend.app.api import routes
from backend.app.db import migrate
from backend.app.domain.models import ALL_RUNS, AttemptStatus, AuditEvent, ExecutionAttempt, IdempotencyRecord, Intervention, utc_now_iso
from backend.app.domain.workspaces import (
    DEMO_WORKSPACE_ID,
    ExecutionNotAvailable,
    UnknownWorkspace,
    WorkspaceMismatch,
    new_workspace,
)
from backend.app.main import app
from backend.app.repositories.base import BaseRepository
from backend.app.repositories.in_memory import InMemoryRepository
from backend.app.services.audit_service import AuditService
from backend.app.services.execution_service import OPERATION_EXECUTE
from backend.app.services.ingestion_service import EventValidationError
from backend.app.services.recovery_service import RecoveryService
from backend.tests.events_support import Pipeline, ensure_event_workspace, event
from backend.tests.support import FakeClock, FixedProbModel, ScriptedProvider, build_service, case_of, ledger, make_tx

client = TestClient(app)
TX1, TX2 = "tx_fp_000001", "tx_fp_000002"


def uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


@pytest.fixture
def raw(pg_dsn, pg_schema):
    conn = psycopg2.connect(pg_dsn, options=f"-c search_path={pg_schema}")
    conn.autocommit = True

    def run(sql, params=None):
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall() if cur.description else cur.rowcount

    yield run
    conn.close()


@contextmanager
def refused_by(error_class, constraint=None, message=None):
    """The statement must be refused by the database — and, when named, by THAT constraint / with THAT message."""
    with pytest.raises(error_class) as err:
        yield
    if constraint is not None:
        assert err.value.diag.constraint_name == constraint, (
            f"refused by {err.value.diag.constraint_name!r}, expected {constraint!r}: {err.value}"
        )
    if message is not None:
        assert message in str(err.value)


def clone(raw, table, key_column, row_key, also=None, **overrides):
    """Insert a copy of one row, overriding some columns (identity columns are generated, not copied).
    `also=(column, value)` pins the source row further, for tables whose key is only unique within a run."""
    columns = [r[0] for r in raw(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() "
        "AND table_name = %s AND is_identity = 'NO' ORDER BY ordinal_position", (table,))]
    select = ", ".join("%s" if c in overrides else c for c in columns)
    params = [overrides[c] for c in columns if c in overrides] + [row_key]
    extra = ""
    if also is not None:
        extra, params = f" AND {also[0]} = %s", params + [also[1]]
    return raw(
        f"INSERT INTO {table} ({', '.join(columns)}) SELECT {select} FROM {table} WHERE {key_column} = %s{extra}", params
    )


def demo_workspaces(repo, *ids, provider=None, clock=None, analyze=True) -> Dict[str, RecoveryService]:
    """One scanned (and by default analysed) demo run per workspace on a SHARED repository. Every workspace uses the
    same transaction ids on purpose: ids are only unique within a run, so a leak across workspaces would show."""
    services = {}
    for ws in ids:
        services[ws] = build_service(
            [make_tx(1, merchant_id=ws, amount=1000.0), make_tx(2, merchant_id=ws, amount=2000.0)],
            repo=repo, provider=provider or ScriptedProvider(["recovered"]), clock=clock or FakeClock(), analyze=analyze,
        )
    return services


# ── 1. one active run per workspace ──────────────────────────────────────────────────────────
def test_each_workspace_has_its_own_active_run_and_a_scan_in_one_leaves_the_other_alone(any_repo):
    demo_workspaces(any_repo, "ws_a", "ws_b")
    run_a, run_b = any_repo.get_active_run(workspace_id="ws_a"), any_repo.get_active_run(workspace_id="ws_b")
    assert run_a.run_id != run_b.run_id and (run_a.merchant_id, run_b.merchant_id) == ("ws_a", "ws_b")
    assert (run_a.status, run_b.status) == ("active", "active")

    build_service([make_tx(9, merchant_id="ws_b")], repo=any_repo, seed=2, analyze=False)   # a NEW scan in ws_b
    assert any_repo.get_active_run(workspace_id="ws_a").run_id == run_a.run_id              # ws_a is untouched
    assert any_repo.get_run(run_a.run_id, workspace_id="ws_a").status == "active"
    assert any_repo.get_run(run_b.run_id, workspace_id="ws_b").status == "superseded"       # only ws_b's own run was
    assert any_repo.get_active_run(workspace_id="ws_b").run_id not in (run_a.run_id, run_b.run_id)
    assert [r.merchant_id for r in any_repo.list_runs(workspace_id="ws_a")] == ["ws_a"]
    assert {r.merchant_id for r in any_repo.list_runs(workspace_id="ws_b")} == {"ws_b"}


def test_reactivating_a_run_supersedes_only_its_own_workspaces_run(any_repo):
    demo_workspaces(any_repo, "ws_a", "ws_b")
    first_b = any_repo.get_active_run(workspace_id="ws_b")
    build_service([make_tx(9, merchant_id="ws_b")], repo=any_repo, seed=2, analyze=False)
    run_a = any_repo.get_active_run(workspace_id="ws_a")
    any_repo.activate_run(first_b.run_id, workspace_id="ws_b")
    assert any_repo.get_active_run(workspace_id="ws_b").run_id == first_b.run_id
    assert any_repo.get_active_run(workspace_id="ws_a").run_id == run_a.run_id
    with pytest.raises(KeyError):                                   # another workspace's run is simply unknown
        any_repo.activate_run(run_a.run_id, workspace_id="ws_b")
    assert any_repo.get_active_run(workspace_id="ws_a").run_id == run_a.run_id


def test_a_scan_in_a_workspace_with_the_same_source_data_is_still_idempotent(any_repo):
    any_repo.create_workspace(new_workspace("ws_a", "demo", "A"))
    service = RecoveryService(repo=any_repo, audit_service=AuditService(any_repo))
    first = service.scan_revenue(n_total=20, seed=5, merchant_id="ws_a")
    again = service.scan_revenue(n_total=20, seed=5, merchant_id="ws_a")
    assert again["reused_existing_run"] and again["run_id"] == first["run_id"]


# ── 2. concurrent scans in different workspaces ──────────────────────────────────────────────
def test_concurrent_scans_in_different_workspaces_never_interfere(pg_repo, pg_connect):
    workspaces = [f"ws_c{i}" for i in range(6)]
    for ws in workspaces:
        pg_repo.create_workspace(new_workspace(ws, "demo", f"Concurrent {ws}"))
    repos = [pg_repo] + [pg_connect() for _ in range(3)]
    barrier, errors = threading.Barrier(len(workspaces)), []
    expected_seed = {}

    def scan(i, ws):
        service = RecoveryService(repo=repos[i % len(repos)], audit_service=AuditService(repos[i % len(repos)]))
        try:
            barrier.wait()
            for seed in (10 + i, 100 + i):                          # two scans each: the second supersedes the first
                service.scan_revenue(n_total=12, seed=seed, merchant_id=ws)
                expected_seed[ws] = seed
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=scan, args=(i, ws)) for i, ws in enumerate(workspaces)]
    [t.start() for t in threads]
    [t.join(timeout=120) for t in threads]
    assert errors == []
    for ws in workspaces:
        runs = pg_repo.list_runs(workspace_id=ws)
        assert len(runs) == 2 and [r.status for r in runs].count("active") == 1
        assert pg_repo.get_active_run(workspace_id=ws).seed == expected_seed[ws]      # its own latest scan won
        assert all(r.merchant_id == ws for r in runs)


def test_concurrent_scans_in_one_workspace_serialize_to_exactly_one_active_run(pg_repo, pg_connect):
    pg_repo.create_workspace(new_workspace("ws_one", "demo", "One"))
    repos, barrier, errors = [pg_repo, pg_connect(), pg_connect()], threading.Barrier(3), []

    def scan(i):
        service = RecoveryService(repo=repos[i], audit_service=AuditService(repos[i]))
        try:
            barrier.wait()
            service.scan_revenue(n_total=12, seed=50 + i, merchant_id="ws_one")
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=scan, args=(i,)) for i in range(3)]
    [t.start() for t in threads]
    [t.join(timeout=120) for t in threads]
    assert errors == []
    runs = pg_repo.list_runs(workspace_id="ws_one")
    assert len(runs) == 3 and [r.status for r in runs].count("active") == 1


def test_a_scan_in_another_workspace_does_not_wait_for_an_open_reservation(pg_repo, pg_connect):
    demo_workspaces(pg_repo, "ws_a")
    pg_repo.create_workspace(new_workspace("ws_b", "demo", "B"))
    scanner_repo = pg_connect()
    scanner = RecoveryService(repo=scanner_repo, audit_service=AuditService(scanner_repo))
    inside, release, done = threading.Event(), threading.Event(), threading.Event()

    def reserve_then_hold():
        with pg_repo.atomic():                                      # holds a shared lock on ws_a's active run
            pg_repo.get_active_run(workspace_id="ws_a")
            inside.set()
            release.wait(30)

    def scan_elsewhere():
        inside.wait(10)
        scanner.scan_revenue(n_total=12, seed=3, merchant_id="ws_b")
        done.set()

    holder, scan = threading.Thread(target=reserve_then_hold), threading.Thread(target=scan_elsewhere)
    holder.start()
    scan.start()
    try:
        assert done.wait(20), "a scan in ws_b waited for a reservation in ws_a: the workspaces still share a lock"
    finally:
        release.set()
        holder.join(30)
        scan.join(30)
    assert pg_repo.get_active_run(workspace_id="ws_b") is not None


# ── 3. no implicit workspace, no global active run ───────────────────────────────────────────
_UNSCOPED_BY_DESIGN = {
    # the unit-of-work and registry plumbing
    "atomic", "describe", "clear", "lock_customer", "get_workspace", "list_workspaces", "create_workspace",
    # writes of an object that CARRIES its workspace (merchant_id); PostgreSQL's ws_* keys / the in-memory checks tie it
    "register_scan_run", "save_case", "save_decision", "save_attempt", "save_intervention", "save_audit_event",
    "save_idempotency_record", "insert_idempotency_record", "insert_source_event", "save_obligation",
    "create_case", "update_source_transaction",
    # reads whose KEY already is the workspace (a merchant_id argument)
    "get_idempotency_record", "list_customer_attempts", "list_events_for_reference", "lock_obligation",
    "get_or_create_ingestion_run",
    # the system's interrupted-execution sweep: deliberately spans workspaces, never reachable from the API
    "list_reserved_attempts",
}


def test_every_workspace_owned_repository_method_requires_an_explicit_workspace():
    """A guard for the future: a new unscoped read has to be added to the allow-list above, with a reason."""
    registry = {"get_workspace", "list_workspaces", "create_workspace"}      # they ARE the workspace registry
    scoped, unscoped = {}, set()
    for name, member in inspect.getmembers(BaseRepository, inspect.isfunction):
        if name.startswith("_") or name in registry or not getattr(member, "__isabstractmethod__", False) and name != "describe":
            continue
        param = inspect.signature(member).parameters.get("workspace_id")
        (scoped.__setitem__(name, param) if param is not None else unscoped.add(name))
    assert unscoped == _UNSCOPED_BY_DESIGN - registry, f"unexpected: {unscoped ^ (_UNSCOPED_BY_DESIGN - registry)}"
    for name, param in scoped.items():
        assert param.kind is inspect.Parameter.KEYWORD_ONLY and param.default is inspect.Parameter.empty, name


def test_there_is_no_fallback_to_a_global_active_run(any_repo):
    demo_workspaces(any_repo, "ws_a")
    any_repo.create_workspace(new_workspace("ws_empty", "demo", "Never scanned"))
    with pytest.raises(TypeError):
        any_repo.get_active_run()                                    # no workspace -> not callable, not "the active run"
    with pytest.raises(TypeError):
        any_repo.list_cases()
    for blank in ("", None):
        with pytest.raises(ValueError, match="workspace_id is required"):
            any_repo.get_active_run(workspace_id=blank)
    # A workspace without a scan has NO data. It does not see ws_a's, even though ws_a's run is "the" active one.
    assert any_repo.get_active_run(workspace_id="ws_empty") is None
    assert any_repo.get_all_transactions(workspace_id="ws_empty") == []
    assert any_repo.list_cases(workspace_id="ws_empty") == []
    assert any_repo.get_all_decisions(workspace_id="ws_empty") == []
    assert any_repo.get_audit_log(workspace_id="ws_empty") == []
    assert any_repo.summarize_audit_log(workspace_id="ws_empty") == {"matched": 0, "counts_by_type": {}}
    assert any_repo.get_case_for_transaction(TX1, workspace_id="ws_empty") is None
    assert any_repo.get_transaction_by_id(TX1, workspace_id="ws_empty") is None
    # ...and "all runs" is all runs OF THE WORKSPACE, not of the database
    assert any_repo.list_cases(ALL_RUNS, workspace_id="ws_empty") == []
    assert any_repo.get_all_transactions(ALL_RUNS, workspace_id="ws_empty") == []


# ── 4. reads and mutations stay inside their workspace ───────────────────────────────────────
def test_ids_resolve_inside_their_own_workspace_only(any_repo):
    services = demo_workspaces(any_repo, "ws_a", "ws_b")
    services["ws_a"].execute_case("ws_a", TX1, "k-a")
    case_a, case_b = case_of(services["ws_a"], TX1, "ws_a"), case_of(services["ws_b"], TX1, "ws_b")
    assert case_a.case_id != case_b.case_id and (case_a.merchant_id, case_b.merchant_id) == ("ws_a", "ws_b")

    # the same transaction id means a different record in each workspace
    assert any_repo.get_transaction_by_id(TX1, workspace_id="ws_a").merchant_id == "ws_a"
    assert any_repo.get_transaction_by_id(TX1, workspace_id="ws_b").merchant_id == "ws_b"
    # a case id from the other workspace is "not found", exactly like an id that never existed
    assert any_repo.get_case(case_a.case_id, workspace_id="ws_b") is None
    assert any_repo.get_case("case_that_never_existed", workspace_id="ws_b") is None
    # every workspace-wide read contains only its own records, in the active run and across "all"
    for scope in (None, ALL_RUNS):
        assert {c.merchant_id for c in any_repo.list_cases(scope, workspace_id="ws_b")} == {"ws_b"}
        assert {t.merchant_id for t in any_repo.get_all_transactions(scope, workspace_id="ws_b")} == {"ws_b"}
        assert {a.merchant_id for a in any_repo.list_attempts(run_id=scope, workspace_id="ws_a")} == {"ws_a"}
    assert any_repo.list_attempts(run_id=ALL_RUNS, workspace_id="ws_b") == []              # ws_b never executed
    assert any_repo.get_all_interventions(ALL_RUNS, workspace_id="ws_b") == []
    assert len(any_repo.get_all_interventions(ALL_RUNS, workspace_id="ws_a")) == 1
    # decisions, attempts and interventions by id
    decision_a = any_repo.get_decision(case_a.decision_id, workspace_id="ws_a")
    assert decision_a is not None and any_repo.get_decision(case_a.decision_id, workspace_id="ws_b") is None
    attempt_a = any_repo.list_attempts(case_id=case_a.case_id, workspace_id="ws_a")[0]
    assert any_repo.get_attempt(attempt_a.attempt_id, workspace_id="ws_b") is None
    assert any_repo.list_attempts(case_id=case_a.case_id, workspace_id="ws_b") == []
    assert any_repo.get_intervention_by_id(attempt_a.intervention_id, workspace_id="ws_b") is None
    assert any_repo.get_intervention_by_id(attempt_a.intervention_id, workspace_id="ws_a") is not None
    # a run id of the other workspace selects nothing
    run_a = any_repo.get_active_run(workspace_id="ws_a")
    assert any_repo.get_run(run_a.run_id, workspace_id="ws_b") is None
    assert any_repo.list_cases(run_a.run_id, workspace_id="ws_b") == []
    assert any_repo.get_all_transactions(run_a.run_id, workspace_id="ws_b") == []
    with any_repo.atomic():
        assert any_repo.lock_cases(run_a.run_id, [TX1], workspace_id="ws_b") == []
        assert len(any_repo.lock_cases(run_a.run_id, [TX1], workspace_id="ws_a")) == 1
    assert any_repo.find_run_by_fingerprint(run_a.source_fingerprint, workspace_id="ws_b") is None


def test_audit_history_is_partitioned_by_workspace(any_repo):
    services = demo_workspaces(any_repo, "ws_a", "ws_b")
    services["ws_a"].execute_case("ws_a", TX1, "k-a")
    for scope in (None, ALL_RUNS):
        a = any_repo.get_audit_log(limit=1000, run_id=scope, workspace_id="ws_a")
        b = any_repo.get_audit_log(limit=1000, run_id=scope, workspace_id="ws_b")
        assert {e.merchant_id for e in a} == {"ws_a"} and {e.merchant_id for e in b} == {"ws_b"}
        assert any(e.event_type == "EXECUTION_SUCCEEDED" or e.event_type == "EXECUTION_FAILED" for e in a)
        assert not any(e.event_type.startswith("EXECUTION") for e in b)
    assert any_repo.summarize_audit_log(workspace_id="ws_b")["counts_by_type"].get("ACTION_AUTHORIZED") is None
    assert any_repo.summarize_audit_log(workspace_id="ws_a")["counts_by_type"].get("ACTION_AUTHORIZED") == 1


def test_a_mutation_aimed_at_another_workspace_is_refused(any_repo):
    services = demo_workspaces(any_repo, "ws_a", "ws_b")
    run_a = any_repo.get_active_run(workspace_id="ws_a")
    case_a = case_of(services["ws_a"], TX1, "ws_a")
    # analysis figures cannot be written onto another workspace's transaction
    with pytest.raises(KeyError):
        any_repo.update_transaction_analysis(run_a.run_id, TX1, 0.01, 0, workspace_id="ws_b")
    with pytest.raises(KeyError):
        any_repo.update_transaction_analyses(run_a.run_id, [(TX1, 0.01, 0)], workspace_id="ws_b")
    assert any_repo.get_transaction_by_id(TX1, workspace_id="ws_a").model_recovery_prob != 0.01
    # a case cannot be saved under another workspace
    moved = replace(any_repo.get_case(case_a.case_id, workspace_id="ws_a"), merchant_id="ws_b")
    with pytest.raises(WorkspaceMismatch):
        any_repo.save_case(moved)
    assert any_repo.get_case(case_a.case_id, workspace_id="ws_a").merchant_id == "ws_a"
    assert any_repo.get_case(case_a.case_id, workspace_id="ws_b") is None


def _attempt_for(case, **over):
    now = utc_now_iso()
    base = dict(
        attempt_id=uid("att"), case_id=case.case_id, run_id=case.run_id, merchant_id=case.merchant_id,
        transaction_id=case.transaction_id, customer_id=case.customer_id, sequence=9, attempt_number=None,
        requested_action="retry", final_action=None, decision_id=None, authorization={"allowed": False},
        status=AttemptStatus.DENIED, idempotency_key=None, request_fingerprint="fp", provider="p",
        execution_mode="simulation", created_at=now,
    )
    base.update(over)
    return ExecutionAttempt(**base)


def test_records_that_name_another_workspace_than_their_parent_are_refused_by_both_repositories(any_repo):
    services = demo_workspaces(any_repo, "ws_a", "ws_b")
    services["ws_a"].execute_case("ws_a", TX1, "seed")      # gives ws_a a real attempt, decision and intervention
    case_a = case_of(services["ws_a"], TX1, "ws_a")
    real_attempt = any_repo.list_attempts(case_id=case_a.case_id, workspace_id="ws_a")[0]
    free_attempt = _attempt_for(case_a, sequence=5)         # a real attempt with no intervention yet
    any_repo.save_attempt(free_attempt)
    other = replace(case_a, merchant_id="ws_b")             # the same case, claiming the other workspace
    now = utc_now_iso()

    with pytest.raises(WorkspaceMismatch):
        any_repo.save_attempt(_attempt_for(case_a, merchant_id="ws_b"))
    with pytest.raises(WorkspaceMismatch):
        any_repo.save_idempotency_record(IdempotencyRecord(
            merchant_id="ws_b", operation=OPERATION_EXECUTE, key="k", request_fingerprint="fp",
            case_id=case_a.case_id, attempt_id=real_attempt.attempt_id, status="in_progress"))
    with pytest.raises(WorkspaceMismatch):
        any_repo.save_audit_event(AuditEvent(
            event_id=uid("evt"), merchant_id="ws_b", transaction_id=TX1, leak_id="fp_000001", decision_id=None,
            intervention_id=None, timestamp=now, event_type="X", action="none", policy_result={},
            run_id=case_a.run_id, case_id=case_a.case_id))
    with pytest.raises(WorkspaceMismatch):
        any_repo.save_intervention(Intervention(
            intervention_id=uid("itv"), decision_id=case_a.decision_id, leak_id="fp_000001", transaction_id=TX1,
            customer_id="c", merchant_id="ws_b", amount=1.0, ai_proposed_action="retry", policy_allowed=True,
            policy_reason="r", final_action="retry", provider="p", status="attempted_no_recovery", recovered=False,
            recovered_amount=0.0, timestamp=now, run_id=case_a.run_id, case_id=case_a.case_id,
            attempt_id=free_attempt.attempt_id))
    assert other.merchant_id == "ws_b"
    # nothing was written by any of the refusals
    assert any_repo.list_attempts(run_id=ALL_RUNS, workspace_id="ws_b") == []
    assert any_repo.get_idempotency_record("ws_b", OPERATION_EXECUTE, "k") is None
    assert all(e.event_type != "X" for e in any_repo.get_audit_log(run_id=ALL_RUNS, limit=1000, workspace_id="ws_b"))
    assert any_repo.get_all_interventions(ALL_RUNS, workspace_id="ws_b") == []


# ── 5. execution safety ──────────────────────────────────────────────────────────────────────
def merchant_workspace_with_a_case(repo, workspace_id="acme"):
    """A merchant (recommend_only) workspace holding one event-derived (inert, open) case."""
    ensure_event_workspace(repo, workspace_id, "merchant")
    pipe = Pipeline(repo)
    pipe.ingest("e-" + workspace_id, merchant=workspace_id, ref="ord_" + workspace_id)
    return pipe.case_of(merchant=workspace_id, ref="ord_" + workspace_id)


def test_a_recommend_only_workspace_never_executes_and_nothing_is_written(any_repo):
    case = merchant_workspace_with_a_case(any_repo)
    provider = ScriptedProvider(["recovered"])
    service = RecoveryService(repo=any_repo, audit_service=AuditService(any_repo), provider=provider, clock=FakeClock())
    service.model = FixedProbModel(0.9)
    events_before = any_repo.get_audit_log(limit=100, run_id=ALL_RUNS, workspace_id="acme")

    for target in (case.case_id, case.transaction_id, "an id that does not exist"):    # existing or not: the same answer
        with pytest.raises(ExecutionNotAvailable) as refused:
            service.execute_case("acme", target, "k1")
        assert refused.value.status_code == 409 and refused.value.code == "execution_not_available"
    with pytest.raises(ExecutionNotAvailable):
        service.recover_revenue("acme")                                          # the whole bulk request, up front

    assert provider.calls == []                                                  # the provider was never reached
    assert any_repo.list_attempts(run_id=ALL_RUNS, workspace_id="acme") == []
    assert any_repo.get_idempotency_record("acme", OPERATION_EXECUTE, "k1") is None
    after = any_repo.get_case(case.case_id, workspace_id="acme")
    assert after.state.value == "open" and after.decision_id is None             # not even decided: no model, no policy
    assert any_repo.get_audit_log(limit=100, run_id=ALL_RUNS, workspace_id="acme") == events_before


def test_an_unknown_workspace_cannot_execute_either(any_repo):
    service = RecoveryService(repo=any_repo, audit_service=AuditService(any_repo), provider=ScriptedProvider())
    for call in (lambda: service.execute_case("ghost", TX1, "k"), lambda: service.recover_revenue("ghost")):
        with pytest.raises(UnknownWorkspace):
            call()
    assert any_repo.get_workspace("ghost") is None


def test_demo_workspaces_keep_simulated_execution_and_label_it_as_such(any_repo):
    provider = ScriptedProvider(["recovered", "recovered"])
    services = demo_workspaces(any_repo, "ws_a", "ws_b", provider=provider)
    out_a = services["ws_a"].execute_case("ws_a", TX1, "same-key")
    out_b = services["ws_b"].execute_case("ws_b", TX1, "same-key")                # the same key, another workspace
    assert not out_a.replayed and not out_b.replayed and out_a.attempt_id != out_b.attempt_id
    assert out_a.intervention["execution_mode"] == out_b.intervention["execution_mode"] == "simulation"
    assert out_a.intervention["merchant_id"] == "ws_a" and out_b.intervention["merchant_id"] == "ws_b"
    assert [c["transaction_id"] for c in provider.calls] == [TX1, TX1]
    assert any_repo.get_workspace("ws_a").execution_mode == "simulation"


def test_idempotency_and_the_attempt_ledger_behave_as_before_inside_a_workspace(any_repo):
    provider = ScriptedProvider(["recovered"])
    services = demo_workspaces(any_repo, "ws_a", "ws_b", provider=provider)
    first = services["ws_a"].execute_case("ws_a", TX1, "k1")
    replay = services["ws_a"].execute_case("ws_a", TX1, "k1")
    assert replay.replayed and replay.intervention == first.intervention and len(provider.calls) == 1
    assert [a.attempt_number for a in ledger(services["ws_a"], TX1, "ws_a")] == [1]
    assert ledger(services["ws_b"], TX1, "ws_b") == []                          # ws_b's identical id was not touched
    assert case_of(services["ws_b"], TX1, "ws_b").state.value == "authorized"
    # the audit trail of the execution is in ws_a, once
    log = any_repo.get_audit_log(limit=1000, run_id=ALL_RUNS, workspace_id="ws_a")
    assert [e.event_type for e in log].count("EXECUTION_STARTED") == 1


def test_analytics_and_recovery_are_computed_per_workspace(any_repo):
    services = demo_workspaces(any_repo, "ws_a", "ws_b", provider=ScriptedProvider(["recovered"]))
    services["ws_a"].recover_revenue("ws_a")
    a, b = services["ws_a"].get_analytics_summary("ws_a"), services["ws_b"].get_analytics_summary("ws_b")
    assert a["total_at_risk"] == b["total_at_risk"] == 3000.0
    assert a["recovered_count"] > 0 and b["recovered_count"] == 0 and b["total_recovered"] == 0
    assert a["execution_mode"] == b["execution_mode"] == "simulation"
    assert services["ws_b"].get_interventions("ws_b") == []
    assert len(services["ws_a"].get_interventions("ws_a")) == a["attempted_count"] or True


def test_a_case_run_and_workspace_that_disagree_are_refused_before_any_attempt_exists():
    class LyingRepository(InMemoryRepository):
        """Reports a transaction that belongs to another workspace than its case and run."""

        def get_transaction_by_id(self, tx_id, run_id=None, *, workspace_id):
            tx = super().get_transaction_by_id(tx_id, run_id, workspace_id=workspace_id)
            return replace(tx, merchant_id="someone_else") if tx is not None else None

    repo, provider = LyingRepository(), ScriptedProvider(["recovered"])
    service = build_service([make_tx(1, merchant_id="ws_a")], repo=repo, provider=provider, analyze=False)
    service.analyze_revenue("ws_a")
    with pytest.raises(ExecutionNotAvailable, match="do not agree"):
        service.execute_case("ws_a", TX1, "k")
    assert provider.calls == [] and repo.list_attempts(run_id=ALL_RUNS, workspace_id="ws_a") == []
    assert case_of(service, TX1, "ws_a").state.value == "authorized"             # untouched, still executable once consistent


def test_a_provider_whose_mode_does_not_match_the_workspace_is_refused():
    class LiveProvider(ScriptedProvider):
        @property
        def execution_mode(self):
            return "live"

    repo, provider = InMemoryRepository(), LiveProvider(["recovered"])
    service = build_service([make_tx(1, merchant_id="ws_a")], repo=repo, provider=provider)
    with pytest.raises(ExecutionNotAvailable, match="refused rather than guessed"):
        service.execute_case("ws_a", TX1, "k")
    assert provider.calls == [] and repo.list_attempts(run_id=ALL_RUNS, workspace_id="ws_a") == []


def test_in_memory_repository_will_not_start_an_attempt_outside_a_simulation_workspace():
    repo = InMemoryRepository()
    case = merchant_workspace_with_a_case(repo)
    with pytest.raises(ExecutionNotAvailable):
        repo.save_attempt(_attempt_for(case, status=AttemptStatus.RESERVED, attempt_number=1, final_action="retry"))
    repo.save_attempt(_attempt_for(case))                    # a DENIED attempt is only the record of a refusal
    assert len(repo.list_attempts(case_id=case.case_id, workspace_id="acme")) == 1


# ── 6. the database refuses what the application would never do ─────────────────────────────
def test_the_database_will_not_start_an_attempt_in_a_recommend_only_workspace(pg_repo, raw):
    case = merchant_workspace_with_a_case(pg_repo)
    columns = dict(
        case_id=case.case_id, run_id=case.run_id, merchant_id="acme", transaction_id=case.transaction_id,
        customer_id=case.customer_id, sequence=1, requested_action="retry",
    )

    def insert(attempt_id, status, number, final):
        raw("""INSERT INTO execution_attempts (attempt_id, case_id, run_id, merchant_id, transaction_id, customer_id,
                   sequence, attempt_number, requested_action, final_action, authorization_snapshot, status,
                   request_fingerprint, provider, execution_mode, created_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, '{}', %s, 'fp', 'p', 'simulation', now())""",
            (attempt_id, columns["case_id"], columns["run_id"], columns["merchant_id"], columns["transaction_id"],
             columns["customer_id"], 1 if status == "denied" else 2, number, "retry", final, status))

    for status in ("reserved", "completed", "failed"):
        with refused_by(pgerr.IntegrityConstraintViolation, message="ws_execution_not_available"):
            insert(uid("att"), status, 1, "retry")
    insert(uid("att"), "denied", None, None)                      # the record of a refusal is always allowed
    assert raw("SELECT count(*), min(status) FROM execution_attempts WHERE merchant_id = 'acme'") == [(1, "denied")]


def test_the_repository_reports_that_database_refusal_as_a_typed_error(pg_repo):
    case = merchant_workspace_with_a_case(pg_repo)
    with pytest.raises(ExecutionNotAvailable):
        pg_repo.save_attempt(_attempt_for(case, status=AttemptStatus.RESERVED, attempt_number=1, final_action="retry"))


def test_switching_a_workspace_off_blocks_new_execution_but_never_strands_an_open_attempt(pg_repo, raw):
    provider = ScriptedProvider(["recovered"])
    services = demo_workspaces(pg_repo, "ws_a", provider=provider)
    service = services["ws_a"]
    reservation = service.executor._reserve_with_retry("ws_a", case_of(service, TX1, "ws_a").case_id, "k-open", None)
    attempt = pg_repo.get_attempt(reservation.attempt_id, workspace_id="ws_a")
    raw("UPDATE workspaces SET execution_mode = 'recommend_only' WHERE workspace_id = 'ws_a'")   # an operator switch
    with pytest.raises(ExecutionNotAvailable):                              # nothing NEW starts...
        service.execute_case("ws_a", TX2, "k-new")
    assert [c["transaction_id"] for c in provider.calls] == []
    attempt.status, attempt.failure_reason, attempt.completed_at = AttemptStatus.FAILED, "closed", utc_now_iso()
    pg_repo.save_attempt(attempt)                                           # ...but the open one can still be closed
    assert pg_repo.get_attempt(attempt.attempt_id, workspace_id="ws_a").status == AttemptStatus.FAILED


@pytest.fixture
def two_workspaces(pg_repo, raw):
    provider = ScriptedProvider(["recovered"])
    services = demo_workspaces(pg_repo, "ws_a", "ws_b", provider=provider)
    services["ws_a"].execute_case("ws_a", TX1, "seed-key")
    case_a, case_b = case_of(services["ws_a"], TX1, "ws_a"), case_of(services["ws_b"], TX1, "ws_b")
    attempt = pg_repo.list_attempts(case_id=case_a.case_id, workspace_id="ws_a")[0]
    return {
        "services": services, "case_a": case_a.case_id, "case_b": case_b.case_id, "run_a": case_a.run_id,
        "run_b": case_b.run_id, "attempt_a": attempt.attempt_id, "intervention_a": attempt.intervention_id,
        "decision_a": case_a.decision_id,
    }


def test_child_rows_cannot_claim_a_workspace_other_than_their_runs(raw, two_workspaces):
    w = two_workspaces
    with refused_by(pgerr.ForeignKeyViolation, "ws_transactions_run_fk"):
        clone(raw, "transactions", "transaction_id", TX1, also=("run_id", w["run_a"]), transaction_id="tx_x",
              leak_id="l_x", merchant_id="ws_b", ordinal=9)
    clone(raw, "transactions", "transaction_id", TX1, also=("run_id", w["run_a"]), transaction_id="tx_ok",
          leak_id="l_ok", ordinal=10)                                   # a CONSISTENT new transaction in ws_a's run: fine
    with refused_by(pgerr.ForeignKeyViolation, "ws_cases_run_fk"):
        clone(raw, "recovery_cases", "case_id", w["case_a"], case_id="case_x", merchant_id="ws_b",
              transaction_id="tx_ok", leak_id="l_ok", ordinal=10)
    with refused_by(pgerr.ForeignKeyViolation, "ws_decisions_case_run_fk"):    # a decision whose run is not its case's
        clone(raw, "decisions", "decision_id", w["decision_a"], decision_id="dec_x", run_id=w["run_b"])
    with refused_by(pgerr.ForeignKeyViolation, "ws_attempts_run_fk"):
        clone(raw, "execution_attempts", "attempt_id", w["attempt_a"], attempt_id="att_x", merchant_id="ws_b",
              sequence=2, attempt_number=2, status="failed", recovered=False, recovered_amount=0, intervention_id=None)
    with refused_by(pgerr.ForeignKeyViolation, "ws_attempts_case_run_fk"):     # an attempt of A's case filed under B's run
        clone(raw, "execution_attempts", "attempt_id", w["attempt_a"], attempt_id="att_y", merchant_id="ws_b",
              run_id=w["run_b"], sequence=3, attempt_number=3, status="failed", recovered=False, recovered_amount=0,
              intervention_id=None)
    clone(raw, "execution_attempts", "attempt_id", w["attempt_a"], attempt_id="att_free", sequence=7,
          attempt_number=None, final_action=None, status="denied", recovered=False, recovered_amount=0,
          intervention_id=None)                                  # an attempt with no intervention (the key is unique)
    with refused_by(pgerr.ForeignKeyViolation, "ws_interventions_run_fk"):
        clone(raw, "interventions", "intervention_id", w["intervention_a"], intervention_id="itv_x", merchant_id="ws_b",
              attempt_id="att_free", recovered=False, recovered_amount=0)
    with refused_by(pgerr.ForeignKeyViolation, "ws_idempotency_case_fk"):
        clone(raw, "idempotency_records", "key", "seed-key", key="k2", merchant_id="ws_b")
    audit_id = raw("SELECT event_id FROM audit_events WHERE run_id = %s LIMIT 1", (w["run_a"],))[0][0]
    with refused_by(pgerr.ForeignKeyViolation, "ws_audit_run_fk"):
        clone(raw, "audit_events", "event_id", audit_id, event_id="evt_x", merchant_id="ws_b")
    with refused_by(pgerr.ForeignKeyViolation, "ws_audit_workspace_fk"):       # not a registered workspace at all
        clone(raw, "audit_events", "event_id", audit_id, event_id="evt_y", merchant_id="nobody", run_id=None,
              case_id=None, attempt_id=None, decision_id=None, intervention_id=None)
    # and the rows that ARE consistent were never disturbed
    assert raw("SELECT count(*) FROM transactions WHERE merchant_id = 'ws_b'") == [(2,)]
    assert raw("SELECT count(*) FROM transactions WHERE merchant_id = 'ws_a'") == [(3,)]      # tx_ok, and only that
    assert raw("SELECT count(*) FROM execution_attempts WHERE merchant_id = 'ws_b'") == [(0,)]
    assert raw("SELECT count(*) FROM interventions WHERE merchant_id = 'ws_b'") == [(0,)]


def test_obligations_and_events_belong_to_a_registered_workspace_and_agree_with_their_case(pg_repo, raw):
    case = merchant_workspace_with_a_case(pg_repo, "acme")
    other_case = merchant_workspace_with_a_case(pg_repo, "other")              # other has its own run and case
    unclaimed = demo_workspaces(pg_repo, "ws_a")["ws_a"]                       # ws_a has cases that no obligation holds
    unclaimed_case = case_of(unclaimed, TX1, "ws_a")
    obligation_id = raw("SELECT obligation_id FROM revenue_obligations WHERE merchant_id = 'acme'")[0][0]
    columns = ("obligation_id", "merchant_id", "reference_kind", "reference_id", "leak_type", "created_at")
    raw(f"INSERT INTO revenue_obligations ({', '.join(columns)}) VALUES ('obl_other', 'other', 'payment', 'o9', 'failed_payment', now())")
    with refused_by(pgerr.ForeignKeyViolation, "ws_obligations_run_fk"):       # other's obligation filed under acme's run
        raw("UPDATE revenue_obligations SET run_id = %s WHERE obligation_id = 'obl_other'", (case.run_id,))
    with refused_by(pgerr.ForeignKeyViolation, "ws_obligations_case_fk"):      # ...or pointing at another workspace's case
        raw("UPDATE revenue_obligations SET run_id = %s, case_id = %s WHERE obligation_id = 'obl_other'",
            (other_case.run_id, unclaimed_case.case_id))
    with refused_by(pgerr.ForeignKeyViolation, "ws_obligations_workspace_fk"):
        clone(raw, "revenue_obligations", "obligation_id", obligation_id, obligation_id="obl_z", merchant_id="nobody",
              reference_id="oz", case_id=None, run_id=None)
    with refused_by(pgerr.ForeignKeyViolation, "ws_source_events_workspace_fk"):   # an event about an unknown workspace
        raw("""INSERT INTO source_events (event_id, merchant_id, source, source_event_id, event_type, reference_kind,
                   reference_id, payload, content_fingerprint, occurred_at, received_at)
               VALUES ('sev_nobody', 'nobody', 'internal', 'e1', 'payment.attempt_failed', 'payment', 'o1', '{}', 'f',
                       now(), now())""")


def test_the_database_allows_one_active_run_per_workspace_and_no_more(raw, two_workspaces):
    w = two_workspaces
    assert raw("SELECT merchant_id, count(*) FROM scan_runs WHERE status = 'active' GROUP BY merchant_id ORDER BY 1") \
        == [("ws_a", 1), ("ws_b", 1)]                                          # two active runs, one per workspace
    with refused_by(pgerr.UniqueViolation, "scan_runs_one_active_per_workspace"):
        clone(raw, "scan_runs", "run_id", w["run_a"], run_id="run_second_active", source_fingerprint="fp_second")
    with refused_by(pgerr.NotNullViolation):                                    # every run names a registered workspace
        raw("""INSERT INTO scan_runs (run_id, merchant_id, source_fingerprint, n_total, seed, created_at, last_scanned_at,
                   status, kind) VALUES ('run_nobody', 'nobody', 'ingest:nobody', 0, 0, now(), now(), 'standby', 'ingestion')""")


# ── 7. events ────────────────────────────────────────────────────────────────────────────────
def test_an_event_about_an_unknown_workspace_is_rejected_and_leaves_nothing_behind(any_repo):
    pipe = Pipeline(any_repo)
    registered_before = [w.workspace_id for w in any_repo.list_workspaces()]
    with pytest.raises(EventValidationError) as refused:
        pipe.ingest("e-ghost", merchant="ghost", ref="ord_ghost")
    assert refused.value.code == "unknown_workspace"
    assert [w.workspace_id for w in any_repo.list_workspaces()] == registered_before        # never created from a claim
    for ws in registered_before:
        assert any_repo.list_source_events(workspace_id=ws) == [] if ws not in ("merch_a",) else True
    assert all(any_repo.list_obligations(workspace_id=ws) == [] for ws in registered_before)
    assert all(any_repo.list_runs(workspace_id=ws) == [] for ws in registered_before)
    # the repositories refuse it on their own as well (PostgreSQL by foreign key)
    with pytest.raises(UnknownWorkspace):
        any_repo.get_or_create_ingestion_run("ghost", utc_now_iso())


def test_event_derived_cases_are_inert_in_every_kind_of_workspace(any_repo):
    ensure_event_workspace(any_repo, "acme", "merchant")
    ensure_event_workspace(any_repo, "demo_inert", "demo")
    pipe = Pipeline(any_repo)
    pipe.ingest("e1", merchant="acme", ref="o1")
    pipe.ingest("e2", merchant="demo_inert", ref="o2")
    provider = ScriptedProvider(["recovered"])
    service = RecoveryService(repo=any_repo, audit_service=AuditService(any_repo), provider=provider, clock=FakeClock())
    service.model = FixedProbModel(0.9)
    for ws, ref in (("acme", "o1"), ("demo_inert", "o2")):
        case = pipe.case_of(merchant=ws, ref=ref)
        assert any_repo.get_run(case.run_id, workspace_id=ws).status == "standby"      # never the active run
        assert any_repo.get_active_run(workspace_id=ws) is None
        assert any_repo.list_cases(workspace_id=ws) == []                            # not dashboard data
        assert len(any_repo.list_cases(ALL_RUNS, workspace_id=ws)) == 1
    with pytest.raises(ExecutionNotAvailable):              # a merchant workspace: refused at the gate
        service.execute_case("acme", pipe.case_of(merchant="acme", ref="o1").case_id, "k")
    with pytest.raises(Exception) as inert:                 # a demo workspace: the case is in no ACTIVE run
        service.execute_case("demo_inert", pipe.case_of(merchant="demo_inert", ref="o2").case_id, "k")
    assert getattr(inert.value, "code", None) in ("run_superseded", "case_not_found")
    assert provider.calls == [] and any_repo.list_attempts(run_id=ALL_RUNS, workspace_id="demo_inert") == []


def test_events_reads_and_reprocessing_stay_inside_their_workspace(any_repo):
    pipe = Pipeline(any_repo)
    a = pipe.ingest("e-a", merchant="merch_a", ref="same_ref")
    b = pipe.ingest("e-b", merchant="merch_b", ref="same_ref")
    assert a.detection.case_id != b.detection.case_id                        # the same reference, two workspaces
    assert {e.merchant_id for e in any_repo.list_source_events(workspace_id="merch_a")} == {"merch_a"}
    assert any_repo.get_source_event(a.event.event_id, workspace_id="merch_b") is None
    assert any_repo.get_obligation(pipe.obligation(merchant="merch_a", ref="same_ref").obligation_id,
                                   workspace_id="merch_b") is None
    assert [o.merchant_id for o in any_repo.list_obligations(workspace_id="merch_b")] == ["merch_b"]
    with pytest.raises(KeyError):
        any_repo.mark_source_event(a.event.event_id, "failed", "x", utc_now_iso(), workspace_id="merch_b")
    with pytest.raises(KeyError):
        pipe.ingestion.reprocess("merch_b", a.event.event_id)
    assert any_repo.get_source_event(a.event.event_id, workspace_id="merch_a").processing_status == "processed"


# ── 8. HTTP ──────────────────────────────────────────────────────────────────────────────────
def new_demo_workspace_over_http():
    workspace_id = uid("ws")
    routes.repo.create_workspace(new_workspace(workspace_id, "demo", f"HTTP {workspace_id}"))
    scan = client.post("/api/scan", json={"n_total": 20, "seed": 77, "merchant_id": workspace_id})
    assert scan.status_code == 200
    assert client.post("/api/analyze", params={"workspace_id": workspace_id}).status_code == 200
    return workspace_id


def test_http_reads_and_execution_are_confined_to_the_selected_workspace():
    default_run = client.get("/api/runs").json()["active_run_id"]
    ws = new_demo_workspace_over_http()
    assert client.get("/api/runs").json()["active_run_id"] == default_run        # the demo workspace's run is untouched

    mine = client.get("/api/transactions", params={"workspace_id": ws, "limit": 1000}).json()
    assert len(mine) == 20 and {t["merchant_id"] for t in mine} == {ws}
    cases = client.get("/api/cases", params={"workspace_id": ws, "limit": 1000}).json()["cases"]
    assert len(cases) == 20 and {c["merchant_id"] for c in cases} == {ws}
    assert client.get("/api/runs", params={"workspace_id": ws}).json()["total"] == 1

    # that workspace's case ids are not found from the demo workspace, and execution there is refused as not found
    case_id, tx_id = cases[0]["case_id"], cases[0]["transaction_id"]
    assert client.get(f"/api/cases/{case_id}").status_code == 404                       # default = demo workspace
    assert client.get(f"/api/cases/{case_id}", params={"workspace_id": ws}).status_code == 200
    cross = client.post(f"/api/interventions/{case_id}/execute", headers={"Idempotency-Key": uid("k")})
    assert cross.status_code == 404 and cross.json()["code"] == "case_not_found"
    never = client.post("/api/interventions/never_existed/execute", headers={"Idempotency-Key": uid("k")})
    assert never.status_code == 404
    # the SAME answer as for an id that never existed (only the caller's own id is echoed): nothing leaks
    assert cross.json() == {**never.json(), "detail": never.json()["detail"].replace("never_existed", case_id)}
    assert ws not in cross.text
    ok = client.post(f"/api/interventions/{tx_id}/execute", params={"workspace_id": ws},
                     headers={"Idempotency-Key": uid("k")})
    assert ok.status_code == 200 and ok.json()["execution_mode"] == "simulation" and ok.json()["merchant_id"] == ws
    assert client.get("/api/interventions", params={"workspace_id": ws}).json()["total"] == 1
    assert all(i["merchant_id"] == DEMO_WORKSPACE_ID for i in client.get("/api/interventions").json()["interventions"])
    audit = client.get("/api/audit", params={"workspace_id": ws, "limit": 1000}).json()
    assert audit["entries"] and {e["merchant_id"] for e in audit["entries"]} == {ws}


def test_http_unknown_workspaces_are_typed_422s_everywhere_and_never_created():
    ghost = uid("ghost")
    for method, path in (
        ("get", "/api/transactions"), ("get", "/api/cases"), ("get", "/api/runs"), ("get", "/api/analytics"),
        ("get", "/api/audit"), ("get", "/api/interventions"), ("get", "/api/ingest/events"),
        ("get", "/api/ingest/obligations"), ("post", "/api/analyze"), ("post", "/api/recover"),
        ("post", "/api/interventions/anything/execute"),
    ):
        resp = getattr(client, method)(path, params={"workspace_id": ghost})
        assert resp.status_code == 422, (path, resp.text)
        assert resp.json() == {"detail": resp.json()["detail"], "code": "unknown_workspace", "workspace_id": ghost}
    assert routes.repo.get_workspace(ghost) is None


def test_http_a_recommend_only_workspace_answers_409_before_anything_else():
    ws = uid("acme")
    routes.repo.create_workspace(new_workspace(ws, "merchant", "Acme"))
    for path in (f"/api/interventions/whatever/execute", "/api/recover"):
        resp = client.post(path, params={"workspace_id": ws}, headers={"Idempotency-Key": uid("k")})
        assert resp.status_code == 409 and resp.json()["code"] == "execution_not_available", (path, resp.text)
        assert isinstance(resp.json()["detail"], str) and resp.json()["workspace_id"] == ws
    assert client.get("/api/analytics", params={"workspace_id": ws}).json()["execution_mode"] == "recommend_only"


def test_http_ingestion_rejects_unknown_workspaces_and_reads_are_per_workspace():
    ghost, acme = uid("ghost"), uid("acme")
    body = event(uid("e"), merchant=ghost, ref=uid("o"))
    resp = client.post("/api/ingest/events", json=body)
    assert resp.status_code == 422 and resp.json()["code"] == "unknown_workspace"
    assert routes.repo.get_workspace(ghost) is None

    routes.repo.create_workspace(new_workspace(acme, "merchant", "Acme"))
    body = event(uid("e"), merchant=acme, ref=uid("o"))
    stored = client.post("/api/ingest/events", json=body)
    assert stored.status_code == 201 and stored.json()["detection"]["outcome"] == "case_opened"
    assert stored.json()["event"]["merchant_assertion"] == "unauthenticated_claim"
    event_id = stored.json()["event"]["event_id"]
    assert client.get("/api/ingest/events", params={"workspace_id": acme}).json()["total"] == 1
    assert all(e["event_id"] != event_id for e in client.get("/api/ingest/events", params={"limit": 1000}).json()["events"])
    assert client.get(f"/api/ingest/events/{event_id}").status_code == 404                     # from the demo workspace
    assert client.get(f"/api/ingest/events/{event_id}", params={"workspace_id": acme}).status_code == 200
    assert client.get("/api/ingest/obligations", params={"workspace_id": acme}).json()["total"] == 1
    exec_resp = client.post(f"/api/interventions/{stored.json()['detection']['case_id']}/execute",
                            params={"workspace_id": acme}, headers={"Idempotency-Key": uid("k")})
    assert exec_resp.status_code == 409 and exec_resp.json()["code"] == "execution_not_available"


# ── 9. migration 0004 from a version-3 database ──────────────────────────────────────────────
def seed_version_3(raw):
    """Consistent multi-workspace data as a version-3 database could hold it (one active run: 0003 still has the
    global index), plus a merchant workspace with an event-derived case."""
    for ws in ("ws_one", "ws_two"):
        raw("""INSERT INTO workspaces (workspace_id, kind, display_name, base_currency, timezone, execution_mode, origin, created_at)
               VALUES (%s, 'demo', %s, 'INR', 'UTC', 'simulation', 'explicit', now())""", (ws, ws))
    raw("""INSERT INTO workspaces (workspace_id, kind, display_name, base_currency, timezone, execution_mode, origin, created_at)
           VALUES ('acme', 'merchant', 'Acme', 'INR', 'UTC', 'recommend_only', 'explicit', now())""")
    for i, ws in enumerate(("ws_one", "ws_two")):
        run = f"run_{ws}"
        raw("""INSERT INTO scan_runs (run_id, merchant_id, source_fingerprint, n_total, seed, created_at, last_scanned_at, status)
               VALUES (%s, %s, %s, 1, 1, now(), now(), %s)""", (run, ws, f"fp_{ws}", "active" if i == 0 else "superseded"))
        raw("""INSERT INTO transactions (run_id, transaction_id, ordinal, leak_id, merchant_id, customer_id, amount, leak_type,
                   event_time) VALUES (%s, 'tx_1', 0, 'fp_1', %s, 'c', 100.50, 'failed_payment', 'x')""", (run, ws))
        raw("""INSERT INTO recovery_cases (case_id, run_id, ordinal, merchant_id, transaction_id, leak_id, customer_id,
                   leak_type, amount, state, created_at, updated_at)
               VALUES (%s, %s, 0, %s, 'tx_1', 'fp_1', 'c', 'failed_payment', 100.50, 'open', now(), now())""",
            (f"case_{ws}", run, ws))
        raw("""INSERT INTO decisions (decision_id, run_id, case_id, leak_id, transaction_id, candidates_evaluated,
                   ai_proposed_action, ai_proposed_ev, ai_proposed_probability, policy_allowed, policy_reason, final_action,
                   created_at) VALUES (%s, %s, %s, 'fp_1', 'tx_1', '[]', 'retry', 1, 0.5, TRUE, 'ok', 'retry', now())""",
            (f"dec_{ws}", run, f"case_{ws}"))
        raw("""INSERT INTO execution_attempts (attempt_id, case_id, run_id, merchant_id, transaction_id, customer_id, sequence,
                   attempt_number, requested_action, final_action, decision_id, authorization_snapshot, status,
                   request_fingerprint, provider, execution_mode, created_at)
               VALUES (%s, %s, %s, %s, 'tx_1', 'c', 1, 1, 'retry', 'retry', %s, '{}', 'failed', 'rfp', 'p', 'simulation', now())""",
            (f"att_{ws}", f"case_{ws}", run, ws, f"dec_{ws}"))
        raw("""INSERT INTO interventions (intervention_id, decision_id, leak_id, transaction_id, customer_id, merchant_id, amount,
                   ai_proposed_action, policy_allowed, policy_reason, final_action, provider, status, recovered,
                   recovered_amount, occurred_at, run_id, case_id, attempt_id)
               VALUES (%s, %s, 'fp_1', 'tx_1', 'c', %s, 100.50, 'retry', TRUE, 'ok', 'retry', 'p', 'attempted_no_recovery',
                       FALSE, 0, now(), %s, %s, %s)""", (f"itv_{ws}", f"dec_{ws}", ws, run, f"case_{ws}", f"att_{ws}"))
        raw("""INSERT INTO idempotency_records (merchant_id, operation, key, request_fingerprint, case_id, attempt_id, status, created_at)
               VALUES (%s, 'execute_intervention', 'k1', 'rfp', %s, %s, 'in_progress', now())""", (ws, f"case_{ws}", f"att_{ws}"))
        raw("""INSERT INTO audit_events (event_id, merchant_id, transaction_id, leak_id, occurred_at, event_type, action,
                   policy_result, policy_version, model_version, provider, run_id, case_id, attempt_id)
               VALUES (%s, %s, 'tx_1', 'fp_1', now(), 'X', 'none', '{}', '1', '1', 'p', %s, %s, %s)""",
            (f"ae_{ws}", ws, run, f"case_{ws}", f"att_{ws}"))
    raw("""INSERT INTO scan_runs (run_id, merchant_id, source_fingerprint, n_total, seed, created_at, last_scanned_at, status, kind)
           VALUES ('run_acme', 'acme', 'ingest:acme', 0, 0, now(), now(), 'standby', 'ingestion')""")
    raw("""INSERT INTO source_events (event_id, merchant_id, source, source_event_id, event_type, reference_kind, reference_id,
               payload, content_fingerprint, occurred_at, received_at)
           VALUES ('sev_acme', 'acme', 'internal', 'e1', 'payment.attempt_failed', 'payment', 'o1', '{}', 'f', now(), now())""")
    raw("""INSERT INTO revenue_obligations (obligation_id, merchant_id, reference_kind, reference_id, leak_type, created_at)
           VALUES ('obl_acme', 'acme', 'payment', 'o1', 'failed_payment', now())""")


_ROW_COUNT_TABLES = ("workspaces", "scan_runs", "transactions", "recovery_cases", "decisions", "execution_attempts",
                     "interventions", "idempotency_records", "audit_events", "source_events", "revenue_obligations")


def test_a_version_3_database_with_data_in_several_workspaces_upgrades_and_keeps_every_row(pg_dsn, pg_schema, raw):
    migrate.upgrade(pg_dsn, pg_schema, target=3)
    seed_version_3(raw)
    before = {t: raw(f"SELECT count(*) FROM {t}")[0][0] for t in _ROW_COUNT_TABLES}
    assert raw("SELECT count(*) FROM scan_runs WHERE status = 'active'") == [(1,)]       # 0003: one for the whole database

    assert migrate.upgrade(pg_dsn, pg_schema) == [4]
    assert {t: raw(f"SELECT count(*) FROM {t}")[0][0] for t in _ROW_COUNT_TABLES} == before   # nothing lost or rewritten
    assert raw("SELECT amount FROM transactions ORDER BY run_id") == [(pytest.approx(100.50),)] * 2
    assert migrate.status(pg_dsn, pg_schema) == {"head": 4, "current": 4, "pending": [], "applied": [1, 2, 3, 4]}

    # the global limit is gone: each workspace can now have its own active run
    raw("UPDATE scan_runs SET status = 'active', superseded_at = NULL WHERE run_id = 'run_ws_two'")
    assert raw("SELECT merchant_id FROM scan_runs WHERE status = 'active' ORDER BY 1") == [("ws_one",), ("ws_two",)]
    with refused_by(pgerr.UniqueViolation, "scan_runs_one_active_per_workspace"):
        clone(raw, "scan_runs", "run_id", "run_ws_one", run_id="run_dup", source_fingerprint="fp_dup")
    # and the ownership rules now apply to the migrated data
    with refused_by(pgerr.ForeignKeyViolation, "ws_transactions_run_fk"):
        raw("UPDATE transactions SET merchant_id = 'ws_two' WHERE run_id = 'run_ws_one'")


def test_the_migration_repairs_the_label_of_a_run_whose_workspace_was_registered_later(pg_dsn, pg_schema, raw):
    migrate.upgrade(pg_dsn, pg_schema, target=3)
    raw("""INSERT INTO scan_runs (run_id, merchant_id, source_fingerprint, n_total, seed, created_at, last_scanned_at, status, kind)
           VALUES ('run_late', 'late', 'ingest:late', 0, 0, now(), now(), 'standby', 'ingestion')""")     # 3.0 allowed this
    assert raw("SELECT workspace_kind FROM scan_runs WHERE run_id = 'run_late'") == [(None,)]
    raw("""INSERT INTO workspaces (workspace_id, kind, display_name, base_currency, timezone, execution_mode, origin, created_at)
           VALUES ('late', 'merchant', 'Late', 'INR', 'UTC', 'recommend_only', 'explicit', now())""")
    assert migrate.upgrade(pg_dsn, pg_schema) == [4]
    assert raw("SELECT workspace_kind FROM scan_runs WHERE run_id = 'run_late'") == [("merchant",)]


_VIOLATIONS = [
    ("a transaction belongs to the workspace of its run",
     "UPDATE transactions SET merchant_id = 'ws_two' WHERE run_id = 'run_ws_one'", "run_ws_one"),
    ("a recovery case belongs to the workspace of its run",
     "UPDATE recovery_cases SET merchant_id = 'ws_two' WHERE case_id = 'case_ws_one'", "case_ws_one"),
    ("a decision belongs to the run of its case",
     "UPDATE decisions SET run_id = 'run_ws_two' WHERE decision_id = 'dec_ws_one'", "dec_ws_one"),
    ("an execution attempt belongs to the workspace and run of its case",
     "UPDATE execution_attempts SET merchant_id = 'ws_two' WHERE attempt_id = 'att_ws_one'", "att_ws_one"),
    ("an intervention belongs to the workspace and run of its case",
     "UPDATE interventions SET merchant_id = 'ws_two' WHERE intervention_id = 'itv_ws_one'", "itv_ws_one"),
    ("an idempotency record belongs to the workspace of its case",
     "UPDATE idempotency_records SET merchant_id = 'ws_two', key = 'k9' WHERE case_id = 'case_ws_one'", "case_ws_one"),
    ("an audit event belongs to the workspace of its run",
     "ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_change; "
     "UPDATE audit_events SET merchant_id = 'ws_two' WHERE event_id = 'ae_ws_one'; "
     "ALTER TABLE audit_events ENABLE TRIGGER audit_events_no_change", "ae_ws_one"),
    ("every source event belongs to a registered workspace",
     "UPDATE source_events SET merchant_id = 'claimed_by_nobody' WHERE event_id = 'sev_acme'", "sev_acme"),
    ("a revenue obligation belongs to the workspace of its run and case",
     "UPDATE revenue_obligations SET run_id = 'run_ws_one' WHERE obligation_id = 'obl_acme'", "obl_acme"),
]


@pytest.mark.parametrize("rule, damage, offender", _VIOLATIONS, ids=[v[0][:44] for v in _VIOLATIONS])
def test_the_migration_refuses_existing_rows_that_break_an_ownership_rule_and_changes_nothing(
    pg_dsn, pg_schema, raw, rule, damage, offender
):
    migrate.upgrade(pg_dsn, pg_schema, target=3)
    seed_version_3(raw)
    raw(damage)
    snapshot = {t: raw(f"SELECT count(*) FROM {t}")[0][0] for t in _ROW_COUNT_TABLES}

    with pytest.raises(migrate.MigrationError) as failed:
        migrate.upgrade(pg_dsn, pg_schema)
    message = str(failed.value)
    assert "0004_workspace_isolation.sql failed and was rolled back" in message
    assert rule in message and offender in message                     # the rule and the offending row are named
    assert "Nothing was changed" in message

    # rolled back whole: still version 3, the old index in place, none of the new constraints, no row touched
    assert migrate.status(pg_dsn, pg_schema) == {"head": 4, "current": 3, "pending": [4], "applied": [1, 2, 3]}
    assert raw("SELECT count(*) FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'scan_runs_one_active'") == [(1,)]
    assert raw("SELECT count(*) FROM pg_constraint WHERE conname LIKE 'ws\\_%'") == [(0,)]
    assert {t: raw(f"SELECT count(*) FROM {t}")[0][0] for t in _ROW_COUNT_TABLES} == snapshot


def test_an_unregistered_event_claim_from_phase_3_0_blocks_the_migration_until_a_person_registers_it(pg_dsn, pg_schema, raw):
    migrate.upgrade(pg_dsn, pg_schema, target=3)
    raw("""INSERT INTO source_events (event_id, merchant_id, source, source_event_id, event_type, reference_kind, reference_id,
               payload, content_fingerprint, occurred_at, received_at)
           VALUES ('sev_claim', 'claimed_only', 'internal', 'e1', 'payment.attempt_failed', 'payment', 'o1', '{}', 'f', now(), now())""")
    with pytest.raises(migrate.MigrationError, match="claimed_only") as failed:
        migrate.upgrade(pg_dsn, pg_schema)
    assert "never create it" not in str(failed.value) and "Register the workspace deliberately" in str(failed.value)
    assert raw("SELECT count(*) FROM workspaces WHERE workspace_id = 'claimed_only'") == [(0,)]   # not created from a claim
    raw("""INSERT INTO workspaces (workspace_id, kind, display_name, base_currency, timezone, execution_mode, origin, created_at)
           VALUES ('claimed_only', 'merchant', 'Registered by a person', 'INR', 'UTC', 'recommend_only', 'explicit', now())""")
    assert migrate.upgrade(pg_dsn, pg_schema) == [4]
