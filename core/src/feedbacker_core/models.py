"""Stage 0 structured representation.

These Pydantic models are the single source of truth for Feedbacker's data
contract (ADR 0002). JSON Schema and TypeScript types are generated from them.

Three kinds of judgement are kept deliberately separate and cannot be confused:

- ``OriginalAssessment``: what the original marker awarded;
- ``AISuggestion``: a model's second reading, which is never a decision;
- ``ModeratorJudgement``: the moderator's own judgement, first and revised.

Each carries a distinct ``kind`` discriminator, forbids unknown fields, and
records provenance.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    NonNegativeInt,
    StringConstraints,
    model_validator,
)

SCHEMA_VERSION = "0.1.0"

Sha256 = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
Identifier = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")]
Pseudonym = Annotated[str, StringConstraints(pattern=r"^\[[A-Z]+_[A-Z0-9]+\]$")]
NonEmptyText = Annotated[str, StringConstraints(min_length=1)]


class Record(BaseModel):
    """Base for every contract type: immutable and strict about fields."""

    model_config = ConfigDict(extra="forbid", frozen=True)


# --- Provenance -------------------------------------------------------------


class ActorKind(StrEnum):
    MODERATOR = "moderator"
    ORIGINAL_MARKER = "original_marker"
    MODEL = "model"
    SYSTEM = "system"


class Actor(Record):
    """Who or what performed a step. Labels are roles, never real names."""

    kind: ActorKind
    label: NonEmptyText = Field(
        description="Role label or model identifier, e.g. 'moderator' or a model ID."
    )


class Transformation(StrEnum):
    IMPORTED = "imported"
    EXTRACTED = "extracted"
    ANONYMISED = "anonymised"
    APPROVED = "approved"
    ENTERED = "entered"
    GENERATED = "generated"
    RECORDED = "recorded"
    REVISED = "revised"
    EXPORTED = "exported"


class Provenance(Record):
    """How a record came to exist."""

    source: NonEmptyText = Field(
        description="What the record was derived from, e.g. 'file:sha256:<hash>' or 'manual entry'."
    )
    transformation: Transformation
    actor: Actor
    timestamp: AwareDatetime
    input_hashes: list[Sha256] = Field(
        default_factory=list, description="Hashes of the inputs this record depends on."
    )


# --- Rubric -----------------------------------------------------------------


class Level(Record):
    """One rubric level. Use ``points`` for a single value (e.g. Turnitin rubrics)
    or ``min_mark``/``max_mark`` for a band. ``label`` is kept exactly as written."""

    id: Identifier
    label: NonEmptyText
    descriptor: NonEmptyText
    points: float | None = Field(default=None, ge=0)
    min_mark: float | None = Field(default=None, ge=0)
    max_mark: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _mark_range(self) -> Level:
        if (
            self.min_mark is not None
            and self.max_mark is not None
            and self.min_mark > self.max_mark
        ):
            raise ValueError(
                f"level '{self.id}': min_mark {self.min_mark} exceeds max_mark {self.max_mark}"
            )
        return self


class Criterion(Record):
    id: Identifier
    title: NonEmptyText
    description: str = ""
    weight: float | None = Field(default=None, gt=0, description="Percentage weight.")
    max_points: float | None = Field(default=None, gt=0)
    levels: list[Level] = Field(min_length=1)

    @model_validator(mode="after")
    def _unique_levels(self) -> Criterion:
        _require_unique([lvl.id for lvl in self.levels], f"criterion '{self.id}' level")
        return self

    def level_ids(self) -> set[str]:
        return {lvl.id for lvl in self.levels}


class Rubric(Record):
    kind: Literal["rubric"] = "rubric"
    id: Identifier
    version: NonEmptyText
    title: NonEmptyText
    criteria: list[Criterion] = Field(min_length=1)
    provenance: Provenance

    @model_validator(mode="after")
    def _unique_criteria(self) -> Rubric:
        _require_unique([c.id for c in self.criteria], "rubric criterion")
        return self

    def criterion(self, criterion_id: str) -> Criterion | None:
        return next((c for c in self.criteria if c.id == criterion_id), None)


# --- Submission -------------------------------------------------------------


class SourceFormat(StrEnum):
    DOCX = "docx"
    PDF = "pdf"


class SourceKind(StrEnum):
    """Which file a submission's text comes from."""

    MARKED_VIEW = "marked_view"
    """The marked version with feedback, e.g. a Turnitin current view."""
    ORIGINAL = "original"
    """The student's original file, optional and often cleaner to extract."""


