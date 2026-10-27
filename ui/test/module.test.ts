/** Modules (ADR 0010): what is made, what is shared, and what the module makes of its assessments' marks. Every name and ID is fictional. */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  contextOfModule,
  createNamedWorkspace,
  importBrief,
  bytesSource,
  loadBrief,
  loadModuleContext,
  loadRequestCohort,
  moderatedRows,
  moduleBriefState,
  moduleMarks,
  openWorkspace,
  readRequestDocument,
  recordModuleContext,
  recordModuleRequest,
  recordRequestCohort,
  RequestCohort,
  showModuleMark,
  studentLinks,
  SubmissionVerdict,
  updateRules,
  useModuleBrief,
  verdictPath,
  type PseudonymKey,
} from "../src/core/index.ts";
import { docx, para, table } from "./builders.ts";
import { NodeFileSystem } from "./nodeFileSystem.ts";
import { prov } from "./helpers.ts";
import { newModule, newWorkspace } from "./proxyHarness.ts";

const HEADER = ["Student ID", "Name", "Assessment Title/Code", "Initial Mark", "Agreed Mark"];
const NAMES = ["Quill Avery", "Pike Jordan", "Marsh Riley", "Fenn Sasha"];
const row = (i: number, assessment: string, initial: string, agreed: string) => [`B0000010${i}`, NAMES[i], assessment, initial, agreed];
const DOC = docx({
  body:
    para("Moderation Form") +
    table([["Programme of Study", "BSc Fictional"], ["Module Title", "Fiction 101"], ["Total number of students on this module", "4"]]) +
    table([
      HEADER,
      row(0, "Report (60%)", "80%", "80"),
      row(1, "Report (60%)", "60%", "50"),
      row(2, "Report (60%)", "70%", ""),
      row(3, "Report (60%)", "NS", ""),
      row(0, "Case study (40%)", "70%", ""),
      row(1, "Case study (40%)", "50%", ""),
      row(2, "Case study (40%)", "NS", ""),
      row(3, "Case study (40%)", "40%", ""),
    ]),
});

// --- Making modules and assessments ----------------------------------------------------------------------------------------------------

test("a module is made by name, and an assessment inside it, in the module's folder", async () => {
  const { module, addAssessment, client, folder } = await newModule();
  expect(module.manifest).toMatchObject({ name: "CS101", workspace_type: "module", shared_key: false, module: null });
  const report = await addAssessment("Report");
  expect(report.manifest).toMatchObject({ name: "Report", workspace_type: "moderation", module: "CS101", shared_key: null });
  expect(existsSync(join(folder, "CS101", "Report", "workspace.json"))).toBe(true);
  const listed = (await client.listWorkspaces()).workspaces;
  expect(listed.map((w) => [w.name, w.workspace_type, w.module, w.in_workspaces_folder, w.problem]).sort()).toEqual([
    ["CS101", "module", null, true, null],
    ["Report", "moderation", "CS101", true, null],
  ]);
});

test("the proxy refuses what a module can't hold", async () => {
  const { client, addAssessment } = await newModule();
  await addAssessment("Report");
  await expect(addAssessment("Report")).rejects.toThrow("already has an assessment called 'Report'");
  for (const name of ["private", "Sources", "brief.json"]) await expect(addAssessment(name)).rejects.toThrow("name the module keeps for its own files");
  await expect(createNamedWorkspace(client, "Nested", { workspace_type: "module", module: "CS101" })).rejects.toThrow("can't be inside another module");
  await expect(createNamedWorkspace(client, "Orphan", { workspace_type: "moderation", module: "Nowhere" })).rejects.toThrow("is not a module registered with this proxy");
  await expect(createNamedWorkspace(client, "Alone", { workspace_type: "moderation", shared_key: true })).rejects.toThrow("only a module chooses");
  // An ordinary workspace is no module, even by the name of one.
  await createNamedWorkspace(client, "Plain", { workspace_type: "moderation" });
  await expect(createNamedWorkspace(client, "Under", { workspace_type: "moderation", module: "Plain" })).rejects.toThrow("is not a module");
});

