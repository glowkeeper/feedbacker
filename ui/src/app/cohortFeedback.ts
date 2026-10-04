/**
 * The cohort's feedback side by side, for consistency (the third part of the maintainer's definition, 2026-10-02):
 * for each criterion, the submissions grouped by the educator's level, each with its recorded feedback, and the
 * overall feedback grouped by the overall mark's UK band. Outliers are flagged in words:
 *
 * - **much shorter or longer** than the rest at its level: under half, or over twice, the median length of the
 *   feedback recorded at that level (only where at least three are recorded, so a median means something);
 * - **nearly the same** as another student's on the same criterion: most of its three-word runs are shared.
 *
 * Only what is current is compared: a mark recorded against the text and rubric as they are now, and feedback given
 * on that marking. Anything out of date is listed, with why, rather than grouped or compared. Everything here is
 * worked out on this computer, from the workspace; nothing is sent.
 */

import { BAND_NAMES, bandOf, educatorMarking, entryMark, isStale, loadFeedback, loadRubric, OVERALL, type Band, type EducatorMarking, type Workspace } from "../core/index.ts";
import { pyFormatG } from "../core/pytext.ts";
import { reviewChoices } from "./review.ts";

export interface CohortEntry {
  submissionId: string;
  label: string; // e.g. "sub-001 [STUDENT_A]"
  mark: number | null;
  text: string | null; // the recorded feedback; null while none is recorded
}

export interface LevelGroup {
  key: string; // a level's id, or a band
  label: string; // the level's label, or the band's name
  entries: CohortEntry[];
}

export interface Outlier {
  submissionId: string;
  message: string;
}

export interface CriterionView {
  target: string; // a criterion's id, or OVERALL
  title: string;
  groups: LevelGroup[]; // highest level first
  unmarked: string[]; // submissions with no mark for it yet
  notCompared: string[]; // submissions left out because a record is out of date (or can't be read), each with why
  outliers: Outlier[];
}

const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];

const median = (ns: number[]) => {
  const s = [...ns].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Three-word runs (or the words themselves, for very short feedback). */
function shingles(text: string): Set<string> {
  const w = words(text);
  if (w.length < 3) return new Set(w);
  return new Set(w.slice(0, -2).map((_, i) => w.slice(i, i + 3).join(" ")));
}

/** How much two pieces of feedback share: their three-word runs in common, over all of either's (0 to 1). */
export function similarity(a: string, b: string): number {
  const x = shingles(a);
  const y = shingles(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const s of x) if (y.has(s)) shared++;
  return shared / (x.size + y.size - shared);
}

export const NEAR_DUPLICATE = 0.8;

/** The outliers in one criterion's groups: length within each level, and near-duplicates across all of them. */
export function outliersOf(groups: LevelGroup[]): Outlier[] {
  const out: Outlier[] = [];
  for (const g of groups) {
    const given = g.entries.filter((e) => e.text);
    if (given.length < 3) continue;
    const lengths = given.map((e) => words(e.text!).length);
    const m = median(lengths);
    given.forEach((e, i) => {
      const n = lengths[i];
      if (n < m / 2) out.push({ submissionId: e.submissionId, message: `${e.label}: much shorter than the rest at ${g.label} (${n} words; their median is ${pyFormatG(m)})` });
      else if (n > m * 2) out.push({ submissionId: e.submissionId, message: `${e.label}: much longer than the rest at ${g.label} (${n} words; their median is ${pyFormatG(m)})` });
    });
  }
  const all = groups.flatMap((g) => g.entries.filter((e) => e.text));
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (similarity(all[i].text!, all[j].text!) >= NEAR_DUPLICATE) {
        out.push({ submissionId: all[i].submissionId, message: `${all[i].label} and ${all[j].label}: nearly the same feedback; check each says what is true of that student's work` });
      }
    }
  }
  return out;
}

/** Every criterion's view, and the overall's, from the workspace as it is now: only current marks and feedback are compared. */
export async function loadCohortFeedback(ws: Workspace): Promise<CriterionView[]> {
  const rubric = await loadRubric(ws);
  const choices = await reviewChoices(ws);
  const blank = (target: string, title: string): CriterionView => ({ target, title, groups: [], unmarked: [], notCompared: [], outliers: [] });
  const views = rubric.criteria.map((c) => blank(c.id, c.title));
  const overall = blank(OVERALL, "Overall");
  const all = [...views, overall];
  for (const s of choices) {
    let m: EducatorMarking;
    try {
      m = await educatorMarking(ws, s.id); // its current marks, as the rest of the Feedback step reads them
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      for (const v of all) v.notCompared.push(`${s.label}: ${why}`);
      continue;
    }
    const feedback = await loadFeedback(ws, s.id);
    /** Its feedback on a target, if given on the marking as it is now; out-of-date feedback is listed, not compared. */
    const textOf = (v: CriterionView, criterionId: string | null): string | null => {
      const f = feedback.find((x) => x.criterion_id === criterionId);
      if (!f) return null;
      if (isStale(m, criterionId, f.given_on)) {
        v.notCompared.push(`${s.label}: its feedback was given on other marking than there is now; check it`);
        return null;
      }
      return f.text;
    };
    rubric.criteria.forEach((c, i) => {
      const v = views[i];
      const e = m.entries.get(c.id);
      if (!e) {
        // Not marked yet, or marked against an earlier text or rubric (so its level can't be compared).
        const why = m.missing.get(c.id) ?? "not marked";
        if (/out of date/.test(why)) v.notCompared.push(`${s.label}: ${why}`);
        else v.unmarked.push(s.label);
        return;
      }
      const level = c.levels.find((l) => l.id === e.level_id);
      let g = v.groups.find((x) => x.key === e.level_id);
      if (!g) v.groups.push((g = { key: e.level_id, label: level?.label ?? e.level_id, entries: [] }));
      g.entries.push({ submissionId: s.id, label: s.label, mark: entryMark(c, e), text: textOf(v, c.id) });
    });
    if (!m.overall) {
      const why = m.missing.get(OVERALL) ?? "no overall mark";
      if (/out of date/.test(why)) overall.notCompared.push(`${s.label}: ${why}`);
      else overall.unmarked.push(s.label);
    } else {
      const band: Band = bandOf(m.overall.mark);
      let g = overall.groups.find((x) => x.key === band);
      if (!g) overall.groups.push((g = { key: band, label: BAND_NAMES[band], entries: [] }));
      g.entries.push({ submissionId: s.id, label: s.label, mark: m.overall.mark, text: textOf(overall, null) });
    }
  }
  // Highest level first: in the rubric's order (highest first), and bands best first.
  rubric.criteria.forEach((c, i) => views[i].groups.sort((a, b) => c.levels.findIndex((l) => l.id === a.key) - c.levels.findIndex((l) => l.id === b.key)));
  const order = Object.keys(BAND_NAMES);
  overall.groups.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return all.map((v) => ({ ...v, outliers: outliersOf(v.groups) }));
}
