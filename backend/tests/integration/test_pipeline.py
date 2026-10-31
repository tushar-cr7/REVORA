import pytest
from backend.app.repositories.in_memory import InMemoryRepository
from backend.app.services.audit_service import AuditService
from backend.app.services.recovery_service import RecoveryService
from backend.tests.support import TEST_WS
from backend.app.domain.workspaces import DEMO_WORKSPACE_ID


def test_full_recovery_pipeline_integration():
    repo = InMemoryRepository()
    audit_service = AuditService(repo=repo)
    service = RecoveryService(repo=repo, audit_service=audit_service)

    # 1. Scan
    scan_res = service.scan_revenue(n_total=100, seed=42)
    assert scan_res["total_transactions_scanned"] == 100
    assert scan_res["total_at_risk"] > 0

    # 2. Analyze
    analyze_res = service.analyze_revenue(DEMO_WORKSPACE_ID)
    assert analyze_res["total_at_risk"] == scan_res["total_at_risk"]
    assert analyze_res["realistically_recoverable"] <= analyze_res["total_at_risk"]

    # 3. Get Opportunities
    opps = service.get_opportunities(DEMO_WORKSPACE_ID, limit=10)
    assert len(opps) > 0
    first_opp = opps[0]

    # 4. Individual Intervention Execution with Idempotency
    itv = service.execute_individual_intervention(
        DEMO_WORKSPACE_ID, target_id=first_opp["transaction_id"],
        idempotency_key="pipe_test_key_001"
    )
    assert itv["transaction_id"] == first_opp["transaction_id"]
    assert itv["idempotency_key"] == "pipe_test_key_001"

    # Idempotent re-execution
    itv_repeat = service.execute_individual_intervention(
        DEMO_WORKSPACE_ID, target_id=first_opp["transaction_id"],
        idempotency_key="pipe_test_key_001"
    )
    assert itv_repeat["intervention_id"] == itv["intervention_id"]

    # 5. Batch Recover
    recover_res = service.recover_revenue(DEMO_WORKSPACE_ID)
    assert recover_res["total_recovered"] <= recover_res["total_at_risk"]
    assert recover_res["policy_violations"] == 0

    # 6. Audit Trail Verification
    audit_log = audit_service.get_audit_log(limit=200, workspace_id=DEMO_WORKSPACE_ID)
    assert len(audit_log) > 0
