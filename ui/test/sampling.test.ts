/** The sampling schemes: pure, repeatable, and never choosing for the moderator. All marks are fictional. */

import { expect, test } from "vitest";
import { boundariesOf, DEFAULT_SAMPLE_PERCENT, describeSample, sampleSize, suggest, type Candidate } from "../src/core/index.ts";

const MARKS = [82, 78, 75, 68, 66, 62, 55, 48, 41, 38, 25];
const cohort = (): Candidate[] => MARKS.map((initial, i) => ({ row: i + 1, initial, agreed: null }));
const BANDS = [
  { label: "70+", from: 70, to: null },
  { label: "60-69", from: 60, to: 69 },
  { label: "50-59", from: 50, to: 59 },
  { label: "40-49", from: 40, to: 49 },
  { label: "0-39", from: 0, to: 39 },
];
const marksOf = (rows: number[]) => rows.map((r) => MARKS[r - 1]);

test("the size is a percentage of those who submitted, always rounded up, and a tenth unless told otherwise", () => {
  expect(DEFAULT_SAMPLE_PERCENT).toBe(10);
  expect([[6, 25], [6, 10], [7, 10], [10, 10], [11, 10], [20, 15], [100, 100], [1, 1], [3, 200]].map(([n, p]) => sampleSize(n, p))).toEqual([2, 1, 1, 1, 2, 3, 100, 1, 3]);
  expect([sampleSize(0, 10), sampleSize(5, 0), sampleSize(5, -3), sampleSize(5, Number.NaN)]).toEqual([0, 0, 0, 0]);
});

test("a spread takes the highest and lowest first, then every fail, then the marks nearest each boundary, then spaces the rest", () => {
  const two = suggest("spread", cohort(), { size: 2, bands: BANDS });
  expect(marksOf(two.rows)).toEqual([82, 25]); // with room for two: the extremes
  const five = suggest("spread", cohort(), { size: 5, bands: BANDS });
  expect(marksOf(five.rows).slice(0, 4)).toEqual([82, 25, 38, 68]); // the extremes, the other fail (below 40), then the mark nearest the 70 boundary
  expect(five.rows).toHaveLength(5);
  const eight = suggest("spread", cohort(), { size: 8, bands: BANDS }).rows;
  expect(new Set(eight).size).toBe(8);
  expect(marksOf(eight)).toEqual(expect.arrayContaining([82, 25, 38, 68, 62, 48])); // 62 near 60, 48 near 50: each boundary has a mark near it
  // The same input gives the same sample, whatever order the rows come in.
  expect(suggest("spread", [...cohort()].reverse(), { size: 5, bands: BANDS }).rows).toEqual(five.rows);
});

test("a spread says when it can't take every fail, and what it couldn't place", () => {
  const result = suggest("spread", cohort(), { size: 2, bands: BANDS, passMark: 50 }); // four fail at 50; room for two
  expect(result.notes).toContain("4 student(s) failed (below 50), and the sample has room for only some of them.");
  const unmarked = suggest("spread", [...cohort(), { row: 12, initial: null, agreed: null }], { size: 3, bands: BANDS });
  expect(unmarked.notes).toContain("1 student(s) have no mark, so they can't be placed in the spread.");
  expect(unmarked.rows).not.toContain(12);
  expect(suggest("spread", [{ row: 1, initial: null, agreed: null }], { size: 1 }).notes).toEqual(["None of the students has a mark to spread the sample across."]);
});

test("a pass mark of the moderator's own is used", () => {
  const rows = suggest("spread", cohort(), { size: 4, bands: BANDS, passMark: 50 }).rows;
  expect(marksOf(rows)).toEqual([82, 25, 38, 41]); // the extremes, then the fails from the lowest up
});

