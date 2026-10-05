/**
 * Feedbacker's structured representation.
 *
 * These zod schemas are the single source of truth for Feedbacker's data
 * contract (ADR 0004). `contract/feedbacker.schema.json` is generated from
 * them, and `contract/conformance.json` keeps the Python reference models
 * compatible until they are retired. This is a port of
 * `core/src/feedbacker_core/models.py`; field names, defaults, rules and
 * error messages match it.
 *
 * Three kinds of judgement are kept deliberately separate and cannot be
 * confused:
 *
 * - `OriginalAssessment`: what the original marker awarded;
 * - `AISuggestion`: a model's second reading, which is never a decision;
 * - `ModeratorJudgement`: the moderator's own judgement, first and revised.
 *
 * Each carries a distinct `kind` discriminator, forbids unknown fields, and
 * records provenance.
 */

import * as z from "zod";
import { entryMarkProblem } from "./marks.ts";
import { pyReprFloat } from "./pytext.ts";
import { codePointLength, instant, isWellFormed, normaliseTimestamp, sha256Text } from "./text.ts";

export const SCHEMA_VERSION = "0.1.0";

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const Identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
const Pseudonym = z.string().regex(/^\[[A-Z]+_[A-Z0-9]+\]$/);
const NonEmptyText = z.string().min(1);
const NonNegativeInt = z.int().min(0);
/**
 * A timezone-aware ISO 8601 timestamp; naive timestamps are rejected. It is
 * normalised to the form the Python reference writes, so both write the same.
 */
export const Timestamp = z.iso.datetime({ offset: true }).overwrite(normaliseTimestamp);

/** A field that may be omitted or null, and is written as null. */
const optional = <T extends z.ZodType>(schema: T) => schema.nullable().default(null);

// --- Provenance ------------------------------------------------------------

export const ActorKind = z.enum(["moderator", "original_marker", "educator", "model", "system"]); // educator: marking their own cohort
export type ActorKind = z.output<typeof ActorKind>;

/** Who or what performed a step. Labels are roles, never real names. */
export const Actor = z.strictObject({
  kind: ActorKind,
  label: NonEmptyText.describe("Role label or model identifier, e.g. 'moderator' or a model ID."),
});
export type Actor = z.output<typeof Actor>;

export const Transformation = z.enum([
  "imported",
  "extracted",
  "anonymised",
  "approved",
  "entered",
  "generated",
  "recorded",
  "revised",
  "exported",
]);
export type Transformation = z.output<typeof Transformation>;

/** How a record came to exist. */
export const Provenance = z.strictObject({
  source: NonEmptyText.describe(
    "What the record was derived from, e.g. 'file:sha256:<hash>' or 'manual entry'.",
  ),
  transformation: Transformation,
  actor: Actor,
  timestamp: Timestamp,
  input_hashes: z.array(Sha256).default([]).describe("Hashes of the inputs this record depends on."),
});
export type Provenance = z.output<typeof Provenance>;

// --- Helpers ---------------------------------------------------------------

function collectUnique(values: string[], what: string, errors: string[]): void {
  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) errors.push(`duplicate ${what} '${v}'`);
    seen.add(v);
  }
}

/** Report a rule failure on the record as a whole, as a Python model validator does. */
function fail(ctx: z.core.$RefinementCtx, message: string): void {
  ctx.addIssue({ code: "custom", message });
}

// --- Rubric ----------------------------------------------------------------

/**
 * One rubric level. Use `points` for a single value (e.g. Turnitin rubrics)
 * or `min_mark`/`max_mark` for a band. `label` is kept exactly as written.
 */
export const Level = z
  .strictObject({
    id: Identifier,
    label: NonEmptyText,
    descriptor: NonEmptyText,
    points: optional(z.number().min(0)),
    min_mark: optional(z.number().min(0)),
    max_mark: optional(z.number().min(0)),
  })
  .superRefine((level, ctx) => {
    if (level.min_mark !== null && level.max_mark !== null && level.min_mark > level.max_mark) {
      fail(ctx, `level '${level.id}': min_mark ${pyNumber(level.min_mark)} exceeds max_mark ${pyNumber(level.max_mark)}`);
    }
  });
export type Level = z.output<typeof Level>;

export const Criterion = z
  .strictObject({
    id: Identifier,
    title: NonEmptyText,
    description: z.string().default(""),
    weight: optional(z.number().positive()).describe("Percentage weight."),
    max_points: optional(z.number().positive()),
    levels: z.array(Level).min(1),
  })
  .superRefine((criterion, ctx) => {
    const errors: string[] = [];
    collectUnique(criterion.levels.map((l) => l.id), `criterion '${criterion.id}' level`, errors);
    if (errors.length) fail(ctx, errors.join("; "));
  });
export type Criterion = z.output<typeof Criterion>;

export const levelIds = (criterion: Criterion): Set<string> => new Set(criterion.levels.map((l) => l.id));

export const Rubric = z
  .strictObject({
    kind: z.literal("rubric").default("rubric"),
    id: Identifier,
    version: NonEmptyText,
    title: NonEmptyText,
    criteria: z.array(Criterion).min(1),
    provenance: Provenance,
  })
  .superRefine((rubric, ctx) => {
    const errors: string[] = [];
    collectUnique(rubric.criteria.map((c) => c.id), "rubric criterion", errors);
    if (errors.length) fail(ctx, errors.join("; "));
  });