class Extract(Record):
    """Text extracted locally from a source file. Never sent to a model."""

    text: str
    source_sha256: Sha256
    warnings: list[str] = Field(default_factory=list)
    provenance: Provenance


class Redaction(Record):
    start: NonNegativeInt
    end: NonNegativeInt
    replacement: Pseudonym
    reason: NonEmptyText

    @model_validator(mode="after")
    def _span(self) -> Redaction:
        if self.end <= self.start:
            raise ValueError(f"redaction end {self.end} must be after start {self.start}")
        return self


class AnonymisedText(Record):
    """Redacted text. Offsets in ``redactions`` refer to the extract text."""

    text: str
    text_sha256: Sha256
    redactions: list[Redaction] = Field(default_factory=list)
    provenance: Provenance


class Approval(Record):
    """The moderator's explicit approval of anonymised text for model use."""

    id: Identifier
    approved_text_sha256: Sha256
    approved_by: Actor
    approved_at: AwareDatetime

    @model_validator(mode="after")
    def _moderator_only(self) -> Approval:
        if self.approved_by.kind is not ActorKind.MODERATOR:
            raise ValueError("approval must be given by the moderator")
        return self


class Submission(Record):
    """One sampled submission, identified only by a pseudonym.

    The original file name is deliberately absent: it may identify the student.
    """

    kind: Literal["submission"] = "submission"
    id: Identifier
    pseudonym: Pseudonym
    source_kind: SourceKind
    source_format: SourceFormat
    source_sha256: Sha256
    extract: Extract | None = None
    anonymised: AnonymisedText | None = None
    approval: Approval | None = None

    @model_validator(mode="after")
    def _pipeline_order(self) -> Submission:
        if self.extract and self.extract.source_sha256 != self.source_sha256:
            raise ValueError(
                f"submission '{self.id}': extract source hash does not match the submission"
            )
        if self.anonymised and not self.extract:
            raise ValueError(f"submission '{self.id}': anonymised text requires an extract")
        if self.approval:
            if not self.anonymised:
                raise ValueError(f"submission '{self.id}': approval requires anonymised text")
            if self.approval.approved_text_sha256 != self.anonymised.text_sha256:
                raise ValueError(
                    f"submission '{self.id}': approval does not match the anonymised text hash"
                )
        return self


# --- Original marker --------------------------------------------------------


class OriginalCriterionMark(Record):
    """The marker's mark for one criterion.

    ``raw_label`` and ``raw_score`` keep the marker's wording exactly as found
    (e.g. "2:2 (68)", "68 / 100"). ``level_id`` is None when it could not be
    mapped to a rubric level; that is a valid state, never guessed.
    """

    criterion_id: Identifier
    level_id: Identifier | None = None
    mark: float | None = Field(default=None, ge=0)
    raw_label: str | None = None
    raw_score: str | None = None
    comment: str | None = None


class Annotation(Record):
    """An inline comment the marker attached to a passage of the work."""

    text: NonEmptyText
    anchor_text: str | None = Field(
        default=None, description="The passage the comment is attached to, if known."
    )
    page: int | None = Field(default=None, ge=1)


class ImportRoute(StrEnum):
    TURNITIN_BULK_ZIP = "turnitin_bulk_zip"
    TURNITIN_CURRENT_VIEW = "turnitin_current_view"
    CANVAS_RUBRIC = "canvas_rubric"
    SPREADSHEET = "spreadsheet"
    MANUAL = "manual"


