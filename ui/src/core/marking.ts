/**
 * Import, enter, confirm, and correct the original marker's marking: a port
 * of `core/src/feedbacker_core/marking.py`.
 *
 * Marking comes from marked views (e.g. Turnitin current views) in one or
 * more bulk zips or single files, selected for the sample exactly as
 * originals are. Each view is parsed (markedView.ts) and mapped onto the
 * **source rubric**, which governs the comparison (maintainer decision,
 * 2026-09-25):
 *
 * - A marker's criterion maps to a source criterion when the names match, or
 *   when the marker's name is a word-boundary prefix of exactly one source
 *   title, or through an explicit mapping from the moderator. Otherwise it is
 *   left unmapped and noted.
 * - The awarded score is the mark. A source `level_id` is set only when the
 *   score equals a source level's points exactly. The marker's selected level
 *   label and score are kept exactly as written.
 * - Disagreements are noted for the moderator, never reconciled: e.g. a
 *   selected level whose points differ from the awarded score, a rubric total
 *   that differs from the grade, or a Submission ID that differs from the file.
 *
 * Comment text is anonymised with the same tokens as the submissions.
 * Marking is never sent to a model. Each record is kept apart from the others
 * and stays unconfirmed until the moderator confirms it; manual entries and
 * corrections replace a record, keeping the previous version in a history.
 */

import * as z from "zod";
import { loadRules, namesFromFileName, redactIn, redactor, type AnonymisationRules } from "./anonymise.ts";
import { ArchiveError, selectMembers } from "./archive.ts";
import { readDownloadReports } from "./downloadReport.ts";
import { embeddedRubricText, recordEmbeddedRubric, restoreEmbeddedRubric } from "./embeddedRubric.ts";
import { ExtractionError, sha256Bytes } from "./extract.ts";
import { parseMarkedView, showsMarkedViewCues, type MarkedView } from "./markedView.ts";
import { type Actor, type Criterion, type ImportRoute, OriginalAssessment, OriginalCriterionMark, Rubric } from "./models.ts";
import { pyCasefold, W } from "./pyre.ts";
import { pyFormatG, pyReprFloat, pyRoundInt, pyStrip } from "./pytext.ts";
import { loadRequest, MODERATOR } from "./request.ts";
import { markingWithheld } from "./reviewState.ts";
import { RUBRIC } from "./rubric.ts";
import { byPseudonym, matchId, type KeyEntry, type PseudonymKey, withEntries, type Workspace, WorkspaceError } from "./workspace.ts";
import { hashSource, type ByteSource } from "./zip.ts";

export const MARKING = "marking";
export const CRITERIA_MAP = "marking/criteria-map.json";
export const MARKED_SOURCES = "sources/marked";
export const MARKER: Actor = { kind: "original_marker", label: "original marker" };

/** The marking can't be imported. `problems` lists every issue found. */
export class MarkingProblem extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super("cannot import marking:\n- " + problems.join("\n- "));
    this.name = "MarkingProblem";
    this.problems = problems;
  }
}

/** Moderator-confirmed mappings from the marker's criterion names to source IDs. */
export const CriteriaMap = z.strictObject({ mapping: z.record(z.string(), z.string()).default({}) });
export type CriteriaMap = z.output<typeof CriteriaMap>;

export interface MarkingResult {
  imported: OriginalAssessment[];
  failed: Map<string, string>; // submission_id -> reason
  ignoredCount: number;
  downloadWarnings: string[];
  /** Whether any download report was found; if not, the failed-file check could not be made. */
  downloadReportFound: boolean;
  unmapped: Set<string>; // the marker's criterion names
  sourceIds: string[];
}

export const markerSlug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "marker";

export const markingPath = (submissionId: string, markerLabel = "marker") => `${MARKING}/${submissionId}--${markerSlug(markerLabel)}.json`;

const criterionOf = (rubric: Rubric, id: string): Criterion | null => rubric.criteria.find((c) => c.id === id) ?? null;

export async function loadRubric(ws: Workspace): Promise<Rubric> {
  if (!(await ws.exists(RUBRIC))) throw new WorkspaceError("import the source rubric first ('rubric import')");
  const parsed = Rubric.safeParse(await ws.readJson(RUBRIC)); // the workspace reports a file that isn't JSON
  if (!parsed.success) throw new WorkspaceError(`${RUBRIC} is not a valid rubric; import the rubric again`);
  return parsed.data;
}

