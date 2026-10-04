/** The three-way comparison and the label flags. */

import { expect, test } from "vitest";
import { compare, compareOverall, labelFlag } from "../src/app/comparison.ts";
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
  stale: new Set(),
  verdict: null,
  verdictStale: false,
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
    ["marker", "68 / 100; the marker's level: 2:1 (68); on the source rubric: 2:1 (68)", "More generous than your mark (62) by 6 points", true],
    ["second marker", "62 / 100; on the source rubric: 2:1 (62)", "Agrees with your mark (62)", false],
    ["third", "58 / 100; the marker's level: 2:2 (55); on the source rubric: between 2:2 (55) and 2:1 (62)", "Harsher than your mark (62) by 4 points", true],
  ]);
  expect(row.ai).toEqual({ text: "1ST (75)", comparison: "Suggests a higher level than yours (2:1 (62))", differs: true, direction: "higher", flag: null });
});

test("a revised judgement is compared, and its first level shown beside it", () => {
  const [row] = compare(review({ mode: "blind", revealedAt: "t", judgements: new Map([["design", judgement("p55", "p68")]]), markings: [assessment("marker", mark(68, null, "p68"))] }));
  expect(row.yours).toBe("2:1 (68) (revised from 2:2 (55))");
  expect(row.markers[0].cell.comparison).toBe("Agrees with your mark (68)");
});

test("a mark moved within the level is shown beside it, and compared with the marker's mark", () => {
  const moved = { submission_id: "sub-001", criterion_id: "design", mode: "open", first: { level_id: "p62", mark: 64 }, revised: null } as unknown as ModeratorJudgement;
  const [row] = compare(review({ judgements: new Map([["design", moved]]), markings: [assessment("marker", mark(68, null, "p68")), assessment("second", mark(64, null))] }));
  expect(row.yours).toBe("2:1 (62), mark 64");
  expect(row.markers.map(({ cell }) => cell.comparison)).toEqual(["More generous than your mark (64) by 4 points", "Agrees with your mark (64)"]);
});

test("before a judgement there is nothing to compare, and nothing at all while hidden", () => {
  const [row] = compare(review({ markings: [assessment("marker", mark(68, "2:2 (55)"))], readings: new Map([["design", { suggested_level_id: null } as AISuggestion]]) }));
  expect([row.yours, row.markers[0].cell.comparison, row.markers[0].cell.flag !== null, row.ai?.text]).toEqual([null, null, true, "No level suggested"]);
  expect(compare(review({ shown: false, markings: [assessment("marker", mark(68, null))] }))).toEqual([]);
});

test("the marker's own label is shown as written, beside the source rubric's level, never replaced by it", () => {
  const [row] = compare(review({ markings: [assessment("marker", mark(68, "2:2 (55)", "p68"))] }));
  const { cell } = row.markers[0];
  expect(cell.text).toBe("68 / 100; the marker's level: 2:2 (55); on the source rubric: 2:1 (68)");
  expect(cell.flag).toMatch(/^The marker's level "2:2 \(55\)" doesn't fit their score of 68 \/ 100/);
});

// --- Overall -------------------------------------------------------------------------------------

const second: Criterion = { ...criterion, id: "build", title: "Build", weight: 50, max_points: null, levels: [level("b80", "Top (80)", 80), level("b40", "Half (40)", 40)] };

test("the overall row: the marker's mark as awarded, and what the moderator's and the AI's levels imply (never a mark)", () => {
  const judgementOf = (criterion_id: string, level_id: string) => ({ ...judgement(level_id), criterion_id }) as unknown as ModeratorJudgement;
  const r = review({
    rubric: { criteria: [criterion, second] } as Review["rubric"],
    judgements: new Map([["design", judgementOf("design", "p62")]]),
    markings: [{ marker_label: "marker", criterion_marks: [], overall_mark: 62, raw_overall: "62 /100", raw_rubric_total: "61.55 / 100" } as unknown as OriginalAssessment],
    readings: new Map([
      ["design", { suggested_level_id: "p75" } as AISuggestion],
      ["build", { suggested_level_id: "b80" } as AISuggestion],
    ]),
  });
  expect(compareOverall(r)).toEqual({
    yours: "Not yet: 1 of 2 criteria judged",
    markers: [{ marker: "marker", text: "62 /100, as awarded (rubric total 61.55 / 100)" }],
    ai: "87.5 / 100, implied by its suggested levels (not a mark)",
  });
  r.judgements.set("build", judgementOf("build", "b40"));
  r.verdict = { suggested_mark: 58 } as Review["verdict"];
  const both = compareOverall(r)!;
  expect(both.yours).toBe("56 / 100, implied by your marks; your suggested mark: 58");
  expect(both.markers[0].text).toBe("62 /100, as awarded (rubric total 61.55 / 100); 6 above what your marks imply");
  expect(both.ai).toBe("87.5 / 100, implied by its suggested levels (not a mark); 31.5 above what your marks imply");
  // Without weights, nothing is guessed; and nothing shows before a blind reveal.
  const unweighted = compareOverall({ ...r, rubric: { criteria: [criterion, { ...second, weight: null }] } as Review["rubric"] })!;
  expect([unweighted.yours, unweighted.ai]).toEqual(["Can't be worked out: the source rubric has no criterion weights; your suggested mark: 58", "Can't be worked out: the source rubric has no criterion weights"]);
  expect(compareOverall({ ...r, shown: false })).toBeNull();
  // An out-of-date judgement isn't counted: no overall of the moderator's, and nothing compared with one.
  const stale = compareOverall({ ...r, stale: new Set(["build"]) })!;
  expect([stale.yours, stale.markers[0].text]).toEqual(["Can't be worked out: out of date: Build (record it again); your suggested mark: 58", "62 /100, as awarded (rubric total 61.55 / 100)"]);
  // Where the AI gave no level, the row says so, and why.
  r.readings.set("build", { suggested_level_id: null, missing_evidence: true } as AISuggestion);
  expect(compareOverall(r)!.ai).toBe("Can't be worked out: the AI suggested no level for Build (it found too little evidence)");
  r.readings.delete("build");
  expect(compareOverall(r)!.ai).toBe("Can't be worked out: the AI reading has nothing for Build");
});
