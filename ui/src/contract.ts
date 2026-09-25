/* Generated from contract/feedbacker.schema.json by `npm run contract`. Do not edit by hand. */

/**
 * Generated from core/src/feedbacker_core/models.py. Do not edit by hand.
 */
export type FeedbackerContract =
  | Rubric
  | Brief
  | Submission
  | OriginalAssessment
  | AISuggestion
  | ModeratorJudgement
  | SubmissionVerdict
  | ModerationRequest
  | ModerationRecord;
export type ActorKind = "moderator" | "original_marker" | "model" | "system";
export type Transformation =
  "imported" | "extracted" | "anonymised" | "approved" | "entered" | "generated" | "recorded" | "revised" | "exported";
export type BlockKind = "heading" | "paragraph" | "table_row";
export type SourceFormat = "docx" | "pdf";
/**
 * Which file a submission's text comes from.
 */
export type SourceKind = "marked_view" | "original";
export type ImportRoute = "turnitin_bulk_zip" | "turnitin_current_view" | "canvas_rubric" | "spreadsheet" | "manual";
export type ProducedBy = "live" | "batch" | "cache";
export type ReviewMode = "open" | "blind";
export type Verdict = "agree" | "generous" | "harsh" | "inconsistent";

export interface Rubric {
  /**
   * @minItems 1
   */
  criteria: [Criterion, ...Criterion[]];
  id: string;
  kind?: "rubric";
  provenance: Provenance;
  title: string;
  version: string;
}
export interface Criterion {
  description?: string;
  id: string;
  /**
   * @minItems 1
   */
  levels: [Level, ...Level[]];
  max_points?: number | null;
  title: string;
  /**
   * Percentage weight.
   */
  weight?: number | null;
}
/**
 * One rubric level. Use ``points`` for a single value (e.g. Turnitin rubrics)
 * or ``min_mark``/``max_mark`` for a band. ``label`` is kept exactly as written.
 */
export interface Level {
  descriptor: string;
  id: string;
  label: string;
  max_mark?: number | null;
  min_mark?: number | null;
  points?: number | null;
}
/**
 * How a record came to exist.
 */
export interface Provenance {
  actor: Actor;
  /**
   * Hashes of the inputs this record depends on.
   */
  input_hashes?: string[];
  /**
   * What the record was derived from, e.g. 'file:sha256:<hash>' or 'manual entry'.
   */
  source: string;
  timestamp: string;
  transformation: Transformation;
}
/**
 * Who or what performed a step. Labels are roles, never real names.
 */
export interface Actor {
  kind: ActorKind;
  /**
   * Role label or model identifier, e.g. 'moderator' or a model ID.
   */
  label: string;
}
/**
 * The assessment brief. Confidential assessment material, not student data.
 *
 * It follows the submission pipeline: extracted locally, redacted (staff
 * names and contact details), and explicitly approved by the moderator before
 * it may be given to a model (maintainer decision, 2026-09-25).
 */
export interface Brief {
  anonymised?: AnonymisedText | null;
  approval?: Approval | null;
  extract: Extract;
  kind?: "brief";
  provenance: Provenance;
  source_format: SourceFormat;
  source_sha256: string;
}
/**
 * Redacted text. Offsets in ``redactions`` refer to the extract text.
 */
export interface AnonymisedText {
  provenance: Provenance;
  redactions?: Redaction[];
  text: string;
  text_sha256: string;
}
export interface Redaction {
  end: number;
  reason: string;
  replacement: string;
  start: number;
}
/**
 * The moderator's explicit approval of anonymised text for model use.
 */
export interface Approval {
  approved_at: string;
  approved_by: Actor;
  approved_text_sha256: string;
  id: string;
}
/**
 * Text extracted locally from a source file. Never sent to a model.
 */
export interface Extract {
  blocks?: Block[];
  provenance: Provenance;
  source_sha256: string;
  text: string;
  warnings?: string[];
}
/**
 * A structural unit of extracted text; offsets index into ``Extract.text``.
 */
