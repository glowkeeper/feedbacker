/**
 * The scale the overall mark is given on and the grade points it is rounded to: which marks are grade points, the nearest one (a mark exactly halfway
 * rounding up), the ends of the scale, and what is kept in a workspace. How a mark is proposed and recorded with it is in take-proposals.test.ts.
 */

import { expect, test } from "vitest";
import { DEFAULT_GRADE_SCALE, ENDING_IN_2_5_8, GradeScale, describeProposal, describeRounding, gradePoints, checkOverallFeedback, feedbackText, loadGradeScale, outOfOf, percentOfOverall, proposeOverall, roundToScale, saveGradeScale } from "../src/core/index.ts";
import { newWorkspace } from "./proxyHarness.ts";

const ending = GradeScale.parse(ENDING_IN_2_5_8);

test("marks ending in 2, 5 or 8 are the grade points of a percentage, and 0 and 100 are too", () => {
  const points = gradePoints(ending)!;
  expect(points.slice(0, 7)).toEqual([0, 2, 5, 8, 12, 15, 18]);
  expect(points.slice(-5)).toEqual([88, 92, 95, 98, 100]);
  expect(points).toContain(100);
  expect(points).toContain(42);
  expect(points).not.toContain(40);
  expect(gradePoints(DEFAULT_GRADE_SCALE)).toBeNull();
});

test("a mark goes to the nearest grade point, and one exactly halfway goes up", () => {
  expect([66.3, 66.4, 64, 63.4, 63.5, 63.6, 67.4, 67.5].map((m) => roundToScale(m, ending))).toEqual([65, 65, 65, 62, 65, 65, 68, 68]);
  expect(roundToScale(66.3, DEFAULT_GRADE_SCALE)).toBe(66.3);
});

test("the ends of the scale: below the lowest grade point, and a top mark that stays the top", () => {
  expect([0, 0.9, 1, 1.4, 3.4, 3.5].map((m) => roundToScale(m, ending))).toEqual([0, 0, 2, 2, 2, 5]);
  expect([98.9, 99, 99.9, 100].map((m) => roundToScale(m, ending))).toEqual([98, 100, 100, 100]);
  const list = GradeScale.parse({ rounding: "list", points: [35, 45, 55] });
  expect([10, 40, 50, 99].map((m) => roundToScale(m, list))).toEqual([35, 45, 55, 55]); // a list is exactly what was listed: nothing beyond it
});

test("a scale out of another number: a step of a half on a mark out of 10, and the educator's own list out of 7", () => {
  const tenths = GradeScale.parse({ out_of: 10, rounding: "step", step: 0.5 });
  expect(gradePoints(tenths)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]);
  expect([6.7, 6.75, 6.8, 9.9].map((m) => roundToScale(m, tenths))).toEqual([6.5, 7, 7, 10]);
  const sevens = GradeScale.parse({ out_of: 7, rounding: "list", points: [1, 2, 3, 4, 5, 6, 7] });
  expect(roundToScale(4.5, sevens)).toBe(5);
  expect(gradePoints(GradeScale.parse({ out_of: 10, rounding: "step", step: 3 }))).toEqual([0, 3, 6, 9, 10]); // the top of the scale is always one
});

test("the overall is worked out as a percentage, put on the scale, and then rounded: both figures are kept", () => {
  expect(proposeOverall(66.3, ending)).toEqual({ worked: 66.3, mark: 65 });
  expect(proposeOverall(66.3, DEFAULT_GRADE_SCALE)).toEqual({ worked: 66.3, mark: 66.3 });
  const outOfTen = GradeScale.parse({ out_of: 10, rounding: "step", step: 0.5 });
  expect(proposeOverall(66.3, outOfTen)).toEqual({ worked: 6.6, mark: 6.5 });
  expect(describeProposal({ worked: 66.3, mark: 65 })).toBe("66.3, rounded to 65");
  expect(describeProposal({ worked: 65, mark: 65 })).toBe("65");
});

