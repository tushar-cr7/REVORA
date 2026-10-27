"""
The provider integration boundary.

A provider adapter turns ONE provider's webhook payload into a `NormalizedEventIn`. Everything
provider-specific (signature verification, field names, retries semantics, which of our event types
it can supply at all) lives behind this interface, so the ingestion and detection code never see a
provider payload.

No real adapter exists. Writing one needs a concrete, verified provider contract (payload schema,
signature scheme, delivery guarantees, id semantics) — see docs/DURABLE_FOUNDATION.md "Provider
adapters". `InternalAdapter` is the identity mapping used by tests and the internal endpoint.
"""
from abc import ABC, abstractmethod
from typing import Any, Dict

from backend.app.ingestion.schemas import NormalizedEventIn


class ProviderAdapter(ABC):
    #: matches `NormalizedEventIn.source`
    source: str

    @abstractmethod
    def verify(self, headers: Dict[str, str], body: bytes) -> None:
        """Authenticate the delivery (signature / shared secret). Raise on failure. Must run BEFORE normalize."""

    @abstractmethod
    def normalize(self, payload: Dict[str, Any]) -> NormalizedEventIn:
        """Map the provider payload to the normalized contract; keep the original under `raw`."""


class InternalAdapter(ProviderAdapter):
    """Identity mapping for events that are already normalized. It authenticates nothing."""

    source = "internal"

    def verify(self, headers: Dict[str, str], body: bytes) -> None:  # noqa: D401 - intentionally a no-op
        return None

    def normalize(self, payload: Dict[str, Any]) -> NormalizedEventIn:
        return NormalizedEventIn.model_validate(payload)


ADAPTERS: Dict[str, ProviderAdapter] = {InternalAdapter.source: InternalAdapter()}