test("boundary cases are the marks nearest a boundary, within the distance, closest first", () => {
  expect(boundariesOf(BANDS)).toEqual([70, 60, 50, 40]);
  const three = suggest("boundary", cohort(), { size: 3, bands: BANDS, distance: 2 });
  expect(marksOf(three.rows)).toEqual([41, 68, 62]); // 1 away, then 2 away in row order
  expect(three.notes).toEqual([]);
  const many = suggest("boundary", cohort(), { size: 6, bands: BANDS, distance: 2 });
  expect(marksOf(many.rows)).toEqual([41, 68, 62, 48, 38]);
  expect(many.notes).toEqual(["Only 5 student(s) have a mark within 2 of a band boundary, fewer than the 6 wanted."]);
  expect(suggest("boundary", cohort(), { size: 2 }).notes).toEqual(["The request's band labels couldn't be read, so there are no boundaries to be near."]);
});

test("a random sample is repeatable from its seed, distinct, and from the candidates", () => {
  const a = suggest("random", cohort(), { size: 4, seed: "ab12cd34" });
  expect(suggest("random", cohort(), { size: 4, seed: "ab12cd34" }).rows).toEqual(a.rows);
  expect(suggest("random", [...cohort()].reverse(), { size: 4, seed: "ab12cd34" }).rows).toEqual(a.rows); // not the order the rows come in
  expect(new Set(a.rows).size).toBe(4);
  expect(a.rows.every((r) => r >= 1 && r <= 11)).toBe(true);
  const others = ["s1", "s2", "s3", "s4", "s5"].map((seed) => suggest("random", cohort(), { size: 4, seed }).rows.join());
  expect(new Set([a.rows.join(), ...others]).size).toBeGreaterThan(1); // different seeds don't all give the same sample
  // Students with no mark can still be sampled at random.
  expect(suggest("random", [{ row: 1, initial: null, agreed: null }, { row: 2, initial: null, agreed: null }], { size: 2, seed: "x" }).rows.sort()).toEqual([1, 2]);
});

test("marks changed by internal moderation: the furthest moves first, and only real changes", () => {
  const rows: Candidate[] = [
    { row: 1, initial: 82, agreed: 82 },
    { row: 2, initial: 25, agreed: 15 },
    { row: 3, initial: 65, agreed: null },
    { row: 4, initial: 70, agreed: 66 },
    { row: 5, initial: 55, agreed: 59 },
  ];
  const result = suggest("changed", rows, { size: 2 });
  expect(result.rows).toEqual([2, 4]); // moved by 10, then by 4 (row 5 also moved 4: the earlier row first)
  expect(suggest("changed", rows, { size: 5 }).notes).toEqual(["Only 3 student(s) have a mark that was changed, fewer than the 5 wanted."]);
  expect(suggest("changed", rows, { size: 5 }).rows).toEqual([2, 4, 5]);
});

test("picking by hand suggests nothing, and a size beyond the cohort is the cohort", () => {
  expect(suggest("hand", cohort(), { size: 3 })).toEqual({ rows: [], notes: [] });
  expect(suggest("random", cohort().slice(0, 3), { size: 10, seed: "z" }).rows).toHaveLength(3);
  expect(suggest("spread", [], { size: 3 }).rows).toEqual([]);
});

test("how the sample was chosen is said in words, with the seed where there is one", () => {
  expect(describeSample({ scheme: "spread", percent: 25, submitted: 6, size: 2, passMark: 50 })).toBe(
    "25% of the 6 who submitted (2), rounded up, chosen as a spread across the bands (the highest and lowest marks, every fail below 50, the marks nearest each band boundary, and the rest spaced evenly)",
  );
  expect(describeSample({ scheme: "random", percent: 10, submitted: 30, size: 3, seed: "ab12" })).toBe("10% of the 30 who submitted (3), rounded up, chosen at random from the seed ab12");
  expect(describeSample({ scheme: "boundary", percent: 10, submitted: 30, size: 3, distance: 1 })).toContain("within 1 of a band boundary");
  expect(describeSample({ scheme: "hand", percent: 10, submitted: 30, size: 3 })).toBe("10% of the 30 who submitted (3), rounded up, chosen by hand");
});
