"""
HTTP-level contract tests for the execution-safety changes: status codes, typed error
bodies, the replay header, run scoping, and compatibility with how the dashboard calls
the API (no request body, string `detail`).

The process-wide repository is shared by every test module, so each test scans with its
own seed (its own run) and swaps in a scripted provider + fixed model for determinism.
"""
import itertools
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from backend.app.api import routes
from backend.app.domain.policy import DEFAULT_POLICY
from backend.app.main import app
from backend.tests.support import FixedProbModel, ScriptedProvider

client = TestClient(app)
_seeds = itertools.count(7001)


class Api:
    def __init__(self, provider, seed):
        self.provider = provider
        self.seed = seed

    def opportunities(self, action=None, allowed=None):
        opps = client.get("/api/opportunities?limit=100").json()
        return [
            o for o in opps
            if (action is None or o["recommended_action"] == action)
            and (allowed is None or o["policy_allowed"] is allowed)
        ]

    def execute(self, target, key, body=None):
        # The dashboard sends a JSON content type, an Idempotency-Key and no body at all.
        headers = {"Content-Type": "application/json", "Idempotency-Key": key} if key else {}
        if body is None:
            return client.post(f"/api/interventions/{target}/execute", headers=headers)
        return client.post(f"/api/interventions/{target}/execute", headers=headers, json=body)


@pytest.fixture
def api(monkeypatch):
    provider = ScriptedProvider(["recovered"])
    monkeypatch.setattr(routes.recovery_service, "provider", provider)
    monkeypatch.setattr(routes.recovery_service, "model", FixedProbModel(0.9))
    seed = next(_seeds)
    assert client.post("/api/scan", json={"n_total": 50, "seed": seed}).status_code == 200
    assert client.post("/api/analyze").status_code == 200
    return Api(provider, seed)


def test_dashboard_style_request_executes_and_reports_simulation(api):
    opp = api.opportunities(action="retry", allowed=True)[0]
    resp = api.execute(opp["transaction_id"], "dash-1")
    assert resp.status_code == 200
    body = resp.json()
    assert body["transaction_id"] == opp["transaction_id"]
    assert body["status"] == "recovered" and body["recovered_amount"] == opp["amount"]
    assert body["execution_mode"] == "simulation" and body["provider"] == "ScriptedProvider"
    assert body["case_id"] and body["attempt_id"] and body["run_id"]
    assert body["idempotency_key"] == "dash-1"
    assert "idempotent-replayed" not in resp.headers


def test_replay_returns_the_original_and_flags_it(api):
    opp = api.opportunities(action="retry", allowed=True)[0]
    first = api.execute(opp["transaction_id"], "replay-1")
    before = (
        len(client.get("/api/interventions").json()["interventions"]),
        client.get("/api/audit?limit=1000").json()["matched"],
        client.get("/api/analytics").json(),
    )

    again = api.execute(opp["transaction_id"], "replay-1")
    assert again.status_code == 200 and again.json() == first.json()
    assert again.headers["idempotent-replayed"] == "true"

    after = (
        len(client.get("/api/interventions").json()["interventions"]),
        client.get("/api/audit?limit=1000").json()["matched"],
        client.get("/api/analytics").json(),
    )
    assert after == before
    assert len(api.provider.calls) == 1


def test_key_reuse_for_another_transaction_is_422_with_a_string_detail(api):
    a, b = api.opportunities(action="retry", allowed=True)[:2]
    api.execute(a["transaction_id"], "shared")
    resp = api.execute(b["transaction_id"], "shared")
    assert resp.status_code == 422
    body = resp.json()
    assert body["code"] == "idempotency_key_reuse" and isinstance(body["detail"], str)
    assert len(api.provider.calls) == 1
    assert client.get(f"/api/cases/{body['case_id']}").json()["attempt_count"] == 0


def test_executing_a_finished_case_again_is_a_409_not_a_second_recovery(api):
    opp = api.opportunities(action="retry", allowed=True)[0]
    api.execute(opp["transaction_id"], "first")
    resp = api.execute(opp["transaction_id"], "second")
    assert resp.status_code == 409
    body = resp.json()
    assert body["code"] == "case_not_executable" and body["case_state"] == "recovered"
    assert isinstance(body["detail"], str)
    analytics = client.get("/api/analytics").json()
    assert analytics["recovered_count"] == 1 and analytics["total_recovered"] == opp["amount"]


def test_policy_denial_is_a_409_that_names_the_rule_and_the_safe_alternative(api, monkeypatch):
    opp = api.opportunities(action="retry", allowed=True)[0]
    monkeypatch.setattr(routes.recovery_service, "policy", replace(DEFAULT_POLICY, max_retries=0))

    resp = api.execute(opp["transaction_id"], "denied-1")
    assert resp.status_code == 409
    body = resp.json()
    assert body["code"] == "policy_denied"
    assert body["detail"].startswith("Execution blocked by policy:") and "Retry limit exceeded" in body["detail"]
    assert body["policy"]["allowed"] is False and body["safe_alternative"] == "escalate"
    assert api.provider.calls == []

    case = client.get(f"/api/cases/{body['case_id']}").json()
    assert case["state"] == "blocked" and case["attempt_count"] == 0
    assert [a["status"] for a in case["attempts"]] == ["denied"]
    assert case["attempts"][0]["authorization"]["limits"]["max_retries"] == 0

    replay = api.execute(opp["transaction_id"], "denied-1")
    assert replay.status_code == 409 and replay.json()["attempt_id"] == body["attempt_id"]
    assert replay.headers["idempotent-replayed"] == "true"
    assert len(client.get(f"/api/cases/{body['case_id']}").json()["attempts"]) == 1


