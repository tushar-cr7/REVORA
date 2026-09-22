import pytest
from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)


def test_api_health_endpoint():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_api_scan_and_analyze_workflow():
    # Scan
    scan_resp = client.post("/api/scan", json={"n_total": 50, "seed": 42})
    assert scan_resp.status_code == 200
    scan_data = scan_resp.json()
    assert scan_data["total_transactions_scanned"] == 50
    assert scan_data["total_at_risk"] > 0

    # Analyze
    analyze_resp = client.post("/api/analyze")
    assert analyze_resp.status_code == 200
    analyze_data = analyze_resp.json()
    assert "realistically_recoverable" in analyze_data
    assert "explanation" in analyze_data
    assert "model_metadata" in analyze_data


def test_api_transactions_and_opportunities():
    client.post("/api/scan", json={"n_total": 50, "seed": 42})
    client.post("/api/analyze")

    # Get transactions
    txs_resp = client.get("/api/transactions?limit=10")
    assert txs_resp.status_code == 200
    txs = txs_resp.json()
    assert len(txs) > 0
    tx_id = txs[0]["transaction_id"]

    # Get single transaction
    single_tx_resp = client.get(f"/api/transactions/{tx_id}")
    assert single_tx_resp.status_code == 200
    assert single_tx_resp.json()["transaction_id"] == tx_id

    # Get opportunities
    opps_resp = client.get("/api/opportunities?limit=5")
    assert opps_resp.status_code == 200
    assert len(opps_resp.json()) > 0


def test_api_individual_intervention_execution_and_idempotency():
    client.post("/api/scan", json={"n_total": 50, "seed": 42})
    client.post("/api/analyze")

    txs = client.get("/api/transactions?limit=1").json()
    tx_id = txs[0]["transaction_id"]

    headers = {"Idempotency-Key": "test_idemp_key_999"}

    # First execution
    exec1_resp = client.post(f"/api/interventions/{tx_id}/execute", headers=headers)
    assert exec1_resp.status_code == 200
    exec1_data = exec1_resp.json()
    assert exec1_data["idempotency_key"] == "test_idemp_key_999"
    itv_id = exec1_data["intervention_id"]

    # Second execution with SAME idempotency key
    exec2_resp = client.post(f"/api/interventions/{tx_id}/execute", headers=headers)
    assert exec2_resp.status_code == 200
    exec2_data = exec2_resp.json()
    assert exec2_data["intervention_id"] == itv_id


def test_api_demo_force_retry_block():
    client.post("/api/scan", json={"n_total": 100, "seed": 42})
    client.post("/api/analyze")

    resp = client.post("/api/demo/force-retry-block")
    assert resp.status_code == 200
    data = resp.json()
    assert data["attempted_action"] == "retry"
    assert not data["policy_allowed"]
    assert data["final_action"] in ("escalate", "suppress")


def test_api_audit_policies_and_simulate():
    client.post("/api/scan", json={"n_total": 50, "seed": 42})
    client.post("/api/analyze")

    # Get Audit
    audit_resp = client.get("/api/audit")
    assert audit_resp.status_code == 200
    assert "entries" in audit_resp.json()

    # Get Policies
    policies_resp = client.get("/api/policies")
    assert policies_resp.status_code == 200
    assert "active_policy" in policies_resp.json()

    # Simulate Policy
    sim_resp = client.post("/api/simulate", json={"max_retries": 1, "max_auto_recovery_value": 10000.0})
    assert sim_resp.status_code == 200
    assert "simulated_total_expected_value" in sim_resp.json()


def test_api_copilot_and_operational_endpoints():
    client.post("/api/scan", json={"n_total": 50, "seed": 42})
    client.post("/api/analyze")

    # Copilot query general
    c_resp = client.post("/api/copilot/query", json={"query": "Explain policy blocks"})
    assert c_resp.status_code == 200
    c_data = c_resp.json()
    assert "headline" in c_data
    assert "guardrail_status" in c_data
    assert "key_metrics" in c_data

    # Interventions endpoint
    i_resp = client.get("/api/interventions")
    assert i_resp.status_code == 200
    assert "interventions" in i_resp.json()

    # Escalations endpoint
    e_resp = client.get("/api/escalations")
    assert e_resp.status_code == 200
    assert "escalations" in e_resp.json()

    # Analytics endpoint
    a_resp = client.get("/api/analytics")
    assert a_resp.status_code == 200
    assert "recovery_rate_pct" in a_resp.json()

