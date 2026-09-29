/**
 * Every marker's record for each sampled submission: the imported one
 * ("marker") and any entered by hand under another role (e.g. "second
 * marker"), found in `marking/`. A record that doesn't load is listed with
 * its problem, never left out.
 */

import { loadRequest, MARKING, markingWithheld, markingPath, OriginalAssessment, REQUEST, unmappedCriteria, type Workspace } from "../core/index.ts";

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
