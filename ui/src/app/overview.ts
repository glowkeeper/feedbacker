/**
 * The moderation at a glance: for each sampled submission, how far it has
 * got, and the workspace-wide steps (rubric, brief). Everything is read from
 * the workspace; a record that doesn't load is shown as a problem, never
 * skipped silently.
 */

import {
  BRIEF,
  loadBrief,
  loadJudgements,
  loadReviewState,
  loadReadings,
  loadRequest,
  loadRubric,
  loadSubmission,
  readingPath,
  RUBRIC,
  submissionPath,
  type Workspace,
  WorkspaceError,
} from "../core/index.ts";
import { markingRecords } from "./markingRecords.ts";
import { readingProblems, staleJudgements } from "./review.ts";

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
  judged: number; // criteria with a recorded judgement
  judgedStep: Step; // "attention": some criteria judged, not all
  review: string | null; // how it is reviewed, e.g. "blind, not yet revealed"; null until chosen
  problem: string | null;
}

export interface Overview {
  request: { module: string | null; programme: string | null; cohortSize: number | null } | null;
  rubric: Step;
  criteria: number; // in the source rubric, when it loads
  rubricProblem: string | null;
  brief: { imported: Step; approved: Step; problem: string | null };
  submissions: SubmissionRow[];
  problem: string | null;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function loadOverview(ws: Workspace): Promise<Overview> {
  const overview: Overview = { request: null, rubric: "missing", criteria: 0, rubricProblem: null, brief: { imported: "missing", approved: "missing", problem: null }, submissions: [], problem: null };
  if (await ws.exists(RUBRIC)) {
    try {
      overview.criteria = (await loadRubric(ws)).criteria.length;
      overview.rubric = "done";
    } catch (err) {
      overview.rubric = "attention";
      overview.rubricProblem = message(err);
    }
  }
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
  const marking = await markingRecords(ws);
  overview.request = { module: request.context.module, programme: request.context.programme, cohortSize: request.context.cohort_size };
  for (const s of request.sample) {
    const row: SubmissionRow = { id: s.submission_id, pseudonym: s.pseudonym, band: s.listed_band, original: "missing", anonymised: "missing", approved: "missing", marking: "missing", reading: "missing", judged: 0, judgedStep: "missing", review: null, problem: null };
    let approved: string | null = null;
    if (await ws.exists(submissionPath(s.submission_id))) {
      try {
        const sub = await loadSubmission(ws, s.submission_id);
        approved = sub.approval?.approved_text_sha256 ?? null;
        row.original = "done";
        row.anonymised = sub.anonymised ? "done" : "missing";
        row.approved = sub.approval ? "done" : "missing";
      } catch (err) {
        row.original = "attention";
        row.problem = message(err);
      }
    }
    // Every marker's record: done when all are confirmed, needing attention otherwise.
    const own = marking.filter((m) => m.submissionId === s.submission_id);
    if (own.length) {
      row.marking = own.every((m) => m.confirmed && !m.problem) ? "done" : "attention";
      row.problem ??= own.find((m) => m.problem)?.problem ?? null;
    }
    if (await ws.exists(readingPath(s.submission_id))) {
      try {
        const [problem] = readingProblems(s.submission_id, await loadReadings(ws, s.submission_id), approved);
        if (problem) throw new Error(problem);
        row.reading = "done";
      } catch (err) {
        row.reading = "attention";
        row.problem ??= message(err);
      }
    }
    try {
      const state = await loadReviewState(ws, s.submission_id);
      const judgements = await loadJudgements(ws, s.submission_id);
      const mode = state?.mode ?? (judgements.length ? "open" : null);
      row.review = mode === "blind" ? (state!.revealed_at ? "blind, revealed" : "blind, not yet revealed") : mode;
      row.judged = judgements.length;
      if (row.judged) row.judgedStep = overview.criteria && row.judged >= overview.criteria ? "done" : "attention";
      if (staleJudgements(judgements, approved).length) {
        row.judgedStep = "attention";
        row.problem ??= "some judgements were recorded against an earlier approved text; check them again";
      }
    } catch (err) {
      row.judgedStep = "attention";
      row.problem ??= message(err);
    }
    overview.submissions.push(row);
  }
  return overview;
}
