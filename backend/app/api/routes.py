from typing import Optional, List, Dict, Any
import psycopg2
from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, Response
from fastapi.responses import JSONResponse
from backend.app.api.schemas import (
    HealthResponse,
    ScanRequest,
    ScanResponse,
    AnalyzeResponse,
    RecoverResponse,
    AuditLogResponse,
    PolicySimulateRequest,
    PolicySimulateResponse,
    ForceRetryBlockResponse,
    InterventionsResponse,
    EscalationsResponse,
    AnalyticsResponse,
    ExecuteRequest,
    CopilotQueryRequest,
    CopilotQueryResponse,
)
from backend.app.api.runtime import container, server_error
from backend.app.domain.models import InvalidCaseTransition
from backend.app.domain.policy import POLICY_VERSION, PolicyLimits
from backend.app.domain.workspaces import DEMO_WORKSPACE_ID, UnknownWorkspace, WorkspaceError
from backend.app.services.execution_service import ExecutionError

router = APIRouter(prefix="/api", tags=["revenue"])

# The repository is chosen by configuration (REVORA_STORAGE), not hard-wired here.
repo = container.repo
audit_service = container.audit_service
recovery_service = container.recovery_service


def workspace_scope(
    workspace_id: str = Query(
        default=DEMO_WORKSPACE_ID,
        min_length=1,
        max_length=128,
        description=(
            "The workspace this request is about. Defaults to the demo workspace so existing clients keep working. "
            "It is a SELECTION made by the caller, not authentication: nothing proves the caller may use it "
            "(see docs/PHASE_3_CHECKPOINT.md). Every read and write is confined to this workspace; another "
            "workspace's records are reported as not found."
        ),
    ),
) -> str:
    """
    Resolves `?workspace_id=` to a REGISTERED workspace, or answers 422 `unknown_workspace`. It never creates one.
    There is no fallback to a global "active run": a workspace with no scan simply has no data.
    """
    workspace = repo.get_workspace(workspace_id)
    if workspace is None:
        raise UnknownWorkspace(
            f"Workspace {workspace_id!r} does not exist. Workspaces are never created implicitly.", workspace_id
        )
    return workspace.workspace_id


def _workspace_error_response(e: WorkspaceError) -> JSONResponse:
    return JSONResponse(status_code=e.status_code, content=e.to_body())


def _execution_error_response(e: ExecutionError) -> JSONResponse:
    """Typed error body: `detail` is always a plain string, with machine-readable `code` and context beside it."""
    headers = {"Idempotent-Replayed": "true"} if e.replayed else None
    return JSONResponse(status_code=e.status_code, content=e.to_body(), headers=headers)


@router.get("/health", response_model=HealthResponse)
def health():
    return HealthResponse(status="ok")


@router.get("/health/ready")
def health_ready():
    """
    Readiness: can the process reach its store, and is the schema the one this code expects?
    Also states plainly whether the store is durable, so a demo on in-memory state cannot be mistaken
    for a deployment that keeps its records.
    """
    try:
        storage = repo.describe()
    except Exception as e:  # noqa: BLE001 - reported as not-ready, never as a stack trace
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "detail": "The data store is not reachable or its schema is not ready.",
                     "reason": type(e).__name__},
        )
    return {"status": "ok", "storage": storage}


@router.post("/scan", response_model=ScanResponse)
def scan_revenue(req: ScanRequest = ScanRequest()):
    """
    Generate a SYNTHETIC demo dataset as a scan run. Only for a registered demo workspace:
    422 `unknown_workspace` (never auto-created), 409 `synthetic_data_not_allowed` for a merchant workspace.
    """
    try:
        res = recovery_service.scan_revenue(n_total=req.n_total, seed=req.seed, merchant_id=req.merchant_id)
        return ScanResponse(**res)
    except WorkspaceError as e:
        return JSONResponse(status_code=e.status_code, content=e.to_body())
    except psycopg2.Error as e:
        raise server_error("Scan failed", e)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/analyze", response_model=AnalyzeResponse)
def analyze_revenue(workspace_id: str = Depends(workspace_scope)):
    try:
        res = recovery_service.analyze_revenue(workspace_id)
        return AnalyzeResponse(**res)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise server_error("Analysis failed", e)


