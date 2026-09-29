/** Marks on the source rubric: a mark within a level, quick picks, and the overall a set of marks implies. */

import { expect, test } from "vitest";
import { criterionMax, entryMark, impliedOverall, markProblem, quickMarks, type Criterion } from "../src/core/index.ts";

const level = (id: string, label: string, points: number | null, range: [number, number] | null = null) => ({
  id,
  label,
  descriptor: label,
  points,
  min_mark: range?.[0] ?? null,
  max_mark: range?.[1] ?? null,
});
// Uneven levels, as real rubrics have them.
const insight: Criterion = {
  id: "insight",
  title: "Insight",
  description: "",
  weight: 25,
  max_points: null,
  levels: [level("p100", "Outstanding (100)", 100), level("p85", "Excellent (85)", 85), level("p75", "Very good (75)", 75), level("p65", "Good (65)", 65), level("p55", "Competent (55)", 55), level("p15", "Poor Fail (15)", 15), level("p0", "Fail (0)", 0)],
};
const lv = (id: string) => insight.levels.find((l) => l.id === id)!;

test("quick picks are 3 below, the level's points and 3 above, within 0 and the maximum", () => {
  expect(criterionMax(insight)).toBe(100);
  expect(quickMarks(insight, lv("p65"))).toEqual([62, 65, 68]);
  expect(quickMarks(insight, lv("p100"))).toEqual([97, 100]);
  expect(quickMarks(insight, lv("p0"))).toEqual([0, 3]);
  expect(quickMarks(insight, level("x", "No points", null))).toEqual([]);
});

test("a mark must fit its level: no nearer another level's points, or within its range", () => {
  expect(markProblem(insight, lv("p65"), 68)).toBeNull();
  expect(markProblem(insight, lv("p65"), 70)).toBeNull(); // halfway: either level
  expect(markProblem(insight, lv("p65"), 72)).toBe("a mark of 72 is nearer Very good (75) than Good (65); choose that level, or a mark nearer Good (65)");
  expect(markProblem(insight, lv("p15"), 30)).toBeNull(); // between Fail-bands, the gap is wide
  expect(markProblem(insight, lv("p100"), 101)).toBe("Insight is marked out of 100, so 101 is too high");
  expect(markProblem(insight, lv("p65"), -1)).toMatch(/at least 0/);
  const ranged = level("r", "2:1", null, [60, 69]);
  expect(markProblem({ ...insight, levels: [ranged] }, ranged, 64)).toBeNull();
  expect(markProblem({ ...insight, levels: [ranged] }, ranged, 70)).toBe("a mark of 70 is outside 2:1's range (60 to 69)");
});

test("a judgement's mark is the one recorded, or (from before marks) its level's points", () => {
  expect(entryMark(insight, { level_id: "p65", mark: 68 })).toBe(68);
  expect(entryMark(insight, { level_id: "p65", mark: null })).toBe(65);
});

test("the overall that marks imply is weighted, each mark a share of its criterion's maximum; what is missing is said, never guessed", () => {
  const build: Criterion = { ...insight, id: "build", title: "Build", weight: 75, max_points: 80 };
  const marks: Record<string, number> = { insight: 62, build: 40 }; // 62 of 100, 40 of 80 = 50
  expect(impliedOverall([insight, build], (c) => marks[c.id])).toEqual({ mark: 53 }); // 62·¼ + 50·¾
  expect(impliedOverall([insight, { ...build, weight: 25 }], (c) => marks[c.id])).toEqual({ mark: 56 });
  expect(impliedOverall([insight, build], (c) => (c.id === "insight" ? 62 : null))).toEqual({ missing: "no mark for Build" });
  expect(impliedOverall([insight, build], () => null, (c) => `no level for ${c.title}`)).toEqual({ missing: "no level for Insight" });
  expect(impliedOverall([insight, { ...build, weight: null }], (c) => marks[c.id])).toEqual({ missing: "the source rubric has no criterion weights" });
});
