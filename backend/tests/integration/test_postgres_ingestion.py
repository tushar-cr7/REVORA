"""
Event ingestion on PostgreSQL: the properties that need real transactions and real concurrency.
(The behavior itself is covered on both repositories in test_ingestion_flow.py.)
"""
import threading
import time

import pytest

from backend.app.domain.events import ObligationStatus
from backend.app.domain.models import AuditEventType, CaseState
from backend.app.services.detection_service import DetectionOutcome
from backend.tests.events_support import FAILED, SUCCEEDED, Pipeline
from backend.tests.integration.test_postgres_execution import run_together
from backend.tests.events_support import EVENTS_WS, ensure_event_workspace


def test_a_failure_inside_the_detection_unit_leaves_no_trace_of_the_half_finished_case(pg_repo, monkeypatch):
    pipe = Pipeline(pg_repo)
    real_log = pipe.audit.log_event

    def failing_log(**kwargs):
        if kwargs["event_type"] == AuditEventType.CASE_OPENED_FROM_EVENTS:
            raise RuntimeError("audit store unavailable")      # the LAST write of the unit
        return real_log(**kwargs)

    pipe.audit.log_event = failing_log
    result = pipe.ingest("e1")
    assert result.event.processing_status == "failed" and "audit store unavailable" in result.event.failure_reason

    # The event is kept (replayable); everything detection had already written is gone.
    assert len(pg_repo.list_source_events(workspace_id=EVENTS_WS)) == 1
    assert pg_repo.list_cases(run_id="all", workspace_id=EVENTS_WS) == [] and pg_repo.get_all_transactions(run_id="all", workspace_id=EVENTS_WS) == []
    assert pipe.obligation() is None                 # even the obligation row and the merchant's ingestion run were part of the unit
    assert pg_repo.list_runs(workspace_id=EVENTS_WS) == []

    pipe.audit.log_event = real_log
    replay = pipe.ingestion.reprocess(EVENTS_WS, result.event.event_id)
    assert replay.detection.outcome == DetectionOutcome.OPENED and replay.event.processing_status == "processed"
    assert len(pg_repo.list_cases(run_id="all", workspace_id=EVENTS_WS)) == 1
    run = pg_repo.list_runs(workspace_id=EVENTS_WS)[0]
    assert (run.transaction_count, run.total_at_risk) == (1, 2499.0)         # the run's totals follow the case


def test_many_workers_reporting_failures_for_one_object_converge_on_one_case(pg_repo, pg_connect):
    repos = [pg_repo, pg_connect(), pg_connect()]
    pipes = [Pipeline(r) for r in repos]
    attempts = 12
    results = run_together([
        (lambda p=pipes[i % 3], i=i: p.ingest(f"f{i}", FAILED, at=i, data={"failure_code": "card_declined", "attempt_number": i + 1}))
        for i in range(attempts)
    ])
    assert all(kind == "ok" for kind, _ in results), [r for k, r in results if k == "err"]
    outcomes = [r.detection.outcome for _, r in results]
    assert outcomes.count(DetectionOutcome.OPENED) == 1                       # exactly one worker opened the case
    obligation = pipes[0].obligation()
    assert obligation.event_count == attempts and obligation.failure_count == attempts
    assert len(pg_repo.list_cases(run_id="all", workspace_id=EVENTS_WS)) == 1 and len(pg_repo.list_source_events(workspace_id=EVENTS_WS)) == attempts
    tx = pg_repo.get_transaction_by_id(obligation.obligation_id, obligation.run_id, workspace_id=EVENTS_WS)
    assert tx.retries_so_far == attempts - 1                                  # the highest REPORTED attempt number, not a delivery count


