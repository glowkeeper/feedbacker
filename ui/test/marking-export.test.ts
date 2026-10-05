/**
 * Approving each student's marks and feedback, and exporting them: what blocks an approval, what clears it, the text
 * and marks table as they are pasted and exported (snapshots), the structured record, and the re-identified copy,
 * which restores only each student's platform ID, and only when confirmed. Synthetic material only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  acceptFlag,
  anonymiseWorkspace,
  approvalState,
  approve,
  approveSubmission,
  bytesSource,
  exportMarking,
  exportMarkingReidentified,
  feedbackText,
  importCohort,
  importRubric,
  loadRubric,
  MarkingRecord,
  OVERALL,
  readiness,
  recordAssessment,
  recordFeedback,
  recordJudgement,
  recordSubmissionMark,
  updateRules,
  WorkspaceError,
} from "../src/core/index.ts";
import { makeZip, packFile } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

/** A marking workspace with two approved submissions, both marked, and the first with all its feedback. */
async function setUp(name: string) {
  const made = await newWorkspace(name, { workspace_type: "marking" });
  const ws = made.ws;
  await recordAssessment(ws, { title: "Coursework 1", module: "Fictional 101" });
  await importCohort(ws, bytesSource("cohort_1.zip", makeZip({ "100200301 - QUILL AVERY . - a.docx": packFile("submissions/sub-a.docx"), "100200302 - PIKE JORDAN - b.pdf": packFile("submissions/sub-b.pdf") })));
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic" });
  await updateRules(ws, { names: ["Morgan Ellis"] });
  await anonymiseWorkspace(ws);
  for (const id of ["sub-001", "sub-002"]) await approve(ws, id);
  const criteria = (await loadRubric(ws)).criteria.map((c) => c.id);
  for (const id of ["sub-001", "sub-002"]) {
    for (const [i, c] of criteria.entries()) await recordJudgement(ws, id, c, { levelId: i === 0 ? "p68" : "p62" });
    await recordSubmissionMark(ws, id, { mark: 64 });
  }
  for (const [i, c] of criteria.entries()) await recordFeedback(ws, "sub-001", c, { text: `Criterion ${i + 1}: you set this out clearly.\nNext time, go further.` });
  await recordFeedback(ws, "sub-001", OVERALL, { text: "A clear, well-organised piece of work. Next time, test more widely." });
  return { ws, path: made.path, criteria };
}

test("a submission can't be approved until everything is marked, its feedback is current, and every flag is accepted", async () => {
  const { ws, criteria } = await setUp("export-1");
  const second = await readiness(ws, "sub-002");
  expect([second.feedback, second.digest]).toEqual([null, null]);
  expect(second.problems[0]).toMatch(/: no feedback recorded$/);
  await expect(approveSubmission(ws, "sub-002")).rejects.toThrow(WorkspaceError);
  // A flag blocks until it is accepted with a reason.
  await recordFeedback(ws, "sub-001", criteria[1], { text: "Excellent work. Next time, go further." });
  expect((await readiness(ws, "sub-001")).problems).toEqual([expect.stringMatching(/"Excellent" is praise .+ \(change the feedback, or accept the flag with a reason\)$/)]);
  await acceptFlag(ws, "sub-001", criteria[1], { check: "praise", detail: "excellent" }, "The brief's own word");
  expect((await readiness(ws, "sub-001")).problems).toEqual([]);
  const approval = await approveSubmission(ws, "sub-001");
  expect([approval.approved_by.kind, (await approvalState(ws, "sub-001")).current]).toEqual(["educator", true]);
});

test("any later change clears the approval: a mark, the feedback, or a flag's reason", async () => {
  const { ws, criteria } = await setUp("export-2");
  await approveSubmission(ws, "sub-001");
  await recordFeedback(ws, "sub-001", criteria[0], { text: "Changed. Next time, go further." });
  let state = await approvalState(ws, "sub-001");
  expect([state.approval !== null, state.current]).toEqual([true, false]);
  await approveSubmission(ws, "sub-001");
  await recordJudgement(ws, "sub-001", criteria[0], { levelId: "p62" }); // the feedback is now out of date too
  state = await approvalState(ws, "sub-001");
  expect([state.current, state.digest]).toEqual([false, null]);
});

test("what a student receives, as text to paste: the mark, each criterion's mark and feedback, then the overall", async () => {
  const { ws } = await setUp("export-3");
  const { feedback } = await readiness(ws, "sub-001");
  await expect(feedbackText(feedback!)).toMatchFileSnapshot("./__snapshots__/marking-feedback.txt");
});

test("the exports: each approved student's feedback, all of them, the marks table and the record, pseudonymous", async () => {
  const { ws, path } = await setUp("export-4");
  await expect(exportMarking(ws)).rejects.toThrow("approve at least one first");
  await approveSubmission(ws, "sub-001");
  const { paths, submissions } = await exportMarking(ws, new Date("2026-10-05T09:00:00Z"));
  expect(submissions).toEqual(["sub-001"]); // only what is approved now
  expect(paths).toEqual([
    "exports/marking-coursework-1-feedback-sub-001.feedbacker-export.md",
    "exports/marking-coursework-1-feedback.feedbacker-export.md",
    "exports/marking-coursework-1-marks.feedbacker-export.csv",
    "exports/marking-coursework-1-record.feedbacker-export.json",
  ]);
  const read = (p: string) => readFileSync(join(path, p), "utf8");
  await expect(read(paths[2])).toMatchFileSnapshot("./__snapshots__/marking-marks.csv");
  await expect(read(paths[0])).toMatchFileSnapshot("./__snapshots__/marking-feedback-sub-001.md");
  for (const p of paths) expect(read(p)).not.toContain("100200301");
  const record = MarkingRecord.parse(JSON.parse(read(paths[3])));
  expect([record.approvals.map((a) => a.submission_id), record.provisional_marks[0].why_none, record.feedback.length]).toEqual([["sub-001"], "there are no AI proposals", 5]);
});

test("a re-identified copy restores only each student's platform ID, and only when confirmed", async () => {
  const { ws, path } = await setUp("export-5");
  await approveSubmission(ws, "sub-001");
  await expect(exportMarkingReidentified(ws, { confirmed: false })).rejects.toThrow("only when you confirm it");
  const { paths } = await exportMarkingReidentified(ws, { confirmed: true });
  expect(paths).toEqual([
    "exports/marking-coursework-1-feedback-sub-001-reidentified.feedbacker-export.md",
    "exports/marking-coursework-1-feedback-reidentified.feedbacker-export.md",
    "exports/marking-coursework-1-marks-reidentified.feedbacker-export.csv",
  ]);
  const csv = readFileSync(join(path, paths[2]), "utf8");
  expect(csv.split("\n")[1].startsWith("sub-001,100200301,")).toBe(true);
  const md = readFileSync(join(path, paths[0]), "utf8");
  expect(md).toContain("# Feedback for 100200301");
  expect(md).toContain("Re-identified copy: this contains personal data");
  expect(md).not.toContain("QUILL"); // nothing else restored
});