class OriginalAssessment(Record):
    """What an original marker awarded. Never sent to a model."""

    kind: Literal["original_assessment"] = "original_assessment"
    submission_id: Identifier
    marker_label: NonEmptyText = Field(
        default="marker", description="Role label, e.g. 'first marker' or 'agreed'; never a name."
    )
    import_route: ImportRoute
    criterion_marks: list[OriginalCriterionMark] = Field(default_factory=list)
    overall_mark: float | None = Field(default=None, ge=0)
    raw_overall: str | None = None
    overall_comment: str | None = None
    annotations: list[Annotation] = Field(default_factory=list)
    provenance: Provenance

    @model_validator(mode="after")
    def _checks(self) -> OriginalAssessment:
        _require_unique(
            [m.criterion_id for m in self.criterion_marks],
            f"original assessment '{self.submission_id}' criterion",
        )
        if self.provenance.actor.kind not in (ActorKind.ORIGINAL_MARKER, ActorKind.MODERATOR):
            raise ValueError(
                "original assessment must be recorded from the original marker or entered by the moderator"
            )
        return self


# --- AI suggestion ----------------------------------------------------------


class ProducedBy(StrEnum):
    LIVE = "live"
    BATCH = "batch"
    CACHE = "cache"


class TokenUsage(Record):
    input_tokens: NonNegativeInt = 0
    output_tokens: NonNegativeInt = 0
    cache_read_tokens: NonNegativeInt = 0
    cache_write_tokens: NonNegativeInt = 0


class ModelCall(Record):
    """Provenance for one model call (ADR 0003)."""

    provider: NonEmptyText
    model_requested: NonEmptyText
    model_reported: str | None = None
    request_id: str | None = None
    prompt_version: NonEmptyText
    rubric_version: NonEmptyText
    approval_id: Identifier
    approved_text_sha256: Sha256
    request_sha256: Sha256
    response_sha256: Sha256 | None = None
    stop_reason: str | None = None
    usage: TokenUsage = Field(default_factory=TokenUsage)
    produced_by: ProducedBy
    cached_from_request_id: str | None = None
    timestamp: AwareDatetime
    error: str | None = None

    @model_validator(mode="after")
    def _cache_link(self) -> ModelCall:
        if self.produced_by is ProducedBy.CACHE and not self.cached_from_request_id:
            raise ValueError("a cached result must link to the originating request")
        return self


class EvidenceQuote(Record):
    text: NonEmptyText
    verified: bool = Field(
        description="True only if the quote was found verbatim in the approved anonymised text."
    )
    start: NonNegativeInt | None = None
    end: NonNegativeInt | None = None


class AISuggestion(Record):
    """A model's second reading for one criterion. A suggestion, never a mark."""

    kind: Literal["ai_suggestion"] = "ai_suggestion"
    id: Identifier
    submission_id: Identifier
    criterion_id: Identifier
    suggested_level_id: Identifier | None = Field(
        default=None, description="None when the model could not suggest a level."
    )
    rationale: str = ""
    evidence: list[EvidenceQuote] = Field(default_factory=list)
    draft_comment: str | None = None
    missing_evidence: bool = False
    call: ModelCall
    provenance: Provenance

    @model_validator(mode="after")
    def _model_actor(self) -> AISuggestion:
        if self.provenance.actor.kind is not ActorKind.MODEL:
            raise ValueError("an AI suggestion's provenance actor must be a model")
        return self


# --- Moderator judgement ----------------------------------------------------


class ReviewMode(StrEnum):
    OPEN = "open"
    BLIND = "blind"


class JudgementEntry(Record):
    level_id: Identifier
    comment: str | None = None
    comment_derived_from_ai: bool = Field(
        default=False, description="True if the comment was adapted from an AI draft."
    )
    recorded_at: AwareDatetime


