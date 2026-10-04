/**
 * The three-way comparison for one submission: for each criterion, the
 * moderator's judgement, each marker's mark and the AI suggestion, side by
 * side. Every difference is said in words (never by colour alone), and a
 * marker's level label that doesn't fit their score on the source rubric is
 * flagged, never corrected.
 */

import { describeBetween, entryMark, impliedOverall, type Criterion, type Level, type OriginalCriterionMark } from "../core/index.ts";
import { pyFormatG } from "../core/pytext.ts";
import type { Review } from "./review.ts";

export interface Cell {
  text: string; // what was given, e.g. "58 / 100; the marker's level: 2:2 (55); on the source rubric: between 2:2 (55) and 2:1 (62)"
  comparison: string | null; // how it compares with the moderator's level, in words; null when there is nothing to compare
  differs: boolean;
  direction: "higher" | "lower" | "different" | null; // the marker's mark or the AI's level against the moderator's
  flag: string | null; // a marker's level label that doesn't fit their score
}

export interface CriterionComparison {
  criterionId: string;
  title: string;
  yours: string | null; // null until judged
  markers: { marker: string; cell: Cell }[];
  ai: Cell | null; // null when there is no AI reading of this criterion
}

const levelOf = (c: Criterion, id: string | null) => (id === null ? null : (c.levels.find((l) => l.id === id) ?? null));
const points = (n: number) => pyFormatG(n);
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * A flag when the marker's level label names a level of the source rubric
 * that doesn't fit the score: the score is outside that level's mark range,
 * or (with points only) that level isn't the score's own level or one of the
 * two it lies between. E.g. a "2:2 (55)" label on a score of 65, which lies
 * between 2:1 (62) and 2:1 (68).
 */
export function labelFlag(mark: OriginalCriterionMark, c: Criterion): string | null {
  if (!mark.raw_label || mark.mark === null) return null;
  const named = c.levels.filter((l) => norm(l.label) === norm(mark.raw_label!));
  if (!named.length) return null; // a label the source rubric doesn't have can't be checked
  const score = mark.mark;
  const fits = (l: Level) => {
    if (l.min_mark !== null || l.max_mark !== null) return (l.min_mark ?? -Infinity) <= score && score <= (l.max_mark ?? Infinity);
    if (l.points === null) return true; // nothing to check against
    const pointed = c.levels.filter((x) => x.points !== null);
    const below = pointed.filter((x) => x.points! <= score).sort((a, b) => b.points! - a.points!)[0];
    const above = pointed.filter((x) => x.points! >= score).sort((a, b) => a.points! - b.points!)[0];
    return l.points === below?.points || l.points === above?.points;
  };
  if (named.some(fits)) return null;
  return `The marker's level "${mark.raw_label}" doesn't fit their score of ${mark.raw_score || points(score)}, which is ${describeBetween(score, c)} on the source rubric. Check it; it hasn't been changed.`;
}

function markerCell(mark: OriginalCriterionMark | null, c: Criterion, yours: Level | null, yourMark: number | null): Cell {
  if (!mark || mark.mark === null) return { text: "No mark", comparison: null, differs: false, direction: null, flag: null };
  // The marker's own label as written, then where the score sits on the source rubric: never one in place of the other.
  const onRubric = mark.level_id ? (levelOf(c, mark.level_id)?.label ?? mark.level_id) : describeBetween(mark.mark, c);
  const text = `${mark.raw_score || points(mark.mark)}${mark.raw_label ? `; the marker's level: ${mark.raw_label}` : ""}; on the source rubric: ${onRubric}`;
  const flag = labelFlag(mark, c);
  if (!yours) return { text, comparison: null, differs: false, direction: null, flag };
  // Mark against mark; a level without points (so no mark) can only be the same level or not.
  if (yourMark === null) {
    return mark.level_id === yours.id
      ? { text, comparison: "Agrees with your level", differs: false, direction: null, flag }
      : { text, comparison: "Differs from your level", differs: true, direction: "different", flag };
  }
  const diff = mark.mark - yourMark;
  if (diff === 0) return { text, comparison: `Agrees with your mark (${points(yourMark)})`, differs: false, direction: null, flag };
  return {
    text,
    comparison: `${diff > 0 ? "More generous" : "Harsher"} than your mark (${points(yourMark)}) by ${points(Math.abs(diff))} point${Math.abs(diff) === 1 ? "" : "s"}`,
    differs: true,
    direction: diff > 0 ? "higher" : "lower",
    flag,
  };
}

function aiCell(levelId: string | null, c: Criterion, yours: Level | null): Cell {
  const suggested = levelOf(c, levelId);
  if (!suggested) return { text: "No level suggested", comparison: null, differs: false, direction: null, flag: null };
  const text = suggested.label;
  if (!yours) return { text, comparison: null, differs: false, direction: null, flag: null };
  if (suggested.id === yours.id) return { text, comparison: "Agrees with your level", differs: false, direction: null, flag: null };
  if (suggested.points === null || yours.points === null || suggested.points === yours.points) {
    return { text, comparison: "Suggests a different level from yours", differs: true, direction: "different", flag: null };
  }
  const higher = suggested.points > yours.points;
  return { text, comparison: `Suggests a ${higher ? "higher" : "lower"} level than yours (${yours.label})`, differs: true, direction: higher ? "higher" : "lower", flag: null };
}