@router.get("/runs")
def get_runs(workspace_id: str = Depends(workspace_scope)):
    runs = recovery_service.get_runs(workspace_id)
    active = repo.get_active_run(workspace_id=workspace_id)
    return {"total": len(runs), "active_run_id": active.run_id if active else None, "runs": runs}


@router.get("/transactions")
def get_transactions(
    limit: int = Query(default=100, ge=1, le=1000),
    leak_type: Optional[str] = Query(default=None),
    workspace_id: str = Depends(workspace_scope),
):
    return recovery_service.get_transactions(workspace_id, limit=limit, leak_type=leak_type)


@router.get("/transactions/{id}")
def get_transaction(id: str, workspace_id: str = Depends(workspace_scope)):
    tx = recovery_service.get_transaction_by_id(workspace_id, id)
    if not tx:
        raise HTTPException(status_code=404, detail=f"Transaction/leak {id} not found.")
    return tx


@router.get("/opportunities")
def get_opportunities(limit: int = Query(default=20, ge=1, le=100), workspace_id: str = Depends(workspace_scope)):
    return recovery_service.get_opportunities(workspace_id, limit=limit)


@router.get("/decisions/{id}")
def get_decision(id: str, workspace_id: str = Depends(workspace_scope)):
    dec = recovery_service.get_decision_by_id(workspace_id, id)
    if not dec:
        raise HTTPException(status_code=404, detail=f"Decision {id} not found.")
    return dec


@router.get("/cases")
def get_cases(
    limit: int = Query(default=100, ge=1, le=1000),
    state: Optional[str] = Query(default=None),
    run_id: Optional[str] = Query(default=None, description="Defaults to the workspace's active run; 'all' for every run of it."),
    workspace_id: str = Depends(workspace_scope),
):
    cases = recovery_service.get_cases(workspace_id, limit=limit, state=state, run_id=run_id)
    return {"total": len(cases), "cases": cases}


@router.get("/cases/{case_id}")
def get_case(case_id: str, workspace_id: str = Depends(workspace_scope)):
    case = recovery_service.get_case_detail(workspace_id, case_id)
    if not case:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found.")
    return case


@router.post("/interventions/{id}/execute")
def execute_intervention(
    id: str,
    response: Response,
    body: Optional[ExecuteRequest] = Body(default=None),
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    x_idempotency_key: Optional[str] = Header(default=None, alias="X-Idempotency-Key"),
    workspace_id: str = Depends(workspace_scope),
):
    """
    Execute the recovery action authorized for a case (`id` = transaction id, leak id or case id).

    Policy is re-evaluated against current state before anything runs. Send an
    `Idempotency-Key`: the same key with the same request returns the original result
    (header `Idempotent-Replayed: true`); the same key with a different request is 422.
    409 = refused without effect (policy denial, case not executable, request in flight).

    Execution is only ever available in a `simulation` workspace (the demo workspace). For any other workspace the
    answer is 409 `execution_not_available`, before a decision is recorded, a key is stored or a provider is called.
    A case id that belongs to another workspace is 404 `case_not_found`, exactly as if it did not exist.
    """
    key = idempotency_key or x_idempotency_key
    expected = body.expected_action.value if body and body.expected_action else None
    try:
        outcome = recovery_service.execute_case(
            workspace_id, target_id=id, idempotency_key=key, expected_action=expected
        )
    except ExecutionError as e:
        return _execution_error_response(e)
    except WorkspaceError as e:  # before ValueError, which it is a subclass of
        return _workspace_error_response(e)
    except InvalidCaseTransition as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise server_error("Intervention execution failed", e)
    if outcome.replayed:
        response.headers["Idempotent-Replayed"] = "true"
    return outcome.intervention


@router.post("/recover", response_model=RecoverResponse)
def recover_revenue(workspace_id: str = Depends(workspace_scope)):
    try:
        res = recovery_service.recover_revenue(workspace_id)
        return RecoverResponse(**res)
    except WorkspaceError as e:  # e.g. 409 execution_not_available: the whole bulk request is refused up front
        return _workspace_error_response(e)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise server_error("Recovery failed", e)