export type Rubric = z.output<typeof Rubric>;

export const criterionOf = (rubric: Rubric, criterionId: string): Criterion | undefined =>
  rubric.criteria.find((c) => c.id === criterionId);

// --- Submission ------------------------------------------------------------

export const SourceFormat = z.enum(["docx", "pdf"]);
export type SourceFormat = z.output<typeof SourceFormat>;

/**
 * Which file a submission's text comes from: `marked_view` (the marked version
 * with feedback, e.g. a Turnitin current view) or `original` (the student's
 * original file, optional and often cleaner to extract).
 */
export const SourceKind = z.enum(["marked_view", "original"]);
export type SourceKind = z.output<typeof SourceKind>;

export const BlockKind = z.enum(["heading", "paragraph", "table_row"]);
export type BlockKind = z.output<typeof BlockKind>;

/** A structural unit of extracted text; offsets index into `Extract.text` in code points. */
export const Block = z
  .strictObject({
    kind: BlockKind,
    start: NonNegativeInt,
    end: NonNegativeInt,
    level: optional(z.int().min(0)).describe("Heading level, if a heading."),
    page: optional(z.int().min(1)).describe("Page number, for PDFs."),
  })
  .superRefine((block, ctx) => {
    if (block.end < block.start) fail(ctx, `block end ${block.end} is before start ${block.start}`);
  });
export type Block = z.output<typeof Block>;

/** Text extracted locally from a source file. Never sent to a model. */
export const Extract = z
  .strictObject({
    text: z.string(),
    source_sha256: Sha256,
    blocks: z.array(Block).default([]),
    warnings: z.array(z.string()).default([]),
    provenance: Provenance,
  })
  .superRefine((extract, ctx) => {
    const length = codePointLength(extract.text);
    for (const b of extract.blocks) {
      if (b.end > length) fail(ctx, `block ${b.start}-${b.end} extends beyond the extracted text`);
    }
  });
export type Extract = z.output<typeof Extract>;

export const Redaction = z
  .strictObject({
    start: NonNegativeInt,
    end: NonNegativeInt,
    replacement: Pseudonym,
    reason: NonEmptyText,
  })
  .superRefine((r, ctx) => {
    if (r.end <= r.start) fail(ctx, `redaction end ${r.end} must be after start ${r.start}`);
  });
export type Redaction = z.output<typeof Redaction>;

/** Redacted text. Offsets in `redactions` refer to the extract text. */
export const AnonymisedText = z
  .strictObject({
    text: z.string(),
    text_sha256: Sha256,
    redactions: z.array(Redaction).default([]),
    provenance: Provenance,
  })
  .superRefine((anonymised, ctx) => {
    // Text that can't be encoded as UTF-8 can't be hashed; Python rejects it too.
    if (!isWellFormed(anonymised.text)) return fail(ctx, "anonymised text contains a lone surrogate and cannot be encoded as UTF-8");
    // The approval gate relies on this hash, so it must describe the text.
    if (sha256Text(anonymised.text) !== anonymised.text_sha256) {
      fail(ctx, "anonymised text does not match text_sha256");
    }
  });
export type AnonymisedText = z.output<typeof AnonymisedText>;

/** The explicit approval of anonymised text for the AI, by whoever works the workspace: its moderator, or the educator marking. */
export const Approval = z
  .strictObject({
    id: Identifier,
    approved_text_sha256: Sha256,
    approved_by: Actor,
    approved_at: Timestamp,
  })
  .superRefine((approval, ctx) => {
    if (approval.approved_by.kind !== "moderator" && approval.approved_by.kind !== "educator") {
      fail(ctx, "approval must be given by the moderator or the educator");
    }
  });
export type Approval = z.output<typeof Approval>;

/**
 * One sampled submission, identified only by a pseudonym. The original file
 * name is deliberately absent: it may identify the student.
 */
const submissionFields = z.strictObject({
  kind: z.literal("submission").default("submission"),
  id: Identifier,
  pseudonym: Pseudonym,
  source_kind: SourceKind,
  source_format: SourceFormat,
  source_sha256: Sha256,
  extract: optional(Extract),
  anonymised: optional(AnonymisedText),
  approval: optional(Approval),
  provenance: Provenance.describe(
    "How the submission entered the workspace (e.g. imported from a bulk download).",
  ),
});

export const Submission = submissionFields.superRefine((sub, ctx) => {
  const where = `submission '${sub.id}'`;
  if (sub.extract && sub.extract.source_sha256 !== sub.source_sha256) {
    return fail(ctx, `${where}: extract source hash does not match the submission`);
  }
  if (sub.anonymised && !sub.extract) return fail(ctx, `${where}: anonymised text requires an extract`);
  if (sub.approval) {
    if (!sub.anonymised) return fail(ctx, `${where}: approval requires anonymised text`);
    if (sub.approval.approved_text_sha256 !== sub.anonymised.text_sha256) {
      fail(ctx, `${where}: approval does not match the anonymised text hash`);
    }
  }
});
export type Submission = z.output<typeof Submission>;

/**
 * A submission as a moderation record carries it: without its extract. The
 * extract is the original text, which may name the student; a record is
 * pseudonymous, so it carries only the approved anonymised text, its
 * redactions and its approval, which stand without the extract (maintainer
 * decision, 2026-09-27).
 */
