"""The AI reading: an evidence-cited second reading per criterion (#18, ADR 0003).

Maintainer decisions (2026-09-25, recorded on #18):

- default model Claude Sonnet 5, configurable per run;
- a per-run spend limit of $5, with a worst-case estimate the moderator confirms;
- if the model declines on safety grounds, the same approved request is sent
  once to a fallback model (Claude Opus 5), and both calls are recorded;
- the brief is part of every request (#31) unless the moderator explicitly
  opts out;
- the API key comes from ``ANTHROPIC_API_KEY`` or ``~/Feedbacker/.env`` and is
  never logged, exported, or recorded.

Only approved anonymised text is sent. Each request is rebuilt from the current
approved material immediately before sending, and it must equal the request
the moderator confirmed; otherwise nothing is sent for that submission. The
model never sees the original marker's marks or comments. Every call, including
refused and failed ones, leaves a call record and its raw response.

This module is provider-neutral: all provider specifics live in an adapter
(``providers/``).
"""

from __future__ import annotations

import hashlib
import json
import math
import os
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
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
    Transformation,
)
from feedbacker_core.providers import (
    Outcome,
    Provider,
    ProviderError,
    ProviderRequest,
    ProviderResult,
)
from feedbacker_core.request import load_request
from feedbacker_core.workspace import Workspace, WorkspaceError

PROMPT_VERSION = "reading-v1"
PROMPT_TEXT = (Path(__file__).parent / "prompts" / f"{PROMPT_VERSION}.md").read_text()
DEFAULT_MODEL = "claude-sonnet-5"
FALLBACK_MODEL = "claude-opus-5"
DEFAULT_CAP_USD = 5.0
MAX_OUTPUT_TOKENS = 16000  # also the output bound used in every estimate
CHARS_PER_TOKEN = 3.0  # conservative: overestimates input tokens
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


# --- Credentials and provider ---------------------------------------------------------


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


def make_provider() -> Provider:
    from feedbacker_core.providers.anthropic import AnthropicProvider

    return AnthropicProvider(api_key_loader=load_api_key)


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


def build_request(
    rubric: Rubric, brief: str | None, pseudonym: str, text: str, model: str
) -> ProviderRequest:
    """Stable content first (instructions, rubric, brief), so it can be cached (#25)."""
    return ProviderRequest(
        model=model,
        max_output_tokens=MAX_OUTPUT_TOKENS,
        instructions=PROMPT_TEXT,
        blocks=(
            "RUBRIC\n\n" + render_rubric(rubric),
            "ASSESSMENT BRIEF\n\n" + (brief if brief else "(No brief was provided.)"),
            f"SUBMISSION {pseudonym}\n\n{text}",
        ),
    )


def request_hash(request: ProviderRequest, provider: str) -> str:
    material = {
        "provider": provider,
        **asdict(request),
        "output_schema": ReadingOut.model_json_schema(),
    }
    return hashlib.sha256(json.dumps(material, sort_keys=True).encode()).hexdigest()


def estimate(provider: Provider, request: ProviderRequest) -> tuple[int, int, float]:
    """Worst case for one call: input overestimated, output at its maximum."""
    chars = len(request.instructions) + sum(len(b) for b in request.blocks)
    tokens_in = math.ceil(chars / CHARS_PER_TOKEN)
    tokens_out = request.max_output_tokens
    p_in, p_out = provider.price(request.model)
    return tokens_in, tokens_out, (tokens_in * p_in + tokens_out * p_out) / 1_000_000


# --- Planning -------------------------------------------------------------------------


@dataclass
class PlannedReading:
    submission_id: str
    pseudonym: str
    request: ProviderRequest
    tokens_in: int
    tokens_out: int
    cost: float  # primary call, worst case
    fallback_cost: float  # fallback call, worst case (0 when fallback is off)


@dataclass
class Plan:
    provider: str
    model: str
    cap_usd: float
    fallback_model: str | None
    with_brief: bool
    readings: list[PlannedReading] = field(default_factory=list)
    skipped: dict[str, str] = field(default_factory=dict)

    @property
    def estimated_cost(self) -> float:
        """At most: every call at its worst case, including a fallback for each."""
        return sum(r.cost + r.fallback_cost for r in self.readings)


def reading_path(submission_id: str) -> str:
    return f"{READINGS}/{submission_id}.json"


def _current_material(
    workspace: Workspace, with_brief: bool
) -> tuple[Rubric, str | None, Approval | None]:
    rubric = load_rubric(workspace)
    if not with_brief:
        return rubric, None, None
    if not workspace.exists(BRIEF):
        raise ReadingError(
            "no brief has been imported; import and approve it ('brief import'), or run "
            "with --no-brief to read without one"
        )
    try:
        text, approval = approved_brief_text(workspace)
    except UnapprovedText as err:
        raise ReadingError(
            f"{err}; approve it ('anonymise approve WORKSPACE brief') before reading"
        ) from None
    return rubric, text, approval