test("an assessment opens only with its module, and a workspace on its own opens as before", async () => {
  const { module, client, addAssessment } = await newModule();
  const report = await addAssessment("Report");
  const fs = new NodeFileSystem(report.registration.path);
  await expect(openWorkspace(fs, client)).rejects.toThrow("an assessment in the module 'CS101'; open it through the module");
  const other = await newModule({ name: "Other" });
  await expect(openWorkspace(fs, client, other.module)).rejects.toThrow(); // another module's proxy doesn't know it
  const alone = await newWorkspace("alone");
  expect(alone.ws.module).toBeNull();
  await expect(openWorkspace(new NodeFileSystem(alone.path), alone.client, module)).rejects.toThrow("is not in a module");
});

test("deleting a module forgets its assessments too", async () => {
  const { module, addAssessment, client } = await newModule();
  const report = await addAssessment("Report");
  await addAssessment("Case study");
  expect((await client.listWorkspaces()).workspaces).toHaveLength(3);
  await module.delete("CS101");
  expect((await client.listWorkspaces()).workspaces).toEqual([]);
});

// --- What is shared --------------------------------------------------------------------------------------------------------------------

test("the rules are the module's, shared by its assessments, and the key is not shared unless the module was made to", async () => {
  const { module, addAssessment, folder } = await newModule();
  const a = await addAssessment("Report");
  const b = await addAssessment("Case study");
  await updateRules(a, { redact: { "Jordan Pike": "PERSON" } });
  expect(JSON.stringify(await b.readJson("anonymisation/rules.json"))).toContain("Jordan Pike");
  expect(existsSync(join(folder, "CS101", "anonymisation", "rules.json"))).toBe(true);
  expect(existsSync(join(folder, "CS101", "Report", "anonymisation", "rules.json"))).toBe(false);
  expect(a.isShared("anonymisation/rules.json")).toBe(true);
  expect(a.isShared("private/pseudonym-key.json")).toBe(false);
  await a.writeKey({ entries: [], tokens: [{ token: "[ORG_1]", kind: "ORG", value: "Fictional Ltd" }] });
  expect((await b.readKey()).tokens).toEqual([]);
  expect(await module.exists("private/pseudonym-key.json")).toBe(false);
});

test("a module made to share the key holds it once, and a student is one pseudonym throughout", async () => {
  const { module, addAssessment } = await newModule({ shared_key: true });
  const a = await addAssessment("Report");
  const b = await addAssessment("Case study");
  const key: PseudonymKey = { entries: [], tokens: [{ token: "[ORG_1]", kind: "ORG", value: "Fictional Ltd" }] };
  await a.writeKey(key);
  expect(b.isShared("private/pseudonym-key.json")).toBe(true);
  expect((await b.readKey()).tokens).toEqual(key.tokens);
  expect((await module.readKey()).tokens).toEqual(key.tokens);
});

test("the module's context is entered once, and read from the request document", async () => {
  const { module, addAssessment } = await newModule();
  const report = await addAssessment("Report");
  expect(await contextOfModule(report)).toBeNull();
  await recordModuleRequest(module, await readRequestDocument("form.docx", DOC));
  expect(await loadModuleContext(module)).toMatchObject({ programme: "BSc Fictional", module: "Fiction 101" });
  expect(await contextOfModule(report)).toMatchObject({ programme: "BSc Fictional" });
  // What the moderator entered is not overwritten by reading the document again.
  await recordModuleContext(module, { programme: "BSc Entered", module: null });
  await recordModuleRequest(module, await readRequestDocument("form.docx", DOC));
  expect(await loadModuleContext(module)).toMatchObject({ programme: "BSc Entered", module: null });
  await expect(recordModuleContext(report, { programme: "x" })).rejects.toThrow("isn't a module");
});

