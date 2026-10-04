/** The checks on feedback, with synthetic feedback that should and shouldn't raise each flag. */

import { expect, test } from "vitest";
import { bandOf, checkCriterionFeedback, checkFeedback, DEFAULT_PRAISE, PraiseWords, unaccepted, type Criterion } from "../src/core/index.ts";

const NEXT = " Next time, test the edge cases.";
const kinds = (flags: { check: string; detail: string }[]) => flags.map((f) => `${f.check}:${f.detail}`);
const check = (text: string, mark: number | null, max: number | null = 100) => kinds(checkFeedback(text, mark, max, DEFAULT_PRAISE));

test("marks are banded on the UK scale", () => {
  expect([95, 70, 69.9, 60, 58, 50, 45, 40, 39].map(bandOf)).toEqual(["first", "first", "upper_second", "upper_second", "lower_second", "lower_second", "third", "third", "fail"]);
});

test("praise above the mark's band is flagged; praise that fits is not", () => {
  expect(check(`Excellent analysis throughout.${NEXT}`, 58)).toEqual(["praise:excellent"]);
  expect(check(`Excellent analysis throughout.${NEXT}`, 75)).toEqual([]);
  expect(check(`A very good and thorough account.${NEXT}`, 55)).toEqual(["praise:very good", "praise:thorough"]);
  expect(check(`A very good and thorough account.${NEXT}`, 65)).toEqual([]);
  expect(check(`A good attempt.${NEXT}`, 45)).toEqual(["praise:good"]);
  expect(check(`Satisfactory in places.${NEXT}`, 30)).toEqual(["praise:satisfactory"]);
  // On a 7-point criterion, 4 is 57%: a lower second.
  expect(check(`Outstanding.${NEXT}`, 4, 7)).toEqual(["praise:outstanding"]);
});

test("negated praise, and words inside other words, are not flagged", () => {
  expect(check(`This is not yet excellent, and the design isn't strong.${NEXT}`, 55)).toEqual([]);
  expect(check(`A goodish start; the strongest part is the testing.${NEXT}`, 45)).toEqual([]);
});

test("feedback without a next step is flagged", () => {
  expect(check("Clear and well argued.", 72)).toEqual(["next_step:no next step"]);
  for (const step of ["Next time, plan earlier.", "In future, cite sources.", "In the future, add tests.", "Going forward, reflect more."]) expect(check(`Clear. ${step}`, 72)).toEqual([]);
});

test("a mark other than the one awarded is flagged; the awarded mark is not", () => {
  expect(check(`This deserves 68%.${NEXT}`, 62)).toEqual(["other_mark:68%"]);
  expect(check(`Worth 68/100.${NEXT}`, 62)).toEqual(["other_mark:68/100"]);
  expect(check(`A mark of 68 would need more.${NEXT}`, 62)).toEqual(["other_mark:mark of 68"]);
  expect(check(`You earned 62%.${NEXT}`, 62)).toEqual([]);
  expect(check(`You wrote 42 tests.${NEXT}`, 62)).toEqual([]); // a count, not a mark
});

test("a classification other than the mark's is flagged; the mark's own is not", () => {
  expect(check(`This is 2:1 work.${NEXT}`, 55)).toEqual(["other_mark:2:1"]);
  expect(check(`This is first-class work.${NEXT}`, 65)).toEqual(["other_mark:first-class"]);
  expect(check(`Solid upper second work.${NEXT}`, 64)).toEqual([]);
});

test("another level's label is flagged; ordinary words that are labels are not", () => {
  const c = {
    id: "design",
    title: "Design",
    weight: 25,
    max_points: 100,
    levels: [
      { id: "p68", label: "2:1 (68)", points: 68, descriptor: "", min_mark: null, max_mark: null },
      { id: "p55", label: "2:2 (55)", points: 55, descriptor: "", min_mark: null, max_mark: null },
      { id: "basic", label: "Basic", points: null, descriptor: "", min_mark: null, max_mark: null },
    ],
  } as unknown as Criterion;
  expect(kinds(checkCriterionFeedback(`Closer to 2:1 (68) than you think.${NEXT}`, c, "p55", 55, DEFAULT_PRAISE))).toEqual(["other_mark:2:1", "other_mark:2:1 (68)"]);
  expect(kinds(checkCriterionFeedback(`A basic account.${NEXT}`, c, "p55", 55, DEFAULT_PRAISE))).toEqual([]);
});

test("an accepted flag is no longer open, only for the same check and detail", () => {
  const flags = checkFeedback(`Excellent.`, 58, 100, DEFAULT_PRAISE);
  const accepted = { accepted_flags: [{ check: "praise" as const, detail: "excellent", reason: "Quoting the brief's own word" }] };
  expect(kinds(unaccepted(flags, accepted))).toEqual(["next_step:no next step"]);
});

test("marks are compared as what they are: a percentage, a fraction of its own total, or a raw mark", () => {
  // 4 out of 7 is 57%.
  expect(check(`You earned 57%.${NEXT}`, 4, 7)).toEqual([]);
  expect(check(`You earned 4/7.${NEXT}`, 4, 7)).toEqual([]);
  expect(check(`You earned 8/14.${NEXT}`, 4, 7)).toEqual([]);
  expect(check(`You earned 70%.${NEXT}`, 4, 7)).toEqual(["other_mark:70%"]);
  // An overall 62: "62/50" names another mark, however its first number reads.
  expect(check(`This is 62/50.${NEXT}`, 62)).toEqual(["other_mark:62/50"]);
  expect(check(`This is 62 out of 100.${NEXT}`, 62)).toEqual([]);
  expect(check(`This is 62.4%.${NEXT}`, 62)).toEqual([]); // rounds to the mark
});

test("fail as a grade is a classification; the verb isn't", () => {
  expect(check(`This is fail-grade work.${NEXT}`, 55)).toEqual(["other_mark:fail-grade"]);
  expect(check(`Frankly, a fail.${NEXT}`, 45)).toEqual(["other_mark:a fail"]);
  expect(check(`The design fails to justify its choices.${NEXT}`, 55)).toEqual([]);
  expect(check(`This is fail-grade work.${NEXT}`, 30)).toEqual([]); // the mark's own band
});

test("blank phrases in the workspace's lists are left out, so nothing matches everywhere", () => {
  expect(PraiseWords.parse({ first: ["  ", "excellent ", ""], upper_second: [], lower_second: [], third: [] }).first).toEqual(["excellent"]);
  expect(kinds(checkFeedback(`Fine.${NEXT}`, 55, 100, { first: [""], upper_second: [], lower_second: [], third: [] }))).toEqual([]);
});