export async function loadCriteriaMap(ws: Workspace): Promise<CriteriaMap> {
  if (!(await ws.exists(CRITERIA_MAP))) return CriteriaMap.parse({});
  return CriteriaMap.parse(await ws.readJson(CRITERIA_MAP));
}

/** Record explicit mappings (keys are the marker's names, compared case-insensitively). */
export async function updateCriteriaMap(ws: Workspace, mapping: Record<string, string>): Promise<CriteriaMap> {
  const rubric = await loadRubric(ws);
  const ids = new Set(rubric.criteria.map((c) => c.id));
  const unknown = Object.values(mapping).filter((v) => !ids.has(v)).map((v) => `'${v}'`);
  if (unknown.length) throw new WorkspaceError(`unknown source criterion ID(s) ${unknown.join(", ")}; see 'rubric import' preview`);
  const current = await loadCriteriaMap(ws);
  const merged = { ...current.mapping };
  for (const [k, v] of Object.entries(mapping)) merged[pyCasefold(k)] = v;
  const map = CriteriaMap.parse({ mapping: merged });
  await ws.writeJson(CRITERIA_MAP, map);
  return map;
}

/** Exact (case-insensitive) title match, explicit mapping, or a unique prefix. */
export function mapCriterion(name: string, rubric: Rubric, explicit: CriteriaMap): string | null {
  const folded = pyStrip(pyCasefold(name));
  if (Object.hasOwn(explicit.mapping, folded)) return explicit.mapping[folded];
  const exact = rubric.criteria.filter((c) => pyStrip(pyCasefold(c.title)) === folded).map((c) => c.id);
  if (exact.length === 1) return exact[0];
  const notWord = new RegExp(`^[${W}]`, "u");
  const prefix = rubric.criteria
    .filter((c) => {
      const title = pyStrip(pyCasefold(c.title));
      return title.startsWith(folded) && !notWord.test(title.slice(folded.length));
    })
    .map((c) => c.id);
  return prefix.length === 1 ? prefix[0] : null;
}

/** 'between Good (65) and Very good (75)', or the exact level's label. */
export function describeBetween(points: number, criterion: Criterion): string {
  const levels = criterion.levels.filter((l) => l.points !== null).sort((a, b) => a.points! - b.points!);
  const exact = levels.filter((l) => l.points === points);
  if (exact.length) return exact[0].label;
  const below = levels.filter((l) => l.points! < points);
  const above = levels.filter((l) => l.points! > points);
  if (below.length && above.length) return `between ${below.at(-1)!.label} and ${above[0].label}`;
  if (above.length) return `below ${above[0].label}`;
  return below.length ? `above ${below.at(-1)!.label}` : "not comparable (no pointed levels)";
}

export interface AssessmentContext {
  submissionId: string;
  externalId: string;
  rubric: Rubric;
  criteriaMap: CriteriaMap;
  key: PseudonymKey;
  rules: AnonymisationRules;
  route: ImportRoute;
  source: string;
  inputHashes: string[];
  now: Date;
  /** The initial mark the request listed for the student (a percentage), to check the marked view's grade against. */
  requestMark?: number | null;
}

const NOT_MAPPED = "could not be mapped to the source rubric";

/** The marker's criterion names that an import couldn't map onto the source rubric, exactly as written, to be offered for matching. */
export const unmappedCriteria = (assessment: OriginalAssessment): string[] => assessment.unmapped_criteria;

