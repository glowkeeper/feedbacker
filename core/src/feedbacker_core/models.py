"""Feedbacker's structured representation.

These Pydantic models are the reference implementation of Feedbacker's data
contract. Since ADR 0004 the contract is owned by the TypeScript zod models in
``ui/src/core/models.ts``, which generate ``contract/feedbacker.schema.json``;
``contract/conformance.json`` keeps these models compatible with them until the
Python core is retired (see ``feedbacker_core.contract``).

Three kinds of judgement are kept deliberately separate and cannot be confused:

- ``OriginalAssessment``: what the original marker awarded;
- ``AISuggestion``: a model's second reading, which is never a decision;
- ``ModeratorJudgement``: the moderator's own judgement, first and revised.

Each carries a distinct ``kind`` discriminator, forbids unknown fields, and
records provenance.
"""

from __future__ import annotations

import hashlib
import math
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    NonNegativeInt,
    StringConstraints,
    field_validator,
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
    EDUCATOR = "educator"  # marking their own cohort
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


class BlockKind(StrEnum):
    HEADING = "heading"
    PARAGRAPH = "paragraph"
    TABLE_ROW = "table_row"


class Block(Record):
    """A structural unit of extracted text; offsets index into ``Extract.text``."""

    kind: BlockKind
    start: NonNegativeInt
    end: NonNegativeInt
    level: int | None = Field(default=None, ge=0, description="Heading level, if a heading.")
    page: int | None = Field(default=None, ge=1, description="Page number, for PDFs.")

    @model_validator(mode="after")
    def _span(self) -> Block:
        if self.end < self.start:
            raise ValueError(f"block end {self.end} is before start {self.start}")
        return self


class Extract(Record):
    """Text extracted locally from a source file. Never sent to a model."""

    text: str
    source_sha256: Sha256
    blocks: list[Block] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    provenance: Provenance

    @model_validator(mode="after")
    def _blocks_within_text(self) -> Extract:
        for b in self.blocks:
            if b.end > len(self.text):
                raise ValueError(f"block {b.start}-{b.end} extends beyond the extracted text")
        return self


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

    @model_validator(mode="after")
    def _hash_matches_text(self) -> AnonymisedText:
        # The approval gate relies on this hash, so it must describe the text.
        if sha256_text(self.text) != self.text_sha256:
            raise ValueError("anonymised text does not match text_sha256")
        return self


class Approval(Record):
    """The explicit approval of anonymised text for the AI.

    It is given by whoever works the workspace: its moderator, or the educator marking.
    """

    id: Identifier
    approved_text_sha256: Sha256
    approved_by: Actor
    approved_at: AwareDatetime

    @model_validator(mode="after")
    def _moderator_or_educator(self) -> Approval:
        if self.approved_by.kind not in (ActorKind.MODERATOR, ActorKind.EDUCATOR):
            raise ValueError("approval must be given by the moderator or the educator")
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
    provenance: Provenance = Field(
        description="How the submission entered the workspace (e.g. imported from a bulk download)."
    )

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


class RecordSubmission(Submission):
    """A submission as a moderation record carries it: without its extract.

    The extract is the original text, which may name the student. A record is
    pseudonymous, so it carries only the approved anonymised text, its
    redactions and its approval, which stand without the extract (maintainer
    decision, 2026-09-27).
    """

    extract: None = None  # never the original text, in the schema as well as here
    listed_band: str | None = Field(
        default=None, description="The grade band the request listed it under, as written."
    )

    @field_validator("extract", mode="before")
    @classmethod
    def _no_extract(cls, value: object) -> object:
        if value is not None:
            raise ValueError("a moderation record carries no extract (the original text)")
        return value

    @model_validator(mode="after")
    def _pipeline_order(self) -> RecordSubmission:  # replaces Submission's pipeline check
        if self.approval:
            if not self.anonymised:
                raise ValueError(f"submission '{self.id}': approval requires anonymised text")
            if self.approval.approved_text_sha256 != self.anonymised.text_sha256:
                raise ValueError(
                    f"submission '{self.id}': approval does not match the anonymised text hash"
                )
        return self


# --- Assessment brief --------------------------------------------------------