def test_the_same_event_delivered_concurrently_is_stored_and_processed_once(pg_repo, pg_connect):
    pipes = [Pipeline(r) for r in (pg_repo, pg_connect(), pg_connect())]
    results = run_together([lambda p=pipes[i % 3]: p.ingest("dup", FAILED) for i in range(9)])
    assert all(kind == "ok" for kind, _ in results), [r for k, r in results if k == "err"]
    assert len([r for _, r in results if not r.duplicate]) == 1               # exactly one delivery stored the event
    # A concurrent redelivery of a still-`received` event is processed again by design (it heals a crash between
    # store and process), so WHICH delivery opens the case is a race. That exactly one does is the invariant.
    outcomes = [r.detection.outcome for _, r in results if r.detection is not None]
    assert outcomes.count(DetectionOutcome.OPENED) == 1
    assert len(pg_repo.list_source_events(workspace_id=EVENTS_WS)) == 1 and len(pg_repo.list_cases(run_id="all", workspace_id=EVENTS_WS)) == 1
    assert pipes[0].obligation().event_count == 1
    opened = [e for e in pg_repo.get_audit_log(limit=100, run_id="all", workspace_id=EVENTS_WS) if e.event_type == "CASE_OPENED_FROM_EVENTS"]
    assert len(opened) == 1


def test_a_failure_racing_its_own_settlement_never_leaves_an_open_case_for_a_settled_object(pg_repo, pg_connect):
    """
    The invariant the obligation lock exists for: once a success newer than the failure has been stored, the
    obligation ends up settled and no case is left open — whatever the interleaving.

    The interleaving is forced, not hoped for. For each object: a newer failure is evaluated and has folded the
    events it can see (a view WITHOUT the settlement); only then is the settlement released; and the failure's
    evaluation holds for a while before it writes. Without a lock the settlement is evaluated, saved and
    committed inside that window and the failure's late write then restores a stale "at risk". With the lock
    the settlement's evaluation waits for the failure's, and then sees both.
    """
    pipes = [Pipeline(r) for r in (pg_repo, pg_connect(), pg_connect())]
    refs = [f"race_{n}" for n in range(6)]
    stale_view_taken = {ref: threading.Event() for ref in refs}

    for p in pipes:
        original = p.detection._apply_projection

        def hold_on_stale_view(obligation, projection, _orig=original):
            if (projection.status == ObligationStatus.AT_RISK.value and projection.event_count == 2
                    and obligation.reference_id in stale_view_taken):
                stale_view_taken[obligation.reference_id].set()      # the settlement may now be delivered
                time.sleep(0.5)                                       # ...while this evaluation sits on its old view
            return _orig(obligation, projection)

        p.detection._apply_projection = hold_on_stale_view

    # The obligation and its case already exist (the first failure was reported earlier). That matters: the very
    # first write of an obligation is serialized by its unique key anyway; the row lock protects every later event
    # about an object that already has a row.
    for ref in refs:
        pipes[0].ingest(f"f0-{ref}", FAILED, at=0, ref=ref)

    jobs = []
    for n, ref in enumerate(refs):
        jobs.append(lambda p=pipes[n % 3], ref=ref: p.ingest(f"f1-{ref}", FAILED, at=5, ref=ref))        # a newer failure

        def settle(p=pipes[(n + 1) % 3], ref=ref):
            assert stale_view_taken[ref].wait(timeout=20), "the failure never took its view"
            return p.ingest(f"s-{ref}", SUCCEEDED, at=10, ref=ref)                                        # then the settlement

        jobs.append(settle)
    results = run_together(jobs)
    assert all(kind == "ok" for kind, _ in results), [r for k, r in results if k == "err"]

    for ref in refs:
        obligation = pipes[0].obligation(ref=ref)
        assert obligation.status == ObligationStatus.SETTLED.value, (ref, obligation.status, obligation.event_count)
        assert obligation.event_count == 3 and obligation.failure_count == 2
        case = pg_repo.get_case(obligation.case_id, workspace_id=EVENTS_WS)
        assert case.state == CaseState.RESOLVED_AT_SOURCE, (ref, case.state)
    assert [c for c in pg_repo.list_cases(run_id="all", workspace_id=EVENTS_WS) if c.state != CaseState.RESOLVED_AT_SOURCE] == []
    # (nothing is left chasing a customer who has paid)