/** The comparison, criterion by criterion; empty while the marking and the AI reading aren't shown. */
export function compare(review: Review): CriterionComparison[] {
  if (!review.shown) return [];
  return review.rubric.criteria.map((c) => {
    const j = review.judgements.get(c.id);
    const entry = j ? (j.revised ?? j.first) : null; // the moderator's current view: the revision, if any
    const yours = levelOf(c, entry?.level_id ?? null);
    const yourMark = entry ? entryMark(c, entry) : null;
    const reading = review.readings.get(c.id);
    // The level, and the mark within it when it isn't the level's own points.
    const withMark = yours && yourMark !== null && yourMark !== yours.points ? `, mark ${points(yourMark)}` : "";
    return {
      criterionId: c.id,
      title: c.title,
      yours: yours ? `${yours.label}${withMark}${j?.revised ? ` (revised from ${levelOf(c, j.first.level_id)?.label ?? j.first.level_id})` : ""}` : null,
      markers: review.markings.map((m) => ({ marker: m.marker_label, cell: markerCell(m.criterion_marks.find((x) => x.criterion_id === c.id) ?? null, c, yours, yourMark) })),
      ai: reading ? aiCell(reading.suggested_level_id, c, yours) : null,
    };
  });
}

export interface OverallComparison {
  yours: string; // implied by the moderator's marks, and their suggested mark if they have given one
  markers: { marker: string; text: string }[];
  ai: string | null; // implied by the AI's levels (never a mark); null when there is no AI reading
}

const outOf100 = (n: number) => `${pyFormatG(n)} / 100`;
const against = (n: number, yours: { mark: number } | { missing: string }) => {
  if (!("mark" in yours)) return "";
  const diff = Math.round((n - yours.mark) * 10) / 10;
  return diff === 0 ? "; the same as your marks imply" : `; ${pyFormatG(Math.abs(diff))} ${diff > 0 ? "above" : "below"} what your marks imply`;
};

/** The overall marks beside the criteria: the marker's as awarded, that implied by the moderator's marks, and that implied by the AI's levels. */
export function compareOverall(review: Review): OverallComparison | null {
  if (!review.shown) return null;
  const criteria = review.rubric.criteria;
  const current = (c: Criterion) => {
    const j = review.judgements.get(c.id);
    return j ? entryMark(c, j.revised ?? j.first) : null;
  };
  // Out-of-date judgements are never counted: the overall waits until they are recorded again.
  const outOfDate = criteria.filter((c) => review.stale.has(c.id)).map((c) => c.title);
  const yours: { mark: number } | { missing: string } = outOfDate.length
    ? { missing: `out of date: ${outOfDate.join(", ")} (record ${outOfDate.length === 1 ? "it" : "them"} again)` }
    : impliedOverall(criteria, current, (c) => `no mark for ${c.title}`);
  const judged = criteria.filter((c) => review.judgements.has(c.id)).length;
  const suggested = review.verdict?.suggested_mark ?? null;
  const yoursText =
    ("mark" in yours
      ? `${outOf100(yours.mark)}, implied by your marks`
      : judged < criteria.length
        ? `Not yet: ${judged} of ${criteria.length} criteria judged`
        : `Can't be worked out: ${yours.missing}`) + (suggested !== null ? `; your suggested mark: ${pyFormatG(suggested)}` : "");
  const markers = review.markings.map((m) => ({
    marker: m.marker_label,
    text:
      m.overall_mark === null
        ? "No overall mark"
        : `${m.raw_overall || pyFormatG(m.overall_mark)}, as awarded${m.raw_rubric_total ? ` (rubric total ${m.raw_rubric_total})` : ""}${against(m.overall_mark, yours)}`,
  }));
  let ai: string | null = null;
  if (review.readings.size) {
    // Where the AI gave no level, say so and why, rather than blaming the rubric.
    const unread = criteria.find((c) => !review.readings.has(c.id));
    const declined = criteria.find((c) => review.readings.get(c.id)?.suggested_level_id === null);
    const implied = impliedOverall(criteria, (c) => levelOf(c, review.readings.get(c.id)?.suggested_level_id ?? null)?.points ?? null, (c) => `no level with points for ${c.title}`);
    if (unread) ai = `Can't be worked out: the AI reading has nothing for ${unread.title}`;
    else if (declined) {
      const why = review.readings.get(declined.id)!.missing_evidence ? " (it found too little evidence)" : "";
      ai = `Can't be worked out: the AI suggested no level for ${declined.title}${why}`;
    } else ai = "mark" in implied ? `${outOf100(implied.mark)}, implied by its suggested levels (not a mark)${against(implied.mark, yours)}` : `Can't be worked out: ${implied.missing}`;
  }
  return { yours: yoursText, markers, ai };
}

/** The overall the moderator's current marks imply, or null while it can't be worked out (a criterion unjudged or out of date, or no weights). */
export function yourImpliedMark(review: Review): number | null {
  if (review.stale.size) return null;
  const implied = impliedOverall(review.rubric.criteria, (c) => {
    const j = review.judgements.get(c.id);
    return j ? entryMark(c, j.revised ?? j.first) : null;
  });
  return "mark" in implied ? implied.mark : null;
}