class ModeratorJudgement(Record):
    """The moderator's own judgement for one criterion.

    In ``open`` review (the default, matching usual moderation practice) the
    original marks, comments, and AI reading are visible throughout, and only
    ``first`` is recorded.

    In ``blind`` review, ``first`` is recorded before the original marks and AI
    reading are revealed; ``revised`` is optional and recorded after the reveal.
    Both are kept.
    """

    kind: Literal["moderator_judgement"] = "moderator_judgement"
    submission_id: Identifier
    criterion_id: Identifier
    mode: ReviewMode = ReviewMode.OPEN
    first: JudgementEntry
    revealed_at: AwareDatetime | None = None
    revised: JudgementEntry | None = None
    provenance: Provenance

    @model_validator(mode="after")
    def _judge_first(self) -> ModeratorJudgement:
        if self.provenance.actor.kind is not ActorKind.MODERATOR:
            raise ValueError("a moderator judgement's provenance actor must be the moderator")
        where = f"judgement '{self.submission_id}/{self.criterion_id}'"
        if self.mode is ReviewMode.OPEN:
            if self.revealed_at or self.revised:
                raise ValueError(f"{where}: open review has no reveal or revision")
            return self
        if self.revealed_at and self.first.recorded_at > self.revealed_at:
            raise ValueError(
                f"judgement '{self.submission_id}/{self.criterion_id}': first judgement "
                "must be recorded before the reveal"
            )
        if self.revised:
            if not self.revealed_at:
                raise ValueError(
                    f"judgement '{self.submission_id}/{self.criterion_id}': a revision "
                    "is only possible after the reveal"
                )
            if self.revised.recorded_at < self.revealed_at:
                raise ValueError(
                    f"judgement '{self.submission_id}/{self.criterion_id}': revision "
                    "must be recorded after the reveal"
                )
        return self


# --- Submission verdict -----------------------------------------------------


class Verdict(StrEnum):
    AGREE = "agree"
    GENEROUS = "generous"
    HARSH = "harsh"
    INCONSISTENT = "inconsistent"


class SubmissionVerdict(Record):
    """The moderator's overall view of how one submission was marked."""

    kind: Literal["submission_verdict"] = "submission_verdict"
    submission_id: Identifier
    verdict: Verdict
    suggested_mark: float | None = Field(default=None, ge=0)
    comment: str | None = None
    provenance: Provenance

    @model_validator(mode="after")
    def _moderator(self) -> SubmissionVerdict:
        if self.provenance.actor.kind is not ActorKind.MODERATOR:
            raise ValueError("a submission verdict's provenance actor must be the moderator")
        return self


# --- Moderation context -----------------------------------------------------


class BandCount(Record):
    label: NonEmptyText
    count: NonNegativeInt


class ModerationContext(Record):
    """Module-level context from the moderation request. Roles only, never names."""

    cohort_size: NonNegativeInt | None = None
    multiple_groups: bool | None = None
    band_distribution: list[BandCount] = Field(
        default_factory=list, description="Marked assessments per band, as reported."
    )
    sample_note: str | None = Field(default=None, description="How the sample was chosen.")


# --- Moderation record ------------------------------------------------------