def test_event_derived_state_survives_a_restart_and_replays_identically(pg_repo, pg_connect):
    pipe = Pipeline(pg_repo)
    pipe.ingest("f1", FAILED, at=0)
    pipe.ingest("f2", FAILED, at=30, data={"failure_code": "insufficient_funds", "attempt_number": 2})
    before = (pipe.obligation().to_dict(), pipe.case_of().to_dict(), [e.to_dict() for e in pg_repo.list_source_events(workspace_id=EVENTS_WS)])

    restarted = Pipeline(pg_connect())
    assert (restarted.obligation().to_dict(), restarted.case_of().to_dict(),
            [e.to_dict() for e in restarted.repo.list_source_events(workspace_id=EVENTS_WS)]) == before
    assert restarted.ingest("f1", FAILED, at=0).duplicate                    # the redelivery after the restart is recognized
    assert restarted.ingest("s", SUCCEEDED, at=60).detection.outcome == DetectionOutcome.RESOLVED
    assert restarted.case_of().state == CaseState.RESOLVED_AT_SOURCE

    # Replaying every stored event from scratch yields the same final obligation (reconciliation).
    for event in restarted.repo.list_source_events(limit=100, workspace_id=EVENTS_WS):
        restarted.ingestion.reprocess(EVENTS_WS, event.event_id)
    assert restarted.obligation().status == "settled" and restarted.obligation().event_count == 3
    assert len(restarted.repo.list_cases(run_id="all", workspace_id=EVENTS_WS)) == 1


def test_the_ingestion_run_is_per_merchant_and_never_activatable(pg_repo):
    pipe = Pipeline(pg_repo)
    pipe.ingest("e1", merchant="merch_a")
    pipe.ingest("e1", merchant="merch_b")
    runs = [r for ws in ("merch_a", "merch_b") for r in pg_repo.list_runs(workspace_id=ws) if r.kind == "ingestion"]
    assert {r.merchant_id for r in runs} == {"merch_a", "merch_b"} and all(r.status == "standby" for r in runs)
    for run in runs:
        with pytest.raises(ValueError, match="cannot be activated"):
            pg_repo.activate_run(run.run_id, workspace_id=run.merchant_id)
        with pytest.raises(KeyError):                         # another workspace's run is simply unknown
            pg_repo.activate_run(run.run_id, workspace_id="merch_b" if run.merchant_id == "merch_a" else "merch_a")
    assert pg_repo.get_active_run(workspace_id="merch_a") is None and pg_repo.get_active_run(workspace_id="merch_b") is None
    # Scan-only operations refuse an ingestion run, and event-derived writes refuse a scan run.
    from backend.tests.support import build_service, make_tx

    service = build_service([make_tx(1)], repo=pg_repo, seed=3)
    scan_run = pg_repo.get_active_run(workspace_id="merch_test")
    with pytest.raises(ValueError, match="only an ingestion run"):
        pg_repo.create_case(service.repo.get_case_for_transaction("tx_fp_000001", workspace_id="merch_test"),
                            service.repo.get_transaction_by_id("tx_fp_000001", workspace_id="merch_test"))
    assert scan_run.kind == "synthetic_scan"


def test_bursts_of_first_events_for_brand_new_objects_never_deadlock(pg_repo, pg_connect):
    """
    The regression for a real defect: simultaneous first events about a NEW object all insert its obligation row,
    which has two unique indexes, and PostgreSQL deadlocked the speculative inserts against each other (about one
    run in four with a dozen workers). The shape that failed is reproduced: many workers, ALL of them reporting the
    first event of one brand-new object at the same instant, over many fresh objects, one object at a time so that
    connection-pool queueing cannot serialize them.
    """
    pipes = [Pipeline(r) for r in (pg_repo, pg_connect(), pg_connect())]
    workers_per_object, objects = 24, 20
    for n in range(objects):
        ref = f"burst_{n}"
        results = run_together([
            (lambda p=pipes[k % 3], ref=ref, k=k: p.ingest(
                f"e-{ref}-{k}", FAILED, at=k, ref=ref, data={"failure_code": "card_declined", "attempt_number": k + 1}))
            for k in range(workers_per_object)
        ], timeout=120)
        errors = [r for kind, r in results if kind == "err"]
        assert errors == [], (ref, errors[:2])
        assert pipes[0].obligation(ref=ref).event_count == workers_per_object
    assert len(pg_repo.list_cases(run_id="all", workspace_id=EVENTS_WS)) == objects                         # one case per object, no more