export const RecordSubmission = submissionFields
  .extend({
    // Null in the schema too, so a schema-only consumer can't accept a record carrying the original text.
    extract: z.null({ error: "a moderation record carries no extract (the original text)" }).default(null),
    listed_band: optional(z.string()).describe("The grade band the request listed it under, as written."),
  })
  .superRefine((sub, ctx) => {
    const where = `submission '${sub.id}'`;
    if (sub.approval) {
      if (!sub.anonymised) return fail(ctx, `${where}: approval requires anonymised text`);
      if (sub.approval.approved_text_sha256 !== sub.anonymised.text_sha256) {
        fail(ctx, `${where}: approval does not match the anonymised text hash`);
      }
    }
  });
export type RecordSubmission = z.output<typeof RecordSubmission>;

// --- Assessment brief ------------------------------------------------------

/**
 * The assessment brief. Confidential assessment material, not student data.
 * It follows the submission pipeline: extracted locally, redacted (staff
 * names and contact details), and explicitly approved by the moderator before
 * it may be given to a model (maintainer decision, 2026-09-25).
 */
export const Brief = z
  .strictObject({
    kind: z.literal("brief").default("brief"),
    source_format: SourceFormat,
    source_sha256: Sha256,
    extract: Extract,
    anonymised: optional(AnonymisedText),
    approval: optional(Approval),
    provenance: Provenance,
  })
  .superRefine((brief, ctx) => {
    if (brief.extract.source_sha256 !== brief.source_sha256) {
      return fail(ctx, "brief: extract source hash does not match the brief");
    }
    if (brief.approval) {
      if (!brief.anonymised) return fail(ctx, "brief: approval requires anonymised text");
      if (brief.approval.approved_text_sha256 !== brief.anonymised.text_sha256) {
        fail(ctx, "brief: approval does not match the anonymised text hash");
      }
    }
  });
export type Brief = z.output<typeof Brief>;

// --- Original marker -------------------------------------------------------

/**
 * The marker's mark for one criterion. `raw_label` and `raw_score` keep the
 * marker's wording exactly as found (e.g. "2:2 (68)", "68 / 100"). `level_id`
 * is null when it could not be mapped to a rubric level; that is a valid
 * state, never guessed.
 */
export const OriginalCriterionMark = z.strictObject({
  criterion_id: Identifier,
  level_id: optional(Identifier),
  mark: optional(z.number().min(0)),
  raw_criterion: optional(z.string()).describe("The criterion's name in the marker's system, as written."),
  raw_label: optional(z.string()),
  raw_score: optional(z.string()),
  comment: optional(z.string()),
});
export type OriginalCriterionMark = z.output<typeof OriginalCriterionMark>;

/**
 * An inline comment the marker attached to a passage of the work. Positions
 * are approximate: `page` is the page of the marked report, and `position` is
 * the marker's height on that page (0 = top, 1 = bottom). `anchor_text` is
 * only ever an approximate match, never presented as exact.
 */
export const Annotation = z.strictObject({
  text: NonEmptyText,
  number: optional(z.int().min(1)).describe("The marker's comment number."),
  criterion_label: optional(z.string()).describe("The criterion tag on the comment, as written."),
  anchor_text: optional(z.string()).describe("An approximate passage the comment refers to, if known."),
  page: optional(z.int().min(1)),
  position: optional(z.number().min(0).max(1)),
});
export type Annotation = z.output<typeof Annotation>;

export const ImportRoute = z.enum([
  "turnitin_bulk_zip",
  "turnitin_current_view",
  "canvas_rubric",
  "spreadsheet",
  "manual",
]);
export type ImportRoute = z.output<typeof ImportRoute>;

/** What an original marker awarded. Never sent to a model. */
export const OriginalAssessment = z
  .strictObject({
    kind: z.literal("original_assessment").default("original_assessment"),
    submission_id: Identifier,
    marker_label: NonEmptyText.default("marker").describe(
      "Role label, e.g. 'first marker' or 'agreed'; never a name.",
    ),
    import_route: ImportRoute,
    criterion_marks: z.array(OriginalCriterionMark).default([]),
    overall_mark: optional(z.number().min(0)),
    raw_overall: optional(z.string()),
    raw_rubric_total: optional(z.string()).describe(
      "The marker's rubric total exactly as written, if separate.",
    ),
    overall_comment: optional(z.string()),
    annotations: z.array(Annotation).default([]),
    import_notes: z
      .array(z.string())
      .default([])
      .describe(
        "Things found on import for the moderator to judge, e.g. a selected level that disagrees " +
          "with the awarded score, or a criterion that could not be mapped.",
      ),
    unmapped_criteria: z
      .array(z.string())
      .default([])
      .describe("The marker's criterion names this import could not map to the source rubric, exactly as written."),
    confirmed_by: optional(Actor),
    confirmed_at: optional(Timestamp),
    provenance: Provenance,
  })
  .superRefine((a, ctx) => {
    if ((a.confirmed_by === null) !== (a.confirmed_at === null)) {
      return fail(ctx, "confirmation needs both confirmed_by and confirmed_at");
    }
    if (a.confirmed_by && a.confirmed_by.kind !== "moderator") {
      return fail(ctx, "original assessment must be confirmed by the moderator");
    }
    const errors: string[] = [];
    collectUnique(
      a.criterion_marks.map((m) => m.criterion_id),
      `original assessment '${a.submission_id}' criterion`,
      errors,
    );
    if (errors.length) return fail(ctx, errors.join("; "));
    if (a.provenance.actor.kind !== "original_marker" && a.provenance.actor.kind !== "moderator") {
      fail(ctx, "original assessment must be recorded from the original marker or entered by the moderator");
    }
  });