def plan_readings(
    workspace: Workspace,
    submission_ids: list[str] | None = None,
    *,
    model: str = DEFAULT_MODEL,
    cap_usd: float = DEFAULT_CAP_USD,
    fallback: bool = True,
    with_brief: bool = True,
    replace: bool = False,
    provider: Provider | None = None,
) -> Plan:
    """Everything that would be sent, with a worst-case estimate. Sends nothing."""
    provider = provider or make_provider()
    if cap_usd <= 0:
        raise ReadingError("the spend limit must be greater than 0")
    try:
        provider.price(model)
        if fallback:
            provider.price(FALLBACK_MODEL)
    except ProviderError as err:
        raise ReadingError(str(err)) from None
    rubric, brief_text, _ = _current_material(workspace, with_brief)
    sample = load_request(workspace).sample
    known = {s.submission_id: s for s in sample}
    plan = Plan(
        provider=provider.name,
        model=model,
        cap_usd=cap_usd,
        fallback_model=FALLBACK_MODEL if fallback else None,
        with_brief=with_brief,
    )
    for sub_id in submission_ids or [s.submission_id for s in sample]:
        if sub_id not in known:
            plan.skipped[sub_id] = "not in the sample"
            continue
        if workspace.exists(reading_path(sub_id)) and not replace:
            plan.skipped[sub_id] = "already read; use replace to read again"
            continue
        try:
            text, _ = approved_text(workspace, sub_id)
        except (UnapprovedText, WorkspaceError) as err:
            plan.skipped[sub_id] = str(err)
            continue
        request = build_request(rubric, brief_text, known[sub_id].pseudonym, text, model)
        tokens_in, tokens_out, cost = estimate(provider, request)
        fallback_cost = (
            estimate(provider, _with_model(request, FALLBACK_MODEL))[2] if fallback else 0.0
        )
        plan.readings.append(
            PlannedReading(
                sub_id, known[sub_id].pseudonym, request, tokens_in, tokens_out, cost, fallback_cost
            )
        )
    return plan


def _with_model(request: ProviderRequest, model: str) -> ProviderRequest:
    return ProviderRequest(model, request.max_output_tokens, request.instructions, request.blocks)


# --- Running ---------------------------------------------------------------------------


@dataclass
class RunResult:
    read: dict[str, list[AISuggestion]] = field(default_factory=dict)
    failed: dict[str, str] = field(default_factory=dict)
    not_run: dict[str, str] = field(default_factory=dict)
    warnings: dict[str, list[str]] = field(default_factory=dict)
    fallbacks: list[str] = field(default_factory=list)
    spent_usd: float = 0.0


@dataclass
class _Current:
    request: ProviderRequest
    text: str
    approval: Approval
    brief_approval: Approval | None
    rubric: Rubric


def _rebuild(workspace: Workspace, planned: PlannedReading, plan: Plan, model: str) -> _Current:
    """Rebuild the request from the current approved material, pass the gate, and
    require it to equal what the moderator confirmed. Raises otherwise."""
    rubric, brief_text, brief_approval = _current_material(workspace, plan.with_brief)
    text, approval = approved_text(workspace, planned.submission_id)
    require_approved(workspace, planned.submission_id, text)
    if brief_text is not None:
        require_approved_brief(workspace, brief_text)
    request = build_request(rubric, brief_text, planned.pseudonym, text, model)
    if request != _with_model(planned.request, model):
        raise UnapprovedText(
            "the submission, brief, or rubric changed after you confirmed the estimate; "
            "nothing was sent, so run the reading again"
        )
    return _Current(request, text, approval, brief_approval, rubric)


