/**
 * Every marker's record for each sampled submission: the imported one
 * ("marker") and any entered by hand under another role (e.g. "second
 * marker"), found in `marking/`. A record that doesn't load is listed with
 * its problem, never left out.
 */

import { isHidden, loadRequest, loadReviewState, MARKING, markingPath, OriginalAssessment, REQUEST, type Workspace } from "../core/index.ts";

export interface MarkingRecord {
  submissionId: string;
  label: string; // the submission, e.g. "sub-001 [STUDENT_A]"
  markerLabel: string | null; // null when the record doesn't load
  file: string;
  confirmed: boolean;
  hidden: boolean; // the submission is being reviewed blind and isn't yet revealed
  problem: string | null;
}

/** Whether a submission's marking must stay hidden: it is reviewed blind and not yet revealed (or that can't be told). */
export async function markingHidden(ws: Workspace, submissionId: string): Promise<boolean> {
  try {
    return isHidden(await loadReviewState(ws, submissionId));
  } catch {
    return true;
  }
}

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
      const record: MarkingRecord = { submissionId: s.submission_id, label, markerLabel: null, file, confirmed: false, hidden, problem: null };
      try {
        // This file itself, validated (never another file found by a default name).
        const parsed = OriginalAssessment.safeParse(await ws.readJson(`${MARKING}/${file}`));
        if (!parsed.success) throw new Error(`${MARKING}/${file} is not a valid marking record`);
        if (markingPath(s.submission_id, parsed.data.marker_label) !== `${MARKING}/${file}` || parsed.data.submission_id !== s.submission_id) {
          throw new Error(`${MARKING}/${file} doesn't match the submission and marker it records`);
        }
        record.markerLabel = parsed.data.marker_label;
        record.confirmed = parsed.data.confirmed_at !== null;
      } catch (err) {
        record.problem = message(err);
      }
      out.push(record);
    }
  }
  return out;
}