class Brief(Record):
    """The assessment brief. Confidential assessment material, not student data.

    It follows the submission pipeline: extracted locally, redacted (staff
    names and contact details), and explicitly approved by the moderator before
    it may be given to a model (maintainer decision, 2026-09-25).
    """

    kind: Literal["brief"] = "brief"
    source_format: SourceFormat
    source_sha256: Sha256
    extract: Extract
    anonymised: AnonymisedText | None = None
    approval: Approval | None = None
    provenance: Provenance

    @model_validator(mode="after")
    def _pipeline_order(self) -> Brief:
        if self.extract.source_sha256 != self.source_sha256:
            raise ValueError("brief: extract source hash does not match the brief")
        if self.approval:
            if not self.anonymised:
                raise ValueError("brief: approval requires anonymised text")
            if self.approval.approved_text_sha256 != self.anonymised.text_sha256:
                raise ValueError("brief: approval does not match the anonymised text hash")
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
    raw_criterion: str | None = Field(
        default=None, description="The criterion's name in the marker's system, as written."
    )
    raw_label: str | None = None
    raw_score: str | None = None
    comment: str | None = None


class Annotation(Record):
    """An inline comment the marker attached to a passage of the work.

    Positions are approximate: ``page`` is the page of the marked report, and
    ``position`` is the marker's height on that page (0 = top, 1 = bottom).
    ``anchor_text`` is only ever an approximate match, never presented as exact.
    """

    text: NonEmptyText
    number: int | None = Field(default=None, ge=1, description="The marker's comment number.")
    criterion_label: str | None = Field(
        default=None, description="The criterion tag on the comment, as written."
    )
    anchor_text: str | None = Field(
        default=None, description="An approximate passage the comment refers to, if known."
    )
    page: int | None = Field(default=None, ge=1)
    position: float | None = Field(default=None, ge=0, le=1)


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
    raw_rubric_total: str | None = Field(
        default=None, description="The marker's rubric total exactly as written, if separate."
    )
    overall_comment: str | None = None
    annotations: list[Annotation] = Field(default_factory=list)
    import_notes: list[str] = Field(
        default_factory=list,
        description="Things found on import for the moderator to judge, e.g. a selected level "
        "that disagrees with the awarded score, or a criterion that could not be mapped.",
    )
    unmapped_criteria: list[str] = Field(
        default_factory=list,
        description="The marker's criterion names this import could not map to the source "
        "rubric, exactly as written.",
    )
    confirmed_by: Actor | None = None
    confirmed_at: AwareDatetime | None = None
    provenance: Provenance

    @model_validator(mode="after")
    def _checks(self) -> OriginalAssessment:
        if (self.confirmed_by is None) != (self.confirmed_at is None):
            raise ValueError("confirmation needs both confirmed_by and confirmed_at")
        if self.confirmed_by and self.confirmed_by.kind is not ActorKind.MODERATOR:
            raise ValueError("original assessment must be confirmed by the moderator")
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
    brief_approval_id: Identifier | None = Field(
        default=None, description="The approved brief included in the request, if any."
    )
    brief_sha256: Sha256 | None = None
    fallback_from: str | None = Field(
        default=None,
        description="The model that declined, when this call is the recorded fallback.",
    )
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
        if (self.brief_approval_id is None) != (self.brief_sha256 is None):
            raise ValueError("a brief in the call needs both brief_approval_id and brief_sha256")
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
    mark: float | None = Field(
        default=None,
        ge=0,
        description="The moderator's mark for the criterion, within the level: its points "
        "unless moved. Null in a judgement recorded before marks, which counts as the level's "
        "points.",
    )
    comment: str | None = None
    comment_derived_from_ai: bool = Field(
        default=False, description="True if the comment was adapted from an AI draft."
    )
    level_from_suggestion: Identifier | None = Field(
        default=None,
        description=(
            "The id of the AI suggestion whose level was taken, unchanged; "
            "null if the level is the moderator's own."
        ),
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
    revised_provenance: Provenance | None = Field(
        default=None,
        description="What the revision was made against; `provenance` stays the first "
        "judgement's. Null in a revision recorded before it existed.",
    )

    @model_validator(mode="after")
    def _judge_first(self) -> ModeratorJudgement:
        # Made by whoever works the workspace: its moderator, or the educator marking.
        judges = (ActorKind.MODERATOR, ActorKind.EDUCATOR)
        if self.provenance.actor.kind not in judges:
            raise ValueError("a judgement's provenance actor must be the moderator or the educator")
        where = f"judgement '{self.submission_id}/{self.criterion_id}'"
        if self.revised_provenance is not None:
            if self.revised is None:
                raise ValueError(f"{where}: revised provenance without a revision")
            if self.revised_provenance.actor.kind is not self.provenance.actor.kind:
                raise ValueError(f"{where}: a revision must be made by whoever made the judgement")
        if self.mode is ReviewMode.OPEN:
            if self.revealed_at or self.revised:
                raise ValueError(f"{where}: open review has no reveal or revision")
            return self
        if self.revealed_at and self.first.recorded_at >= self.revealed_at:
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
            if self.revised.recorded_at <= self.revealed_at:
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
    criteria_mark: float | None = Field(
        default=None,
        ge=0,
        description="The overall mark the moderator's criterion marks implied when the verdict "
        "was recorded; null if it couldn't be worked out.",
    )
    comment: str | None = None
    provenance: Provenance

    @model_validator(mode="after")
    def _moderator(self) -> SubmissionVerdict:
        if self.provenance.actor.kind is not ActorKind.MODERATOR:
            raise ValueError("a submission verdict's provenance actor must be the moderator")
        return self


class SubmissionMark(Record):
    """The educator's overall mark and comment for one submission they mark."""

    kind: Literal["submission_mark"] = "submission_mark"
    submission_id: Identifier
    mark: float = Field(ge=0, description="The educator's overall mark.")
    criteria_mark: float | None = Field(
        default=None,
        ge=0,
        description="The overall mark the educator's criterion marks implied when it was "
        "recorded; null if it couldn't be worked out.",
    )
    comment: str | None = Field(default=None, description="The overall comment, anonymised.")
    provenance: Provenance

    @model_validator(mode="after")
    def _educator(self) -> SubmissionMark:
        if self.provenance.actor.kind is not ActorKind.EDUCATOR:
            raise ValueError("a submission's mark must be given by the educator")
        return self


class FeedbackDraft(Record):
    """The AI's draft of feedback for one criterion, or the overall summary (no criterion).

    It is drafted from the educator's own marks and comments (ADR 0006). A draft,
    never feedback: the educator adapts it, or writes their own.
    """

    kind: Literal["feedback_draft"] = "feedback_draft"
    id: Identifier
    submission_id: Identifier
    criterion_id: Identifier | None = Field(
        default=None, description="Null for the overall summary."
    )
    text: NonEmptyText
    drafted_from: Sha256 = Field(
        description="A digest of the educator's marking it was drafted from: the criterion's "
        "level, mark and comment, or, for the overall summary, every criterion's and the overall "
        "mark and comment."
    )
    guide_version: int | None = Field(
        default=None,
        ge=1,
        description="The version of the educator's feedback guide sent with it; null if none was.",
    )
    call: ModelCall
    provenance: Provenance

    @model_validator(mode="after")
    def _model_actor(self) -> FeedbackDraft:
        if self.provenance.actor.kind is not ActorKind.MODEL:
            raise ValueError("a feedback draft's provenance actor must be a model")
        return self


class FeedbackGuide(Record):
    """The educator's feedback guide for the assessment.

    What each level of each criterion typically needs to hear, and the common next
    steps. It is sent with every drafting request once approved.
    """

    kind: Literal["feedback_guide"] = "feedback_guide"
    version: int = Field(ge=1, description="Raised each time the guide is saved.")
    text: NonEmptyText = Field(description="Anonymised, as the educator's comments are.")
    text_sha256: Sha256
    approval: Approval | None = Field(
        default=None,
        description="The educator's approval of exactly this text for the AI; null until given.",
    )
    provenance: Provenance

    @model_validator(mode="after")
    def _guide(self) -> FeedbackGuide:
        if self.provenance.actor.kind is not ActorKind.EDUCATOR:
            raise ValueError("a feedback guide must be written by the educator")
        if sha256_text(self.text) != self.text_sha256:
            raise ValueError("the guide's text does not match text_sha256")
        if self.approval and self.approval.approved_text_sha256 != self.text_sha256:
            raise ValueError("the guide's approval is of other text")
        if self.approval and self.approval.approved_by.kind is not ActorKind.EDUCATOR:
            raise ValueError("a feedback guide must be approved by the educator")
        return self


class AcceptedFlag(Record):
    """A check's flag the educator accepted for this text, with their reason."""

    check: Literal["praise", "next_step", "other_mark", "token", "cut_off"] = Field(
        description="Which check raised it: praise above the mark's band, no next step, another "
        "mark or level named, an anonymised value (a token) the student would see, or text that "
        "ends mid-sentence."
    )
    detail: NonEmptyText = Field(description="What it found, e.g. the word or the mark named.")
    reason: NonEmptyText = Field(description="Why the educator keeps the text as it is.")


class Feedback(Record):
    """The educator's feedback to the student on one criterion, or overall (no criterion)."""

    kind: Literal["feedback"] = "feedback"
    submission_id: Identifier
    criterion_id: Identifier | None = Field(
        default=None, description="Null for the overall feedback."
    )
    text: NonEmptyText = Field(description="Anonymised, as the educator's comments are.")
    derived_from_ai: bool = Field(
        default=False,
        description="True if it was adapted from an AI draft, however much it was changed.",
    )
    from_draft: Identifier | None = Field(
        default=None, description="The draft it was adapted from, when it was."
    )
    given_on: Sha256 = Field(
        description="A digest of the educator's marking it was given on, as a draft's `drafted_from`."
    )
    accepted_flags: list[AcceptedFlag] = Field(
        default_factory=list,
        description="The checks' flags the educator accepted for this text, each with a reason; "
        "recording new text clears them.",
    )
    provenance: Provenance

    @model_validator(mode="after")
    def _educator(self) -> Feedback:
        if self.provenance.actor.kind is not ActorKind.EDUCATOR:
            raise ValueError("feedback must be given by the educator")
        if self.from_draft is not None and not self.derived_from_ai:
            raise ValueError("feedback adapted from a draft is derived from the AI")
        return self


# --- Moderation context -----------------------------------------------------


class BandCount(Record):
    label: NonEmptyText
    count: NonNegativeInt


class ModerationContext(Record):
    """Module-level context from the moderation request. Roles only, never names."""

    programme: str | None = Field(default=None, description="Programme title, as written.")
    module: str | None = Field(default=None, description="Module title and code, as written.")
    staff_roles: list[NonEmptyText] = Field(
        default_factory=list,
        description="Roles involved, e.g. 'module convener', 'marker'. Never names.",
    )
    cohort_size: NonNegativeInt | None = None
    multiple_groups: bool | None = None
    band_distribution: list[BandCount] = Field(
        default_factory=list, description="Marked assessments per band, as reported."
    )
    sample_note: str | None = Field(default=None, description="How the sample was chosen.")
    provenance: Provenance = Field(
        description="Where these values came from, e.g. entered from the moderation request."
    )


# --- Assessment (marking) -----------------------------------------------------


class AssessmentDetails(Record):
    """What a marking workspace is marking: the assessment, as the educator enters it."""

    kind: Literal["assessment"] = "assessment"
    title: NonEmptyText = Field(
        description="The assessment's title, as written, e.g. 'Coursework 1: a web application'."
    )
    module: str | None = Field(default=None, description="Module title and code, as written.")
    programme: str | None = Field(default=None, description="Programme title, as written.")
    provenance: Provenance = Field(
        description="Where these values came from, e.g. entered by the educator."
    )


class CohortSubmission(Record):
    """One submission in a marking workspace's cohort, identified only by its pseudonymous ID.

    Its real ID and name are only in the pseudonym key.
    """

    submission_id: Identifier
    pseudonym: Pseudonym


class Cohort(Record):
    """Every submission a marking workspace marks: the whole cohort, not a sample.

    It is imported from the marking platform's bulk download.
    """

    kind: Literal["cohort"] = "cohort"
    submissions: list[CohortSubmission] = Field(min_length=1)
    provenance: Provenance = Field(description="The latest import that added to the cohort.")

    @model_validator(mode="after")
    def _unique(self) -> Cohort:
        errors: list[str] = []
        _collect_unique([s.submission_id for s in self.submissions], "cohort submission", errors)
        _collect_unique([s.pseudonym for s in self.submissions], "cohort pseudonym", errors)
        if errors:
            raise ValueError("invalid cohort: " + "; ".join(errors))
        return self


# --- Moderation request -----------------------------------------------------


class SampledSubmission(Record):
    """One sampled submission, identified only by its pseudonymous ID.

    The external identifier (e.g. a Turnitin submission ID) lives only in the
    pseudonym key.
    """

    submission_id: Identifier
    pseudonym: Pseudonym
    listed_band: str | None = Field(
        default=None, description="The grade band the request listed it under, as written."
    )


class ModerationRequest(Record):
    """What the commissioning body asked to be moderated."""

    kind: Literal["moderation_request"] = "moderation_request"
    context: ModerationContext
    sample: list[SampledSubmission] = Field(min_length=1)
    provenance: Provenance

    @model_validator(mode="after")
    def _unique(self) -> ModerationRequest:
        errors: list[str] = []
        _collect_unique([s.submission_id for s in self.sample], "sampled submission", errors)
        _collect_unique([s.pseudonym for s in self.sample], "sampled pseudonym", errors)
        if errors:
            raise ValueError("invalid moderation request: " + "; ".join(errors))
        return self


# --- Moderation record ------------------------------------------------------


def _criterion_max(c: Criterion) -> float | None:
    """The most a criterion can be marked: its max_points, or else its top level's points."""
    if c.max_points is not None:
        return c.max_points
    points = [lv.points for lv in c.levels if lv.points is not None]
    return max(points) if points else None


def _mark_problem(c: Criterion, level: Level, mark: float) -> str | None:
    """Why a mark doesn't fit the level (as the TypeScript core's markProblem), or None."""
    top = _criterion_max(c)
    if top is not None and mark > top:
        return f"{c.title} is marked out of {top:g}, so {mark:g} is too high"
    if level.min_mark is not None or level.max_mark is not None:
        lo = level.min_mark if level.min_mark is not None else -math.inf
        hi = level.max_mark if level.max_mark is not None else math.inf
        if not lo <= mark <= hi:
            low = "any" if level.min_mark is None else f"{level.min_mark:g}"
            high = "any" if level.max_mark is None else f"{level.max_mark:g}"
            return f"a mark of {mark:g} is outside {level.label}'s range ({low} to {high})"
        return None
    if level.points is None:
        return f"{level.label} has no points, so it can't take a mark"
    own = abs(mark - level.points)
    nearer = [
        lv
        for lv in c.levels
        if lv.id != level.id and lv.points is not None and abs(mark - lv.points) < own
    ]
    if nearer:
        closest = min(nearer, key=lambda lv: abs(mark - lv.points))
        return (
            f"a mark of {mark:g} is nearer {closest.label} than {level.label}; "
            f"choose that level, or a mark nearer {level.label}"
        )
    return None


def _entry_mark_problem(c: Criterion, entry: JudgementEntry) -> str | None:
    level = next((lv for lv in c.levels if lv.id == entry.level_id), None)
    if level is None or entry.mark is None:
        return None
    return _mark_problem(c, level, entry.mark)


class ModerationRecord(Record):
    """Everything for one moderation, self-contained and pseudonymous."""

    kind: Literal["moderation_record"] = "moderation_record"
    schema_version: Literal["0.1.0"] = SCHEMA_VERSION
    id: Identifier
    context: ModerationContext | None = None
    rubric: Rubric
    submissions: list[RecordSubmission] = Field(min_length=1)
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
            where = f"judgement '{j.submission_id}/{j.criterion_id}'"
            check(
                where,
                j.submission_id,
                j.criterion_id,
                j.first.level_id,
                j.revised.level_id if j.revised else None,
            )
            # Each mark must fit its level on the record's rubric.
            criterion = self.rubric.criterion(j.criterion_id)
            for entry in (j.first, j.revised):
                problem = _entry_mark_problem(criterion, entry) if criterion and entry else None
                if problem:
                    errors.append(f"{where}: {problem}")

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


def sha256_text(text: str) -> str:
    """SHA-256 of UTF-8 text, as used for approved-text hashes."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


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


class SubmissionApproval(Record):
    """The educator's approval of exactly what one student will receive.

    Every criterion's mark and feedback, and the overall mark and feedback, as
    exported (and the flags accepted on them). A later change clears it.
    """

    kind: Literal["submission_approval"] = "submission_approval"
    submission_id: Identifier
    content_sha256: Sha256 = Field(
        description="A digest of what the student will receive, as it was approved."
    )
    approved_by: Actor
    approved_at: AwareDatetime

    @model_validator(mode="after")
    def _educator(self) -> SubmissionApproval:
        if self.approved_by.kind is not ActorKind.EDUCATOR:
            raise ValueError("a submission's marks and feedback must be approved by the educator")
        return self


class ProvisionalMark(Record):
    """The provisional mark the AI's proposed levels implied (never a mark), or why there was none."""

    submission_id: Identifier
    mark: float | None = Field(default=None, ge=0)
    why_none: str | None = Field(
        default=None, description="Why no provisional mark could be worked out, when none could."
    )


class MarkingRecord(Record):
    """Everything for one marked cohort, self-contained and pseudonymous."""

    kind: Literal["marking_record"] = "marking_record"
    schema_version: Literal["0.1.0"] = SCHEMA_VERSION
    id: Identifier
    assessment: AssessmentDetails | None = None
    rubric: Rubric
    cohort: Cohort
    guide: FeedbackGuide | None = None
    ai_suggestions: list[AISuggestion] = Field(default_factory=list)
    provisional_marks: list[ProvisionalMark] = Field(default_factory=list)
    judgements: list[ModeratorJudgement] = Field(default_factory=list)
    marks: list[SubmissionMark] = Field(default_factory=list)
    drafts: list[FeedbackDraft] = Field(default_factory=list)
    feedback: list[Feedback] = Field(default_factory=list)
    approvals: list[SubmissionApproval] = Field(default_factory=list)
    exported_at: AwareDatetime

    @model_validator(mode="after")
    def _references(self) -> MarkingRecord:
        """Nothing twice, and nothing outside the cohort or the rubric, as a moderation record."""
        errors: list[str] = []
        submissions = {s.submission_id for s in self.cohort.submissions}

        def known(where: str, submission_id: str) -> None:
            if submission_id not in submissions:
                errors.append(f"{where}: unknown submission '{submission_id}'")

        def check(where: str, submission_id: str, criterion_id: str | None, *level_ids: str | None):
            known(where, submission_id)
            if criterion_id is None:
                return
            criterion = self.rubric.criterion(criterion_id)
            if criterion is None:
                errors.append(f"{where}: unknown criterion '{criterion_id}'")
                return
            for level_id in level_ids:
                if level_id is not None and level_id not in criterion.level_ids():
                    errors.append(
                        f"{where}: level '{level_id}' is not a level of criterion '{criterion_id}'"
                    )

        _collect_unique([s.id for s in self.ai_suggestions], "AI suggestion", errors)
        for s in self.ai_suggestions:
            check(f"AI suggestion '{s.id}'", s.submission_id, s.criterion_id, s.suggested_level_id)
        _collect_unique(
            [p.submission_id for p in self.provisional_marks], "provisional mark", errors
        )
        for p in self.provisional_marks:
            known("provisional mark", p.submission_id)
        _collect_unique(
            [f"{j.submission_id}/{j.criterion_id}" for j in self.judgements], "judgement", errors
        )
        for j in self.judgements:
            check(
                f"judgement '{j.submission_id}/{j.criterion_id}'",
                j.submission_id,
                j.criterion_id,
                j.first.level_id,
                j.revised.level_id if j.revised else None,
            )
        _collect_unique([m.submission_id for m in self.marks], "overall mark", errors)
        for m in self.marks:
            known("overall mark", m.submission_id)
        _collect_unique([d.id for d in self.drafts], "feedback draft", errors)
        _collect_unique(
            [f"{d.submission_id}/{d.criterion_id or 'overall'}" for d in self.drafts],
            "feedback draft of a criterion",
            errors,
        )
        for d in self.drafts:
            check(f"feedback draft '{d.id}'", d.submission_id, d.criterion_id)
        _collect_unique(
            [f"{f.submission_id}/{f.criterion_id or 'overall'}" for f in self.feedback],
            "feedback",
            errors,
        )
        for f in self.feedback:
            check(
                f"feedback '{f.submission_id}/{f.criterion_id or 'overall'}'",
                f.submission_id,
                f.criterion_id,
            )
        _collect_unique([a.submission_id for a in self.approvals], "approval", errors)
        for a in self.approvals:
            known("approval", a.submission_id)
        if errors:
            raise ValueError("inconsistent marking record: " + "; ".join(errors))
        return self


CONTRACT_TYPES: tuple[type[Record], ...] = (
    AssessmentDetails,
    Cohort,
    Rubric,
    Brief,
    Submission,
    OriginalAssessment,
    AISuggestion,
    ModeratorJudgement,
    SubmissionVerdict,
    SubmissionMark,
    FeedbackDraft,
    Feedback,
    FeedbackGuide,
    SubmissionApproval,
    MarkingRecord,
    ModerationRequest,
    ModerationRecord,
)

__all__ = [
    "AssessmentDetails",
    "Cohort",
    "CohortSubmission",
    "SubmissionMark",
    "FeedbackDraft",
    "Feedback",
    "AcceptedFlag",
    "FeedbackGuide",
    "SubmissionApproval",
    "ProvisionalMark",
    "MarkingRecord",
    "RecordSubmission",
    "Brief",
    "ModerationRequest",
    "SampledSubmission",
    "Verdict",
    "SubmissionVerdict",
    "ReviewMode",
    "ModerationContext",
    "ImportRoute",
    "BandCount",
    "Block",
    "BlockKind",
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
    "sha256_text",
    "Submission",
    "TokenUsage",
    "Transformation",
]