export type OriginalAssessment = z.output<typeof OriginalAssessment>;

// --- AI suggestion ---------------------------------------------------------

export const ProducedBy = z.enum(["live", "batch", "cache"]);
export type ProducedBy = z.output<typeof ProducedBy>;

export const TokenUsage = z.strictObject({
  input_tokens: NonNegativeInt.default(0),
  output_tokens: NonNegativeInt.default(0),
  cache_read_tokens: NonNegativeInt.default(0),
  cache_write_tokens: NonNegativeInt.default(0),
});
export type TokenUsage = z.output<typeof TokenUsage>;

/** Provenance for one model call (ADR 0003). */
export const ModelCall = z
  .strictObject({
    provider: NonEmptyText,
    model_requested: NonEmptyText,
    model_reported: optional(z.string()),
    request_id: optional(z.string()),
    prompt_version: NonEmptyText,
    rubric_version: NonEmptyText,
    approval_id: Identifier,
    approved_text_sha256: Sha256,
    brief_approval_id: optional(Identifier).describe(
      "The approved brief included in the request, if any.",
    ),
    brief_sha256: optional(Sha256),
    fallback_from: optional(z.string()).describe(
      "The model that declined, when this call is the recorded fallback.",
    ),
    request_sha256: Sha256,
    response_sha256: optional(Sha256),
    stop_reason: optional(z.string()),
    usage: TokenUsage.default(() => TokenUsage.parse({})),
    produced_by: ProducedBy,
    cached_from_request_id: optional(z.string()),
    timestamp: Timestamp,
    error: optional(z.string()),
  })
  .superRefine((call, ctx) => {
    if ((call.brief_approval_id === null) !== (call.brief_sha256 === null)) {
      return fail(ctx, "a brief in the call needs both brief_approval_id and brief_sha256");
    }
    if (call.produced_by === "cache" && !call.cached_from_request_id) {
      fail(ctx, "a cached result must link to the originating request");
    }
  });
export type ModelCall = z.output<typeof ModelCall>;

export const EvidenceQuote = z.strictObject({
  text: NonEmptyText,
  verified: z
    .boolean()
    .describe("True only if the quote was found verbatim in the approved anonymised text."),
  start: optional(NonNegativeInt),
  end: optional(NonNegativeInt),
});
export type EvidenceQuote = z.output<typeof EvidenceQuote>;

/** A model's second reading for one criterion. A suggestion, never a mark. */
export const AISuggestion = z
  .strictObject({
    kind: z.literal("ai_suggestion").default("ai_suggestion"),
    id: Identifier,
    submission_id: Identifier,
    criterion_id: Identifier,
    suggested_level_id: optional(Identifier).describe("Null when the model could not suggest a level."),
    rationale: z.string().default(""),
    evidence: z.array(EvidenceQuote).default([]),
    draft_comment: optional(z.string()),
    missing_evidence: z.boolean().default(false),
    call: ModelCall,
    provenance: Provenance,
  })
  .superRefine((s, ctx) => {
    if (s.provenance.actor.kind !== "model") fail(ctx, "an AI suggestion's provenance actor must be a model");
  });
export type AISuggestion = z.output<typeof AISuggestion>;

// --- Moderator judgement ---------------------------------------------------

export const ReviewMode = z.enum(["open", "blind"]);
export type ReviewMode = z.output<typeof ReviewMode>;

export const JudgementEntry = z.strictObject({
  level_id: Identifier,
  mark: optional(z.number().min(0)).describe("The moderator's mark for the criterion, within the level: its points unless moved. Null in a judgement recorded before marks, which counts as the level's points."),
  comment: optional(z.string()),
  comment_derived_from_ai: z.boolean().default(false).describe("True if the comment was adapted from an AI draft."),
  level_from_suggestion: optional(Identifier).describe("The id of the AI suggestion whose level was taken, unchanged; null if the level is the moderator's own."),
  recorded_at: Timestamp,
});
export type JudgementEntry = z.output<typeof JudgementEntry>;

/**
 * The moderator's own judgement for one criterion.
 *
 * In `open` review (the default, matching usual moderation practice) the
 * original marks, comments, and AI reading are visible throughout, and only
 * `first` is recorded.
 *
 * In `blind` review, `first` is recorded before the original marks and AI
 * reading are revealed; `revised` is optional and recorded after the reveal.
 * Both are kept.
 */
