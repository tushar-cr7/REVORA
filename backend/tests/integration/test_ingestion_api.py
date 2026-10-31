"""
The ingestion HTTP contract: status codes, typed errors, that nothing leaks (raw payloads) or executes,
and that the existing endpoints keep their shapes. Runs against the module-level application (in-memory,
explicitly, see conftest) and once more with the ingestion endpoints routed through PostgreSQL.
"""
import uuid

import pytest
from fastapi.testclient import TestClient

from backend.app.api import ingestion_routes, routes
from backend.app.main import app
from backend.tests.events_support import EVENTS_WS, INV_OVERDUE, SUCCEEDED, ensure_event_workspace, event

client = TestClient(app)


def uid(prefix="e"):
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def post(workspace_kind="merchant", **kwargs):
    """Post one event. The workspace it names is registered first, explicitly: ingestion rejects unknown workspaces."""
    body = event(kwargs.pop("source_event_id", uid()), **kwargs)
    ensure_event_workspace(routes.repo, body["claimed_merchant_id"], workspace_kind)
    return body, client.post("/api/ingest/events", json=body)


def test_a_new_event_is_accepted_stored_and_opens_a_case():
    body, resp = post(ref=uid("ord"), merchant=uid("m"))
    assert resp.status_code == 201
    out = resp.json()
    assert out["status"] == "accepted" and out["duplicate"] is False
    assert out["event"]["processing_status"] == "processed" and out["event"]["event_id"].startswith("sev_")
    assert out["event"]["merchant_assertion"] == "unauthenticated_claim"
    assert out["event"]["reference"] == body["reference"] and out["event"]["occurred_at"] == "2026-10-20T10:00:00+00:00"
    assert out["detection"]["outcome"] == "case_opened" and out["detection"]["case_id"]
    assert "raw" not in out["event"] and "raw_payload" not in out["event"]


def test_a_redelivery_is_a_200_that_changes_nothing():
    body, first = post(ref=uid("ord"), merchant=uid("m"))
    again = client.post("/api/ingest/events", json=body)
    assert first.status_code == 201 and again.status_code == 200
    assert again.json()["status"] == "duplicate" and again.json()["duplicate"] is True
    assert again.json()["event"]["event_id"] == first.json()["event"]["event_id"]
    listing = client.get("/api/ingest/events", params={"workspace_id": body["claimed_merchant_id"]}).json()
    assert listing["total"] == 1


def test_the_same_identity_with_different_content_is_a_409_and_the_original_is_kept():
    body, first = post(ref=uid("ord"), merchant=uid("m"), amount_minor=100000)
    conflicting = dict(body, amount_minor=999999)
    resp = client.post("/api/ingest/events", json=conflicting)
    assert resp.status_code == 409
    assert resp.json()["code"] == "event_identity_conflict" and resp.json()["event_id"] == first.json()["event"]["event_id"]
    assert isinstance(resp.json()["detail"], str)
    stored = client.get(
        f"/api/ingest/events/{first.json()['event']['event_id']}", params={"workspace_id": body["claimed_merchant_id"]}
    ).json()
    assert stored["amount_minor"] == 100000


@pytest.mark.parametrize(
    "mutate,field",
    [
        (lambda b: b.pop("claimed_merchant_id"), "claimed_merchant_id"),
        (lambda b: b.update(event_type="payment.exploded"), "event_type"),
        (lambda b: b.update(occurred_at="2026-10-20T10:00:00"), "occurred_at"),      # no UTC offset
        (lambda b: b.update(amount_minor=12.5), "amount_minor"),                     # money is integer minor units
        (lambda b: b.update(amount_minor=5000, currency=None), None),                # amount without currency
        (lambda b: b["reference"].update(kind="invoice"), None),                     # kind does not match the event type
        (lambda b: b["data"].update(surprise=True), "surprise"),
        (lambda b: b.update(merchant_id="m"), "merchant_id"),                        # the un-prefixed name is not accepted
    ],
)
def test_malformed_events_are_rejected_with_the_field_named(mutate, field):
    body = event(uid())
    mutate(body)
    resp = client.post("/api/ingest/events", json=body)
    assert resp.status_code == 422
    problems = resp.json()["detail"]
    assert isinstance(problems, list) and problems and all("msg" in p and "loc" in p for p in problems)
    if field:
        assert any(field in ".".join(str(x) for x in p["loc"]) for p in problems), problems


