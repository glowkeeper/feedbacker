/** A marking workspace's cohort, imported from a synthetic bulk download, and everything that then works from it. */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadOverview } from "../src/app/overview.ts";
import { recordsToReview } from "../src/app/anonymisation.ts";
import { originalsRecorded } from "../src/app/recorded.ts";
import { markingStates, statusWord } from "../src/app/steps.ts";
import {
  anonymiseWorkspace,
  approve,
  approvedText,
  bytesSource,
  CohortProblem,
  COHORT,
  idFromFileName,
  importBrief,
  importCohort,
  listSubmissions,
  loadCohort,
  loadSubmission,
  recordRequest,
  WorkspaceError,
} from "../src/core/index.ts";
import { makeZip, packFile } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

const sub = (name: string) => packFile(`submissions/${name}`);

/** A synthetic Turnitin-style bulk download: three students, the platform's report, and one stray file. */
const download = (name = "cohort_1.zip", extra: Record<string, Uint8Array | string> = {}) =>
  bytesSource(
    name,
    makeZip({
      "100200301 - QUILL AVERY . - report.docx": sub("sub-a.docx"),
      "100200302 - PIKE JORDAN - report.pdf": sub("sub-b.pdf"),
      "100200303 - MARSH RILEY - report.docx": sub("sub-c.docx"),
      "manifest.txt": "The requested files are now available",
      "notes from the marker.docx": "never opened",
      ...extra,
    }),
  );

const marking = async (name: string) => newWorkspace(name, { workspace_type: "marking" });

test("IDs are read from the platform's file names, and nothing is guessed", () => {
  expect(idFromFileName("100200301 - QUILL AVERY . - report.docx.pdf")).toBe("100200301");
  expect(idFromFileName("pikejordan_late_4021_77031_report.docx")).toBe("4021");
  expect(idFromFileName("pikejordan_4021_77031_report-1.pdf")).toBe("4021");
  for (const name of ["Quill_Avery_100200301_report.docx", "report 2024.docx", "manifest.txt", ""]) expect(idFromFileName(name)).toBeNull();
});

test("every submission in the download is imported, with a pseudonym; real IDs and names are only in the key", async () => {
  const { ws, path } = await marking("mark-c1");
  const result = await importCohort(ws, download());
  expect(result.imported.map((s) => s.id)).toEqual(["sub-001", "sub-002", "sub-003"]);
  expect([result.ignoredCount, result.kept, result.failed.size]).toEqual([1, 0, 0]);
  expect(result.notImported).toHaveLength(1);
  expect(result.notImported[0]).toContain("doesn't carry an ID");
  expect(result.notImported[0]).not.toContain("notes"); // described by its shape, never its name
  const cohort = await loadCohort(ws);
  expect(cohort.submissions).toEqual([
    { submission_id: "sub-001", pseudonym: "[STUDENT_A]" },
    { submission_id: "sub-002", pseudonym: "[STUDENT_B]" },
    { submission_id: "sub-003", pseudonym: "[STUDENT_C]" },
  ]);
  expect([cohort.provenance.actor.kind, (await loadSubmission(ws, "sub-002")).provenance.actor.kind]).toEqual(["educator", "educator"]);
  const key = await ws.readKey();
  expect(key.entries[0]).toMatchObject({ pseudonym: "[STUDENT_A]", external_id: "100200301", source_files: { original: "100200301 - QUILL AVERY . - report.docx" } });
  for (const file of [join(path, COHORT), ...readdirSync(join(path, "submissions")).map((f) => join(path, "submissions", f))]) {
    const text = readFileSync(file, "utf8");
    expect(text).not.toContain("100200301");
    expect(text).not.toContain("QUILL");
  }
});

test("importing again adds the new submissions and keeps every pseudonym; replacing is explicit", async () => {
  const { ws } = await marking("mark-c2");
  await importCohort(ws, download());
  const late = bytesSource("rowancasey_late_4024_77034_report.pdf", sub("sub-d.pdf"));
  const again = await importCohort(ws, [download("cohort_2.zip"), late]);
  expect([again.imported.map((s) => s.id), again.kept]).toEqual([["sub-004"], 3]);
  expect((await listSubmissions(ws)).map((s) => s.pseudonym)).toEqual(["[STUDENT_A]", "[STUDENT_B]", "[STUDENT_C]", "[STUDENT_D]"]);
  const replaced = await importCohort(ws, download("cohort_3.zip"), { replace: true });
  expect(replaced.imported.map((s) => s.id)).toEqual(["sub-001", "sub-002", "sub-003"]);
  expect((await loadCohort(ws)).submissions).toHaveLength(4);
});