export const ModeratorJudgement = z
  .strictObject({
    kind: z.literal("moderator_judgement").default("moderator_judgement"),
    submission_id: Identifier,
    criterion_id: Identifier,
    mode: ReviewMode.default("open"),
    first: JudgementEntry,
    revealed_at: optional(Timestamp),
    revised: optional(JudgementEntry),
    provenance: Provenance,
    revised_provenance: optional(Provenance).describe("What the revision was made against; `provenance` stays the first judgement's. Null in a revision recorded before it existed."),
  })
  .superRefine((j, ctx) => {
    // Made by whoever works the workspace: its moderator, or the educator marking.
    if (j.provenance.actor.kind !== "moderator" && j.provenance.actor.kind !== "educator") {
      return fail(ctx, "a judgement's provenance actor must be the moderator or the educator");
    }
    const where = `judgement '${j.submission_id}/${j.criterion_id}'`;
    if (j.revised_provenance) {
      if (!j.revised) return fail(ctx, `${where}: revised provenance without a revision`);
      if (j.revised_provenance.actor.kind !== j.provenance.actor.kind) return fail(ctx, `${where}: a revision must be made by whoever made the judgement`);
    }
    if (j.mode === "open") {
      if (j.revealed_at || j.revised) fail(ctx, `${where}: open review has no reveal or revision`);
      return;
    }
    // A null instant means a timestamp already failed its own check.
    const first = instant(j.first.recorded_at);
    const revealed = j.revealed_at === null ? null : instant(j.revealed_at);
    if (first !== null && revealed !== null && first >= revealed) {
      return fail(ctx, `${where}: first judgement must be recorded before the reveal`);
    }
    if (j.revised) {
      if (!j.revealed_at) return fail(ctx, `${where}: a revision is only possible after the reveal`);
      const revised = instant(j.revised.recorded_at);
      if (revised !== null && revealed !== null && revised <= revealed) {
        fail(ctx, `${where}: revision must be recorded after the reveal`);
      }
    }
  });
export type ModeratorJudgement = z.output<typeof ModeratorJudgement>;

// --- Submission verdict ----------------------------------------------------

export const Verdict = z.enum(["agree", "generous", "harsh", "inconsistent"]);
export type Verdict = z.output<typeof Verdict>;

/** The moderator's overall view of how one submission was marked. */
export const SubmissionVerdict = z
  .strictObject({
    kind: z.literal("submission_verdict").default("submission_verdict"),
    submission_id: Identifier,
    verdict: Verdict,
    suggested_mark: optional(z.number().min(0)),
    criteria_mark: optional(z.number().min(0)).describe("The overall mark the moderator's criterion marks implied when the verdict was recorded; null if it couldn't be worked out."),
    comment: optional(z.string()),
    provenance: Provenance,
  })
  .superRefine((v, ctx) => {
    if (v.provenance.actor.kind !== "moderator") {
      fail(ctx, "a submission verdict's provenance actor must be the moderator");
    }
  });
export type SubmissionVerdict = z.output<typeof SubmissionVerdict>;

/** The educator's overall mark and comment for one submission they mark. */
export const SubmissionMark = z
  .strictObject({
    kind: z.literal("submission_mark").default("submission_mark"),
    submission_id: Identifier,
    mark: z.number().min(0).describe("The educator's overall mark."),
    criteria_mark: optional(z.number().min(0)).describe("The overall mark the educator's criterion marks implied when it was recorded; null if it couldn't be worked out."),
    comment: optional(z.string()).describe("The overall comment, anonymised."),
    provenance: Provenance,
  })
  .superRefine((m, ctx) => {
    if (m.provenance.actor.kind !== "educator") fail(ctx, "a submission's mark must be given by the educator");
  });
export type SubmissionMark = z.output<typeof SubmissionMark>;

/**
 * The AI's draft of feedback for one criterion, or the overall summary (no criterion), drafted from the educator's
 * own marks and comments (ADR 0006), or, as a suggested edit, from their recorded feedback and the checks' flags on it.
 * A draft, never feedback: the educator adapts it, or writes their own.
 */
export const FeedbackDraft = z
  .strictObject({
    kind: z.literal("feedback_draft").default("feedback_draft"),
    id: Identifier,
    submission_id: Identifier,
    criterion_id: optional(Identifier).describe("Null for the overall summary."),
    text: NonEmptyText,
    drafted_from: Sha256.describe("A digest of the educator's marking it was drafted from: the criterion's level, mark and comment, or, for the overall summary, every criterion's and the overall mark and comment."),
    guide_version: optional(z.int().min(1)).describe("The version of the educator's feedback guide sent with it; null if none was."),
    edited_from: optional(Sha256).describe("For a suggested edit: the SHA-256 of the educator's recorded feedback it edits, sent with the checks' flags on it; null for a draft."),
    call: ModelCall,
    provenance: Provenance,
  })
  .superRefine((d, ctx) => {
    if (d.provenance.actor.kind !== "model") fail(ctx, "a feedback draft's provenance actor must be a model");
    if (d.edited_from !== null && d.guide_version !== null) fail(ctx, "a suggested edit is sent no feedback guide");
  });
export type FeedbackDraft = z.output<typeof FeedbackDraft>;

/**
 * The educator's feedback guide for the assessment: what each level of each criterion typically needs to hear, and
 * the common next steps. It is sent with every drafting request once approved, so drafts start from the same place.
 */
export const FeedbackGuide = z
  .strictObject({
    kind: z.literal("feedback_guide").default("feedback_guide"),
    version: z.int().min(1).describe("Raised each time the guide is saved."),
    text: NonEmptyText.describe("Anonymised, as the educator's comments are."),
    text_sha256: Sha256,
    approval: optional(Approval).describe("The educator's approval of exactly this text for the AI; null until given."),
    provenance: Provenance,
  })
  .superRefine((g, ctx) => {
    if (g.provenance.actor.kind !== "educator") fail(ctx, "a feedback guide must be written by the educator");
    if (sha256Text(g.text) !== g.text_sha256) fail(ctx, "the guide's text does not match text_sha256");
    if (g.approval && g.approval.approved_text_sha256 !== g.text_sha256) fail(ctx, "the guide's approval is of other text");
    if (g.approval && g.approval.approved_by.kind !== "educator") fail(ctx, "a feedback guide must be approved by the educator");
  });