def test_a_timestamp_from_the_future_is_a_422_with_a_code():
    body = event(uid())
    body["occurred_at"] = "2099-01-01T00:00:00+00:00"
    resp = client.post("/api/ingest/events", json=body)
    assert resp.status_code == 422 and resp.json()["code"] == "occurred_at_in_future"
    assert isinstance(resp.json()["detail"], str)


def test_nothing_is_executed_and_the_dashboard_view_is_untouched():
    client.post("/api/scan", json={"n_total": 40, "seed": 913})
    client.post("/api/analyze")
    active_before = client.get("/api/runs").json()["active_run_id"]
    interventions_before = client.get("/api/interventions").json()["total"]
    analytics_before = client.get("/api/analytics").json()
    opportunities_before = client.get("/api/opportunities?limit=100").json()

    merchant = uid("m")
    out = post(ref=uid("ord"), merchant=merchant)[1].json()
    post(ref=uid("ord"), merchant=merchant, event_type=INV_OVERDUE, source_event_id=uid())

    runs = client.get("/api/runs").json()
    assert runs["active_run_id"] == active_before                                     # the active run did not change
    # The demo workspace shows ITS runs only. The event-derived runs belong to the merchant's own workspace (where
    # they are standby, never active) and are not visible from here.
    assert {r["kind"] for r in runs["runs"]} == {"synthetic_scan"}
    own = client.get("/api/runs", params={"workspace_id": merchant}).json()
    assert {r["kind"] for r in own["runs"]} == {"ingestion"} and own["active_run_id"] is None
    assert client.get("/api/interventions").json()["total"] == interventions_before
    assert client.get("/api/analytics").json() == analytics_before
    assert client.get("/api/opportunities?limit=100").json() == opportunities_before    # event cases are not dashboard opportunities

    case_id = out["detection"]["case_id"]
    # ...and cannot be executed. From the demo workspace the case is simply not found; in its own (merchant) workspace
    # the workspace gate refuses before anything else; in a DEMO-kind workspace it is in no active run.
    other = client.post(f"/api/interventions/{case_id}/execute", headers={"Idempotency-Key": uid("k")})
    assert other.status_code == 404 and other.json()["code"] == "case_not_found"
    own = client.post(f"/api/interventions/{case_id}/execute", params={"workspace_id": merchant},
                      headers={"Idempotency-Key": uid("k")})
    assert own.status_code == 409 and own.json()["code"] == "execution_not_available"
    demo_merchant = uid("d")
    demo_out = post(ref=uid("ord"), merchant=demo_merchant, workspace_kind="demo")[1].json()
    inert = client.post(f"/api/interventions/{demo_out['detection']['case_id']}/execute",
                        params={"workspace_id": demo_merchant}, headers={"Idempotency-Key": uid("k")})
    assert inert.status_code == 409 and inert.json()["code"] == "run_superseded"


def test_a_settlement_closes_the_case_through_the_api():
    merchant, ref = uid("m"), uid("ord")
    opened = post(ref=ref, merchant=merchant, at=0)[1].json()
    settled = post(ref=ref, merchant=merchant, event_type=SUCCEEDED, at=10, amount_minor=None, currency=None, customer=None)[1].json()
    assert opened["detection"]["outcome"] == "case_opened" and settled["detection"]["outcome"] == "case_resolved_at_source"
    obligations = client.get("/api/ingest/obligations", params={"workspace_id": merchant, "status": "settled"}).json()
    assert obligations["total"] == 1 and obligations["obligations"][0]["case_id"] == opened["detection"]["case_id"]
    case = client.get(f"/api/cases/{opened['detection']['case_id']}", params={"workspace_id": merchant}).json()
    assert case["state"] == "resolved_at_source"


