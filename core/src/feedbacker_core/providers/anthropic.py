"""Anthropic adapter (ADR 0003). The only module that knows the Anthropic SDK."""

from __future__ import annotations

from pydantic import BaseModel

from feedbacker_core.models import TokenUsage
from feedbacker_core.providers import (
    Outcome,
    ProviderError,
    ProviderRequest,
    ProviderResult,
)

# USD per million tokens (input, output), from Anthropic's published first-party rates.
PRICES = {
    "claude-sonnet-5": (2.0, 10.0),
    "claude-opus-5": (5.0, 25.0),
    "claude-opus-5-5": (4.0, 20.0),
    "claude-haiku-4-5": (1.0, 5.0),
    "claude-fable-5-1": (10.0, 50.0),
}
CACHE_WRITE = 1.25  # multiplier on input price for cache writes
CACHE_READ = 0.1  # multiplier on input price for cache reads


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, api_key_loader=None, client=None):
        """The client is created on first use, so prices and estimates need no key."""
        self._client = client
        self._api_key_loader = api_key_loader

    def _get_client(self):
        if self._client is None:
            import anthropic

            key = self._api_key_loader() if self._api_key_loader else None
            self._client = anthropic.Anthropic(api_key=key)
        return self._client

    def price(self, model: str) -> tuple[float, float]:
        if model not in PRICES:
            raise ProviderError(
                f"no price is known for model '{model}', so the spend limit cannot be "
                f"enforced; known models: {', '.join(PRICES)}",
                fatal=True,
            )
        return PRICES[model]

    def cost(self, model: str, usage: TokenUsage) -> float:
        p_in, p_out = self.price(model)
        billed_in = (
            usage.input_tokens
            + CACHE_WRITE * usage.cache_write_tokens
            + CACHE_READ * usage.cache_read_tokens
        )
        return (billed_in * p_in + usage.output_tokens * p_out) / 1_000_000

    def read(self, request: ProviderRequest, output_type: type[BaseModel]) -> ProviderResult:
        import anthropic

        try:
            response = self._get_client().messages.parse(
                model=request.model,
                max_tokens=request.max_output_tokens,
                system=request.instructions,
                messages=[
                    {
                        "role": "user",
                        "content": [{"type": "text", "text": b} for b in request.blocks],
                    }
                ],
                output_format=output_type,
            )
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError):
            raise ProviderError(
                "the API key was rejected (expired, revoked, or without access); "
                "create a new key and update ~/Feedbacker/.env",
                fatal=True,
            ) from None
        except anthropic.NotFoundError:
            raise ProviderError(f"model '{request.model}' was not found", fatal=True) from None
        except anthropic.APIStatusError as err:
            raise ProviderError(
                f"the API returned an error ({type(err).__name__}, HTTP {err.status_code})"
            ) from None
        except anthropic.APIConnectionError as err:
            raise ProviderError(f"network error ({type(err).__name__})") from None

        u = response.usage
        usage = TokenUsage(
            input_tokens=u.input_tokens or 0,
            output_tokens=u.output_tokens or 0,
            cache_read_tokens=getattr(u, "cache_read_input_tokens", None) or 0,
            cache_write_tokens=getattr(u, "cache_creation_input_tokens", None) or 0,
        )
        if response.stop_reason == "refusal":
            outcome = Outcome.REFUSED
        elif response.stop_reason == "max_tokens":
            outcome = Outcome.TRUNCATED
        elif response.parsed_output is None:
            outcome = Outcome.UNPARSED
        else:
            outcome = Outcome.COMPLETE
        return ProviderResult(
            outcome=outcome,
            parsed=response.parsed_output if outcome is Outcome.COMPLETE else None,
            model_reported=getattr(response, "model", None),
            request_id=getattr(response, "_request_id", None),
            stop_reason=response.stop_reason,
            usage=usage,
            raw_json=response.to_json(),
        )
