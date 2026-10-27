from abc import ABC, abstractmethod
from typing import Dict, Any, Optional
from backend.app.domain.models import Intervention


class PaymentExecutionProvider(ABC):
    @property
    @abstractmethod
    def name(self) -> str:
        pass

    @property
    def execution_mode(self) -> str:
        """
        "simulation" when no real external action is taken, "live" for a real
        payment/communication provider. A provider must declare itself; the
        default is deliberately not "live" so an undeclared one is never
        mistaken for a real, verified integration.
        """
        return "unknown"

    @abstractmethod
    def execute(
        self,
        leak: Dict[str, Any],
        decision: Dict[str, Any],
        idempotency_key: Optional[str] = None,
    ) -> Intervention:
        pass
