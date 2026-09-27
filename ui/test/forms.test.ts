/** The setup forms read input as the Python command line does (#19). */

import { expect, test } from "vitest";
import { FormProblem, parseBands, parseCount, parseSample, parseWeights, problemsOf } from "../src/app/forms.ts";
import { RequestError } from "../src/core/index.ts";

test("the sample: BAND:ID,ID or ID,ID per line, split at the last colon", () => {
  expect(parseSample("60-69:100200301,100200302\n2:1:100200303\n\n100200304")).toEqual([
    { external_id: "100200301", band: "60-69" },
    { external_id: "100200302", band: "60-69" },
    { external_id: "100200303", band: "2:1" },
    { external_id: "100200304", band: null },
  ]);
});

test("bands are LABEL=COUNT, and every bad line is reported", () => {
  expect(parseBands("60-69=2\n2:1 = 3")).toEqual([{ label: "60-69", count: 2 }, { label: "2:1", count: 3 }]);
  const err = (() => {
    try {
      parseBands("60-69\n=2\n70-79=x");
    } catch (e) {
      return e as FormProblem;
    }
  })()!;
  expect(err.problems).toHaveLength(3);
  expect(err.problems[0]).toContain("must look like LABEL=COUNT");
});

test("weights are CRITERION_ID=PERCENT, with an optional %", () => {
  expect([...parseWeights("implementation=25\nrequirements-and-design = 25%")]).toEqual([["implementation", 25], ["requirements-and-design", 25]]);
  expect(() => parseWeights("implementation")).toThrow("must look like CRITERION_ID=PERCENT");
  expect(() => parseWeights("implementation=lots")).toThrow("must look like CRITERION_ID=PERCENT");
});

test("a count is a whole number, or empty", () => {
  expect(parseCount(" ", "the cohort size")).toBeNull();
  expect(parseCount("40", "the cohort size")).toBe(40);
  expect(() => parseCount("4.5", "the cohort size")).toThrow("the cohort size must be a whole number");
});

test("problems come from the core's list, or an error's message", () => {
  expect(problemsOf(new RequestError(["a", "b"]))).toEqual(["a", "b"]);
  expect(problemsOf(new Error("plain"))).toEqual(["plain"]);
});