@router.get("/interventions", response_model=InterventionsResponse)
def get_interventions(
    limit: int = Query(default=100, ge=1, le=1000),
    run_id: Optional[str] = Query(default=None, description="Defaults to the workspace's active run; 'all' for every run of it."),
    workspace_id: str = Depends(workspace_scope),
):
    interventions = recovery_service.get_interventions(workspace_id, limit=limit, run_id=run_id)
    return InterventionsResponse(total=len(interventions), interventions=interventions)


@router.get("/escalations", response_model=EscalationsResponse)
def get_escalations(limit: int = Query(default=50, ge=1, le=1000), workspace_id: str = Depends(workspace_scope)):
    escalations = recovery_service.get_escalations(workspace_id, limit=limit)
    return EscalationsResponse(total=len(escalations), escalations=escalations)


@router.get("/analytics", response_model=AnalyticsResponse)
def get_analytics(workspace_id: str = Depends(workspace_scope)):
    stats = recovery_service.get_analytics_summary(workspace_id)
    return AnalyticsResponse(**stats)


@router.get("/audit", response_model=AuditLogResponse)
def get_audit(
    limit: int = Query(default=200, ge=1, le=1000),
    leak_type: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    transaction_id: Optional[str] = Query(default=None),
    newest_first: bool = Query(default=False),
    run_id: Optional[str] = Query(default=None, description="Defaults to the workspace's active run; 'all' for its full history."),
    workspace_id: str = Depends(workspace_scope),
):
    entries = audit_service.get_audit_log(
        limit=limit,
        leak_type=leak_type,
        status=status,
        transaction_id=transaction_id,
        newest_first=newest_first,
        run_id=run_id,
        workspace_id=workspace_id,
    )
    summary = audit_service.summarize_audit_log(
        leak_type=leak_type, status=status, transaction_id=transaction_id, run_id=run_id, workspace_id=workspace_id
    )
    return AuditLogResponse(total=len(entries), entries=entries, **summary)


@router.get("/policies")
def get_policies():
    return {
        "active_policy": recovery_service.policy.to_dict(),
        "policy_version": POLICY_VERSION,
        "description": "Deterministic system guardrails governing autonomous revenue recovery.",
    }


@router.post("/simulate", response_model=PolicySimulateResponse)
def simulate_policy(req: PolicySimulateRequest, workspace_id: str = Depends(workspace_scope)):
    base = recovery_service.policy
    custom_policy = PolicyLimits(
        max_retries=req.max_retries if req.max_retries is not None else base.max_retries,
        min_cooldown_hours=req.min_cooldown_hours if req.min_cooldown_hours is not None else base.min_cooldown_hours,
        max_customer_contacts_per_day=req.max_customer_contacts_per_day if req.max_customer_contacts_per_day is not None else base.max_customer_contacts_per_day,
        max_auto_recovery_value=req.max_auto_recovery_value if req.max_auto_recovery_value is not None else base.max_auto_recovery_value,
        max_subscription_consecutive_failures_for_retry=req.max_subscription_consecutive_failures_for_retry if req.max_subscription_consecutive_failures_for_retry is not None else base.max_subscription_consecutive_failures_for_retry,
        invoice_escalation_age_days=req.invoice_escalation_age_days if req.invoice_escalation_age_days is not None else base.invoice_escalation_age_days,
    )
    try:
        res = recovery_service.simulate_policy(workspace_id, custom_policy)
        return PolicySimulateResponse(**res)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/demo/force-retry-block", response_model=ForceRetryBlockResponse)
def demo_force_retry_block(workspace_id: str = Depends(workspace_scope)):
    try:
        res = recovery_service.get_demo_blocked_case(workspace_id)
        return ForceRetryBlockResponse(**res)
    except ValueError as e:
        if "Call /api/scan first" in str(e):
            raise HTTPException(status_code=400, detail=str(e))
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/copilot/query", response_model=CopilotQueryResponse)
def query_copilot(req: CopilotQueryRequest, workspace_id: str = Depends(workspace_scope)):
    try:
        res = recovery_service.copilot_query(workspace_id, query=req.query, transaction_id=req.transaction_id)
        return CopilotQueryResponse(**res)
    except Exception as e:
        raise server_error("Copilot query failed", e)
