import threading
from typing import Dict, Any, List, Optional
from backend.app.domain.models import Transaction, Decision, Intervention, AuditEvent
from backend.app.repositories.base import BaseRepository


class InMemoryRepository(BaseRepository):
    def __init__(self):
        self._lock = threading.Lock()
        self._transactions: Dict[str, Transaction] = {}  # keyed by transaction_id & leak_id
        self._decisions: Dict[str, Decision] = {}        # keyed by decision_id & leak_id
        self._interventions: Dict[str, Intervention] = {}  # keyed by intervention_id
        self._idempotency_map: Dict[str, Intervention] = {}  # keyed by idempotency_key
        self._audit_log: List[AuditEvent] = []
        self.scanned: bool = False
        self.analyzed: bool = False
        self.recovered: bool = False

    def save_transactions(self, transactions: List[Transaction]):
        with self._lock:
            self._transactions.clear()
            for tx in transactions:
                self._transactions[tx.transaction_id] = tx
                self._transactions[tx.leak_id] = tx
            self.scanned = True
            self.analyzed = False
            self.recovered = False

    def get_transaction_by_id(self, tx_id: str) -> Optional[Transaction]:
        with self._lock:
            return self._transactions.get(tx_id)

    def get_all_transactions(self) -> List[Transaction]:
        with self._lock:
            unique = {tx.transaction_id: tx for tx in self._transactions.values()}
            return list(unique.values())

    def save_decision(self, decision: Decision):
        with self._lock:
            self._decisions[decision.decision_id] = decision
            self._decisions[decision.leak_id] = decision
            self._decisions[decision.transaction_id] = decision

    def get_decision(self, key: str) -> Optional[Decision]:
        with self._lock:
            return self._decisions.get(key)

    def get_all_decisions(self) -> List[Decision]:
        with self._lock:
            unique = {d.decision_id: d for d in self._decisions.values()}
            return list(unique.values())

    def save_intervention(self, intervention: Intervention):
        with self._lock:
            self._interventions[intervention.intervention_id] = intervention
            if intervention.idempotency_key:
                self._idempotency_map[intervention.idempotency_key] = intervention

    def get_intervention_by_id(self, intervention_id: str) -> Optional[Intervention]:
        with self._lock:
            return self._interventions.get(intervention_id)

    def get_intervention_by_idempotency_key(self, key: str) -> Optional[Intervention]:
        with self._lock:
            return self._idempotency_map.get(key)

    def get_all_interventions(self) -> List[Intervention]:
        with self._lock:
            unique = {i.intervention_id: i for i in self._interventions.values()}
            return list(unique.values())

    def get_escalations(self) -> List[Decision]:
        with self._lock:
            unique = {d.decision_id: d for d in self._decisions.values() if d.final_action == "escalate"}
            return list(unique.values())

    def save_audit_event(self, event: AuditEvent):
        with self._lock:
            self._audit_log.append(event)

    def get_audit_log(
        self, limit: int = 200, leak_type: Optional[str] = None, status: Optional[str] = None
    ) -> List[AuditEvent]:
        with self._lock:
            res = self._audit_log
            if leak_type:
                res = [e for e in res if e.leak_id.startswith(leak_type[:2]) or e.action == leak_type]
            if status:
                res = [e for e in res if e.event_type == status or (e.outcome and e.outcome.get("status") == status)]
            return res[:limit]

    def clear(self):
        with self._lock:
            self._transactions.clear()
            self._decisions.clear()
            self._interventions.clear()
            self._idempotency_map.clear()
            self._audit_log.clear()
            self.scanned = False
            self.analyzed = False
            self.recovered = False


repo = InMemoryRepository()
