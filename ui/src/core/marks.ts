/**
 * Marks on the source rubric: the moderator's mark for a criterion, within
 * the level they chose, and the overall mark a set of criterion marks
 * implies.
 *
 * A judgement records a level and a mark within it. The mark starts as the
 * level's points, and the moderator can move it a little either way (the
 * quick picks are 3 below, the level's points and 3 above, as in the common
 * 2-5-8 practice within a band), or enter another mark. A mark must fit its
 * level: within the level's mark range when the rubric gives one, and
 * otherwise no nearer another level's points than its own. A judgement
 * recorded before marks existed counts as its level's points.
 *
 * The overall a set of marks implies is weighted by the rubric's criterion
 * weights, with each mark taken as a share of its criterion's maximum
 * (max_points, or else its top level's points), out of 100. It needs a mark
 * for every criterion and a weight for every criterion; otherwise it says
 * what is missing rather than guessing.
 */

import type { AISuggestion, Criterion, JudgementEntry, Level } from "./models.ts";
import { pyFormatG } from "./pytext.ts";

const levelOf = (c: Criterion, id: string | null) => (id === null ? null : (c.levels.find((l) => l.id === id) ?? null));

/** The most a criterion can be marked: its max_points, or else its top level's points (null if it has neither). */
export function criterionMax(c: Criterion): number | null {
  if (c.max_points !== null) return c.max_points;
  const points = c.levels.map((l) => l.points).filter((p): p is number => p !== null);
  return points.length ? Math.max(...points) : null;
}

/** Whether a level takes a mark: it has points (the default mark) or a mark range. */
export const takesMark = (level: Level) => level.points !== null || level.min_mark !== null || level.max_mark !== null;

/** Why a judgement entry's recorded mark doesn't fit its level on this criterion, or null if it does (or has no mark). */
export function entryMarkProblem(c: Criterion, entry: Pick<JudgementEntry, "level_id" | "mark">): string | null {
  const level = levelOf(c, entry.level_id);
  return level && entry.mark !== null ? markProblem(c, level, entry.mark) : null;
}

/** The quick picks for a level: 3 below its points, its points, and 3 above, kept within 0 and the criterion's maximum and within the level. */
export function quickMarks(c: Criterion, level: Level): number[] {
  if (level.points === null) return [];
  const max = criterionMax(c) ?? Infinity;
  const picks = [level.points - 3, level.points, level.points + 3].filter((m) => m >= 0 && m <= max && markProblem(c, level, m) === null);
  return [...new Set(picks)];
}

/** Why a mark doesn't fit the level, or null if it does. */
export function markProblem(c: Criterion, level: Level, mark: number): string | null {
  if (!Number.isFinite(mark) || mark < 0) return `a mark must be a number of at least 0, not ${mark}`;
  const max = criterionMax(c);
  if (max !== null && mark > max) return `${c.title} is marked out of ${pyFormatG(max)}, so ${pyFormatG(mark)} is too high`;
  if (level.min_mark !== null || level.max_mark !== null) {
    const [lo, hi] = [level.min_mark ?? -Infinity, level.max_mark ?? Infinity];
    if (mark < lo || mark > hi) return `a mark of ${pyFormatG(mark)} is outside ${level.label}'s range (${level.min_mark ?? "any"} to ${level.max_mark ?? "any"})`;
    return null;
  }
  if (level.points === null) return `${level.label} has no points, so it can't take a mark`;
  const own = Math.abs(mark - level.points);
  const nearer = c.levels.filter((l) => l.id !== level.id && l.points !== null && Math.abs(mark - l.points) < own);
  if (nearer.length) {
    const closest = nearer.sort((a, b) => Math.abs(mark - a.points!) - Math.abs(mark - b.points!))[0];
    return `a mark of ${pyFormatG(mark)} is nearer ${closest.label} than ${level.label}; choose that level, or a mark nearer ${level.label}`;
  }
  return null;
}

/** The moderator's mark for a criterion: the one recorded, or (recorded before marks existed) the level's points. */
export function entryMark(c: Criterion, entry: Pick<JudgementEntry, "level_id" | "mark">): number | null {
  return entry.mark ?? levelOf(c, entry.level_id)?.points ?? null;
}

/**
 * The overall mark that criterion marks imply: weighted, each mark as a share
 * of its criterion's maximum, out of 100 and rounded to one decimal place.
 * `markOf` gives a criterion's mark, or null for none (and then why).
 */
export function impliedOverall(criteria: Criterion[], markOf: (c: Criterion) => number | null, noMark: (c: Criterion) => string = (c) => `no mark for ${c.title}`): { mark: number } | { missing: string } {
  if (!criteria.length) return { missing: "the source rubric has no criteria" };
  if (criteria.some((c) => c.weight === null)) return { missing: "the source rubric has no criterion weights" };
  let total = 0;
  let weights = 0;
  for (const c of criteria) {
    const mark = markOf(c);
    if (mark === null) return { missing: noMark(c) };
    const max = criterionMax(c);
    if (max === null || !(max > 0)) return { missing: `${c.title} has no maximum points` };
    total += c.weight! * (mark / max) * 100;
    weights += c.weight!;
  }
  return { mark: Math.round((total / weights) * 10) / 10 };
}

/**
 * The provisional mark the AI's proposed levels imply, worked out exactly as an implied mark is, from each proposed
 * level's points and the rubric's weights: the AI never gives a mark. Where a criterion has no proposed level, it says
 * so rather than guessing.
 */
export function provisionalMark(criteria: Criterion[], proposalOf: (criterionId: string) => AISuggestion | undefined): { mark: number } | { missing: string } {
  return impliedOverall(
    criteria,
    (c) => levelOf(c, proposalOf(c.id)?.suggested_level_id ?? null)?.points ?? null,
    (c) => {
      const proposal = proposalOf(c.id);
      if (!proposal) return `there is no proposal for ${c.title}`;
      if (proposal.suggested_level_id === null) return `the AI proposed no level for ${c.title}${proposal.missing_evidence ? " (it found too little evidence)" : ""}`;
      return `the level proposed for ${c.title} has no points`;
    },
  );
}
