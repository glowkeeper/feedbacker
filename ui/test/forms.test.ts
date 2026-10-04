/** The setup forms: lists entered row by row, and numbers per criterion in a box each. */

import { expect, test } from "vitest";
import { bandsFrom, FormProblem, parseCount, parseMark, parseRequestForm, pointsFrom, problemsOf, sampleFrom, totalWeight, weightsFrom } from "../src/app/forms.ts";
import { RequestError } from "../src/core/index.ts";

const problemsIn = (read: () => unknown) => {
  try {
    read();
  } catch (e) {
    return (e as FormProblem).problems;
  }
  return [];
};

test("the sample: a row per band, its IDs separated by commas, spaces or new lines; a row with no band has none", () => {
  expect(
    sampleFrom([
      { band: "60-69", ids: "100200301, 100200302" },
      { band: " 2:1 ", ids: "100200303" },
      { band: "", ids: "100200304\n100200305  100200306" },
      { band: "", ids: "  " },
    ]),
  ).toEqual([
    { external_id: "100200301", band: "60-69" },
    { external_id: "100200302", band: "60-69" },
    { external_id: "100200303", band: "2:1" },
    { external_id: "100200304", band: null },
    { external_id: "100200305", band: null },
    { external_id: "100200306", band: null },
  ]);
  expect(problemsIn(() => sampleFrom([{ band: "70+", ids: "" }]))).toEqual(["the band '70+' has no submission IDs"]);
});

test("the band distribution: a row per band with a whole number of students; empty rows are ignored, and every bad row is reported", () => {
  expect(bandsFrom([{ label: "60-69", count: "2" }, { label: "2:1", count: " 3 " }, { label: "", count: "" }])).toEqual([
    { label: "60-69", count: 2 },
    { label: "2:1", count: 3 },
  ]);
  expect(problemsIn(() => bandsFrom([{ label: "60-69", count: "" }, { label: "", count: "2" }, { label: "70-79", count: "x" }]))).toEqual([
    "the band '60-69' needs a whole number of students",
    "the number of students 2 needs its band",
    "the band '70-79' needs a whole number of students, not 'x'",
  ]);
});

const titles = new Map([["implementation", "Implementation"], ["design", "Design"]]);

test("weights: a percentage per criterion (a % is allowed), empty boxes left out, problems named by the criterion's title", () => {
  expect([...weightsFrom({ implementation: "25", design: " 25 % " }, titles)]).toEqual([["implementation", 25], ["design", 25]]);
  expect([...weightsFrom({ implementation: "", design: "30" }, titles)]).toEqual([["design", 30]]);
  expect(problemsIn(() => weightsFrom({ implementation: "lots" }, titles))).toEqual(["the weight for Implementation must be a number, not 'lots'"]);
});

test("numbers follow Python's float(), as the command line does: no hex or binary, and never inf or nan", () => {
  for (const bad of ["0x10", "0b10", "0o7", "1e", "--1", "inf", "nan", "-Infinity"]) {
    expect(problemsIn(() => weightsFrom({ design: bad }, titles)), bad).toHaveLength(1);
    expect(problemsIn(() => pointsFrom({ design: bad }, titles)), bad).toEqual([`the mark for Design must be a number, not '${bad}'`]);
  }
  expect([...weightsFrom({ implementation: "1_0", design: "1e1" }, titles)]).toEqual([["implementation", 10], ["design", 10]]);
});

test("the running total of weights: only while every box could be saved (never inf or nan)", () => {
  expect(totalWeight({ a: "25", b: " 20 % ", c: "" })).toBe(45);
  expect(totalWeight({})).toBe(0);
  for (const bad of ["lots", "inf", "nan", "-Infinity", "0x10"]) expect(totalWeight({ a: "25", b: bad }), bad).toBeNull();
});

test("marks by criterion, and a mark", () => {
  expect([...pointsFrom({ implementation: "58", design: " 62.5 " }, titles)]).toEqual([["implementation", 58], ["design", 62.5]]);
  expect([parseMark(" ", "the overall mark"), parseMark("61", "the overall mark")]).toEqual([null, 61]);
  expect(() => parseMark("0x3d", "the overall mark")).toThrow("the overall mark must be a number, not '0x3d'");
  expect(() => parseMark("inf", "the overall mark")).toThrow("the overall mark must be a number, not 'inf'");
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

test("the request form reports every problem together", () => {
  const fields = {
    sample: [{ band: "70+", ids: "" }],
    programme: "",
    module: "",
    roles: "",
    cohort: "4.5",
    groups: "unknown" as const,
    bands: [{ label: "60-69", count: "" }, { label: "70-79", count: "x" }],
    note: "",
  };
  expect(problemsIn(() => parseRequestForm(fields))).toHaveLength(4); // the empty band, the cohort, and both bad bands
  const ok = parseRequestForm({ ...fields, sample: [{ band: "60-69", ids: "100200301" }], cohort: "40", bands: [{ label: "60-69", count: "12" }], groups: "multiple", roles: "module convener\nsecond marker" });
  expect(ok.sample).toEqual([{ external_id: "100200301", band: "60-69" }]);
  expect(ok.options).toMatchObject({ cohort_size: 40, multiple_groups: true, band_distribution: [{ label: "60-69", count: 12 }], staff_roles: ["module convener", "second marker"] });
});

test("core messages that name command-line commands are put in the app's terms", async () => {
  const { inApp, problemsOf } = await import("../src/app/forms.ts");
  expect(problemsOf(new Error("import the source rubric first ('rubric import')"))).toEqual(["import the source rubric first (Rubric)"]);
  expect(inApp("criterion 'X' (25%, 58 / 100, selected none) could not be mapped to the source rubric; map it with --criterion")).toBe(
    "criterion 'X' (25%, 58 / 100, selected none) could not be mapped to the source rubric; match it under \"Match the marker's criteria\" and import again",
  );
});

test("no core message the app can show still names a command-line command once put in the app's terms", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { inApp } = await import("../src/app/forms.ts");
  const dir = new URL("../src/core/", import.meta.url);
  const cli = /'(rubric|brief|anonymise|marking|reading|originals|request) [a-z]+[^']*'|--(criterion|no-brief|confirm|replace)\b/;
  const left: string[] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    for (const line of readFileSync(new URL(name, dir), "utf8").split("\n")) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line) || !cli.test(line)) continue; // comments may name commands
      if (cli.test(inApp(line))) left.push(`${name}: ${line.trim()}`);
    }
  }
  expect(left).toEqual([]);
});
