/**
 * Recording the moderation request keeps external IDs out of every record but
 * the key. A port of `core/tests/test_request.py`. Its four command-line tests
 * check argument parsing (`--sample 60-69:...`, `--band LABEL=COUNT`) and
 * output of the Python command line, which the app replaces with its own
 * interface (#19); the behaviour beneath them is tested here.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  loadRequest,
  ModerationRequest,
  pseudonymFor,
  recordRequest,
  RequestError,
  type SampleEntry,
  type Workspace,
} from "../src/core/index.ts";
import { newWorkspace } from "./proxyHarness.ts";

// Fictional identifiers only.
const SAMPLE: SampleEntry[] = [
  { external_id: "100200301", band: "60-69" },
  { external_id: "100200302", band: "60-69" },
  { external_id: "100200303", band: "50-59" },
];

const problemsOf = async (run: Promise<unknown>) => {
  const err = await run.catch((e) => e);
  expect(err).toBeInstanceOf(RequestError);
  return (err as RequestError).problems;
};

test("pseudonyms are sequential letters", () => {
  expect([0, 1, 25, 26, 27, 701, 702].map(pseudonymFor)).toEqual([
    "[STUDENT_A]",
    "[STUDENT_B]",
    "[STUDENT_Z]",
    "[STUDENT_AA]",
    "[STUDENT_AB]",
    "[STUDENT_ZZ]",
    "[STUDENT_AAA]",
  ]);
});

test("records a pseudonymous request and a private key", async () => {
  const { ws, path } = await newWorkspace();
  const request = await recordRequest(ws, SAMPLE, {
    cohort_size: 3,
    multiple_groups: false,
    band_distribution: [
      { label: "60-69", count: 2 },
      { label: "50-59", count: 1 },
    ],
    sample_note: "Whole cohort sampled.",
    now: new Date("2026-01-15T00:00:00Z"),
  });
  expect(request.sample.map((s) => [s.submission_id, s.pseudonym, s.listed_band])).toEqual([
    ["sub-001", "[STUDENT_A]", "60-69"],
    ["sub-002", "[STUDENT_B]", "60-69"],
    ["sub-003", "[STUDENT_C]", "50-59"],
  ]);
  const requestText = readFileSync(join(path, "request.json"), "utf8");
  for (const entry of SAMPLE) expect(requestText).not.toContain(entry.external_id);
  const key = Object.fromEntries((await ws.readKey()).entries.map((e) => [e.pseudonym, e.external_id]));
  expect(key).toEqual({ "[STUDENT_A]": "100200301", "[STUDENT_B]": "100200302", "[STUDENT_C]": "100200303" });
  expect(await loadRequest(ws)).toEqual(request);
  expect(request.context.provenance.transformation).toBe("entered");
});

test("the request is a valid contract record", async () => {
  const { ws } = await newWorkspace();
  const request = await recordRequest(ws, SAMPLE);
  expect(ModerationRequest.parse(await ws.readJson("request.json"))).toEqual(request);
});

test("whitespace is trimmed and the band is optional", async () => {
  const { ws } = await newWorkspace();
  const request = await recordRequest(ws, [{ external_id: "  100200301 " }, { external_id: "100200302", band: " " }]);
  expect(request.sample.map((s) => s.listed_band)).toEqual([null, null]);
  expect((await ws.readKey()).entries[0].external_id).toBe("100200301");
});

test("all problems are reported together", async () => {
  const { ws } = await newWorkspace();
  const problems = await problemsOf(
    recordRequest(ws, [
      { external_id: "100200301" },
      { external_id: "100200301" }, // duplicate
      { external_id: "100200302-" }, // trailing punctuation
      { external_id: "1002 00303" }, // internal space
      { external_id: "" }, // empty
    ]),
  );
  expect(problems).toHaveLength(4);
  expect(problems).toContain("entry 2: identifier '100200301' duplicates entry 1");
  expect(problems.some((p) => p.includes("'100200302-' is malformed"))).toBe(true);
  expect(problems.some((p) => p.includes("'1002 00303' is malformed"))).toBe(true);
  expect(problems).toContain("entry 5: identifier is empty");
  expect(await ws.exists("request.json")).toBe(false);
  expect(await ws.exists("private/pseudonym-key.json")).toBe(false);
});

test("an empty sample is rejected", async () => {
  const { ws } = await newWorkspace();
  expect(await problemsOf(recordRequest(ws, []))).toContain("the sample is empty");
});

test("inconsistent counts are rejected", async () => {
  const { ws } = await newWorkspace();
  expect((await problemsOf(recordRequest(ws, SAMPLE, { cohort_size: 2 }))).join()).toContain("smaller than the sample");
  expect(
    (await problemsOf(recordRequest(ws, SAMPLE, { cohort_size: 3, band_distribution: [{ label: "60-69", count: 5 }] }))).join(),
  ).toContain("totals 5, more than the cohort size 3");
});

test("an existing request is not overwritten without replace", async () => {
  const { ws } = await newWorkspace();
  await recordRequest(ws, SAMPLE);
  await expect(recordRequest(ws, SAMPLE.slice(0, 1))).rejects.toThrow("already recorded");
  expect((await recordRequest(ws, SAMPLE.slice(0, 1), { replace: true })).sample).toHaveLength(1);
});

// --- Stable pseudonyms: replacement must never reassign ---------------------------

const mapping = async (ws: Workspace) =>
  Object.fromEntries((await ws.readKey()).entries.map((e) => [e.external_id, [e.submission_id, e.pseudonym]]));

test("replacement keeps pseudonyms when reordered or reduced", async () => {
  const { ws } = await newWorkspace();
  await recordRequest(ws, SAMPLE);
  const before = await mapping(ws);
  const request = await recordRequest(ws, [SAMPLE[2], SAMPLE[1]], { replace: true });
  expect(request.sample.map((s) => [s.submission_id, s.pseudonym])).toEqual([before["100200303"], before["100200302"]]);
  // The dropped identifier keeps its entry, so its pseudonym is never reused.
  expect(await mapping(ws)).toEqual(before);
});

test("new identifiers get fresh pseudonyms, never reused ones", async () => {
  const { ws } = await newWorkspace();
  await recordRequest(ws, SAMPLE);
  await recordRequest(ws, [SAMPLE[0]], { replace: true });
  const request = await recordRequest(ws, [SAMPLE[0], { external_id: "100200304" }], { replace: true });
  expect(request.sample.map((s) => s.pseudonym)).toEqual(["[STUDENT_A]", "[STUDENT_D]"]);
  expect((await mapping(ws))["100200304"]).toEqual(["sub-004", "[STUDENT_D]"]);
});

// --- Consistency on disk: key and request written separately ------------------------

test("an interrupted replacement leaves a consistent workspace", async () => {
  const { ws } = await newWorkspace();
  const original = await recordRequest(ws, SAMPLE.slice(0, 2));
  const realWrite = ws.writeJson.bind(ws);
  ws.writeJson = async (relative, data, options) => {
    if (relative === "request.json") throw new Error("disk full");
    return realWrite(relative, data, options);
  };
  await expect(recordRequest(ws, [SAMPLE[2], SAMPLE[0]], { replace: true })).rejects.toThrow("disk full");
  ws.writeJson = realWrite;
  // The old request still loads and resolves; the key only gained an entry.
  expect(await loadRequest(ws)).toEqual(original);
  expect(await mapping(ws)).toHaveProperty("100200303");
});

test("loading detects a damaged key", async () => {
  const { ws, path } = await newWorkspace();
  await recordRequest(ws, SAMPLE);
  writeFileSync(join(path, "private", "pseudonym-key.json"), '{"entries": []}');
  await expect(loadRequest(ws)).rejects.toThrow("inconsistent");
});

// --- All problems together --------------------------------------------------------

test("sample and count problems are reported together", async () => {
  const { ws } = await newWorkspace();
  const problems = await problemsOf(
    recordRequest(ws, [{ external_id: "100200301" }, { external_id: "100200301" }, { external_id: "x-" }], {
      cohort_size: 0,
      band_distribution: [{ label: "60-69", count: 4 }],
      staff_roles: ["module convener", " "],
    }),
  );
  const joined = problems.join("\n");
  for (const expected of [
    "duplicates entry 1",
    "'x-' is malformed",
    "smaller than the sample",
    "totals 4, more than the cohort size 0",
    "staff roles must not be empty",
  ]) {
    expect(joined).toContain(expected);
  }
  expect(await ws.exists("request.json")).toBe(false);
  expect(await ws.exists("private/pseudonym-key.json")).toBe(false);
});

// --- Context -------------------------------------------------------------------

test("programme, module and roles are recorded", async () => {
  const { ws } = await newWorkspace();
  const request = await recordRequest(ws, SAMPLE, {
    programme: "MSc Fictional Computing",
    module: "FIC101 Imaginary Systems",
    staff_roles: ["module convener", "marker"],
  });
  expect(request.context).toMatchObject({
    programme: "MSc Fictional Computing",
    module: "FIC101 Imaginary Systems",
    staff_roles: ["module convener", "marker"],
  });
});

test("a band label may contain a colon (as the command line allows)", async () => {
  const { ws } = await newWorkspace();
  await recordRequest(ws, [{ external_id: "100200301", band: "2:1" }]);
  expect((await loadRequest(ws)).sample[0].listed_band).toBe("2:1");
});
