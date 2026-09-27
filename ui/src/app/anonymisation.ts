/**
 * The anonymisation step in the app: reading the rules form as the command
 * line reads it, and what the moderator reviews for each record. Real values
 * are taken from the extract only when the moderator asks to see them.
 */

import { BRIEF, BRIEF_ID, loadBrief, loadRequest, loadSubmission, REQUEST, submissionPath, type Workspace, WorkspaceError } from "../core/index.ts";
import { pyIsAlpha, pyIsCased, pyIsUpper } from "../core/pyre.ts";

const lines = (text: string) => text.split(/\r?\n/).filter((l) => l.trim());

/** Python's `str.isupper() and str.isalpha()`: letters only, with at least one capital and no small letter. */
function isKind(kind: string): boolean {
  const cps = [...kind].map((ch) => ch.codePointAt(0)!);
  return cps.length > 0 && cps.every(pyIsAlpha) && cps.some(pyIsUpper) && cps.every((c) => pyIsUpper(c) || !pyIsCased(c));
}

/**
 * Extra values to redact, one per line, as the command line reads them:
 * `TEXT=KIND` when KIND is capital letters (e.g. `aquill99=USERNAME`),
 * otherwise the whole line is the text, redacted as REDACTED.
 */
export function parseRedactions(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of lines(text)) {
    const at = line.lastIndexOf("=");
    const kind = at < 0 ? "" : line.slice(at + 1);
    if (at >= 0 && isKind(kind)) out[line.slice(0, at)] = kind;
    else out[line] = "REDACTED";
  }
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
 * The records that can be anonymised: each imported sampled submission, and
 * the brief. No request yet means none; a request that doesn't load is an
 * error, reported as it is.
 */
export async function recordsToReview(ws: Workspace): Promise<RecordStatus[]> {
  const out: RecordStatus[] = [];
  const sample = (await ws.exists(REQUEST)) ? (await loadRequest(ws)).sample : [];
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