export type FeedbackGuide = z.output<typeof FeedbackGuide>;

/** A check's flag the educator accepted for this text, with their reason: flags are never blocks. */
export const AcceptedFlag = z.strictObject({
  check: z.enum(["praise", "next_step", "other_mark", "token", "cut_off"]).describe("Which check raised it: praise above the mark's band, no next step, another mark or level named, an anonymised value (a token) the student would see, or text that ends mid-sentence."),
  detail: NonEmptyText.describe("What it found, e.g. the word or the mark named."),
  reason: NonEmptyText.describe("Why the educator keeps the text as it is."),
});
export type AcceptedFlag = z.output<typeof AcceptedFlag>;

/** The educator's feedback to the student on one criterion, or overall (no criterion): their own, or adapted from an AI draft. */
export const Feedback = z
  .strictObject({
    kind: z.literal("feedback").default("feedback"),
    submission_id: Identifier,
    criterion_id: optional(Identifier).describe("Null for the overall feedback."),
    text: NonEmptyText.describe("Anonymised, as the educator's comments are."),
    derived_from_ai: z.boolean().default(false).describe("True if it was adapted from an AI draft, however much it was changed."),
    from_draft: optional(Identifier).describe("The draft it was adapted from, when it was."),
    given_on: Sha256.describe("A digest of the educator's marking it was given on, as a draft's `drafted_from`."),
    accepted_flags: z.array(AcceptedFlag).default([]).describe("The checks' flags the educator accepted for this text, each with a reason; recording new text clears them."),
    provenance: Provenance,
  })
  .superRefine((f, ctx) => {
    if (f.provenance.actor.kind !== "educator") fail(ctx, "feedback must be given by the educator");
    if (f.from_draft !== null && !f.derived_from_ai) fail(ctx, "feedback adapted from a draft is derived from the AI");
  });
export type Feedback = z.output<typeof Feedback>;

// --- Moderation context ----------------------------------------------------

export const BandCount = z.strictObject({ label: NonEmptyText, count: NonNegativeInt });
export type BandCount = z.output<typeof BandCount>;

/** Module-level context from the moderation request. Roles only, never names. */
export const ModerationContext = z.strictObject({
  programme: optional(z.string()).describe("Programme title, as written."),
  module: optional(z.string()).describe("Module title and code, as written."),
  staff_roles: z
    .array(NonEmptyText)
    .default([])
    .describe("Roles involved, e.g. 'module convener', 'marker'. Never names."),
  cohort_size: optional(NonNegativeInt),
  multiple_groups: optional(z.boolean()),
  band_distribution: z.array(BandCount).default([]).describe("Marked assessments per band, as reported."),
  sample_note: optional(z.string()).describe("How the sample was chosen."),
  provenance: Provenance.describe(
    "Where these values came from, e.g. entered from the moderation request.",
  ),
});
export type ModerationContext = z.output<typeof ModerationContext>;

// --- Moderation request ----------------------------------------------------

/**
 * One sampled submission, identified only by its pseudonymous ID. The external
 * identifier (e.g. a Turnitin submission ID) lives only in the pseudonym key.
 */
export const SampledSubmission = z.strictObject({
  submission_id: Identifier,
  pseudonym: Pseudonym,
  listed_band: optional(z.string()).describe("The grade band the request listed it under, as written."),
});
export type SampledSubmission = z.output<typeof SampledSubmission>;

/** What the commissioning body asked to be moderated. */
export const ModerationRequest = z
  .strictObject({
    kind: z.literal("moderation_request").default("moderation_request"),
    context: ModerationContext,
    sample: z.array(SampledSubmission).min(1),
    provenance: Provenance,
  })
  .superRefine((request, ctx) => {
    const errors: string[] = [];
    collectUnique(request.sample.map((s) => s.submission_id), "sampled submission", errors);
    collectUnique(request.sample.map((s) => s.pseudonym), "sampled pseudonym", errors);
    if (errors.length) fail(ctx, "invalid moderation request: " + errors.join("; "));
  });
export type ModerationRequest = z.output<typeof ModerationRequest>;

// --- Moderation record -----------------------------------------------------