test("a rule is said in words", () => {
  expect(describeRounding(ending)).toBe("rounded to marks ending in 2, 5 or 8");
  expect(describeRounding(GradeScale.parse({ out_of: 10, rounding: "step", step: 0.5 }))).toBe("rounded to the nearest 0.5");
  expect(describeRounding(GradeScale.parse({ rounding: "list", points: [45, 55] }))).toBe("rounded to 45 or 55");
  expect(describeRounding(DEFAULT_GRADE_SCALE)).toBe("not rounded");
});

test("a scale that doesn't make sense is refused, saying why", () => {
  const why = (input: object) => GradeScale.safeParse(input).error?.issues.map((i) => i.message).join("; ");
  expect(why({ rounding: "step" })).toMatch(/needs the step/);
  expect(why({ rounding: "none", step: 5 })).toMatch(/belongs to another kind of rounding/);
  expect(why({ rounding: "pattern", every: 10, at: [2, 10] })).toMatch(/less than the size of the block/);
  expect(why({ rounding: "list", points: [] })).toMatch(/at least one grade point/);
  expect(why({ out_of: 10, rounding: "list", points: [5, 11] })).toMatch(/above 10/);
  expect(why({ rounding: "step", step: 0.01 })).toMatch(/more than 2000 grade points/);
  expect(why({ out_of: 0 })).toBeDefined();
});

test("a workspace keeps its scale, and a workspace that never chose one has the default; choosing the default again keeps nothing", async () => {
  const { ws } = await newWorkspace("grade-scale-1", { workspace_type: "marking" });
  expect(await loadGradeScale(ws)).toEqual(DEFAULT_GRADE_SCALE);
  await saveGradeScale(ws, ending);
  expect(await loadGradeScale(ws)).toEqual(ending);
  await saveGradeScale(ws, DEFAULT_GRADE_SCALE);
  expect(await ws.exists("marks/grade-scale.json")).toBe(false);
  await ws.writeJson("marks/grade-scale.json", { rounding: "step" });
  await expect(loadGradeScale(ws)).rejects.toThrow(/not a valid grade scale: rounding to a step needs the step/);
});

test("a mark is read as a percentage on the scale it was given on, for the checks that are about percentages", () => {
  const outOfTen = GradeScale.parse({ out_of: 10 });
  expect(percentOfOverall({ mark: 7, grade_scale: outOfTen })).toBe(70);
  expect(percentOfOverall({ mark: 65, grade_scale: null })).toBe(65);
  expect([outOfOf({ grade_scale: outOfTen }), outOfOf({ grade_scale: null })]).toEqual([10, 100]);
});

test("full marks are never proposed above the top of the scale, even where one decimal place would pass it", () => {
  const odd = GradeScale.parse({ out_of: 7.25 });
  expect(proposeOverall(100, odd)).toEqual({ worked: 7.25, mark: 7.25 });
});

test("the overall comment is checked against the mark on the scale it was given on: a mark of 7 out of 10 is named as 7 or as 70%, and 8 or 80% are another mark", () => {
  const checks = { first: [], upper_second: [], lower_second: [], third: [], bands: false, nextStep: false };
  const named = (text: string) => checkOverallFeedback(text, 7, checks, 10).map((f) => f.check);
  expect(named("Your mark of 7 reflects careful work.")).toEqual([]);
  expect(named("A solid 70% overall.")).toEqual([]);
  expect(named("A mark of 8 would need more depth.")).toEqual(["other_mark"]);
  expect(checkOverallFeedback("A solid 70% overall.", 70, checks).map((f) => f.check)).toEqual([]); // a percentage as before
});

test("what a student reads says what the overall is out of only when it is not a percentage", () => {
  const f = { submissionId: "sub-001", pseudonym: "A", mark: 7, criteria: [], overall: "Well done." };
  expect(feedbackText(f)).toMatch(/^Overall mark: 7\n/);
  expect(feedbackText({ ...f, overallOutOf: 10 })).toMatch(/^Overall mark: 7 out of 10\n/);
});