test("an ID in two files, and a file that isn't docx or pdf, are listed and not imported", async () => {
  const { ws } = await marking("mark-c3");
  const result = await importCohort(
    ws,
    download("cohort_1.zip", { "100200303 - MARSH RILEY - report v2.docx": sub("sub-c.docx"), "100200305 - ROWAN CASEY - slides.pptx": "never opened" }),
  );
  expect(result.imported.map((s) => s.id)).toEqual(["sub-001", "sub-002"]);
  expect(result.notImported.some((p) => p.includes("2 files carry the same ID"))).toBe(true);
  expect(result.notImported.some((p) => p.includes("not docx or pdf"))).toBe(true);
});

test("a file that fails keeps its pseudonym for a later try", async () => {
  const { ws } = await marking("mark-c4");
  const result = await importCohort(ws, download("cohort_1.zip", { "100200304 - ROWAN CASEY - report.pdf": "not a pdf" }));
  expect([...result.failed.keys()]).toEqual(["sub-004"]);
  expect((await loadCohort(ws)).submissions.map((s) => s.submission_id)).toEqual(["sub-001", "sub-002", "sub-003"]);
  const retry = await importCohort(ws, bytesSource("100200304 - ROWAN CASEY - report.pdf", sub("sub-d.pdf")));
  expect(retry.imported.map((s) => [s.id, s.pseudonym])).toEqual([["sub-004", "[STUDENT_D]"]]);
});

test("a download with nothing to import is refused, and records nothing", async () => {
  const { ws } = await marking("mark-c5");
  await expect(importCohort(ws, bytesSource("stray.zip", makeZip({ "notes.docx": "x", "manifest.txt": "x" })))).rejects.toThrow(CohortProblem);
  expect(await ws.exists(COHORT)).toBe(false);
});

test("only a marking workspace has a cohort; a moderation lists its sample", async () => {
  const { ws } = await newWorkspace("mod-c6");
  await expect(importCohort(ws, download())).rejects.toThrow(WorkspaceError);
  await recordRequest(ws, [{ external_id: "100200301", band: "60-69" }]);
  expect(await listSubmissions(ws)).toEqual([{ submission_id: "sub-001", pseudonym: "[STUDENT_A]", listed_band: "60-69" }]);
});

test("anonymisation, approval and the overview work from the cohort, and the steps say so", async () => {
  const { ws } = await marking("mark-c7");
  let states = markingStates(await loadOverview(ws), null, null);
  expect(`${statusWord(states.get("cohort"))}: ${states.get("cohort")!.reason}`).toBe("Not started: no submissions imported yet");
  expect(states.get("anonymisation")!.reason).toBe("import the cohort's submissions first");

  await importCohort(ws, download());
  const result = await anonymiseWorkspace(ws);
  expect(Object.keys(result.counts).sort()).toEqual(["sub-001", "sub-002", "sub-003"]);
  const anonymised = await loadSubmission(ws, "sub-001");
  expect(anonymised.anonymised!.text.toUpperCase()).not.toContain("QUILL"); // the name from the file name is redacted
  expect((await approve(ws, "sub-001")).approved_by.kind).toBe("educator");
  expect((await approvedText(ws, "sub-001"))[0]).toBe(anonymised.anonymised!.text);

  expect((await recordsToReview(ws)).map((r) => [r.id, r.approved])).toEqual([
    ["sub-001", true],
    ["sub-002", false],
    ["sub-003", false],
  ]);
  states = markingStates(await loadOverview(ws), null, null);
  expect(`${statusWord(states.get("cohort"))}: ${states.get("cohort")!.reason}`).toBe("Done: 3 submissions imported");
  expect(`${statusWord(states.get("anonymisation"))}: ${states.get("anonymisation")!.reason}`).toBe("Needs attention: 1 of 3 texts approved");
});

test("the Submissions screen shows each submission's real ID beside its pseudonym, from the key", async () => {
  const { ws } = await marking("mark-c8");
  await importCohort(ws, download());
  expect((await originalsRecorded(ws)).map((r) => [r.id, r.pseudonym, r.realId, r.imported])).toEqual([
    ["sub-001", "[STUDENT_A]", "100200301", true],
    ["sub-002", "[STUDENT_B]", "100200302", true],
    ["sub-003", "[STUDENT_C]", "100200303", true],
  ]);
});

test("the brief can be anonymised and approved before any submissions are imported", async () => {
  const { ws } = await marking("mark-c9");
  await importBrief(ws, bytesSource("brief.docx", packFile("brief.docx")));
  let states = markingStates(await loadOverview(ws), null, null);
  expect(`${statusWord(states.get("anonymisation"))}: ${states.get("anonymisation")!.reason}`).toBe("Needs attention: 0 of 1 texts approved");
  const result = await anonymiseWorkspace(ws);
  expect(Object.keys(result.counts)).toEqual(["brief"]);
  await approve(ws, "brief");
  states = markingStates(await loadOverview(ws), null, null);
  expect(`${statusWord(states.get("anonymisation"))}: ${states.get("anonymisation")!.reason}`).toBe("Done: 1 of 1 texts approved");
});