export function buildAssessment(view: MarkedView, ctx: AssessmentContext): OriginalAssessment {
  const notes = [...view.warnings];
  if (view.external_id && view.external_id !== ctx.externalId) notes.push("the Submission ID inside the marked view differs from its file's identifier");
  if (ctx.requestMark != null && view.grade !== null && view.grade_max) {
    // A marked view's grade against the request's initial mark: a difference shows a file given to the wrong student, or a mark changed since.
    const percent = (100 * view.grade) / view.grade_max;
    if (Math.abs(percent - ctx.requestMark) > 1e-6) notes.push("the marked view's overall grade differs from the initial mark the request listed");
  }
  const marks: OriginalCriterionMark[] = [];
  const used = new Set<string>();
  const unmapped: string[] = [];
  for (const pc of view.criteria) {
    const cid = mapCriterion(pc.name, ctx.rubric, ctx.criteriaMap);
    if (cid === null) unmapped.push(pc.name);
    if (cid === null || used.has(cid)) {
      const why = cid !== null && used.has(cid) ? "already mapped" : NOT_MAPPED;
      notes.push(`criterion '${pc.name}' (${pyFormatG(pc.weight)}%, ${pc.raw_score}, selected ${pc.selected_label || "none"}) ${why}; map it with --criterion`);
      continue;
    }
    used.add(cid);
    const source = criterionOf(ctx.rubric, cid)!;
    const level = source.levels.find((l) => l.points === pc.score) ?? null;
    if (pc.selected_points !== null && pc.selected_points !== pc.score) {
      notes.push(`criterion '${pc.name}': the selected level ${pc.selected_label} disagrees with the awarded score ${pc.raw_score}`);
    }
    if (!level) notes.push(`criterion '${pc.name}': awarded ${pyFormatG(pc.score)} is ${describeBetween(pc.score, source)} on the source rubric`);
    marks.push(
      OriginalCriterionMark.parse({
        criterion_id: cid,
        level_id: level?.id ?? null,
        mark: pc.score,
        raw_criterion: pc.name,
        raw_label: pc.selected_label,
        raw_score: pc.raw_score,
      }),
    );
  }
  if (view.grade !== null && view.rubric_total !== null) {
    if (pyRoundInt(view.rubric_total) !== pyRoundInt(view.grade) || Math.abs(view.rubric_total - view.grade) >= 1) {
      notes.push(`the rubric total ${pyFormatG(view.rubric_total)} differs from the grade ${pyFormatG(view.grade)}`);
    }
  }
  return OriginalAssessment.parse({
    submission_id: ctx.submissionId,
    marker_label: "marker",
    import_route: ctx.route,
    criterion_marks: marks,
    overall_mark: view.grade,
    raw_overall: view.raw_grade, // exactly as written; the rubric total has its own field
    raw_rubric_total: view.raw_rubric_total,
    overall_comment: redactIn(view.general_comment, ctx.key, ctx.rules),
    annotations: view.comments
      .filter((c) => c.text)
      .map((c) => ({ text: redactIn(c.text, ctx.key, ctx.rules), number: c.number, criterion_label: c.criterion_label, page: c.page, position: c.position })),
    import_notes: notes,
    unmapped_criteria: unmapped,
    provenance: {
      source: ctx.source,
      transformation: "imported",
      actor: MARKER,
      timestamp: ctx.now.toISOString(),
      input_hashes: [...new Set(ctx.inputHashes)].sort(),
    },
  });
}

/**
 * The replaced record goes into the history, so corrections are recorded.
 * Returns the history path written, or null if there was nothing to keep.
 * The callers make it private afterwards, whether or not the rest succeeds.
 */
async function archivePrevious(ws: Workspace, submissionId: string, markerLabel: string, when: Date): Promise<string | null> {
  const path = markingPath(submissionId, markerLabel);
  if (!(await ws.exists(path))) return null;
  // Python's strftime("%Y%m%dT%H%M%S%f"), in UTC. A Date has milliseconds only,
  // so two replacements in one millisecond are told apart by a suffix rather
  // than one overwriting the other.
  const stamp = when.toISOString().replace(/[-:]/g, "").replace(/\.(\d{3})Z$/, "$1000");
  const base = `${MARKING}/history/${submissionId}--${markerSlug(markerLabel)}--${stamp}`;
  let history = `${base}.json`;
  for (let n = 2; await ws.exists(history); n++) history = `${base}-${n}.json`;
  await ws.writeJson(history, await ws.readJson(path));
  return history;
}

