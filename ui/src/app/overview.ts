/**
 * The moderation at a glance: for each sampled submission, how far it has
 * got, and the workspace-wide steps (rubric, brief). Everything is read from
 * the workspace; a record that doesn't load is shown as a problem, never
 * skipped silently.
 */

import {
  BRIEF,
  loadBrief,
  currentReview,
  loadJudgements,
  loadMarking,
  loadVerdict,
  loadSubmissionMark,
  educatorMarking,
  isStale,
  loadFeedback,
  feedbackFlags,
  approvalState,
  OVERALL,
  submissionMarkStale,
  readingProblems,
  staleJudgements,
  staleVerdict,
  loadReadings,
  listSubmissions,
  loadRequest,
  loadRubric,
  loadSubmission,
  readingPath,
  RUBRIC,
  submissionPath,
  submissionsKnown,
  type Rubric,
  type Verdict,
  type Workspace,
  type WorkspaceSubmission,
} from "../core/index.ts";
import { markingRecords } from "./markingRecords.ts";

export type Step = "missing" | "done" | "attention";

export interface SubmissionRow {
  id: string;
  pseudonym: string;
  band: string | null;
  original: Step;
  anonymised: Step;
  approved: Step;
  marking: Step; // "attention": imported but not yet confirmed, or a record doesn't load
  markingImported: boolean; // at least one marker's record loads (confirmed or not: a blind review leaves it unconfirmed until the reveal)
  reading: Step;
  judged: number; // criteria with a recorded judgement
  judgedStep: Step; // "attention": some criteria judged, not all
  verdict: Verdict | null;
  verdictStale: boolean; // given on other marking, or another approved text, than there is now
  overall: Step; // a marking workspace's overall mark: "attention" when given on other criterion marks than there are now
  feedback: Step; // a marking workspace's feedback: done when every criterion and the overall have current feedback
  approval: Step; // a marking workspace's approval of what the student receives: "attention" when it has changed since
  review: string | null; // how it is reviewed, e.g. "blind, not yet revealed"; null until chosen
  problem: string | null; // the first problem found, for the overview's table
  problems: { original: string | null; marking: string | null; reading: string | null; review: string | null }; // each step's own, for its reason
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
  let rubric: Rubric | null = null;
  if (await ws.exists(RUBRIC)) {
    try {
      rubric = await loadRubric(ws);
      overview.criteria = rubric.criteria.length;
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
  // The workspace's submissions: a moderation's sample, or a marking workspace's cohort.
  let submissions: WorkspaceSubmission[];
  try {
    if (!(await submissionsKnown(ws))) return overview;
    submissions = await listSubmissions(ws);
    if (ws.manifest.workspace_type !== "marking") {
      const { context } = await loadRequest(ws);
      overview.request = { module: context.module, programme: context.programme, cohortSize: context.cohort_size };
    }
  } catch (err) {
    overview.problem = message(err);
    return overview;
  }
  const marking = await markingRecords(ws);
  for (const s of submissions) {
    const row: SubmissionRow = { id: s.submission_id, pseudonym: s.pseudonym, band: s.listed_band, original: "missing", anonymised: "missing", approved: "missing", marking: "missing", markingImported: false, reading: "missing", judged: 0, judgedStep: "missing", verdict: null, verdictStale: false, overall: "missing", feedback: "missing", approval: "missing", review: null, problem: null, problems: { original: null, marking: null, reading: null, review: null } };
    let approved: string | null = null;
    let approvalId: string | null = null;
    if (await ws.exists(submissionPath(s.submission_id))) {
      try {
        const sub = await loadSubmission(ws, s.submission_id);
        approved = sub.approval?.approved_text_sha256 ?? null;
        approvalId = sub.approval?.id ?? null;
        row.original = "done";
        row.anonymised = sub.anonymised ? "done" : "missing";
        row.approved = sub.approval ? "done" : "missing";
      } catch (err) {
        row.original = "attention";
        row.problem = row.problems.original = message(err);
      }
    }
    // Every marker's record: done when all are confirmed, needing attention otherwise.
    const own = marking.filter((m) => m.submissionId === s.submission_id);
    row.markingImported = own.some((m) => !m.problem);
    if (own.length) {
      row.marking = own.every((m) => m.confirmed && !m.problem) ? "done" : "attention";
      row.problems.marking = own.find((m) => m.problem)?.problem ?? null;
      row.problem ??= row.problems.marking;
    }
    if (await ws.exists(readingPath(s.submission_id))) {
      try {
        const [problem] = readingProblems(s.submission_id, await loadReadings(ws, s.submission_id), approved, { approvalId, rubric });
        if (problem) throw new Error(problem);
        row.reading = "done";
      } catch (err) {
        row.reading = "attention";
        row.problems.reading = message(err);
        row.problem ??= row.problems.reading;
      }
    }
    try {
      const state = await currentReview(ws, s.submission_id);
      const judgements = await loadJudgements(ws, s.submission_id);
      row.review = state?.mode === "blind" ? (state.revealed_at ? "blind, revealed" : "blind, not yet revealed") : (state?.mode ?? null);
      row.judged = judgements.length;
      if (row.judged) row.judgedStep = overview.criteria && row.judged >= overview.criteria ? "done" : "attention";
      if (rubric && staleJudgements(judgements, approved, rubric).length) {
        row.judgedStep = "attention";
        row.problems.review ??= "some judgements were recorded against an earlier approved text or source rubric; check them again";
        row.problem ??= row.problems.review;
      }
    } catch (err) {
      row.judgedStep = "attention";
      row.problems.review ??= message(err);
      row.problem ??= row.problems.review;
    }
    if (ws.manifest.workspace_type === "marking") {
      // The educator's overall mark, in place of a verdict on someone else's marking.
      try {
        const mark = await loadSubmissionMark(ws, s.submission_id);
        if (mark) row.overall = (await submissionMarkStale(ws, mark)) ? "attention" : "done";
        if (row.overall === "attention") {
          row.problems.review ??= "the overall mark was given on other criterion marks than there are now; check it again";
          row.problem ??= row.problems.review;
        }
      } catch (err) {
        row.overall = "attention";
        row.problems.review ??= message(err);
        row.problem ??= row.problems.review;
      }
      // The educator's feedback: current for every criterion and the overall, or some, or out of date.
      try {
        const given = await loadFeedback(ws, s.submission_id);
        if (given.length && row.original === "done" && row.approved === "done") {
          const m = await educatorMarking(ws, s.submission_id);
          const targets = [...m.rubric.criteria.map((c) => c.id), OVERALL];
          const current = given.filter((f) => !isStale(m, f.criterion_id, f.given_on)).length;
          const open = (await feedbackFlags(ws, s.submission_id)).some((f) => f.open.length);
          row.feedback = current === targets.length && given.length === targets.length && !open ? "done" : "attention";
        } else if (given.length) row.feedback = "attention";
        if (row.approved === "done") {
          const a = await approvalState(ws, s.submission_id);
          row.approval = a.current ? "done" : a.approval ? "attention" : "missing";
        }
      } catch (err) {
        row.feedback = "attention";
        row.problems.review ??= message(err);
        row.problem ??= row.problems.review;
      }
      overview.submissions.push(row);
      continue;
    }
    try {
      const verdict = await loadVerdict(ws, s.submission_id);
      row.verdict = verdict?.verdict ?? null;
      if (verdict) {
        const own = marking.filter((m) => m.submissionId === s.submission_id && !m.problem);
        const markings = await Promise.all(own.map((m) => loadMarking(ws, s.submission_id, m.markerLabel!)));
        row.verdictStale = rubric !== null && staleVerdict(verdict, approved, markings, rubric, await loadJudgements(ws, s.submission_id));
        if (row.verdictStale) {
          row.problems.review ??= "the verdict was recorded against earlier marking, an earlier approved text or rubric, or other marks of yours; check it again";
          row.problem ??= row.problems.review;
        }
      }
    } catch (err) {
      row.problems.review ??= message(err);
      row.problem ??= row.problems.review;
    }
    overview.submissions.push(row);
  }
  return overview;
}