class ModerationRecord(Record):
    """Everything for one moderation, self-contained and pseudonymous."""

    kind: Literal["moderation_record"] = "moderation_record"
    schema_version: Literal["0.1.0"] = SCHEMA_VERSION
    id: Identifier
    context: ModerationContext | None = None
    rubric: Rubric
    submissions: list[Submission] = Field(min_length=1)
    original_assessments: list[OriginalAssessment] = Field(default_factory=list)
    ai_suggestions: list[AISuggestion] = Field(default_factory=list)
    judgements: list[ModeratorJudgement] = Field(default_factory=list)
    verdicts: list[SubmissionVerdict] = Field(default_factory=list)
    overall_comment: str | None = None
    approved_by: Actor | None = None
    approved_at: AwareDatetime | None = None
    provenance: Provenance

    @model_validator(mode="after")
    def _references(self) -> ModerationRecord:
        errors: list[str] = []
        _collect_unique([s.id for s in self.submissions], "submission", errors)
        _collect_unique([s.pseudonym for s in self.submissions], "submission pseudonym", errors)
        submissions = {s.id: s for s in self.submissions}

        def check(where: str, submission_id: str, criterion_id: str, *level_ids: str | None):
            if submission_id not in submissions:
                errors.append(f"{where}: unknown submission '{submission_id}'")
            criterion = self.rubric.criterion(criterion_id)
            if criterion is None:
                errors.append(f"{where}: unknown criterion '{criterion_id}'")
                return
            for level_id in level_ids:
                if level_id is not None and level_id not in criterion.level_ids():
                    errors.append(
                        f"{where}: level '{level_id}' is not a level of criterion '{criterion_id}'"
                    )

        _collect_unique(
            [f"{a.submission_id}/{a.marker_label}" for a in self.original_assessments],
            "original assessment",
            errors,
        )
        for a in self.original_assessments:
            if a.submission_id not in submissions:
                errors.append(f"original assessment: unknown submission '{a.submission_id}'")
            for m in a.criterion_marks:
                check(
                    f"original assessment '{a.submission_id}'",
                    a.submission_id,
                    m.criterion_id,
                    m.level_id,
                )

        _collect_unique([s.id for s in self.ai_suggestions], "AI suggestion", errors)
        for s in self.ai_suggestions:
            where = f"AI suggestion '{s.id}'"
            check(where, s.submission_id, s.criterion_id, s.suggested_level_id)
            sub = submissions.get(s.submission_id)
            if s.call.rubric_version != self.rubric.version:
                errors.append(
                    f"{where}: rubric version '{s.call.rubric_version}' "
                    f"does not match '{self.rubric.version}'"
                )
            if sub is not None:
                if sub.approval is None:
                    errors.append(f"{where}: submission '{sub.id}' has no approval")
                elif (
                    s.call.approval_id != sub.approval.id
                    or s.call.approved_text_sha256 != sub.approval.approved_text_sha256
                ):
                    errors.append(f"{where}: call does not match the submission's approval")

        _collect_unique(
            [f"{j.submission_id}/{j.criterion_id}" for j in self.judgements],
            "moderator judgement",
            errors,
        )
        for j in self.judgements:
            check(
                f"judgement '{j.submission_id}/{j.criterion_id}'",
                j.submission_id,
                j.criterion_id,
                j.first.level_id,
                j.revised.level_id if j.revised else None,
            )

        _collect_unique([v.submission_id for v in self.verdicts], "submission verdict", errors)
        for v in self.verdicts:
            if v.submission_id not in submissions:
                errors.append(f"submission verdict: unknown submission '{v.submission_id}'")

        if (self.approved_by is None) != (self.approved_at is None):
            errors.append("record approval needs both approved_by and approved_at")
        if self.approved_by and self.approved_by.kind is not ActorKind.MODERATOR:
            errors.append("record must be approved by the moderator")

        if errors:
            raise ValueError("invalid moderation record:\n- " + "\n- ".join(errors))
        return self


# --- Helpers ----------------------------------------------------------------


def _collect_unique(values: list[str], what: str, errors: list[str]) -> None:
    seen: set[str] = set()
    for v in values:
        if v in seen:
            errors.append(f"duplicate {what} '{v}'")
        seen.add(v)


def _require_unique(values: list[str], what: str) -> None:
    errors: list[str] = []
    _collect_unique(values, what, errors)
    if errors:
        raise ValueError("; ".join(errors))


CONTRACT_TYPES: tuple[type[Record], ...] = (
    Rubric,
    Submission,
    OriginalAssessment,
    AISuggestion,
    ModeratorJudgement,
    SubmissionVerdict,
    ModerationRecord,
)

__all__ = [
    "Verdict",
    "SubmissionVerdict",
    "ReviewMode",
    "ModerationContext",
    "ImportRoute",
    "BandCount",
    "Annotation",
    "SCHEMA_VERSION",
    "CONTRACT_TYPES",
    "Actor",
    "ActorKind",
    "AISuggestion",
    "AnonymisedText",
    "Approval",
    "Criterion",
    "EvidenceQuote",
    "Extract",
    "JudgementEntry",
    "Level",
    "ModelCall",
    "ModerationRecord",
    "ModeratorJudgement",
    "OriginalAssessment",
    "OriginalCriterionMark",
    "ProducedBy",
    "Provenance",
    "Redaction",
    "Rubric",
    "SourceFormat",
    "SourceKind",
    "Submission",
    "TokenUsage",
    "Transformation",
]