/** Everything for one moderation, self-contained and pseudonymous. */
export const ModerationRecord = z
  .strictObject({
    kind: z.literal("moderation_record").default("moderation_record"),
    schema_version: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
    id: Identifier,
    context: optional(ModerationContext),
    rubric: Rubric,
    submissions: z.array(RecordSubmission).min(1),
    original_assessments: z.array(OriginalAssessment).default([]),
    ai_suggestions: z.array(AISuggestion).default([]),
    judgements: z.array(ModeratorJudgement).default([]),
    verdicts: z.array(SubmissionVerdict).default([]),
    overall_comment: optional(z.string()),
    approved_by: optional(Actor),
    approved_at: optional(Timestamp),
    provenance: Provenance,
  })
  .superRefine((record, ctx) => {
    const errors: string[] = [];
    collectUnique(record.submissions.map((s) => s.id), "submission", errors);
    collectUnique(record.submissions.map((s) => s.pseudonym), "submission pseudonym", errors);
    const submissions = new Map(record.submissions.map((s) => [s.id, s]));

    const check = (where: string, submissionId: string, criterionId: string, ...levels: (string | null)[]) => {
      if (!submissions.has(submissionId)) errors.push(`${where}: unknown submission '${submissionId}'`);
      const criterion = criterionOf(record.rubric, criterionId);
      if (!criterion) {
        errors.push(`${where}: unknown criterion '${criterionId}'`);
        return;
      }
      const ids = levelIds(criterion);
      for (const level of levels) {
        if (level !== null && !ids.has(level)) {
          errors.push(`${where}: level '${level}' is not a level of criterion '${criterionId}'`);
        }
      }
    };

    collectUnique(
      record.original_assessments.map((a) => `${a.submission_id}/${a.marker_label}`),
      "original assessment",
      errors,
    );
    for (const a of record.original_assessments) {
      if (!submissions.has(a.submission_id)) {
        errors.push(`original assessment: unknown submission '${a.submission_id}'`);
      }
      for (const m of a.criterion_marks) {
        check(`original assessment '${a.submission_id}'`, a.submission_id, m.criterion_id, m.level_id);
      }
    }

    collectUnique(record.ai_suggestions.map((s) => s.id), "AI suggestion", errors);
    for (const s of record.ai_suggestions) {
      const where = `AI suggestion '${s.id}'`;
      check(where, s.submission_id, s.criterion_id, s.suggested_level_id);
      if (s.call.rubric_version !== record.rubric.version) {
        errors.push(`${where}: rubric version '${s.call.rubric_version}' does not match '${record.rubric.version}'`);
      }
      const sub = submissions.get(s.submission_id);
      if (sub) {
        if (!sub.approval) errors.push(`${where}: submission '${sub.id}' has no approval`);
        else if (
          s.call.approval_id !== sub.approval.id ||
          s.call.approved_text_sha256 !== sub.approval.approved_text_sha256
        ) {
          errors.push(`${where}: call does not match the submission's approval`);
        }
      }
    }

    collectUnique(
      record.judgements.map((j) => `${j.submission_id}/${j.criterion_id}`),
      "moderator judgement",
      errors,
    );
    for (const j of record.judgements) {
      const where = `judgement '${j.submission_id}/${j.criterion_id}'`;
      check(where, j.submission_id, j.criterion_id, j.first.level_id, j.revised ? j.revised.level_id : null);
      // Each mark must fit its level on the record's rubric.
      const criterion = criterionOf(record.rubric, j.criterion_id);
      for (const entry of [j.first, j.revised]) {
        const problem = criterion && entry ? entryMarkProblem(criterion, entry) : null;
        if (problem) errors.push(`${where}: ${problem}`);
      }
    }

    collectUnique(record.verdicts.map((v) => v.submission_id), "submission verdict", errors);
    for (const v of record.verdicts) {
      if (!submissions.has(v.submission_id)) errors.push(`submission verdict: unknown submission '${v.submission_id}'`);
    }

    if ((record.approved_by === null) !== (record.approved_at === null)) {
      errors.push("record approval needs both approved_by and approved_at");
    }
    if (record.approved_by && record.approved_by.kind !== "moderator") {
      errors.push("record must be approved by the moderator");
    }

    if (errors.length) fail(ctx, "invalid moderation record:\n- " + errors.join("\n- "));
  });
export type ModerationRecord = z.output<typeof ModerationRecord>;


// --- The contract ----------------------------------------------------------

/** The top-level record types, each with a distinct `kind`. */
// --- Assessment (marking) -----------------------------------------------------

/** What a marking workspace is marking: the assessment, as the educator enters it. Nothing in it identifies a student. */
export const AssessmentDetails = z.strictObject({
  kind: z.literal("assessment").default("assessment"),
  title: NonEmptyText.describe("The assessment's title, as written, e.g. 'Coursework 1: a web application'."),
  module: optional(z.string()).describe("Module title and code, as written."),
  programme: optional(z.string()).describe("Programme title, as written."),
  provenance: Provenance.describe("Where these values came from, e.g. entered by the educator."),
});
export type AssessmentDetails = z.output<typeof AssessmentDetails>;

/** One submission in a marking workspace's cohort, identified only by its pseudonymous ID; its real ID and name are only in the pseudonym key. */
export const CohortSubmission = z.strictObject({
  submission_id: Identifier,
  pseudonym: Pseudonym,
});
export type CohortSubmission = z.output<typeof CohortSubmission>;

/** Every submission a marking workspace marks, imported from the marking platform's bulk download: the whole cohort, not a sample. */
export const Cohort = z
  .strictObject({
    kind: z.literal("cohort").default("cohort"),
    submissions: z.array(CohortSubmission).min(1),
    provenance: Provenance.describe("The latest import that added to the cohort."),
  })
  .superRefine((cohort, ctx) => {
    const errors: string[] = [];
    collectUnique(cohort.submissions.map((s) => s.submission_id), "cohort submission", errors);
    collectUnique(cohort.submissions.map((s) => s.pseudonym), "cohort pseudonym", errors);
    if (errors.length) fail(ctx, "invalid cohort: " + errors.join("; "));
  });
export type Cohort = z.output<typeof Cohort>;

/**
 * The educator's approval of exactly what one student will receive: every criterion's mark and feedback, and the
 * overall mark and feedback, as exported (and the flags accepted on them). A later change to any of it clears it.
 */
export const SubmissionApproval = z
  .strictObject({
    kind: z.literal("submission_approval").default("submission_approval"),
    submission_id: Identifier,
    content_sha256: Sha256.describe("A digest of what the student will receive, as it was approved."),
    approved_by: Actor,
    approved_at: Timestamp,
  })
  .superRefine((a, ctx) => {
    if (a.approved_by.kind !== "educator") fail(ctx, "a submission's marks and feedback must be approved by the educator");
  });
