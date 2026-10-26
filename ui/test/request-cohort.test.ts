/**
 * The cohort a request document lists, kept without its students, and how the Overview shows it. Every name and ID is fictional.
 */

import { expect, test } from "vitest";
import { assessmentView, loadCohortView } from "../src/app/cohortView.ts";
import { loadRequestCohort, readRequestDocument, recordRequest, recordRequestCohort, REQUEST_COHORT, RequestCohort, rowOf, sha256Bytes, studentsOf } from "../src/core/index.ts";
import { docx, para, table } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

const NAMES = ["Quill Avery", "Pike Jordan", "Marsh Riley", "Fenn Sasha", "Reed Morgan", "Sloan Casey", "Vale Robin"];
const HEADER = ["Student ID", "Name", "Assessment Title/Code", "Initial Mark", "Agreed Mark"];
const row = (i: number, assessment: string, initial: string, agreed: string) => [`B0000010${i}`, NAMES[i], assessment, initial, agreed];
const DOC = docx({
  body:
    para("Moderation Form") +
    table([["Programme of Study", "BSc Fictional"], ["Module Title", "Fiction 101"], ["Total number of students on this module", "7"], ["", "70+ 3"], ["", "60-69 2"], ["", "0-59 2"]]) +
    table([
      HEADER,
      row(0, "Report (60%)", "82%", "82"),
      row(1, "Report (60%)", "75%", "75"),
      row(2, "Report (60%)", "65%", ""),
      row(3, "Report (60%)", "62%", "62"),
      row(4, "Report (60%)", "40%", "30"),
      row(5, "Report (60%)", "NS", ""),
      row(6, "Report (60%)", "55%", ""),
      row(0, "Case study (40%)", "85%", "85"),
      row(1, "Case study (40%)", "25%", "15"),
    ]),
});

const read = () => readRequestDocument("form.docx", DOC);

test("the cohort is kept as rows with marks, and no name or ID", async () => {
  const { ws } = await newWorkspace();
  const findings = await read();
  const cohort = await recordRequestCohort(ws, findings, { assessment: "Report (60%)", sampled: [{ row: 1, submission_id: "sub-001" }, { row: 5, submission_id: "sub-002" }] });
  expect(cohort.source_sha256).toBe(sha256Bytes(DOC));
  expect(cohort.assessments.map((a) => [a.assessment, a.title, a.weight, a.rows.length])).toEqual([["Report (60%)", "Report", 60, 7], ["Case study (40%)", "Case study", 40, 2]]);
  expect(cohort.assessments[0].rows[5]).toEqual({ row: 6, initial: null, agreed: null, submitted: false }); // no submission: no mark
  expect(cohort.assessments[0].rows[4]).toEqual({ row: 5, initial: 40, agreed: 30, submitted: true });
  expect(cohort.bands.map((b) => [b.label, b.from, b.to, b.count])).toEqual([["70+", 70, null, 3], ["60-69", 60, 69, 2], ["0-59", 0, 59, 2]]);
  // What is on disk: nothing that says who anyone is.
  const text = JSON.stringify(await ws.readJson(REQUEST_COHORT));
  for (const who of [...NAMES, "B00000100", "B00000106"]) expect(text).not.toContain(who);
  expect(await loadRequestCohort(ws)).toEqual(cohort);
});

test("a row's number is its place among the students listed for that assessment", async () => {
  const findings = await read();
  expect(studentsOf(findings, "Case study (40%)").map((r) => r.student_id)).toEqual(["B00000100", "B00000101"]);
  expect([rowOf(findings, "Report (60%)", "B00000102"), rowOf(findings, "Case study (40%)", "B00000101"), rowOf(findings, "Case study (40%)", "B00000102")]).toEqual([3, 2, null]);
});

test("the sample can only be rows that are in the cohort and submitted, once each", async () => {
  const { ws } = await newWorkspace();
  const findings = await read();
  await expect(recordRequestCohort(ws, findings, { assessment: "Report (60%)", sampled: [{ row: 6, submission_id: "sub-001" }] })).rejects.toThrow("has no submission");
  await expect(recordRequestCohort(ws, findings, { assessment: "Report (60%)", sampled: [{ row: 99, submission_id: "sub-001" }] })).rejects.toThrow("is not in the cohort");
  await expect(recordRequestCohort(ws, findings, { assessment: "Report (60%)", sampled: [{ row: 1, submission_id: "sub-001" }, { row: 2, submission_id: "sub-001" }] })).rejects.toThrow("duplicate sampled submission");
  expect(RequestCohort.safeParse({ kind: "request_cohort", source_sha256: "a".repeat(64), assessments: [] , provenance: {} }).success).toBe(false);
  expect(await ws.exists(REQUEST_COHORT)).toBe(false);
});

test("the Overview's view shows the cohort by band, with the sample's rows marked, and says what doesn't agree", async () => {
  const { ws } = await newWorkspace();
  await recordRequest(ws, [{ external_id: "B00000100" }, { external_id: "B00000104" }], { cohort_size: 7 });
  await recordRequestCohort(ws, await read(), { assessment: "Report (60%)", sampled: [{ row: 1, submission_id: "sub-001" }, { row: 5, submission_id: "sub-002" }] });
  const view = (await loadCohortView(ws))!;
  const [report, study] = view.assessments;
  expect([report.students, report.submitted, report.noSubmission, report.inSample]).toEqual([7, 6, 1, 2]);
  expect(report.bands.map((b) => [b.label, b.cohort, b.sample, b.stated])).toEqual([["70+", 2, 1, 3], ["60-69", 2, 0, 2], ["0-59", 2, 1, 2]]);
  expect(report.rows[0]).toEqual({ row: 1, initial: "82", agreed: "82", band: "70+", sampled: "sub-001" });
  expect(report.rows[5]).toEqual({ row: 6, initial: "No submission", agreed: "—", band: "—", sampled: null });
  // The request says 3 in 70+, and its table has 2: said, not corrected.
  expect(report.notes).toEqual(["The request says 3 in 70+, but its table has 2."]);
  // The cohort size on the request (7) is not the second assessment's number of rows (2).
  expect(study.notes).toContain("The request gives a cohort size of 7, but its table lists 2 students for this assessment.");
  expect([study.inSample, study.students]).toEqual([0, 2]);
});

test("a request recorded by hand has no cohort to show", async () => {
  const { ws } = await newWorkspace();
  await recordRequest(ws, [{ external_id: "A1" }]);
  expect(await loadCohortView(ws)).toBeNull();
  expect(await loadRequestCohort(ws)).toBeNull();
});

test("a cohort whose bands couldn't be read says so", async () => {
  const noBands = docx({ body: table([HEADER, row(0, "Report (60%)", "82%", "82"), row(1, "Report (60%)", "NS", "")]) });
  const findings = await readRequestDocument("form.docx", noBands);
  const { ws } = await newWorkspace();
  const cohort = await recordRequestCohort(ws, findings, { assessment: "Report (60%)", sampled: [] });
  const view = assessmentView(cohort, "Report (60%)", null);
  expect(view.notes).toEqual(["The request's band labels couldn't be read, so the rows aren't banded."]);
  expect(view.rows[0].band).toBe("—");
});
