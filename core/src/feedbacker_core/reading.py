"""The AI reading: an evidence-cited second reading per criterion (#18, ADR 0003).

Maintainer decisions (2026-09-25, recorded on #18):

- default model Claude Sonnet 5, configurable per run;
- a per-run spend limit of $5, with an estimate the moderator confirms first;
- if the model declines on safety grounds, the same approved request is sent
  once to a fallback model (Claude Opus 5) and both calls are recorded;
- the API key comes from ``ANTHROPIC_API_KEY`` or ``~/Feedbacker/.env`` and is
  never logged, exported, or recorded.

Only approved anonymised text is ever sent, obtained through ``boundary.py``
and re-checked immediately before each call. The model never sees the original
marker's marks or comments. Its output is stored as ``AISuggestion`` records:
suggestions, never marks. Every quote is checked against the approved text and
flagged if it is not found verbatim.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel, ConfigDict

from feedbacker_core.boundary import (
    UnapprovedText,
    approved_brief_text,
    approved_text,
    require_approved,
    require_approved_brief,
)
from feedbacker_core.brief import BRIEF
from feedbacker_core.marking import load_rubric
from feedbacker_core.models import (
    Actor,
    ActorKind,
    AISuggestion,
    Approval,
    EvidenceQuote,
    ModelCall,
    ProducedBy,
    Provenance,
    Rubric,
    TokenUsage,
    Transformation,
)
from feedbacker_core.request import load_request
from feedbacker_core.workspace import Workspace, WorkspaceError

PROMPT_VERSION = "reading-v1"
PROMPT_TEXT = (Path(__file__).parent / "prompts" / f"{PROMPT_VERSION}.md").read_text()
PROVIDER = "anthropic"
DEFAULT_MODEL = "claude-sonnet-5"
FALLBACK_MODEL = "claude-opus-5"
DEFAULT_CAP_USD = 5.0
MAX_TOKENS = 16000
# Conservative estimates: about 3 characters per token for input, and an upper
# bound for output including the model's reasoning.
CHARS_PER_TOKEN = 3.0
OUTPUT_TOKENS_ESTIMATE = 8000
# USD per million tokens (input, output), from Anthropic's published first-party rates.
PRICES = {
    "claude-sonnet-5": (2.0, 10.0),
    "claude-opus-5": (5.0, 25.0),
    "claude-opus-5-5": (4.0, 20.0),
    "claude-haiku-4-5": (1.0, 5.0),
    "claude-fable-5-1": (10.0, 50.0),
}
READINGS = "readings"
ENV_FILE = Path.home() / "Feedbacker" / ".env"


class ReadingError(Exception):
    """A reading run cannot start or must stop. Messages never contain the API key."""


# --- Structured output ----------------------------------------------------------


class CriterionReadingOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    criterion_id: str
    suggested_level_id: str | None
    rationale: str
    evidence: list[str]
    draft_comment: str
    missing_evidence: bool


class ReadingOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    criteria: list[CriterionReadingOut]


# --- Credentials ------------------------------------------------------------------


def load_api_key(env_file: Path | None = None) -> str:
    """ANTHROPIC_API_KEY from the environment, else from the private .env file."""
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if key:
        return key
    path = env_file or Path(os.environ.get("FEEDBACKER_ENV", ENV_FILE))
    if path.is_file():
        if path.stat().st_mode & 0o077:
            raise ReadingError(f"{path} is readable by other users; run: chmod 600 {path}")
        for line in path.read_text().splitlines():
            name, sep, value = line.strip().partition("=")
            if sep and name.strip() == "ANTHROPIC_API_KEY" and value.strip():
                return value.strip().strip("'\"")
    raise ReadingError("no Anthropic API key: set ANTHROPIC_API_KEY or put it in ~/Feedbacker/.env")


def make_client():
    import anthropic

    return anthropic.Anthropic(api_key=load_api_key())


# --- Requests ------------------------------------------------------------------------


def render_rubric(rubric: Rubric) -> str:
    """A stable, readable rendering of the source rubric (identical for every call)."""
    lines = [f"Rubric: {rubric.title} (version {rubric.version})"]
    for c in rubric.criteria:
        weight = f", weight {c.weight:g}%" if c.weight else ""
        lines.append(f"\nCriterion id: {c.id}\nTitle: {c.title}{weight}")
        if c.description:
            lines.append(f"Description: {c.description}")
        for lv in c.levels:
            points = f", {lv.points:g} points" if lv.points is not None else ""
            lines.append(f"- Level id: {lv.id} | {lv.label}{points}: {lv.descriptor}")
    return "\n".join(lines)


def build_request(rubric: Rubric, brief: str | None, pseudonym: str, text: str, model: str) -> dict:
    """The complete request. Stable content first (instructions, rubric, brief),
    so it can be cached (#25); the submission last."""
    content = [
        {"type": "text", "text": "RUBRIC\n\n" + render_rubric(rubric)},
        {
            "type": "text",
            "text": "ASSESSMENT BRIEF\n\n" + (brief if brief else "(No brief was provided.)"),
        },
        {"type": "text", "text": f"SUBMISSION {pseudonym}\n\n{text}"},
    ]
    return {
        "model": model,
        "max_tokens": MAX_TOKENS,
        "system": PROMPT_TEXT,
        "messages": [{"role": "user", "content": content}],
    }


def request_hash(request: dict) -> str:
    material = {**request, "output_schema": ReadingOut.model_json_schema()}
    return hashlib.sha256(json.dumps(material, sort_keys=True).encode()).hexdigest()


def price_for(model: str) -> tuple[float, float]:
    if model not in PRICES:
        raise ReadingError(
            f"no price is known for model '{model}', so the spend limit cannot be enforced; "
            f"known models: {', '.join(PRICES)}"
        )
    return PRICES[model]


def estimate_cost(request: dict) -> tuple[int, int, float]:
    chars = len(request["system"]) + sum(
        len(block["text"]) for m in request["messages"] for block in m["content"]
    )
    tokens_in = math.ceil(chars / CHARS_PER_TOKEN)
    tokens_out = OUTPUT_TOKENS_ESTIMATE
    p_in, p_out = price_for(request["model"])
    return tokens_in, tokens_out, (tokens_in * p_in + tokens_out * p_out) / 1_000_000


def actual_cost(model: str, usage: TokenUsage) -> float:
    p_in, p_out = price_for(model)
    billed_in = usage.input_tokens + 1.25 * usage.cache_write_tokens + 0.1 * usage.cache_read_tokens
    return (billed_in * p_in + usage.output_tokens * p_out) / 1_000_000


# --- Planning -------------------------------------------------------------------------


@dataclass
class PlannedReading:
    submission_id: str
    pseudonym: str
    text: str
    approval: Approval
    request: dict
    tokens_in: int
    tokens_out: int
    cost: float


@dataclass
class Plan:
    model: str
    cap_usd: float
    fallback_model: str | None
    brief_approval: Approval | None
    readings: list[PlannedReading] = field(default_factory=list)
    skipped: dict[str, str] = field(default_factory=dict)

    @property
    def estimated_cost(self) -> float:
        return sum(r.cost for r in self.readings)


def reading_path(submission_id: str) -> str:
    return f"{READINGS}/{submission_id}.json"


def plan_readings(
    workspace: Workspace,
    submission_ids: list[str] | None = None,
    *,
    model: str = DEFAULT_MODEL,
    cap_usd: float = DEFAULT_CAP_USD,
    fallback: bool = True,
    replace: bool = False,
) -> Plan:
    """Everything that would be sent, with an estimate. Sends nothing."""
    if cap_usd <= 0:
        raise ReadingError("the spend limit must be greater than 0")
    price_for(model)
    if fallback:
        price_for(FALLBACK_MODEL)
    rubric = load_rubric(workspace)
    brief_text, brief_approval = None, None
    if workspace.exists(BRIEF):
        try:
            brief_text, brief_approval = approved_brief_text(workspace)
        except UnapprovedText as err:
            raise ReadingError(
                f"{err}; approve it ('anonymise approve WORKSPACE brief') before reading"
            ) from None
    sample = load_request(workspace).sample
    wanted = submission_ids or [s.submission_id for s in sample]
    known = {s.submission_id: s for s in sample}
    plan = Plan(
        model=model,
        cap_usd=cap_usd,
        fallback_model=FALLBACK_MODEL if fallback else None,
        brief_approval=brief_approval,
    )
    for sub_id in wanted:
        if sub_id not in known:
            plan.skipped[sub_id] = "not in the sample"
            continue
        if workspace.exists(reading_path(sub_id)) and not replace:
            plan.skipped[sub_id] = "already read; use replace to read again"
            continue
        try:
            text, approval = approved_text(workspace, sub_id)
        except (UnapprovedText, WorkspaceError) as err:
            plan.skipped[sub_id] = str(err)
            continue
        request = build_request(rubric, brief_text, known[sub_id].pseudonym, text, model)
        tokens_in, tokens_out, cost = estimate_cost(request)
        plan.readings.append(
            PlannedReading(
                sub_id,
                known[sub_id].pseudonym,
                text,
                approval,
                request,
                tokens_in,
                tokens_out,
                cost,
            )
        )
    return plan


# --- Running ---------------------------------------------------------------------------


@dataclass
class RunResult:
    read: dict[str, list[AISuggestion]] = field(default_factory=dict)
    failed: dict[str, str] = field(default_factory=dict)
    not_run: dict[str, str] = field(default_factory=dict)
    warnings: dict[str, list[str]] = field(default_factory=dict)
    fallbacks: list[str] = field(default_factory=list)
    spent_usd: float = 0.0


def _usage(response) -> TokenUsage:
    u = response.usage
    return TokenUsage(
        input_tokens=u.input_tokens or 0,
        output_tokens=u.output_tokens or 0,
        cache_read_tokens=getattr(u, "cache_read_input_tokens", None) or 0,
        cache_write_tokens=getattr(u, "cache_creation_input_tokens", None) or 0,
    )


def _send(client, workspace: Workspace, planned: PlannedReading, plan: Plan, model: str):
    """The gate, re-checked immediately before sending, then one API call."""
    require_approved(workspace, planned.submission_id, planned.text)
    if plan.brief_approval is not None:
        brief_text, _ = approved_brief_text(workspace)
        require_approved_brief(workspace, brief_text)
    request = {**planned.request, "model": model}
    return request, client.messages.parse(**request, output_format=ReadingOut)


def run_readings(
    workspace: Workspace,
    plan: Plan,
    *,
    client=None,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> RunResult:
    import anthropic

    client = client or make_client()
    rubric = load_rubric(workspace)
    result = RunResult()
    log: list[dict] = []
    started = now()
    for i, planned in enumerate(plan.readings):
        remaining = plan.cap_usd - result.spent_usd
        if planned.cost > remaining:
            for later in plan.readings[i:]:
                result.not_run[later.submission_id] = (
                    f"the ${plan.cap_usd:g} spend limit would be exceeded "
                    f"(${result.spent_usd:.2f} spent)"
                )
            break
        model = plan.model
        fallback_from = None
        try:
            request, response = _send(client, workspace, planned, plan, model)
            cost = actual_cost(model, _usage(response))
            result.spent_usd += cost
            log.append(_log_entry(planned.submission_id, model, response, cost))
            if response.stop_reason == "refusal" and plan.fallback_model:
                _, _, fallback_cost = estimate_cost(
                    {**planned.request, "model": plan.fallback_model}
                )
                if result.spent_usd + fallback_cost > plan.cap_usd:
                    result.failed[planned.submission_id] = (
                        f"{model} declined, and the fallback would exceed the spend limit"
                    )
                    continue
                fallback_from, model = model, plan.fallback_model
                result.fallbacks.append(planned.submission_id)
                request, response = _send(client, workspace, planned, plan, model)
                cost = actual_cost(model, _usage(response))
                result.spent_usd += cost
                log.append(_log_entry(planned.submission_id, model, response, cost))
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError):
            _write_log(workspace, started, plan, result, log)
            raise ReadingError(
                "the API key was rejected (expired, revoked, or without access); "
                "create a new key and update ~/Feedbacker/.env"
            ) from None
        except anthropic.NotFoundError:
            _write_log(workspace, started, plan, result, log)
            raise ReadingError(f"model '{model}' was not found") from None
        except (UnapprovedText, WorkspaceError) as err:
            result.failed[planned.submission_id] = str(err)
            continue
        except anthropic.APIStatusError as err:
            result.failed[planned.submission_id] = (
                f"the API returned an error ({type(err).__name__}, HTTP {err.status_code})"
            )
            continue
        except anthropic.APIConnectionError as err:
            result.failed[planned.submission_id] = f"network error ({type(err).__name__})"
            continue

        if response.stop_reason == "refusal":
            result.failed[planned.submission_id] = f"{model} declined to read this submission"
            continue
        if response.stop_reason == "max_tokens" or response.parsed_output is None:
            result.failed[planned.submission_id] = (
                f"the reading was incomplete (stop reason: {response.stop_reason})"
            )
            continue
        suggestions, warnings = _to_suggestions(
            response, request, planned, plan, rubric, model, fallback_from, now()
        )
        _store(workspace, planned.submission_id, suggestions, response, now())
        result.read[planned.submission_id] = suggestions
        if warnings:
            result.warnings[planned.submission_id] = warnings
    _write_log(workspace, started, plan, result, log)
    return result


def _to_suggestions(response, request, planned, plan, rubric, model, fallback_from, when):
    out: ReadingOut = response.parsed_output
    warnings: list[str] = []
    call = ModelCall(
        provider=PROVIDER,
        model_requested=model,
        model_reported=getattr(response, "model", None),
        request_id=getattr(response, "_request_id", None),
        prompt_version=PROMPT_VERSION,
        rubric_version=rubric.version,
        approval_id=planned.approval.id,
        approved_text_sha256=planned.approval.approved_text_sha256,
        brief_approval_id=plan.brief_approval.id if plan.brief_approval else None,
        brief_sha256=plan.brief_approval.approved_text_sha256 if plan.brief_approval else None,
        fallback_from=fallback_from,
        request_sha256=request_hash(request),
        response_sha256=hashlib.sha256(response.to_json().encode()).hexdigest(),
        stop_reason=response.stop_reason,
        usage=_usage(response),
        produced_by=ProducedBy.LIVE,
        timestamp=when,
    )
    by_id = {r.criterion_id: r for r in out.criteria}
    unknown = [cid for cid in by_id if rubric.criterion(cid) is None]
    if unknown:
        warnings.append(f"ignored readings for unknown criteria: {', '.join(unknown)}")
    suggestions: list[AISuggestion] = []
    for n, criterion in enumerate(rubric.criteria, 1):
        r = by_id.get(criterion.id)
        if r is None:
            warnings.append(f"no reading returned for criterion '{criterion.id}'")
            continue
        level = r.suggested_level_id
        if level is not None and level not in criterion.level_ids():
            warnings.append(
                f"criterion '{criterion.id}': suggested level '{level}' is not a level of "
                "this criterion, so no level is suggested"
            )
            level = None
        evidence = []
        for quote in r.evidence:
            if not quote.strip():
                continue
            start = planned.text.find(quote)
            evidence.append(
                EvidenceQuote(
                    text=quote,
                    verified=start >= 0,
                    start=start if start >= 0 else None,
                    end=start + len(quote) if start >= 0 else None,
                )
            )
        unverified = sum(1 for e in evidence if not e.verified)
        if unverified:
            warnings.append(
                f"criterion '{criterion.id}': {unverified} quote(s) not found verbatim in the "
                "submission (kept, flagged as unverified)"
            )
        suggestions.append(
            AISuggestion(
                id=f"ai-{planned.submission_id}-{n:02d}",
                submission_id=planned.submission_id,
                criterion_id=criterion.id,
                suggested_level_id=level,
                rationale=r.rationale,
                evidence=evidence,
                draft_comment=r.draft_comment or None,
                missing_evidence=r.missing_evidence or level is None,
                call=call,
                provenance=Provenance(
                    source=f"model call {call.request_id or call.request_sha256[:16]}",
                    transformation=Transformation.GENERATED,
                    actor=Actor(kind=ActorKind.MODEL, label=call.model_reported or model),
                    timestamp=when,
                    input_hashes=sorted(
                        {planned.approval.approved_text_sha256, call.request_sha256}
                        | ({call.brief_sha256} if call.brief_sha256 else set())
                    ),
                ),
            )
        )
    return suggestions, warnings


def _store(workspace, submission_id, suggestions, response, when) -> None:
    stamp = when.strftime("%Y%m%dT%H%M%S%f")
    path = reading_path(submission_id)
    if workspace.exists(path):
        workspace.write_json(
            f"{READINGS}/history/{submission_id}--{stamp}.json",
            workspace.read_json(path),
            private=True,
        )
    workspace.write_json(
        f"{READINGS}/raw/{submission_id}--{stamp}.json",
        json.loads(response.to_json()),
        private=True,
    )
    workspace.write_json(path, [s.model_dump(mode="json") for s in suggestions], private=True)


def _log_entry(submission_id, model, response, cost) -> dict:
    return {
        "submission_id": submission_id,
        "model": model,
        "model_reported": getattr(response, "model", None),
        "request_id": getattr(response, "_request_id", None),
        "stop_reason": response.stop_reason,
        "usage": _usage(response).model_dump(),
        "cost_usd": round(cost, 6),
    }


def _write_log(workspace, started, plan, result, log) -> None:
    workspace.write_json(
        f"{READINGS}/runs/{started.strftime('%Y%m%dT%H%M%S%f')}.json",
        {
            "started": started.isoformat(),
            "model": plan.model,
            "fallback_model": plan.fallback_model,
            "cap_usd": plan.cap_usd,
            "estimated_usd": round(plan.estimated_cost, 6),
            "spent_usd": round(result.spent_usd, 6),
            "calls": log,
            "read": sorted(result.read),
            "failed": result.failed,
            "not_run": result.not_run,
            "fallbacks": result.fallbacks,
        },
        private=True,
    )


def load_readings(workspace: Workspace, submission_id: str) -> list[AISuggestion]:
    path = reading_path(submission_id)
    if not workspace.exists(path):
        raise WorkspaceError(f"no AI reading for {submission_id}")
    return [AISuggestion.model_validate(s) for s in workspace.read_json(path)]