test("the request document is read once into the module, with the rows that are one student and no name or ID", async () => {
  const { module } = await newModule();
  const findings = await readRequestDocument("form.docx", DOC);
  expect(studentLinks(findings)).toEqual([0, 1, 2, 3].map((i) => [{ assessment: "Report (60%)", row: i + 1 }, { assessment: "Case study (40%)", row: i + 1 }]));
  const cohort = await recordModuleRequest(module, findings);
  expect(cohort.sampled).toEqual([]);
  expect(await loadRequestCohort(module)).toEqual(cohort);
  const text = JSON.stringify(await module.readJson("request-cohort.json"));
  for (const who of [...NAMES, "B00000100", "B00000103"]) expect(text).not.toContain(who);
});

test("the brief is imported into the module once, and each assessment takes it whole and chooses its section", async () => {
  const { module, addAssessment } = await newModule();
  const a = await addAssessment("Report");
  const b = await addAssessment("Case study");
  const brief = docx({ body: para("Overview") + para("Everyone reads this.") });
  const file = bytesSource("brief.docx", brief);
  expect(await moduleBriefState(a)).toEqual({ state: "none" });
  await importBrief(module, file);
  expect(await moduleBriefState(a)).toEqual({ state: "not-taken" });
  const taken = await useModuleBrief(a);
  expect(taken.source_sha256).toBe((await loadBrief(module)).source_sha256);
  expect(await moduleBriefState(a)).toEqual({ state: "current" });
  expect(await moduleBriefState(b)).toEqual({ state: "not-taken" });
  // The module's is replaced: the assessment's no longer is it, until it takes it again.
  await importBrief(module, bytesSource("brief.docx", docx({ body: para("Overview") + para("A changed brief.") })), { replace: true });
  expect(await moduleBriefState(a)).toEqual({ state: "different" });
  await useModuleBrief(a);
  expect(await moduleBriefState(a)).toEqual({ state: "current" });
  await expect(useModuleBrief((await newWorkspace()).ws)).rejects.toThrow("not in a module");
});

// --- The module's marks ----------------------------------------------------------------------------------------------------------------

const cohortOf = async () => {
  const { module } = await newModule();
  return recordModuleRequest(module, await readRequestDocument("form.docx", DOC));
};
const R = "Report (60%)";
const C = "Case study (40%)";
const at = (a: string, row: number) => `${a}\u0000${row}`;

test("a module mark is each mark weighted by what the assessment is worth, at three levels", async () => {
  const marks = moduleMarks(await cohortOf(), new Map([[at(R, 1), 90], [at(C, 1), 60]]));
  expect(marks.notes).toEqual([]);
  expect(marks.assessments.map((a) => [a.name, a.weight])).toEqual([[R, 60], [C, 40]]);
  const [s1, s2, s3, s4] = marks.students;
  expect(s1.label).toBe("Student 1");
  // 80 and 70: 0.6 × 80 + 0.4 × 70
  expect(s1.module).toEqual({ initial: 76, internal: 76, moderator: 0.6 * 90 + 0.4 * 60 });
  // The partner's internal moderation moved the report from 60 to 50.
  expect(s2.module.initial).toBeCloseTo(0.6 * 60 + 0.4 * 50);
  expect(s2.module.internal).toBeCloseTo(0.6 * 50 + 0.4 * 50);
  expect(s2.module.moderator).toBeNull(); // not moderated: only the first two levels are filled
  // No submission in one assessment: no module mark, at any level.
  expect(s3.module).toEqual({ initial: null, internal: null, moderator: null });
  expect(s4.module).toEqual({ initial: null, internal: null, moderator: null });
  expect(s1.marks.get(R)).toMatchObject({ initial: 80, internal: 80, moderator: 90, submitted: true });
  expect(s2.marks.get(R)).toMatchObject({ initial: 60, internal: 50, moderator: null });
  expect(showModuleMark(76)).toBe("76");
  expect(showModuleMark(77.25)).toBe("77.3");
  expect(showModuleMark(null)).toBe("—");
});

