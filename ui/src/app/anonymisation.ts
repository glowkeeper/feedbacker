/**
 * The anonymisation step in the app: the extra values to redact, and what
 * the moderator reviews for each record. Real values are taken from the
 * extract only when the moderator asks to see them.
 */

import { ALT_TEXT_PREFIX, BRIEF, BRIEF_ID, figureProblems, listSubmissions, loadBrief, loadSubmission, readFigure, submissionPath, submissionsKnown, type Workspace, WorkspaceError } from "../core/index.ts";

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
      // An approval stands only while the figures it covers are still the images approved.
      const included = (sub.extract?.figures ?? []).filter((f) => !sub.excluded_figures.some((e) => e.placeholder === f.placeholder));
      const broken = sub.approval ? await figureProblems(ws, sub.id, included) : [];
      out.push({ id: s.submission_id, label, anonymised: sub.anonymised !== null, approved: sub.approval !== null && !broken.length, problem: broken.length ? `its approval no longer holds: ${broken.join("; ")}` : null });
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

/** A figure as it is reviewed: where it was, whether it is sent, and its image to show (or why it can't be shown). */
export interface ReviewFigure {
  placeholder: string;
  page: number | null;
  mediaType: string | null;
  excluded: boolean;
  reason: string | null;
  bytes: Uint8Array | null; // to show; null if it can't be
  problem: string | null; // why it can't be shown
  intact: boolean; // its stored image is the one extracted (or it has none to check)
  alt: string | null; // the student's own alternative text for it, as anonymised in the text; null if they gave none
}

/** The text in order: runs of text, and each figure where its placeholder is. */
export type Segment = { kind: "text"; text: string } | { kind: "figure"; placeholder: string };

export interface Review {
  id: string;
  label: string;
  text: string;
  segments: Segment[];
  figures: ReviewFigure[];
  figureProblems: string[]; // included figures whose image is missing or not what was extracted: no approval stands while there are any
  replacements: Replacement[];
  approvedAt: string | null;
}

/** Image types a browser shows; others (EMF, WMF, TIFF) are kept and listed, but not shown. */
const SHOWN = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/svg+xml"]);

/** Split the text at each of these placeholders. */
export function segmentsOf(text: string, placeholders: string[]): Segment[] {
  if (!placeholders.length) return [{ kind: "text", text }];
  const known = new Set(placeholders);
  const out: Segment[] = [];
  let from = 0;
  for (const m of text.matchAll(/\[FIGURE_[1-9][0-9]*\]/g)) {
    if (!known.has(m[0])) continue;
    if (m.index > from) out.push({ kind: "text", text: text.slice(from, m.index) });
    out.push({ kind: "figure", placeholder: m[0] });
    from = m.index + m[0].length;
  }
  if (from < text.length) out.push({ kind: "text", text: text.slice(from) });
  return out;
}

/** One record's anonymised text and its replacements; real values only with `withValues`. */
export async function reviewOf(ws: Workspace, id: string, withValues: boolean): Promise<Review> {
  const record = id === BRIEF_ID ? await loadBrief(ws) : await loadSubmission(ws, id);
  if (!record.anonymised || !record.extract) {
    throw new WorkspaceError(`${id === BRIEF_ID ? "the brief" : id} has not been anonymised; anonymise it first`);
  }
  const points = withValues ? [...record.extract.text] : [];
  // A submission's figures are reviewed with its text; the brief's are not sent, so not reviewed.
  const figures: ReviewFigure[] = [];
  if (record.kind === "submission") {
    for (const f of record.extract.figures) {
      const excluded = record.excluded_figures.find((e) => e.placeholder === f.placeholder);
      // Every figure's image is checked against its hash, whether or not it can be shown.
      let bytes: Uint8Array | null = null;
      let problem: string | null = null;
      let intact = true;
      if (!f.media_type) problem = "its image wasn't kept (its format can't be sent, or it couldn't be read)";
      else {
        try {
          bytes = await readFigure(ws, record.id, f);
        } catch (err) {
          problem = err instanceof Error ? err.message : String(err);
          intact = false;
        }
        if (bytes && !SHOWN.has(f.media_type)) {
          bytes = null;
          problem = `its format (${f.media_type.replace("image/", "").replace(/^x-/, "").toUpperCase()}) can't be shown here`;
        }
      }
      // Only a figure whose own alternative text was extracted, and only the paragraph straight after its placeholder
      // (which is in the text exactly once): the student's prose elsewhere can't become an image's description.
      const after = f.alt_text ? record.anonymised.text.split(f.placeholder)[1] : undefined;
      const alt = after?.startsWith(`\n\n${ALT_TEXT_PREFIX} `) ? after.slice(2 + ALT_TEXT_PREFIX.length + 1).split("\n\n")[0] : null;
      figures.push({ placeholder: f.placeholder, page: f.page, mediaType: f.media_type, excluded: !!excluded, reason: excluded?.reason ?? null, bytes, problem, intact, alt });
    }
  }
  const figureProblems = figures.filter((f) => !f.excluded && !f.intact).map((f) => `${f.placeholder}: ${f.problem}`);
  return {
    id,
    label: record.kind === "brief" ? "The brief" : `${record.id} ${record.pseudonym}`,
    text: record.anonymised.text,
    segments: segmentsOf(record.anonymised.text, figures.map((f) => f.placeholder)),
    figures,
    figureProblems,
    replacements: record.anonymised.redactions.map((r) => ({
      replacement: r.replacement,
      reason: r.reason,
      original: withValues ? points.slice(r.start, r.end).join("") : null,
    })),
    approvedAt: figureProblems.length ? null : (record.approval?.approved_at ?? null), // no approval stands over a broken figure
  };
}
