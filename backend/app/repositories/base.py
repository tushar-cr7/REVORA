from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional
from backend.app.domain.models import Transaction, Decision, Intervention, AuditEvent


class BaseRepository(ABC):
    @abstractmethod
    def save_transactions(self, transactions: List[Transaction]):
        pass

    @abstractmethod
    def get_transaction_by_id(self, tx_id: str) -> Optional[Transaction]:
        pass

    @abstractmethod
    def get_all_transactions(self) -> List[Transaction]:
        pass

    @abstractmethod
    def save_decision(self, decision: Decision):
        pass

    @abstractmethod
    def get_decision(self, decision_id_or_leak_id: str) -> Optional[Decision]:
        pass

    @abstractmethod
    def save_intervention(self, intervention: Intervention):
        pass

    @abstractmethod
    def get_intervention_by_id(self, intervention_id: str) -> Optional[Intervention]:
        pass

    @abstractmethod
    def get_intervention_by_idempotency_key(self, key: str) -> Optional[Intervention]:
        pass

    @abstractmethod
    def get_all_interventions(self) -> List[Intervention]:
        pass

    @abstractmethod
    def get_escalations(self) -> List[Decision]:
        pass

    @abstractmethod
    def save_audit_event(self, event: AuditEvent):
        pass

    @abstractmethod
    def get_audit_log(
        self, limit: int = 200, leak_type: Optional[str] = None, status: Optional[str] = None
    ) -> List[AuditEvent]:
        pass

    @abstractmethod
    def clear(self):
        pass