export interface Block {
  end: number;
  kind: BlockKind;
  /**
   * Heading level, if a heading.
   */
  level?: number | null;
  /**
   * Page number, for PDFs.
   */
  page?: number | null;
  start: number;
}
/**
 * One sampled submission, identified only by a pseudonym.
 *
 * The original file name is deliberately absent: it may identify the student.
 */
export interface Submission {
  anonymised?: AnonymisedText | null;
  approval?: Approval | null;
  extract?: Extract | null;
  id: string;
  kind?: "submission";
  provenance: Provenance1;
  pseudonym: string;
  source_format: SourceFormat;
  source_kind: SourceKind;
  source_sha256: string;
}
/**
 * How a record came to exist.
 */
export interface Provenance1 {
  actor: Actor;
  /**
   * Hashes of the inputs this record depends on.
   */
  input_hashes?: string[];
  /**
   * What the record was derived from, e.g. 'file:sha256:<hash>' or 'manual entry'.
   */
  source: string;
  timestamp: string;
  transformation: Transformation;
}
/**
 * What an original marker awarded. Never sent to a model.
 */
export interface OriginalAssessment {
  annotations?: Annotation[];
  confirmed_at?: string | null;
  confirmed_by?: Actor | null;
  criterion_marks?: OriginalCriterionMark[];
  /**
   * Things found on import for the moderator to judge, e.g. a selected level that disagrees with the awarded score, or a criterion that could not be mapped.
   */
  import_notes?: string[];
  import_route: ImportRoute;
  kind?: "original_assessment";
  /**
   * Role label, e.g. 'first marker' or 'agreed'; never a name.
   */
  marker_label?: string;
  overall_comment?: string | null;
  overall_mark?: number | null;
  provenance: Provenance;
  raw_overall?: string | null;
  /**
   * The marker's rubric total exactly as written, if separate.
   */
  raw_rubric_total?: string | null;
  submission_id: string;
}
/**
 * An inline comment the marker attached to a passage of the work.
 *
 * Positions are approximate: ``page`` is the page of the marked report, and
 * ``position`` is the marker's height on that page (0 = top, 1 = bottom).
 * ``anchor_text`` is only ever an approximate match, never presented as exact.
 */
export interface Annotation {
  /**
   * An approximate passage the comment refers to, if known.
   */
  anchor_text?: string | null;
  /**
   * The criterion tag on the comment, as written.
   */
  criterion_label?: string | null;
  /**
   * The marker's comment number.
   */
  number?: number | null;
  page?: number | null;
  position?: number | null;
  text: string;
}
/**
 * The marker's mark for one criterion.
 *
 * ``raw_label`` and ``raw_score`` keep the marker's wording exactly as found
 * (e.g. "2:2 (68)", "68 / 100"). ``level_id`` is None when it could not be
 * mapped to a rubric level; that is a valid state, never guessed.
 */
export interface OriginalCriterionMark {
  comment?: string | null;
  criterion_id: string;
  level_id?: string | null;
  mark?: number | null;
  /**
   * The criterion's name in the marker's system, as written.
   */
  raw_criterion?: string | null;
  raw_label?: string | null;
  raw_score?: string | null;
}
/**
 * A model's second reading for one criterion. A suggestion, never a mark.
 */
export interface AISuggestion {
  call: ModelCall;
  criterion_id: string;
  draft_comment?: string | null;
  evidence?: EvidenceQuote[];
  id: string;
  kind?: "ai_suggestion";
  missing_evidence?: boolean;
  provenance: Provenance;
  rationale?: string;
  submission_id: string;
  /**
   * None when the model could not suggest a level.
   */
  suggested_level_id?: string | null;
}
/**
 * Provenance for one model call (ADR 0003).
 */