/** Import the sampled marked views found across `sources` (zips or single files). */
export async function importMarking(
  ws: Workspace,
  sources: ByteSource | ByteSource[],
  options: { criteria?: Record<string, string>; replace?: boolean; now?: Date } = {},
): Promise<MarkingResult> {
  const list = Array.isArray(sources) ? sources : [sources];
  const request = await loadRequest(ws);
  const rubric = await loadRubric(ws);
  if (options.criteria && Object.keys(options.criteria).length) await updateCriteriaMap(ws, options.criteria);
  const criteriaMap = await loadCriteriaMap(ws);
  const key = await ws.readKey();
  const rules = await loadRules(ws);
  const sampled = request.sample.map((s) => [s, byPseudonym(key, s.pseudonym)!] as const);
  const existing: string[] = [];
  for (const [s] of sampled) if (await ws.exists(markingPath(s.submission_id))) existing.push(s.submission_id);
  if (existing.length && !options.replace) throw new WorkspaceError(`marking already imported (${existing.join(", ")}); use replace to import again`);

  let selection;
  try {
    selection = await selectMembers(list, sampled.map(([, e]) => matchId(e)));
  } catch (err) {
    if (err instanceof ArchiveError) throw new MarkingProblem([err.message]);
    throw err;
  }
  const labels = new Map(sampled.map(([s, e]) => [matchId(e), `${s.pseudonym} (${s.submission_id})`]));
  const problems = selection.problems((id) => labels.get(id)!, list);
  for (const [id, member] of selection.matched) if (member.suffix !== ".pdf") problems.push(`file for ${labels.get(id)} is not a pdf marked view`);
  if (problems.length) throw new MarkingProblem(problems);

  const now = options.now ?? new Date();
  const reports = await readDownloadReports(list);
  const result: MarkingResult = {
    imported: [],
    failed: new Map(),
    ignoredCount: selection.ignoredCount,
    downloadWarnings: reports.warnings,
    downloadReportFound: reports.found,
    unmapped: new Set(),
    sourceIds: rubric.criteria.map((c) => c.id),
  };
  const sourceHashes = new Map<ByteSource, string>();
  for (const member of selection.matched.values()) if (!sourceHashes.has(member.source)) sourceHashes.set(member.source, await hashSource(member.source));

  // Everything is read and built in memory; nothing is written until every view is processed.
  const staged: { submissionId: string; entry: KeyEntry; fileName: string; bytes: Uint8Array; assessment: OriginalAssessment; view: MarkedView }[] = [];
  const misfiled: string[] = []; // files that are not marked views at all: refused, with nothing imported
  for (const [s, original] of sampled) {
    let entry = original;
    const member = selection.matched.get(matchId(entry))!;
    let bytes: Uint8Array;
    try {
      bytes = await member.read();
    } catch (err) {
      result.failed.set(s.submission_id, `the marked view could not be read (${(err as Error).name})`);
      continue;
    }
    let view: MarkedView;
    try {
      view = await parseMarkedView(bytes);
    } catch (err) {
      if (!(err instanceof ExtractionError)) throw err;
      result.failed.set(s.submission_id, err.message);
      continue;
    }
    if (!showsMarkedViewCues(view)) {
      misfiled.push(`the file for ${s.pseudonym} (${s.submission_id}) doesn't look like a marked view: it has no Submission ID, grade or rubric. It may be the student's original, put in the wrong place`);
      continue;
    }
    if (view.external_id && view.grade === null && view.criteria.length === 0 && view.comments.length === 0 && !view.general_comment && !view.warnings.includes("no grade and general comments section found")) {
      // The platform's own header and feedback pages, with nothing in them: the marking was done elsewhere.
      result.failed.set(s.submission_id, "this marked view carries no marking (no grade, rubric or comments); where the request lists the marks, use them as the original marking instead");
      continue;
    }
    const missing = (
      [
        ["the Submission ID", Boolean(view.external_id)],
        ["the overall grade", view.grade !== null],
        ["the rubric criteria", view.criteria.length > 0],
      ] as const
    )
      .filter(([, present]) => !present)
      .map(([what]) => what);
    if (missing.length) {
      result.failed.set(s.submission_id, `not a complete marked view: ${missing.join(", ")} could not be read`);
      continue;
    }
    // The student's name from the marked view's file name, so comments are
    // anonymised even before the originals are imported.
    for (const name of namesFromFileName(member.fileName, matchId(entry))) {
      if (!entry.names.map(pyCasefold).includes(pyCasefold(name))) entry = { ...entry, names: [...entry.names, name] };
    }
    key.entries = key.entries.map((e) => (e.pseudonym === entry.pseudonym ? entry : e));
    const sourceHash = sourceHashes.get(member.source)!;
    const assessment = buildAssessment(view, {
      submissionId: s.submission_id,
      externalId: matchId(entry),
      requestMark: s.initial_mark,
      rubric,
      criteriaMap,
      key,
      rules,
      route: member.isArchive ? "turnitin_bulk_zip" : "turnitin_current_view",
      source: `${member.isArchive ? "archive" : "file"}:sha256:${sourceHash}`,
      inputHashes: [sourceHash, sha256Bytes(bytes)],
      now,
    });
    const mapped = new Set(assessment.criterion_marks.map((m) => m.raw_criterion));
    for (const c of view.criteria) if (!mapped.has(c.name)) result.unmapped.add(c.name);
    staged.push({ submissionId: s.submission_id, entry, fileName: member.fileName, bytes, assessment, view });
    result.imported.push(assessment);
  }
  if (misfiled.length) throw new MarkingProblem(misfiled);

  // The rubric the views carry is kept beside the marking, to compare the source rubric with (never as the source rubric). It goes first, so a
  // failure to write it leaves no marking half-imported, and what follows puts the earlier one back if the marking can't all be written.
  const earlierEmbedded = staged.length ? await embeddedRubricText(ws) : null;
  // Key first: it only gains tokens and file names.
  const entries = new Map(key.entries.map((e) => [e.pseudonym, e]));
  for (const { entry, fileName } of staged) {
    const current = entries.get(entry.pseudonym)!;
    entries.set(entry.pseudonym, { ...current, source_files: { ...current.source_files, marked: fileName } });
  }
  await ws.writeKey(withEntries(key, key.entries.map((e) => entries.get(e.pseudonym)!)));
  try {
    if (staged.length) await recordEmbeddedRubric(ws, staged.map((x) => ({ view: x.view, sha256: sha256Bytes(x.bytes) })), now);
    // Each submission is replaced completely or not at all: if its record
    // can't be written, its previous marked view is put back and the history
    // copy removed, so the stored view and the record always belong together.
    for (const { submissionId, bytes, assessment } of staged) {
      const source = `${MARKED_SOURCES}/${submissionId}.pdf`;
      const previous = await ws.readBytes(source);
      const history = await archivePrevious(ws, submissionId, "marker", now);
      try {
        await ws.writeBytes(source, bytes);
        await ws.writeJson(markingPath(submissionId), assessment);
      } catch (err) {
        await (previous ? ws.writeBytes(source, previous) : ws.fs.remove(source)).catch(() => {});
        if (history) await ws.fs.remove(history).catch(() => {});
        throw err;
      }
    }
  } catch (err) {
    if (staged.length) await restoreEmbeddedRubric(ws, earlierEmbedded).catch(() => {});
    await ws.secure().catch(() => {}); // whatever was written is still made private
    throw err;
  }
  if (staged.length) await ws.secure(); // the sources, records and history are private
  return result;
}