test("the moderator's module mark needs the moderator's mark in every assessment", async () => {
  const marks = moduleMarks(await cohortOf(), new Map([[at(R, 1), 90]]));
  expect(marks.students[0].module.moderator).toBeNull(); // moderated in the report only
  expect(marks.students[0].module.internal).not.toBeNull();
});

test("with no weighting, or weightings that don't add up to 100, the module says so", async () => {
  const cohort = await cohortOf();
  const unweighted = RequestCohort.parse({ ...cohort, assessments: cohort.assessments.map((a, i) => ({ ...a, weight: i === 0 ? null : a.weight })) });
  const none = moduleMarks(unweighted, new Map());
  expect(none.notes[0]).toContain("doesn't give every assessment a weighting");
  expect(none.students.every((s) => s.module.initial === null)).toBe(true);
  const short = RequestCohort.parse({ ...cohort, assessments: cohort.assessments.map((a) => ({ ...a, weight: (a.weight ?? 0) / 2 })) });
  const marks = moduleMarks(short, new Map());
  expect(marks.notes[0]).toContain("add up to 50%");
  expect(marks.students[0].module.initial).toBe(76); // a share of what is given
});

test("a student the request lists in only one assessment has no module mark, and every row is a student", async () => {
  const cohort = await cohortOf();
  const lone = RequestCohort.parse({ ...cohort, links: cohort.links.slice(1) });
  const marks = moduleMarks(lone, new Map());
  expect(marks.students).toHaveLength(5); // the first student's two rows are now two students
  expect(marks.students[0].module.initial).toBeNull();
});

test("the moderator's marks are read from each assessment's verdicts, and only from the module's own request document", async () => {
  const { module, addAssessment } = await newModule();
  const findings = await readRequestDocument("form.docx", DOC);
  const moduleCohort = await recordModuleRequest(module, findings);
  const report = await addAssessment("Report");
  const verdict = (id: string, suggested: number | null, criteria: number | null) =>
    SubmissionVerdict.parse({ submission_id: id, verdict: "agree", suggested_mark: suggested, criteria_mark: criteria, provenance: prov() });
  await recordRequestCohort(report, findings, { assessment: R, sampled: [{ row: 1, submission_id: "sub-001" }, { row: 2, submission_id: "sub-002" }] });
  await report.writeJson(verdictPath("sub-001"), verdict("sub-001", 90, 85));
  await report.writeJson(verdictPath("sub-002"), verdict("sub-002", null, 55));
  const { marks, note } = await moderatedRows(report, moduleCohort);
  expect(note).toBeNull();
  expect([...marks]).toEqual([[at(R, 1), 90], [at(R, 2), 55]]); // the suggested mark, else the one the criterion marks imply
  // Another document's rows are not this module's.
  const other = await readRequestDocument("form.docx", docx({ body: para("Moderation Form") + table([HEADER, row(0, "Report (60%)", "10%", "")]) }));
  const second = await addAssessment("Case study");
  await recordRequestCohort(second, other, { assessment: R, sampled: [{ row: 1, submission_id: "sub-009" }] });
  const different = await moderatedRows(second, moduleCohort);
  expect(different.marks.size).toBe(0);
  expect(different.note).toContain("different request document");
  expect(readdirSync(module.registration.path)).toContain("request-cohort.json");
});

test("real names appear nowhere in a module's own folder", async () => {
  const { module } = await newModule();
  await recordModuleRequest(module, await readRequestDocument("form.docx", DOC));
  const files = readdirSync(module.registration.path, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".json"));
  const { readFileSync } = await import("node:fs");
  for (const f of files) for (const who of [...NAMES, "B00000100"]) expect(readFileSync(join(module.registration.path, f), "utf8")).not.toContain(who);
});
