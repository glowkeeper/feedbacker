/**
 * Agreement across the sample: for each submission and for each
 * criterion, how often the original marking and the AI suggestion agree
 * with the moderator's level, and which way they differ. Built from the same
 * comparison the review shows, so a blind review counts only once revealed,
 * and only judged criteria are compared.
 */

import { loadRubric, RUBRIC, type Verdict, type Workspace } from "../core/index.ts";
import { compare, type Cell } from "./comparison.ts";
import { loadReview, reviewChoices } from "./review.ts";

export interface Tally {
  agree: number;
  higher: number; // the marking more generous, or the AI suggesting a higher level
  lower: number;
  different: number; // differs without a direction (no points to compare)
}

export interface SubmissionAgreement {
  id: string;
  label: string;
  status: "compared" | "not judged" | "hidden" | "unavailable"; // why a submission isn't compared, if it isn't
  compared: number; // criteria judged and compared
  stale: number; // judgements of an earlier approved text: not compared until checked again
  marking: Tally;
  ai: Tally;
  flags: number; // marker's level labels that don't fit their scores
  verdict: Verdict | null;
}

export interface CriterionAgreement {
  id: string;
  title: string;
  compared: number; // submissions where this criterion is judged and compared
  marking: Tally;
  ai: Tally;
}

export interface Agreement {
  submissions: SubmissionAgreement[];
  criteria: CriterionAgreement[];
}

const empty = (): Tally => ({ agree: 0, higher: 0, lower: 0, different: 0 });

function count(t: Tally, cell: Cell) {
  if (cell.comparison === null) return;
  if (!cell.differs) t.agree += 1;
  else t[cell.direction ?? "different"] += 1;
}

export const disagreements = (t: Tally) => t.higher + t.lower + t.different;

/** Agreement across the sample; null until there is a rubric to compare against. */
export async function loadAgreement(ws: Workspace): Promise<Agreement | null> {
  if (!(await ws.exists(RUBRIC))) return null;
  const rubric = await loadRubric(ws);
  const criteria: CriterionAgreement[] = rubric.criteria.map((c) => ({ id: c.id, title: c.title, compared: 0, marking: empty(), ai: empty() }));
  const submissions: SubmissionAgreement[] = [];
  for (const choice of await reviewChoices(ws)) {
    const row: SubmissionAgreement = { ...choice, status: "unavailable", compared: 0, stale: 0, marking: empty(), ai: empty(), flags: 0, verdict: null };
    submissions.push(row);
    let review;
    try {
      review = await loadReview(ws, choice.id);
    } catch {
      continue; // its problem is shown in the overview's own table
    }
    row.verdict = review.verdict?.verdict ?? null;
    if (review.problems.length && !review.shown) continue;
    if (!review.shown) {
      row.status = review.mode === "blind" ? "hidden" : "not judged";
      continue;
    }
    // A judgement of an earlier approved text isn't counted: it is to be checked again.
    row.stale = review.stale.size;
    const current = new Map([...review.judgements].filter(([cid]) => !review.stale.has(cid)));
    row.status = current.size ? "compared" : "not judged";
    for (const r of compare({ ...review, judgements: current })) {
      row.flags += r.markers.filter((m) => m.cell.flag).length;
      if (r.yours === null) continue;
      const totals = criteria.find((c) => c.id === r.criterionId)!;
      row.compared += 1;
      totals.compared += 1;
      for (const { cell } of r.markers) {
        count(row.marking, cell);
        count(totals.marking, cell);
      }
      if (r.ai) {
        count(row.ai, r.ai);
        count(totals.ai, r.ai);
      }
    }
  }
  return { submissions, criteria };
}

/** A tally in words, e.g. "2 agree; 1 differs (1 more generous)". */
export function describe(t: Tally, what: "marking" | "ai"): string {
  const differ = disagreements(t);
  if (!t.agree && !differ) return "Nothing to compare";
  const ways = [
    t.higher ? `${t.higher} ${what === "marking" ? "more generous" : "higher"}` : "",
    t.lower ? `${t.lower} ${what === "marking" ? "harsher" : "lower"}` : "",
    t.different ? `${t.different} a different level` : "",
  ].filter(Boolean);
  return `${t.agree} agree${differ ? `; ${differ} differ${differ === 1 ? "s" : ""} (${ways.join(", ")})` : ""}`;
}