export async function loadMarking(ws: Workspace, submissionId: string, markerLabel = "marker"): Promise<OriginalAssessment> {
  const path = markingPath(submissionId, markerLabel);
  if (!(await ws.exists(path))) throw new WorkspaceError(`no marking recorded for ${submissionId} (${markerLabel})`);
  return OriginalAssessment.parse(await ws.readJson(path));
}

export async function confirmMarking(ws: Workspace, submissionId: string, markerLabel = "marker", now?: Date): Promise<OriginalAssessment> {
  const withheld = await markingWithheld(ws, submissionId); // confirming means the moderator has seen it
  if (withheld) throw new WorkspaceError(withheld);
  const assessment = await loadMarking(ws, submissionId, markerLabel);
  const confirmed = OriginalAssessment.parse({ ...assessment, confirmed_by: MODERATOR, confirmed_at: (now ?? new Date()).toISOString() });
  await ws.writeJson(markingPath(submissionId, markerLabel), confirmed, { private: true });
  return confirmed;
}

/** The role of whoever internally moderated the marking (a partner institution's), whose changed mark the request lists as the agreed mark. */
export const INTERNAL_MODERATOR = "internal moderator";

export interface RequestMarksResult {
  /** The records made: the initial mark under "marker", and an agreed mark (after internal moderation) that differs from it under "internal moderator". */
  recorded: OriginalAssessment[];
  /** Sampled submissions the request gave no initial mark for, which have no marking made. */
  skipped: string[];
}

