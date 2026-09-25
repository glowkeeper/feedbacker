"""Provider boundary (ADR 0003).

Everything provider-specific lives in an adapter. The reading coordinator only
sees these neutral types, so changing providers needs no changes outside the
adapter.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from pydantic import BaseModel

from feedbacker_core.models import TokenUsage


class Outcome(StrEnum):
    COMPLETE = "complete"
    REFUSED = "refused"
    TRUNCATED = "truncated"
    UNPARSED = "unparsed"


@dataclass(frozen=True)
class ProviderRequest:
    """A provider-neutral request: instructions, then ordered content blocks
    (stable blocks first, so a provider can cache them)."""

    model: str
    max_output_tokens: int
    instructions: str
    blocks: tuple[str, ...]


@dataclass
class ProviderResult:
    outcome: Outcome
    parsed: BaseModel | None
    model_reported: str | None
    request_id: str | None
    stop_reason: str | None
    usage: TokenUsage
    raw_json: str  # the provider's raw response, for the audit trail


class ProviderError(Exception):
    """A call failed. ``fatal`` errors stop the run (e.g. a rejected key)."""

    def __init__(self, message: str, fatal: bool = False):
        super().__init__(message)
        self.fatal = fatal


class Provider(Protocol):
    name: str

    def price(self, model: str) -> tuple[float, float]:
        """USD per million tokens (input, output); raises ProviderError if unknown."""

    def cost(self, model: str, usage: TokenUsage) -> float: ...

    def read(self, request: ProviderRequest, output_type: type[BaseModel]) -> ProviderResult: ...
