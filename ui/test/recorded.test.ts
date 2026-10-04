/** What the setup steps have recorded, as their screens show it. */

import { expect, test } from "vitest";
import { loadOverview } from "../src/app/overview.ts";
import { originalsRecorded, requestFormValues, requestRecorded } from "../src/app/recorded.ts";
import { moderationStates, statusWord } from "../src/app/steps.ts";
import { bytesSource, importBrief, importOriginals, importRubric, recordRequest } from "../src/core/index.ts";
import { makeZip, packFile } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

const SAMPLE = [
  { external_id: "100200301", band: "60-69" },
  { external_id: "100200302" },
  { external_id: "100200303", band: "60-69" },
];

test("no request is recorded yet: nothing to show, and the form starts empty", async () => {
  const { ws } = await newWorkspace();
  expect(await requestRecorded(ws)).toBeNull();
  expect(await originalsRecorded(ws)).toEqual([]);
});

test("the recorded request shows each sampled submission's pseudonym beside its real ID", async () => {
  const { ws } = await newWorkspace();
  await recordRequest(ws, SAMPLE, { module: "Fictional 101", cohort_size: 40, staff_roles: ["module convener"], multiple_groups: false, band_distribution: [{ label: "60-69", count: 12 }] });
  const recorded = (await requestRecorded(ws))!;
  expect(recorded.rows).toEqual([
    { id: "sub-001", pseudonym: "[STUDENT_A]", band: "60-69", realId: "100200301" },
    { id: "sub-002", pseudonym: "[STUDENT_B]", band: null, realId: "100200302" },
    { id: "sub-003", pseudonym: "[STUDENT_C]", band: "60-69", realId: "100200303" },
  ]);
  expect(recorded.request.context.module).toBe("Fictional 101");
});

test("changing the request starts from what is recorded: a row per band, in the order listed", async () => {
  const { ws } = await newWorkspace();
  await recordRequest(ws, SAMPLE, { module: "Fictional 101", cohort_size: 40, staff_roles: ["module convener", "marker"], multiple_groups: true, band_distribution: [{ label: "60-69", count: 12 }], sample_note: "highest and lowest" });
  expect(requestFormValues((await requestRecorded(ws))!)).toEqual({
    sample: [
      { band: "60-69", ids: "100200301, 100200303" },
      { band: "", ids: "100200302" },
    ],
    programme: "",
    module: "Fictional 101",
    roles: "module convener\nmarker",
    cohort: "40",
    groups: "multiple",
    bands: [{ label: "60-69", count: "12" }],
    note: "highest and lowest",
  });
});

test("each sampled original shows whether it is imported, its format and its warnings", async () => {
  const { ws } = await newWorkspace();
  await recordRequest(ws, SAMPLE.slice(0, 2));
  expect((await originalsRecorded(ws)).map((r) => [r.id, r.pseudonym, r.imported, r.format])).toEqual([
    ["sub-001", "[STUDENT_A]", false, null],
    ["sub-002", "[STUDENT_B]", false, null],
  ]);
  await importOriginals(ws, bytesSource("o.zip", makeZip({ "100200301 - QUILL AVERY . - a.docx": packFile("submissions/sub-a.docx"), "100200302 - PIKE JORDAN - b.pdf": packFile("submissions/sub-b.pdf") })));
  const rows = await originalsRecorded(ws);
  expect(rows.map((r) => [r.id, r.imported, r.format, r.problem])).toEqual([
    ["sub-001", true, "docx", null],
    ["sub-002", true, "pdf", null],
  ]);
  expect(rows.every((r) => Array.isArray(r.warnings))).toBe(true);
});

test("each setup step's status says why, and the navigation and the screen use the same words", async () => {
  const { ws } = await newWorkspace();
  const ready = { reasons: [], current: false };
  let states = moderationStates(await loadOverview(ws), ready);
  expect(["request", "rubric", "brief", "originals"].map((id) => [statusWord(states.get(id as "request"), id === "brief"), states.get(id as "request")!.reason])).toEqual([
    ["Not started", "no moderation request recorded yet"],
    ["Not started", "no source rubric saved yet"],
    ["Optional", "no brief imported; it is optional, but the AI reading and your review use it"],
    ["Not started", "record the moderation request first"],
  ]);
  await recordRequest(ws, SAMPLE.slice(0, 2), { module: "Fictional 101" });
  await importOriginals(ws, bytesSource("o.zip", makeZip({ "100200301 - QUILL AVERY . - a.docx": packFile("submissions/sub-a.docx"), "100200302 - PIKE JORDAN - b.pdf": packFile("submissions/sub-b.pdf") })));
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")));
  await importBrief(ws, bytesSource("brief.docx", packFile("brief.docx")));
  states = moderationStates(await loadOverview(ws), ready);
  expect(["request", "rubric", "brief", "originals"].map((id) => [statusWord(states.get(id as "request")), states.get(id as "request")!.reason])).toEqual([
    ["Done", "2 sampled submissions, Fictional 101"],
    ["Done", "4 criteria"],
    ["Needs attention", "imported; anonymise and approve it on Anonymisation"],
    ["Done", "2 of 2 sampled submissions imported"],
  ]);
});