/**
 * Use the marks the request listed as the original marking, for marked views that carry none: the overall mark only,
 * with no marks for the criteria and no comments, which the record says. The initial mark is the "marker"'s, and the agreed mark
 * (after the partner's internal moderation) that differs from it is recorded as the "internal moderator"'s. Each is left unconfirmed, for the moderator to check and confirm as for
 * any marking, and replaces an existing record (kept in the history) only when told to.
 */
export async function useRequestMarks(ws: Workspace, options: { replace?: boolean; now?: Date } = {}): Promise<RequestMarksResult> {
  const request = await loadRequest(ws);
  const now = options.now ?? new Date();
  const wanted = request.sample.flatMap((s) => [
    ...(s.initial_mark !== null ? [{ id: s.submission_id, marker: "marker", mark: s.initial_mark }] : []),
    // The request's agreed mark is the mark after the partner's internal moderation. It is a record of its own only where it differs from the initial one: a mark that stood has nothing to compare.
    ...(s.initial_mark !== null && s.agreed_mark !== null && s.agreed_mark !== s.initial_mark ? [{ id: s.submission_id, marker: INTERNAL_MODERATOR, mark: s.agreed_mark }] : []),
  ]);
  const unchanged = new Set(request.sample.filter((s) => s.initial_mark !== null && s.agreed_mark === s.initial_mark).map((s) => s.submission_id));
  const skipped = request.sample.filter((s) => s.initial_mark === null).map((s) => s.submission_id);
  if (!wanted.length) throw new WorkspaceError("the request gives no marks to use");
  const existing: string[] = [];
  for (const w of wanted) if (await ws.exists(markingPath(w.id, w.marker))) existing.push(`${w.id} (${w.marker})`);
  // Records an earlier use of the request's marks made that its marks no longer give (an internal moderation mark that now
  // equals the initial one, a student whose mark has gone) would stay active beside the new ones: they are obsolete, and are
  // replaced too. Marking entered or imported any other way is never touched.
  const current = new Set(wanted.map((w) => markingPath(w.id, w.marker)));
  const obsolete: { id: string; marker: string }[] = [];
  const files = (await ws.exists(MARKING)) ? (await ws.fs.list(MARKING)).filter((e) => e.kind === "file").map((e) => e.name) : [];
  for (const s of request.sample) {
    for (const name of files.filter((f) => f.startsWith(`${s.submission_id}--`) && f.endsWith(".json"))) {
      const parsed = OriginalAssessment.safeParse(await ws.readJson(`${MARKING}/${name}`));
      if (parsed.success && parsed.data.import_route === "request_document" && !current.has(`${MARKING}/${name}`)) {
        obsolete.push({ id: s.submission_id, marker: parsed.data.marker_label });
        existing.push(`${s.submission_id} (${parsed.data.marker_label}, no longer given by the request)`);
      }
    }
  }
  if (existing.length && !options.replace) {
    throw new WorkspaceError(`marking already recorded (${existing.join(", ")}); use replace to record it again (the old records are kept in the history)`);
  }
  const recorded: OriginalAssessment[] = [];
  let written = false;
  try {
    for (const w of wanted) {
      const assessment = OriginalAssessment.parse({
        submission_id: w.id,
        marker_label: w.marker,
        import_route: "request_document",
        overall_mark: w.mark,
        raw_overall: `${pyFormatG(w.mark)}%`, // as the request wrote it: a percentage
        import_notes: [
          "The request gave this overall mark only: it has no marks for the criteria and no comments.",
          ...(w.marker === "marker" && unchanged.has(w.id) ? ["The request's agreed mark (after internal moderation) is the same as this one."] : []),
        ],
        provenance: { source: "moderation request", transformation: "imported", actor: MODERATOR, timestamp: now.toISOString() },
      });
      // The replaced record goes into the history first; if the new one can't be written, the history copy goes again.
      let history: string | null = null;
      try {
        history = await archivePrevious(ws, w.id, w.marker, now);
        written = true;
        await ws.writeJson(markingPath(w.id, w.marker), assessment);
      } catch (err) {
        if (history) await ws.fs.remove(history).catch(() => {});
        throw err;
      }
      recorded.push(assessment);
    }
    // Only once the new records are written, so a failure leaves the earlier ones as they were. Each goes into the history first.
    for (const o of obsolete) {
      await archivePrevious(ws, o.id, o.marker, now);
      await ws.fs.remove(markingPath(o.id, o.marker));
    }
  } catch (err) {
    if (written) await ws.secure().catch(() => {});
    throw err;
  }
  await ws.secure();
  return { recorded, skipped };
}

