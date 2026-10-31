from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from backend.app.domain.models import AuditEvent, AuditEventType, new_id
from backend.app.domain.policy import POLICY_VERSION
from backend.app.repositories.base import BaseRepository


class AuditService:
    def __init__(self, repo: BaseRepository):
        self.repo = repo

    def log_event(
        self,
        merchant_id: str,
        transaction_id: str,
        leak_id: str,
        event_type: AuditEventType,
        action: str,
        policy_result: Dict[str, Any],
        decision_id: Optional[str] = None,
        intervention_id: Optional[str] = None,
        outcome: Optional[Dict[str, Any]] = None,
        correlation_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        run_id: Optional[str] = None,
        case_id: Optional[str] = None,
        attempt_id: Optional[str] = None,
        provider: str = "SimulationProvider",
    ) -> AuditEvent:
        # Appended, never edited: ordered and queryable. Durable when the repository is (PostgreSQL),
        # gone on restart when it is not (in-memory). Either way it is NOT tamper-evident: nothing
        # here hashes or signs the log, and a database operator can alter it.
        event = AuditEvent(
            event_id=new_id("evt", 16),
            merchant_id=merchant_id,
            transaction_id=transaction_id,
            leak_id=leak_id,
            decision_id=decision_id,
            intervention_id=intervention_id,
            timestamp=datetime.now(timezone.utc).isoformat(),
            event_type=event_type.value,
            action=action,
            policy_result=policy_result,
            policy_version=POLICY_VERSION,
            model_version="1.0.0",
            provider=provider,
            outcome=outcome,
            correlation_id=correlation_id,
            idempotency_key=idempotency_key,
            run_id=run_id,
            case_id=case_id,
            attempt_id=attempt_id,
        )
        self.repo.save_audit_event(event)
        return event

    def get_audit_log(
        self,
        limit: int = 200,
        leak_type: Optional[str] = None,
        status: Optional[str] = None,
        transaction_id: Optional[str] = None,
        newest_first: bool = False,
        run_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        events = self.repo.get_audit_log(
            limit=limit,
            leak_type=leak_type,
            status=status,
            transaction_id=transaction_id,
            newest_first=newest_first,
            run_id=run_id,
        )
        return [e.to_dict() for e in events]

    def summarize_audit_log(
        self,
        leak_type: Optional[str] = None,
        status: Optional[str] = None,
        transaction_id: Optional[str] = None,
        run_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        return self.repo.summarize_audit_log(
            leak_type=leak_type, status=status, transaction_id=transaction_id, run_id=run_id
        )