export interface ModelCall {
  approval_id: string;
  approved_text_sha256: string;
  cached_from_request_id?: string | null;
  error?: string | null;
  model_reported?: string | null;
  model_requested: string;
  produced_by: ProducedBy;
  prompt_version: string;
  provider: string;
  request_id?: string | null;
  request_sha256: string;
  response_sha256?: string | null;
  rubric_version: string;
  stop_reason?: string | null;
  timestamp: string;
  usage?: TokenUsage;
}
export interface TokenUsage {
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
}
export interface EvidenceQuote {
  end?: number | null;
  start?: number | null;
  text: string;
  /**
   * True only if the quote was found verbatim in the approved anonymised text.
   */
  verified: boolean;
}
/**
 * The moderator's own judgement for one criterion.
 *
 * In ``open`` review (the default, matching usual moderation practice) the
 * original marks, comments, and AI reading are visible throughout, and only
 * ``first`` is recorded.
 *
 * In ``blind`` review, ``first`` is recorded before the original marks and AI
 * reading are revealed; ``revised`` is optional and recorded after the reveal.
 * Both are kept.
 */
export interface ModeratorJudgement {
  criterion_id: string;
  first: JudgementEntry;
  kind?: "moderator_judgement";
  mode?: ReviewMode;
  provenance: Provenance;
  revealed_at?: string | null;
  revised?: JudgementEntry | null;
  submission_id: string;
}
export interface JudgementEntry {
  comment?: string | null;
  /**
   * True if the comment was adapted from an AI draft.
   */
  comment_derived_from_ai?: boolean;
  level_id: string;
  recorded_at: string;
}
/**
 * The moderator's overall view of how one submission was marked.
 */
export interface SubmissionVerdict {
  comment?: string | null;
  kind?: "submission_verdict";
  provenance: Provenance;
  submission_id: string;
  suggested_mark?: number | null;
  verdict: Verdict;
}
/**
 * What the commissioning body asked to be moderated.
 */
export interface ModerationRequest {
  context: ModerationContext;
  kind?: "moderation_request";
  provenance: Provenance;
  /**
   * @minItems 1
   */
  sample: [SampledSubmission, ...SampledSubmission[]];
}
/**
 * Module-level context from the moderation request. Roles only, never names.
 */
export interface ModerationContext {
  /**
   * Marked assessments per band, as reported.
   */
  band_distribution?: BandCount[];
  cohort_size?: number | null;
  /**
   * Module title and code, as written.
   */
  module?: string | null;
  multiple_groups?: boolean | null;
  /**
   * Programme title, as written.
   */
  programme?: string | null;
  provenance: Provenance2;
  /**
   * How the sample was chosen.
   */
  sample_note?: string | null;
  /**
   * Roles involved, e.g. 'module convener', 'marker'. Never names.
   */
  staff_roles?: string[];
}
export interface BandCount {
  count: number;
  label: string;
}
/**
 * How a record came to exist.
 */
export interface Provenance2 {
  actor: Actor;
  /**
   * Hashes of the inputs this record depends on.
   */
  input_hashes?: string[];
  /**
   * What the record was derived from, e.g. 'file:sha256:<hash>' or 'manual entry'.
   */
  source: string;
  timestamp: string;
  transformation: Transformation;
}
/**
 * One sampled submission, identified only by its pseudonymous ID.
 *
 * The external identifier (e.g. a Turnitin submission ID) lives only in the
 * pseudonym key.
 */
export interface SampledSubmission {
  /**
   * The grade band the request listed it under, as written.
   */
  listed_band?: string | null;
  pseudonym: string;
  submission_id: string;
}
/**
 * Everything for one moderation, self-contained and pseudonymous.
 */
export interface ModerationRecord {
  ai_suggestions?: AISuggestion[];
  approved_at?: string | null;
  approved_by?: Actor | null;
  context?: ModerationContext | null;
  id: string;
  judgements?: ModeratorJudgement[];
  kind?: "moderation_record";
  original_assessments?: OriginalAssessment[];
  overall_comment?: string | null;
  provenance: Provenance;
  rubric: Rubric;
  schema_version?: "0.1.0";
  /**
   * @minItems 1
   */
  submissions: [Submission, ...Submission[]];
  verdicts?: SubmissionVerdict[];
}