export interface MarkingEntry {
  markerLabel?: string;
  overall?: number | null;
  criteria?: Map<string, number> | Record<string, number>;
  comment?: string | null;
  now?: Date;
}

/**
 * Manual entry or correction. Replaces any existing record (kept in history).
 * Manual records are entered by the moderator, so they need no separate confirmation.
 */
export async function enterMarking(ws: Workspace, submissionId: string, options: MarkingEntry = {}): Promise<OriginalAssessment> {
  const markerLabel = options.markerLabel ?? "marker";
  const request = await loadRequest(ws);
  if (!request.sample.some((s) => s.submission_id === submissionId)) throw new WorkspaceError(`${submissionId} is not in the sample`);
  const withheld = await markingWithheld(ws, submissionId); // entering it means seeing it
  if (withheld) throw new WorkspaceError(withheld);
  const rubric = await loadRubric(ws);
  const criteria = [...(options.criteria instanceof Map ? options.criteria : Object.entries(options.criteria ?? {}))];
  const problems = criteria.filter(([c]) => !criterionOf(rubric, c)).map(([c]) => `unknown source criterion '${c}'`);
  if (problems.length) throw new MarkingProblem(problems);
  const redact = await redactor(ws);
  const now = options.now ?? new Date();
  const marks = criteria.map(([cid, points]) => {
    const level = criterionOf(rubric, cid)!.levels.find((l) => l.points === points) ?? null;
    return OriginalCriterionMark.parse({ criterion_id: cid, level_id: level?.id ?? null, mark: points, raw_score: pyFormatG(points) });
  });
  const assessment = OriginalAssessment.parse({
    submission_id: submissionId,
    marker_label: markerLabel,
    import_route: "manual",
    criterion_marks: marks,
    overall_mark: options.overall ?? null,
    overall_comment: redact.text(options.comment ?? null),
    confirmed_by: MODERATOR,
    confirmed_at: now.toISOString(),
    provenance: { source: "manual entry", transformation: "entered", actor: MODERATOR, timestamp: now.toISOString() },
  });
  await redact.keep();
  // The history copy and the record are written first, then made private; a
  // failure to write either removes the history copy (the replacement didn't
  // happen) and still makes whatever was written private.
  let history: string | null = null;
  try {
    history = await archivePrevious(ws, submissionId, markerLabel, now);
    await ws.writeJson(markingPath(submissionId, markerLabel), assessment);
  } catch (err) {
    if (history) await ws.fs.remove(history).catch(() => {});
    await ws.secure().catch(() => {});
    throw err;
  }
  await ws.secure(); // if the workspace can't be confirmed, that is the error reported
  return assessment;
}

/** A pseudonymous summary for review: marks against the source rubric, and notes. */
export async function markingSummary(ws: Workspace, submissionId: string, markerLabel = "marker"): Promise<string[]> {
  const a = await loadMarking(ws, submissionId, markerLabel);
  const rubric = await loadRubric(ws);
  const status = a.confirmed_at ? "CONFIRMED" : "NOT CONFIRMED";
  const number = (x: number | null) => (x === null ? "None" : pyReprFloat(x)); // Python's str() of a float
  const lines = [`${submissionId} (${a.marker_label}, ${a.import_route}): overall ${a.raw_overall || number(a.overall_mark)}; ${status}`];
  for (const m of a.criterion_marks) {
    const c = criterionOf(rubric, m.criterion_id);
    const where = m.mark === null ? "no mark" : c ? describeBetween(m.mark, c) : "not in the source rubric";
    lines.push(`  ${m.criterion_id}: ${m.raw_score || number(m.mark)} (marker's level: ${m.raw_label || "-"}; source rubric: ${where})`);
  }
  for (const note of a.import_notes) lines.push(`  note: ${note}`);
  lines.push(`  comments: ${a.annotations.length} inline; general comment: ${a.overall_comment ? "yes" : "no"}`);
  return lines;
}
