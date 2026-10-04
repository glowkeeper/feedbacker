/**
 * Every marker's record for each sampled submission: the imported one
 * ("marker") and any entered by hand under another role (e.g. "second
 * marker"), found in `marking/`. A record that doesn't load is listed with
 * its problem, never left out.
 */

import { criterionOf, describeBetween, loadMarking, loadRequest, loadRubric, MARKING, markingWithheld, markingPath, OriginalAssessment, REQUEST, unmappedCriteria, type ImportRoute, type Workspace } from "../core/index.ts";
import { pyReprFloat } from "../core/pytext.ts";
import { inApp } from "./forms.ts";

export interface MarkingRecord {
  submissionId: string;
  label: string; // the submission, e.g. "sub-001 [STUDENT_A]"
  markerLabel: string | null; // null when the record doesn't load
  file: string;
  confirmed: boolean;
  imported: boolean; // from a marked view, rather than entered by hand
  hidden: boolean; // the submission is being reviewed blind and isn't yet revealed
  unmapped: string[]; // the marker's criterion names its import couldn't map to the source rubric (none while hidden)
  problem: string | null;
}

/** Every marker's criterion name, across the records, that is still to be matched to the source rubric. */
export const unmatchedCriteria = (records: MarkingRecord[]) => [...new Set(records.flatMap((r) => r.unmapped))].sort();

/** Whether a submission's marking must stay hidden: it is reviewed blind and not yet revealed, or its review can't be read. */
export const markingHidden = async (ws: Workspace, submissionId: string) => (await markingWithheld(ws, submissionId)) !== null;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function markingRecords(ws: Workspace): Promise<MarkingRecord[]> {
  if (!(await ws.exists(REQUEST))) return [];
  const sample = (await loadRequest(ws)).sample;
  const files = (await ws.exists(MARKING)) ? (await ws.fs.list(MARKING)).filter((e) => e.kind === "file").map((e) => e.name).sort() : [];
  const out: MarkingRecord[] = [];
  for (const s of sample) {
    const label = `${s.submission_id} ${s.pseudonym}`;
    const hidden = await markingHidden(ws, s.submission_id);
    for (const file of files.filter((f) => f.startsWith(`${s.submission_id}--`) && f.endsWith(".json"))) {
      const record: MarkingRecord = { submissionId: s.submission_id, label, markerLabel: null, file, confirmed: false, imported: false, hidden, unmapped: [], problem: null };
      try {
        // This file itself, validated (never another file found by a default name).
        const parsed = OriginalAssessment.safeParse(await ws.readJson(`${MARKING}/${file}`));
        if (!parsed.success) throw new Error(`${MARKING}/${file} is not a valid marking record`);
        if (markingPath(s.submission_id, parsed.data.marker_label) !== `${MARKING}/${file}` || parsed.data.submission_id !== s.submission_id) {
          throw new Error(`${MARKING}/${file} doesn't match the submission and marker it records`);
        }
        record.markerLabel = parsed.data.marker_label;
        record.confirmed = parsed.data.confirmed_at !== null;
        record.imported = parsed.data.import_route !== "manual";
        if (!hidden) record.unmapped = unmappedCriteria(parsed.data);
      } catch (err) {
        record.problem = message(err);
      }
      out.push(record);
    }
  }
  return out;
}

export interface Entry {
  overall: number | null;
  criteria: number; // how many criterion marks
  comment: string;
}

/**
 * Why a hand entry can't be made, or null: it has nothing in it, or it would
 * replace an existing record (above all an imported one) without the
 * moderator saying so.
 */
export function entryProblem(records: MarkingRecord[], submissionId: string, marker: string, entry: Entry, replace: boolean): string | null {
  if (entry.overall === null && entry.criteria === 0 && !entry.comment.trim()) {
    return "enter an overall mark, a mark for at least one criterion, or a comment; nothing was entered";
  }
  const file = markingPath(submissionId, marker).slice(MARKING.length + 1);
  const existing = records.find((r) => r.submissionId === submissionId && r.file === file);
  if (existing?.problem) {
    // Replacing keeps the old record in the history, which needs it to be read: a damaged one has to be dealt with first.
    return `${MARKING}/${file} can't be read (${existing.problem}), so it can't be replaced here; move it out of the workspace, or enter this under another marker role`;
  }
  if (existing && !replace) {
    const what = existing.imported ? "marking imported from its marked view" : "a record entered by hand";
    return `${submissionId} already has ${what} for the ${marker}; to replace it, tick "Replace the existing record" (the old one is kept in the history), or enter this under another marker role`;
  }
  return null;
}

/** How a marking record came in, in words. */
const ROUTES: Record<ImportRoute, string> = {
  turnitin_bulk_zip: "imported from a bulk download of marked views",
  turnitin_current_view: "imported from a marked view",
  canvas_rubric: "imported from a VLE rubric",
  spreadsheet: "imported from a spreadsheet",
  manual: "entered by hand",
};

export interface MarkingCheck {
  id: string;
  marker: string;
  route: string; // how it came in, in words
  overall: string; // the overall mark, as written, or "not recorded"
  confirmed: boolean;
  rows: { title: string; mark: string; markerLevel: string; onRubric: string }[]; // a row per criterion mark, by the source rubric's title
  notes: string[]; // what the import noted, never corrected, in plain words
  inline: number; // inline comments
  overallComment: boolean;
}

/**
 * One marker's record, as the moderator checks it before confirming: what core markingSummary says, by criterion
 * title in a table rather than lines of text, with nothing left out. A criterion that isn't in the source rubric keeps
 * its identifier, and says so.
 */
export async function markingCheck(ws: Workspace, submissionId: string, marker: string): Promise<MarkingCheck> {
  const withheld = await markingWithheld(ws, submissionId);
  if (withheld) throw new Error(withheld);
  const a = await loadMarking(ws, submissionId, marker);
  const rubric = await loadRubric(ws);
  const number = (x: number | null) => (x === null ? "not recorded" : pyReprFloat(x));
  return {
    id: submissionId,
    marker: a.marker_label,
    route: ROUTES[a.import_route],
    overall: a.raw_overall || number(a.overall_mark),
    confirmed: a.confirmed_at !== null,
    rows: a.criterion_marks.map((m) => {
      const c = criterionOf(rubric, m.criterion_id);
      return {
        title: c?.title ?? m.criterion_id,
        mark: m.raw_score || (m.mark === null ? "no mark" : number(m.mark)),
        markerLevel: m.raw_label || "not given",
        onRubric: m.mark === null ? "no mark" : c ? describeBetween(m.mark, c) : "not in the source rubric",
      };
    }),
    notes: a.import_notes.map(inApp),
    inline: a.annotations.length,
    overallComment: a.overall_comment !== null && a.overall_comment !== "",
  };
}
