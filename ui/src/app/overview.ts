/**
 * The moderation at a glance: for each sampled submission, how far it has
 * got, and the workspace-wide steps (rubric, brief). Everything is read from
 * the workspace; a record that doesn't load is shown as a problem, never
 * skipped silently.
 */

import { BRIEF, loadBrief, loadMarking, loadRequest, loadSubmission, readingPath, RUBRIC, submissionPath, markingPath, type Workspace, WorkspaceError } from "../core/index.ts";

export type Step = "missing" | "done" | "attention";

export interface SubmissionRow {
  id: string;
  pseudonym: string;
  band: string | null;
  original: Step;
  anonymised: Step;
  approved: Step;
  marking: Step; // "attention": imported but not yet confirmed
  reading: Step;
  problem: string | null;
}

export interface Overview {
  request: { module: string | null; programme: string | null; cohortSize: number | null } | null;
  rubric: Step;
  brief: { imported: Step; approved: Step; problem: string | null };
  submissions: SubmissionRow[];
  problem: string | null;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function loadOverview(ws: Workspace): Promise<Overview> {
  const overview: Overview = { request: null, rubric: "missing", brief: { imported: "missing", approved: "missing", problem: null }, submissions: [], problem: null };
  overview.rubric = (await ws.exists(RUBRIC)) ? "done" : "missing";
  if (await ws.exists(BRIEF)) {
    try {
      const brief = await loadBrief(ws);
      overview.brief = { imported: "done", approved: brief.approval ? "done" : "missing", problem: null };
    } catch (err) {
      overview.brief = { imported: "attention", approved: "missing", problem: message(err) };
    }
  }
  let request;
  try {
    request = await loadRequest(ws);
  } catch (err) {
    if (err instanceof WorkspaceError && err.message.startsWith("no moderation request")) return overview;
    overview.problem = message(err);
    return overview;
  }
  overview.request = { module: request.context.module, programme: request.context.programme, cohortSize: request.context.cohort_size };
  for (const s of request.sample) {
    const row: SubmissionRow = { id: s.submission_id, pseudonym: s.pseudonym, band: s.listed_band, original: "missing", anonymised: "missing", approved: "missing", marking: "missing", reading: "missing", problem: null };
    if (await ws.exists(submissionPath(s.submission_id))) {
      try {
        const sub = await loadSubmission(ws, s.submission_id);
        row.original = "done";
        row.anonymised = sub.anonymised ? "done" : "missing";
        row.approved = sub.approval ? "done" : "missing";
      } catch (err) {
        row.original = "attention";
        row.problem = message(err);
      }
    }
    if (await ws.exists(markingPath(s.submission_id))) {
      try {
        row.marking = (await loadMarking(ws, s.submission_id)).confirmed_at ? "done" : "attention";
      } catch (err) {
        row.marking = "attention";
        row.problem ??= message(err);
      }
    }
    row.reading = (await ws.exists(readingPath(s.submission_id))) ? "done" : "missing";
    overview.submissions.push(row);
  }
  return overview;
}