def test_events_can_be_listed_filtered_and_fetched():
    merchant = uid("m")
    for n in range(3):
        post(ref=uid("ord"), merchant=merchant)
    post(ref=uid("chk"), merchant=merchant, event_type="checkout.started")
    everything = client.get("/api/ingest/events", params={"workspace_id": merchant}).json()
    assert everything["total"] == 4
    ignored = client.get("/api/ingest/events", params={"workspace_id": merchant, "processing_status": "ignored"}).json()
    assert ignored["total"] == 1 and ignored["events"][0]["event_type"] == "checkout.started"
    one = everything["events"][0]
    assert client.get(f"/api/ingest/events/{one['event_id']}", params={"workspace_id": merchant}).json() == one
    assert client.get("/api/ingest/events/sev_missing", params={"workspace_id": merchant}).status_code == 404
    assert client.get("/api/ingest/events", params={"processing_status": "weird"}).status_code == 422
    assert client.get("/api/ingest/events", params={"limit": 0}).status_code == 422


def test_existing_endpoint_shapes_are_unchanged_and_the_new_fields_are_additive():
    assert client.get("/api/health").json() == {"status": "ok"}
    ready = client.get("/api/health/ready").json()
    assert ready == {"status": "ok", "storage": {"backend": "memory", "durable": False}}
    client.post("/api/scan", json={"n_total": 30, "seed": 914})
    client.post("/api/analyze")
    run = client.get("/api/runs").json()["runs"][-1]
    assert {"run_id", "merchant_id", "source_fingerprint", "status", "scan_count", "kind"} <= set(run)
    opp = client.get("/api/opportunities?limit=1").json()[0]
    decision = client.get(f"/api/decisions/{opp['transaction_id']}").json()
    assert {"decision_id", "final_action", "policy_reason", "policy_version"} <= set(decision)
    assert decision["policy_limits"]["max_retries"] == 2                                # additive: the limits in force
    assert "version" not in client.get(f"/api/cases/{opp['case_id']}").json()           # storage bookkeeping never leaks


def test_the_openapi_document_describes_the_ingestion_contract():
    spec = client.get("/openapi.json").json()
    assert "/api/ingest/events" in spec["paths"] and "post" in spec["paths"]["/api/ingest/events"]
    schema = spec["components"]["schemas"]["NormalizedEventIn"]
    assert {"source", "source_event_id", "claimed_merchant_id", "event_type", "occurred_at", "reference"} <= set(schema["required"])
    assert "claimed_merchant_id" in schema["properties"] and "merchant_id" not in schema["properties"]


def test_a_database_error_is_not_echoed_to_the_client(monkeypatch):
    import psycopg2

    def explode(_event):
        raise psycopg2.OperationalError('connection to server at "10.1.2.3" failed: password authentication failed for user "revora"')

    monkeypatch.setattr(ingestion_routes.ingestion_service, "ingest", explode)
    resp = client.post("/api/ingest/events", json=event(uid()))
    assert resp.status_code == 500
    assert "10.1.2.3" not in resp.text and "revora" not in resp.text and "storage error" in resp.json()["detail"]


# ── the same endpoints, routed through PostgreSQL ────────────────────────
def test_ingestion_through_the_api_is_durable(pg_repo, pg_connect, monkeypatch):
    from backend.tests.events_support import Pipeline

    pipe = Pipeline(pg_repo)
    monkeypatch.setattr(ingestion_routes, "ingestion_service", pipe.ingestion)
    monkeypatch.setattr(ingestion_routes, "repo", pg_repo)
    monkeypatch.setattr(routes, "repo", pg_repo)                             # the workspace lookup of every request

    body = event("durable-1", ref="ord_durable", merchant="merch_pg")
    first = client.post("/api/ingest/events", json=body)
    assert first.status_code == 201 and first.json()["detection"]["outcome"] == "case_opened"
    assert client.post("/api/ingest/events", json=body).status_code == 200
    assert client.post("/api/ingest/events", json=dict(body, amount_minor=1)).status_code == 409

    reopened = Pipeline(pg_connect())                                       # a new connection pool: what a restart sees
    stored = reopened.repo.list_source_events(workspace_id="merch_pg")
    assert [e.source_event_id for e in stored] == ["durable-1"] and stored[0].amount_minor == 249900
    obligation = reopened.obligation(merchant="merch_pg", ref="ord_durable")
    assert obligation.status == "at_risk" and reopened.case_of(obligation).amount == 2499.0
    listed = client.get("/api/ingest/events", params={"workspace_id": "merch_pg"}).json()
    assert listed["total"] == 1 and listed["events"][0]["event_id"] == stored[0].event_id