export type SubmissionApproval = z.output<typeof SubmissionApproval>;

/** The provisional mark the AI's proposed levels implied for a submission (never a mark), or why there was none. */
export const ProvisionalMark = z.strictObject({
  submission_id: Identifier,
  mark: optional(z.number().min(0)),
  why_none: optional(z.string()).describe("Why no provisional mark could be worked out, when none could."),
});
export type ProvisionalMark = z.output<typeof ProvisionalMark>;

/**
 * Everything for one marked cohort, self-contained and pseudonymous: the assessment, rubric, cohort and feedback
 * guide; for each approved submission, the AI's proposals and the provisional mark they implied, the educator's
 * marks and comments, the AI's feedback drafts and suggested edits, the educator's feedback (with whether each was adapted from a draft),
 * and the approval, each with where it came from.
 */
export const MarkingRecord = z.strictObject({
  kind: z.literal("marking_record").default("marking_record"),
  schema_version: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  id: Identifier,
  assessment: optional(AssessmentDetails),
  rubric: Rubric,
  cohort: Cohort,
  guide: optional(FeedbackGuide),
  ai_suggestions: z.array(AISuggestion).default([]),
  provisional_marks: z.array(ProvisionalMark).default([]),
  judgements: z.array(ModeratorJudgement).default([]),
  marks: z.array(SubmissionMark).default([]),
  drafts: z.array(FeedbackDraft).default([]),
  suggestions: z.array(FeedbackDraft).default([]).describe("The AI's suggested edits to the educator's feedback, each naming the feedback it edits; any number for a criterion."),
  feedback: z.array(Feedback).default([]),
  approvals: z.array(SubmissionApproval).default([]),
  exported_at: Timestamp,
}).superRefine((record, ctx) => {
  // Internally consistent, as a moderation record is: nothing twice, and nothing about a submission outside the cohort
  // or a criterion (or level) outside the rubric.
  const errors: string[] = [];
  const submissions = new Set(record.cohort.submissions.map((s) => s.submission_id));
  const known = (where: string, submissionId: string) => {
    if (!submissions.has(submissionId)) errors.push(`${where}: unknown submission '${submissionId}'`);
  };
  const check = (where: string, submissionId: string, criterionId: string | null, ...levels: (string | null)[]) => {
    known(where, submissionId);
    if (criterionId === null) return;
    const criterion = criterionOf(record.rubric, criterionId);
    if (!criterion) return void errors.push(`${where}: unknown criterion '${criterionId}'`);
    const ids = levelIds(criterion);
    for (const level of levels) if (level !== null && !ids.has(level)) errors.push(`${where}: level '${level}' is not a level of criterion '${criterionId}'`);
  };
  collectUnique(record.ai_suggestions.map((s) => s.id), "AI suggestion", errors);
  for (const s of record.ai_suggestions) check(`AI suggestion '${s.id}'`, s.submission_id, s.criterion_id, s.suggested_level_id);
  collectUnique(record.provisional_marks.map((p) => p.submission_id), "provisional mark", errors);
  for (const p of record.provisional_marks) known("provisional mark", p.submission_id);
  collectUnique(record.judgements.map((j) => `${j.submission_id}/${j.criterion_id}`), "judgement", errors);
  for (const j of record.judgements) check(`judgement '${j.submission_id}/${j.criterion_id}'`, j.submission_id, j.criterion_id, j.first.level_id, j.revised?.level_id ?? null);
  collectUnique(record.marks.map((m) => m.submission_id), "overall mark", errors);
  for (const m of record.marks) known("overall mark", m.submission_id);
  collectUnique(record.drafts.map((d) => d.id), "feedback draft", errors);
  collectUnique(record.drafts.map((d) => `${d.submission_id}/${d.criterion_id ?? "overall"}`), "feedback draft of a criterion", errors);
  for (const d of record.drafts) {
    check(`feedback draft '${d.id}'`, d.submission_id, d.criterion_id);
    if (d.edited_from !== null) errors.push(`feedback draft '${d.id}': a suggested edit belongs in suggestions`);
  }
  collectUnique([...record.drafts, ...record.suggestions].map((d) => d.id), "draft or suggested edit", errors);
  for (const d of record.suggestions) {
    check(`suggested edit '${d.id}'`, d.submission_id, d.criterion_id);
    if (d.edited_from === null) errors.push(`suggested edit '${d.id}': it doesn't name the feedback it edits`);
  }
  collectUnique(record.feedback.map((f) => `${f.submission_id}/${f.criterion_id ?? "overall"}`), "feedback", errors);
  for (const f of record.feedback) check(`feedback '${f.submission_id}/${f.criterion_id ?? "overall"}'`, f.submission_id, f.criterion_id);
  collectUnique(record.approvals.map((a) => a.submission_id), "approval", errors);
  for (const a of record.approvals) known("approval", a.submission_id);
  if (errors.length) fail(ctx, "inconsistent marking record: " + errors.join("; "));
});
export type MarkingRecord = z.output<typeof MarkingRecord>;

export const CONTRACT_TYPES = {
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
} as const;
export type ContractTypeName = keyof typeof CONTRACT_TYPES;

/** Python's `str(float)`, for messages that quote numbers (e.g. "70.0"). */
const pyNumber = pyReprFloat;
