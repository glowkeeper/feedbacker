/**
 * The anonymisation step in the app: the extra values to redact, and what
 * the moderator reviews for each record. Real values are taken from the
 * extract only when the moderator asks to see them.
 */

import { BRIEF, BRIEF_ID, listSubmissions, loadBrief, loadSubmission, submissionPath, submissionsKnown, type Workspace, WorkspaceError } from "../core/index.ts";

/** The kinds offered for an extra value to redact: its token then says what it was, e.g. [USERNAME_1]. */
export const REDACTION_KINDS = [
  { value: "REDACTED", label: "Other (no kind)" },
  { value: "USERNAME", label: "Username" },
  { value: "ID", label: "Identifier" },
  { value: "PROJECT", label: "Project name" },
  { value: "PLACE", label: "Place" },
];

export interface RedactionRow {
  text: string;
  kind: string;
}

/** Extra values to redact, a row each with its kind; a row with no value is ignored. */
export function redactionsFrom(rows: RedactionRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { text, kind } of rows) if (text.trim()) out[text.trim()] = kind || "REDACTED";
  return out;
}

export interface RecordStatus {
  id: string; // a submission ID, or "brief"
  label: string;
  anonymised: boolean;
  approved: boolean;
  problem: string | null; // a record that doesn't load is listed with its problem, never left out
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * The records that can be anonymised: each imported submission (sampled, or in
 * the cohort), and the brief. No request or cohort yet means none; one that
 * doesn't load is an error, reported as it is.
 */
export async function recordsToReview(ws: Workspace): Promise<RecordStatus[]> {
  const out: RecordStatus[] = [];
  const sample = (await submissionsKnown(ws)) ? await listSubmissions(ws) : [];
  for (const s of sample) {
    if (!(await ws.exists(submissionPath(s.submission_id)))) continue;
    const label = `${s.submission_id} ${s.pseudonym}`;
    try {
      const sub = await loadSubmission(ws, s.submission_id);
      out.push({ id: s.submission_id, label, anonymised: sub.anonymised !== null, approved: sub.approval !== null, problem: null });
    } catch (err) {
      out.push({ id: s.submission_id, label, anonymised: false, approved: false, problem: message(err) });
    }
  }
  if (await ws.exists(BRIEF)) {
    try {
      const brief = await loadBrief(ws);
      out.push({ id: BRIEF_ID, label: "The brief", anonymised: brief.anonymised !== null, approved: brief.approval !== null, problem: null });
    } catch (err) {
      out.push({ id: BRIEF_ID, label: "The brief", anonymised: false, approved: false, problem: message(err) });
    }
  }
  return out;
}

export interface Replacement {
  replacement: string;
  reason: string;
  original: string | null; // only when the real values were asked for
}

export interface Review {
  id: string;
  label: string;
  text: string;
  replacements: Replacement[];
  approvedAt: string | null;
}

/** One record's anonymised text and its replacements; real values only with `withValues`. */
export async function reviewOf(ws: Workspace, id: string, withValues: boolean): Promise<Review> {
  const record = id === BRIEF_ID ? await loadBrief(ws) : await loadSubmission(ws, id);
  if (!record.anonymised || !record.extract) {
    throw new WorkspaceError(`${id === BRIEF_ID ? "the brief" : id} has not been anonymised; anonymise it first`);
  }
  const points = withValues ? [...record.extract.text] : [];
  return {
    id,
    label: record.kind === "brief" ? "The brief" : `${record.id} ${record.pseudonym}`,
    text: record.anonymised.text,
    replacements: record.anonymised.redactions.map((r) => ({
      replacement: r.replacement,
      reason: r.reason,
      original: withValues ? points.slice(r.start, r.end).join("") : null,
    })),
    approvedAt: record.approval?.approved_at ?? null,
  };
}