def run_readings(
    workspace: Workspace,
    plan: Plan,
    *,
    provider: Provider | None = None,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> RunResult:
    provider = provider or make_provider()
    result = RunResult()
    log: list[dict] = []
    started = now()
    try:
        for i, planned in enumerate(plan.readings):
            if planned.cost > plan.cap_usd - result.spent_usd:
                for later in plan.readings[i:]:
                    result.not_run[later.submission_id] = (
                        f"the ${plan.cap_usd:g} spend limit would be exceeded "
                        f"(${result.spent_usd:.2f} spent)"
                    )
                break
            _read_one(workspace, planned, plan, provider, result, log, now)
    finally:
        _write_log(workspace, started, plan, result, log)
    return result


def _read_one(workspace, planned, plan, provider, result, log, now) -> None:
    sub_id = planned.submission_id
    model, fallback_from = plan.model, None
    while True:
        try:
            current = _rebuild(workspace, planned, plan, model)
            response = provider.read(current.request, ReadingOut)
        except (UnapprovedText, WorkspaceError, ReadingError) as err:
            result.failed[sub_id] = str(err)
            return
        except ProviderError as err:
            if err.fatal:
                raise ReadingError(str(err)) from None
            result.failed[sub_id] = str(err)
            return
        cost = provider.cost(model, response.usage)
        result.spent_usd += cost
        call = _call_record(provider, current, response, model, fallback_from, now())
        _record_call(workspace, sub_id, call, response, now())
        log.append(
            {
                "submission_id": sub_id,
                "model": model,
                "outcome": response.outcome.value,
                "request_id": response.request_id,
                "usage": response.usage.model_dump(),
                "cost_usd": round(cost, 6),
            }
        )
        if response.outcome is Outcome.REFUSED and plan.fallback_model and fallback_from is None:
            if planned.fallback_cost > plan.cap_usd - result.spent_usd:
                result.failed[sub_id] = (
                    f"{model} declined, and the fallback would exceed the spend limit"
                )
                return
            fallback_from, model = model, plan.fallback_model
            result.fallbacks.append(sub_id)
            continue
        break
    if response.outcome is Outcome.REFUSED:
        result.failed[sub_id] = f"{model} declined to read this submission"
        return
    if response.outcome is not Outcome.COMPLETE:
        result.failed[sub_id] = (
            f"the reading was incomplete ({response.outcome.value}, stop reason: "
            f"{response.stop_reason})"
        )
        return
    suggestions, warnings = _to_suggestions(response, current, call, planned, now())
    _store(workspace, sub_id, suggestions, now())
    result.read[sub_id] = suggestions
    if warnings:
        result.warnings[sub_id] = warnings


def _call_record(
    provider, current: _Current, response: ProviderResult, model, fallback_from, when
) -> ModelCall:
    return ModelCall(
        provider=provider.name,
        model_requested=model,
        model_reported=response.model_reported,
        request_id=response.request_id,
        prompt_version=PROMPT_VERSION,
        rubric_version=current.rubric.version,
        approval_id=current.approval.id,
        approved_text_sha256=current.approval.approved_text_sha256,
        brief_approval_id=current.brief_approval.id if current.brief_approval else None,
        brief_sha256=(
            current.brief_approval.approved_text_sha256 if current.brief_approval else None
        ),
        fallback_from=fallback_from,
        request_sha256=request_hash(current.request, provider.name),
        response_sha256=hashlib.sha256(response.raw_json.encode()).hexdigest(),
        stop_reason=response.stop_reason,
        usage=response.usage,
        produced_by=ProducedBy.LIVE,
        timestamp=when,
        error=None if response.outcome is Outcome.COMPLETE else response.outcome.value,
    )


def _record_call(workspace, sub_id, call: ModelCall, response: ProviderResult, when) -> None:
    """Every call, whatever its outcome, leaves its record and raw response."""
    stamp = f"{when.strftime('%Y%m%dT%H%M%S%f')}--{call.model_requested}"
    workspace.write_json(
        f"{READINGS}/calls/{sub_id}--{stamp}.json",
        {"outcome": response.outcome.value, "call": call.model_dump(mode="json")},
        private=True,
    )
    workspace.write_json(
        f"{READINGS}/raw/{sub_id}--{stamp}.json", json.loads(response.raw_json), private=True
    )


def _to_suggestions(response: ProviderResult, current: _Current, call: ModelCall, planned, when):
    out: ReadingOut = response.parsed
    rubric = current.rubric
    warnings: list[str] = []
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
            start = current.text.find(quote)
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
                    actor=Actor(
                        kind=ActorKind.MODEL, label=call.model_reported or call.model_requested
                    ),
                    timestamp=when,
                    input_hashes=sorted(
                        {call.approved_text_sha256, call.request_sha256}
                        | ({call.brief_sha256} if call.brief_sha256 else set())
                    ),
                ),
            )
        )
    return suggestions, warnings


def _store(workspace, submission_id, suggestions, when) -> None:
    path = reading_path(submission_id)
    if workspace.exists(path):
        stamp = when.strftime("%Y%m%dT%H%M%S%f")
        workspace.write_json(
            f"{READINGS}/history/{submission_id}--{stamp}.json",
            workspace.read_json(path),
            private=True,
        )
    workspace.write_json(path, [s.model_dump(mode="json") for s in suggestions], private=True)


def _write_log(workspace, started, plan: Plan, result: RunResult, log) -> None:
    workspace.write_json(
        f"{READINGS}/runs/{started.strftime('%Y%m%dT%H%M%S%f')}.json",
        {
            "started": started.isoformat(),
            "provider": plan.provider,
            "model": plan.model,
            "fallback_model": plan.fallback_model,
            "with_brief": plan.with_brief,
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
