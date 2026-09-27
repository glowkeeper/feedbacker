/**
 * The three-way comparison for one submission (#19): for each criterion, the
 * moderator's judgement, each marker's mark and the AI suggestion, side by
 * side. Every difference is said in words (never by colour alone), and a
 * marker's level label that doesn't fit their score on the source rubric is
 * flagged, never corrected.
 */

import { describeBetween, type Criterion, type Level, type OriginalCriterionMark } from "../core/index.ts";
import { pyFormatG } from "../core/pytext.ts";
import type { Review } from "./review.ts";

export interface Cell {
  text: string; // what was given, e.g. "58 / 100; the marker's level: 2:2 (55); on the source rubric: between 2:2 (55) and 2:1 (62)"
  comparison: string | null; // how it compares with the moderator's level, in words; null when there is nothing to compare
  differs: boolean;
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

function markerCell(mark: OriginalCriterionMark | null, c: Criterion, yours: Level | null): Cell {
  if (!mark || mark.mark === null) return { text: "No mark", comparison: null, differs: false, flag: null };
  // The marker's own label as written, then where the score sits on the source rubric: never one in place of the other.
  const onRubric = mark.level_id ? (levelOf(c, mark.level_id)?.label ?? mark.level_id) : describeBetween(mark.mark, c);
  const text = `${mark.raw_score || points(mark.mark)}${mark.raw_label ? `; the marker's level: ${mark.raw_label}` : ""}; on the source rubric: ${onRubric}`;
  const flag = labelFlag(mark, c);
  if (!yours) return { text, comparison: null, differs: false, flag };
  if (mark.level_id === yours.id) return { text, comparison: "Agrees with your level", differs: false, flag };
  if (yours.points === null) return { text, comparison: "Differs from your level", differs: true, flag };
  const diff = mark.mark - yours.points;
  if (diff === 0) return { text, comparison: "Agrees with your level's points", differs: false, flag };
  return {
    text,
    comparison: `${diff > 0 ? "More generous" : "Harsher"} than your level (${yours.label}) by ${points(Math.abs(diff))} point${Math.abs(diff) === 1 ? "" : "s"}`,
    differs: true,
    flag,
  };
}

function aiCell(levelId: string | null, c: Criterion, yours: Level | null): Cell {
  const suggested = levelOf(c, levelId);
  if (!suggested) return { text: "No level suggested", comparison: null, differs: false, flag: null };
  const text = suggested.label;
  if (!yours) return { text, comparison: null, differs: false, flag: null };
  if (suggested.id === yours.id) return { text, comparison: "Agrees with your level", differs: false, flag: null };
  if (suggested.points === null || yours.points === null) return { text, comparison: "Suggests a different level from yours", differs: true, flag: null };
  const higher = suggested.points > yours.points;
  return { text, comparison: `Suggests a ${higher ? "higher" : "lower"} level than yours (${yours.label})`, differs: true, flag: null };
}

/** The comparison, criterion by criterion; empty while the marking and the AI reading aren't shown. */
export function compare(review: Review): CriterionComparison[] {
  if (!review.shown) return [];
  return review.rubric.criteria.map((c) => {
    const j = review.judgements.get(c.id);
    const entry = j ? (j.revised ?? j.first) : null; // the moderator's current view: the revision, if any
    const yours = levelOf(c, entry?.level_id ?? null);
    const reading = review.readings.get(c.id);
    return {
      criterionId: c.id,
      title: c.title,
      yours: yours ? `${yours.label}${j?.revised ? ` (revised from ${levelOf(c, j.first.level_id)?.label ?? j.first.level_id})` : ""}` : null,
      markers: review.markings.map((m) => ({ marker: m.marker_label, cell: markerCell(m.criterion_marks.find((x) => x.criterion_id === c.id) ?? null, c, yours) })),
      ai: reading ? aiCell(reading.suggested_level_id, c, yours) : null,
    };
  });
}
