/** The setup forms read input as the Python command line does (#19). */

import { expect, test } from "vitest";
import { FormProblem, parseBands, parseCount, parseMark, parsePairs, parsePoints, parseRequestForm, parseSample, parseWeights, problemsOf } from "../src/app/forms.ts";
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

test("weights follow Python's float(), as the command line does: no hex or binary", () => {
  for (const bad of ["x=0x10", "x=0b10", "x=0o7", "x=1e", "x=--1"]) expect(() => parseWeights(bad), bad).toThrow("must look like CRITERION_ID=PERCENT");
  expect([...parseWeights("x=1_0\ny = 25 %\nz=1e1")]).toEqual([["x", 10], ["y", 25], ["z", 10]]);
});

test("the request form reports every problem together", () => {
  const fields = { sample: "60-69:100200301", programme: "", module: "", roles: "", cohort: "4.5", groups: "unknown" as const, bands: "60-69\n70-79=x", note: "" };
  const err = (() => {
    try {
      parseRequestForm(fields);
    } catch (e) {
      return e as FormProblem;
    }
  })()!;
  expect(err.problems).toHaveLength(3); // the cohort, and both bad bands
  const ok = parseRequestForm({ ...fields, cohort: "40", bands: "60-69=12", groups: "multiple", roles: "module convener\nsecond marker" });
  expect(ok.options).toMatchObject({ cohort_size: 40, multiple_groups: true, band_distribution: [{ label: "60-69", count: 12 }], staff_roles: ["module convener", "second marker"] });
});

test("pairs and points read as the command line reads them", () => {
  expect([...parsePairs("PROFESSIONALISM = reflection\nA=B=c", "MARKER_NAME=SOURCE_ID")]).toEqual([["PROFESSIONALISM", "reflection"], ["A=B", "c"]]);
  expect(() => parsePairs("X=\n=y", "MARKER_NAME=SOURCE_ID")).toThrow("'X=' must look like MARKER_NAME=SOURCE_ID");
  expect([...parsePoints("implementation=58\nreflection = 62.5")]).toEqual([["implementation", 58], ["reflection", 62.5]]);
  expect(() => parsePoints("implementation=abc")).toThrow("points for 'implementation' must be a number, not 'abc'");
  expect([parseMark(" ", "the overall mark"), parseMark("61", "the overall mark")]).toEqual([null, 61]);
  expect(() => parseMark("0x3d", "the overall mark")).toThrow("the overall mark must be a number, not '0x3d'");
});

test("marks must be finite: inf and nan can't be stored", () => {
  for (const bad of ["x=inf", "x=nan", "x=-Infinity"]) expect(() => parsePoints(bad), bad).toThrow("must be a number");
  expect(() => parseMark("inf", "the overall mark")).toThrow("the overall mark must be a number, not 'inf'");
});