def test_the_first_event_about_an_object_waits_on_that_objects_advisory_lock_before_inserting(pg_dsn, pg_repo, pg_connect):
    """
    The deterministic form of the burst-deadlock guarantee.

    The deadlock itself needs two sessions to interleave INSIDE one INSERT (both speculative inserts into the
    obligation's two unique indexes), which cannot be forced from outside the server and which the burst test
    above reproduces only by luck (it passed 6/6 with the fix reverted on PostgreSQL 18.6). What the fix
    guarantees, and what makes that interleaving impossible, is checkable exactly: `lock_obligation` takes the
    object's advisory lock FIRST, so at most one session is ever inside the insert for one object.

    So: another session holds that object's lock; a worker's first event about the object must then sit waiting
    on that lock (visible in pg_locks) and must not get past it; when the holder releases, it proceeds and gets
    the one row. Without the advisory lock the worker never waits — it inserts straight away — and this fails.
    """
    import psycopg2

    from backend.app.domain.events import obligation_internal_id

    merchant, kind, ref = "merch_a", "payment", "ord_locked"
    ensure_event_workspace(pg_repo, merchant)                  # the workspace this object belongs to is registered
    obligation_id = obligation_internal_id(merchant, kind, ref)
    holder = psycopg2.connect(pg_dsn)                      # a separate session: it never uses the repository
    watcher = psycopg2.connect(pg_dsn)
    watcher.autocommit = True
    worker_repo = pg_connect()
    outcome = {}

    def first_event():
        try:
            with worker_repo.atomic():
                outcome["obligation"] = worker_repo.lock_obligation(
                    merchant, kind, ref, "failed_payment", "2026-10-01T00:00:00+00:00")
        except Exception as exc:  # noqa: BLE001 - reported below
            outcome["error"] = exc

    def waiting_on_an_advisory_lock() -> int:
        with watcher.cursor() as cur:
            cur.execute(
                "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a USING (pid) "
                "WHERE l.locktype = 'advisory' AND NOT l.granted AND a.datname = current_database()")
            return cur.fetchone()[0]

    try:
        with holder.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"revora:obligation:{obligation_id}",))
        worker = threading.Thread(target=first_event)
        worker.start()
        deadline = time.monotonic() + 15
        while worker.is_alive() and not waiting_on_an_advisory_lock() and time.monotonic() < deadline:
            time.sleep(0.05)
        assert worker.is_alive() and waiting_on_an_advisory_lock() == 1, (
            "the worker did not wait on the object's advisory lock: lock_obligation no longer serializes the "
            f"first writers of one object before they insert ({outcome})")
        assert not outcome                                    # still blocked: nothing returned, nothing failed
    finally:
        holder.commit()                                       # release (also on failure, so nothing hangs)
        holder.close()
    worker.join(timeout=30)
    watcher.close()
    assert not worker.is_alive() and "error" not in outcome, outcome
    assert outcome["obligation"].obligation_id == obligation_id and outcome["obligation"].event_count == 0


def test_a_transient_abort_during_detection_is_retried_whole_and_opens_one_case(pg_repo):
    from backend.app.repositories.errors import TransientStorageError

    pipe = Pipeline(pg_repo)
    real_log, failures = pipe.audit.log_event, []

    def flaky_log(**kwargs):
        if kwargs["event_type"] == AuditEventType.CASE_OPENED_FROM_EVENTS and not failures:
            failures.append(1)
            raise TransientStorageError("simulated deadlock after the case was written")
        return real_log(**kwargs)

    pipe.audit.log_event = flaky_log
    result = pipe.ingest("e1")
    assert failures == [1] and result.event.processing_status == "processed"
    assert result.detection.outcome == DetectionOutcome.OPENED
    assert len(pg_repo.list_cases(run_id="all", workspace_id=EVENTS_WS)) == 1 and len(pg_repo.get_all_transactions(run_id="all", workspace_id=EVENTS_WS)) == 1
    opened = [e for e in pg_repo.get_audit_log(limit=100, run_id="all", workspace_id=EVENTS_WS) if e.event_type == "CASE_OPENED_FROM_EVENTS"]
    assert len(opened) == 1                                                  # the aborted try left no extra row behind
