import uuid
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from backend.app.domain.models import AuditEvent, AuditEventType
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
    ) -> AuditEvent:
        event = AuditEvent(
            event_id=f"evt_{uuid.uuid4().hex[:10]}",
            merchant_id=merchant_id,
            transaction_id=transaction_id,
            leak_id=leak_id,
            decision_id=decision_id,
            intervention_id=intervention_id,
            timestamp=datetime.now(timezone.utc).isoformat(),
            event_type=event_type.value,
            action=action,
            policy_result=policy_result,
            policy_version="1.0.0",
            model_version="1.0.0",
            provider="SimulationProvider",
            outcome=outcome,
            correlation_id=correlation_id,
            idempotency_key=idempotency_key,
        )
        self.repo.save_audit_event(event)
        return event

    def get_audit_log(
        self, limit: int = 200, leak_type: Optional[str] = None, status: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        events = self.repo.get_audit_log(limit=limit, leak_type=leak_type, status=status)
        return [e.to_dict() for e in events]
