/** The three-way comparison and the label flags (#19). */

import { expect, test } from "vitest";
import { compare, labelFlag } from "../src/app/comparison.ts";
import type { Review } from "../src/app/review.ts";
import type { AISuggestion, Criterion, ModeratorJudgement, OriginalAssessment, OriginalCriterionMark } from "../src/core/index.ts";

const level = (id: string, label: string, points: number | null, range: [number, number] | null = null) => ({
  id,
  label,
  descriptor: label,
  points,
  min_mark: range?.[0] ?? null,
  max_mark: range?.[1] ?? null,
});
const criterion: Criterion = {
  id: "design",
  title: "Design",
  description: "",
  weight: 50,
  max_points: 100,
  levels: [level("p75", "1ST (75)", 75), level("p68", "2:1 (68)", 68), level("p62", "2:1 (62)", 62), level("p55", "2:2 (55)", 55)],
};
const mark = (points: number | null, label: string | null, levelId: string | null = null): OriginalCriterionMark => ({
  criterion_id: "design",
  level_id: levelId,
  mark: points,
  raw_criterion: "DESIGN",
  raw_label: label,
  raw_score: points === null ? null : `${points} / 100`,
  comment: null,
});

test.each([
  [68, "2:1 (68)", null], // exactly its level
  [65, "2:1 (68)", null], // between its level and the next
  [65, "2:1 (62)", null],
  [58, "2:2 (55)", null], // between 2:2 (55) and 2:1 (62)
  [65, "  2:1  (62) ", null], // spacing and case don't matter
  [65, "Band X", null], // not a level of the source rubric: can't be checked
  [65, "2:2 (55)", "The marker's level \"2:2 (55)\" doesn't fit their score of 65 / 100, which is between 2:1 (62) and 2:1 (68) on the source rubric. Check it; it hasn't been changed."],
  [80, "2:1 (68)", "The marker's level \"2:1 (68)\" doesn't fit their score of 80 / 100, which is above 1ST (75) on the source rubric. Check it; it hasn't been changed."],
])("a score of %s with the label %j is flagged: %j", (points, label, flag) => {
  expect(labelFlag(mark(points, label), criterion)).toBe(flag);
});

test("a level with a mark range is checked against the range", () => {
  const ranged: Criterion = { ...criterion, levels: [level("a", "2:1", null, [60, 69]), level("b", "2:2", null, [50, 59])] };
  expect(labelFlag(mark(64, "2:1"), ranged)).toBeNull();
  expect(labelFlag(mark(64, "2:2"), ranged)).toMatch(/^The marker's level "2:2" doesn't fit their score of 64 \/ 100/);
});

const judgement = (first: string, revised: string | null = null) =>
  ({ submission_id: "sub-001", criterion_id: "design", mode: revised ? "blind" : "open", first: { level_id: first }, revised: revised ? { level_id: revised } : null }) as unknown as ModeratorJudgement;
const assessment = (marker: string, m: OriginalCriterionMark) => ({ marker_label: marker, criterion_marks: [m] }) as unknown as OriginalAssessment;
const review = (overrides: Partial<Review>): Review => ({
  id: "sub-001",
  pseudonym: "[STUDENT_A]",
  text: "text",
  brief: null,
  rubric: { criteria: [criterion] } as Review["rubric"],
  markings: [],
  readings: new Map(),
  judgements: new Map(),
  verdict: null,
  mode: "open",
  revealedAt: null,
  shown: true,
  notes: [],
  problems: [],
  ...overrides,
});

test("each difference is said in words, beside the moderator's level", () => {
  const [row] = compare(
    review({
      judgements: new Map([["design", judgement("p62")]]),
      markings: [assessment("marker", mark(68, "2:1 (68)", "p68")), assessment("second marker", mark(62, null, "p62")), assessment("third", mark(58, "2:2 (55)"))],
      readings: new Map([["design", { suggested_level_id: "p75" } as AISuggestion]]),
    }),
  );
  expect(row.yours).toBe("2:1 (62)");
  expect(row.markers.map(({ marker, cell }) => [marker, cell.text, cell.comparison, cell.differs])).toEqual([
    ["marker", "68 / 100 (2:1 (68))", "More generous than your level (2:1 (62)) by 6 points", true],
    ["second marker", "62 / 100 (2:1 (62))", "Agrees with your level", false],
    ["third", "58 / 100 (between 2:2 (55) and 2:1 (62))", "Harsher than your level (2:1 (62)) by 4 points", true],
  ]);
  expect(row.ai).toEqual({ text: "1ST (75)", comparison: "Suggests a higher level than yours (2:1 (62))", differs: true, flag: null });
});

test("a revised judgement is compared, and its first level shown beside it", () => {
  const [row] = compare(review({ mode: "blind", revealedAt: "t", judgements: new Map([["design", judgement("p55", "p68")]]), markings: [assessment("marker", mark(68, null, "p68"))] }));
  expect(row.yours).toBe("2:1 (68) (revised from 2:2 (55))");
  expect(row.markers[0].cell.comparison).toBe("Agrees with your level");
});

test("before a judgement there is nothing to compare, and nothing at all while hidden", () => {
  const [row] = compare(review({ markings: [assessment("marker", mark(68, "2:2 (55)"))], readings: new Map([["design", { suggested_level_id: null } as AISuggestion]]) }));
  expect([row.yours, row.markers[0].cell.comparison, row.markers[0].cell.flag !== null, row.ai?.text]).toEqual([null, null, true, "No level suggested"]);
  expect(compare(review({ shown: false, markings: [assessment("marker", mark(68, null))] }))).toEqual([]);
});
