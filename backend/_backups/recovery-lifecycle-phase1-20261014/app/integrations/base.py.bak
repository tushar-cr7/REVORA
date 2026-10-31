from abc import ABC, abstractmethod
from typing import Dict, Any, Optional
from backend.app.domain.models import Intervention


class PaymentExecutionProvider(ABC):
    @property
    @abstractmethod
    def name(self) -> str:
        pass

    @abstractmethod
    def execute(
        self,
        leak: Dict[str, Any],
        decision: Dict[str, Any],
        idempotency_key: Optional[str] = None,
    ) -> Intervention:
        pass