def test_expected_action_is_validated_and_guards_execution(api):
    opp = api.opportunities(action="retry", allowed=True)[0]
    tx = opp["transaction_id"]
    assert api.execute(tx, "g1", body={"expected_action": "bogus"}).status_code == 422
    mismatch = api.execute(tx, "g2", body={"expected_action": "payment_link"})
    assert mismatch.status_code == 409 and mismatch.json()["code"] == "action_mismatch"
    assert api.provider.calls == []
    ok = api.execute(tx, "g3", body={"expected_action": "retry"})
    assert ok.status_code == 200 and ok.json()["final_action"] == "retry"


def test_unknown_transaction_is_404_with_a_string_detail(api):
    resp = api.execute("tx_does_not_exist", "k")
    assert resp.status_code == 404 and isinstance(resp.json()["detail"], str)


def test_oversized_idempotency_key_is_rejected(api):
    opp = api.opportunities()[0]
    resp = api.execute(opp["transaction_id"], "k" * 300)
    assert resp.status_code == 422 and resp.json()["code"] == "idempotency_key_invalid"


def test_scan_reports_run_identity_and_reuse(api):
    first = client.post("/api/scan", json={"n_total": 50, "seed": api.seed}).json()
    assert first["reused_existing_run"] is True and first["superseded_run_id"] is None
    other = client.post("/api/scan", json={"n_total": 50, "seed": next(_seeds)}).json()
    assert other["reused_existing_run"] is False and other["superseded_run_id"] == first["run_id"]
    assert other["run_id"] != first["run_id"]

    runs = client.get("/api/runs").json()
    assert runs["active_run_id"] == other["run_id"]
    by_id = {r["run_id"]: r for r in runs["runs"]}
    assert by_id[first["run_id"]]["status"] == "superseded" and by_id[other["run_id"]]["status"] == "active"


def test_default_reads_follow_the_active_run_and_history_stays_available(api):
    run_a = client.post("/api/scan", json={"n_total": 50, "seed": api.seed}).json()["run_id"]
    opp = api.opportunities(action="retry", allowed=True)[0]
    executed = api.execute(opp["transaction_id"], "hist-1").json()
    assert executed["run_id"] == run_a

    client.post("/api/scan", json={"n_total": 50, "seed": next(_seeds)})
    assert client.get("/api/interventions").json()["total"] == 0
    assert client.get("/api/analytics").json()["total_recovered"] == 0
    assert client.get(f"/api/audit?transaction_id={opp['transaction_id']}&limit=1000").json()["matched"] == 0

    everything = client.get("/api/interventions?run_id=all&limit=1000").json()["interventions"]
    assert executed["intervention_id"] in {i["intervention_id"] for i in everything}
    history = client.get(f"/api/audit?transaction_id={opp['transaction_id']}&run_id={run_a}&limit=1000").json()
    assert history["matched"] >= 3 and all(e["run_id"] == run_a for e in history["entries"])

    # The old run's case is still readable, and is not executable from the new run.
    old = client.get(f"/api/cases/{executed['case_id']}").json()
    assert old["run_id"] == run_a and old["state"] == "recovered"
    stale = api.execute(executed["case_id"], "stale-1")
    assert stale.status_code == 409 and stale.json()["code"] == "run_superseded"


def test_bulk_recover_twice_is_safe_and_reports_honest_counts(api):
    first = client.post("/api/recover").json()
    assert first["executed_now"] > 0 and first["skipped_now"] == 0
    assert first["execution_mode"] == "simulation" and first["policy_violations"] == 0
    assert first["total_recovered"] <= first["total_at_risk"]
    n_calls = len(api.provider.calls)
    n_interventions = client.get("/api/interventions?limit=1000").json()["total"]
    assert n_interventions == first["executed_now"] == n_calls

    second = client.post("/api/recover").json()
    assert second["executed_now"] == 0 and second["skipped_now"] == first["executed_now"]
    for key in ("total_recovered", "recovered_count", "attempted_count", "actions_executed", "policy_violations"):
        assert second[key] == first[key]
    assert len(api.provider.calls) == n_calls
    assert client.get("/api/interventions?limit=1000").json()["total"] == n_interventions

    analytics = client.get("/api/analytics").json()
    assert analytics["total_recovered"] == first["total_recovered"]
    assert analytics["recovered_count"] == first["recovered_count"]
    assert analytics["attempted_amount"] >= analytics["total_recovered"]
    assert analytics["execution_mode"] == "simulation"


def test_cases_endpoints_expose_the_ledger(api):
    opp = api.opportunities(action="retry", allowed=True)[0]
    executed = api.execute(opp["transaction_id"], "led-1").json()
    listing = client.get("/api/cases?state=recovered").json()
    assert executed["case_id"] in {c["case_id"] for c in listing["cases"]}
    detail = client.get(f"/api/cases/{executed['case_id']}").json()
    assert detail["state"] == "recovered" and detail["attempts"][0]["intervention_id"] == executed["intervention_id"]
    assert [h["to"] for h in detail["history"]] == ["authorized", "executing", "recovered"]
    assert client.get("/api/cases/case_missing").status_code == 404


def test_policies_endpoint_reports_the_enforced_limits(api):
    body = client.get("/api/policies").json()
    assert body["policy_version"] == "1.0.0"
    assert body["active_policy"] == routes.recovery_service.policy.to_dict()
