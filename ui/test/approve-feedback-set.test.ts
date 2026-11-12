/**
 * Approving what many students will receive in one action, by exception: the submissions the cohort checks flag are opened first, the rest are skimmed
 * and confirmed, each is approved on its own digest and records that it was made in a set, and what changed after the list was shown is not approved.
 * Synthetic material only.
 */

import { expect, test } from "vitest";
import {
  anonymiseWorkspace,
  approve,
  approveFeedbackSet,
  approveSubmission,
  bytesSource,
  importCohort,
  importRubric,
  loadRubric,
  loadSubmissionApproval,
  markingRecord,
  OVERALL,
  recordFeedback,
  recordJudgement,
  recordSubmissionMark,
  waitingFeedback,
  WorkspaceError,
} from "../src/core/index.ts";
import { makeZip, packFile } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

/** A marking workspace of four synthetic submissions, all marked 62, with feedback recorded on every piece; the third's first piece is much shorter than the rest. */
async function setUp(name: string) {
  const { ws } = await newWorkspace(name, { workspace_type: "marking" });
  await importCohort(
    ws,
    bytesSource(
      "cohort_1.zip",
      makeZip({
        "100200301 - QUILL AVERY . - a.docx": packFile("submissions/sub-a.docx"),
        "100200302 - PIKE JORDAN - b.pdf": packFile("submissions/sub-b.pdf"),
        "100200303 - MARSH RILEY - c.docx": packFile("submissions/sub-c.docx"),
        "100200304 - ROWAN CASEY - d.pdf": packFile("submissions/sub-d.pdf"),
      }),
    ),
  );
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic" });
  await anonymiseWorkspace(ws);
  const ids = ["sub-001", "sub-002", "sub-003", "sub-004"];
  for (const id of ids) await approve(ws, id);
  const criteria = (await loadRubric(ws)).criteria.map((c) => c.id);
  for (const id of ids) {
    for (const c of criteria) await recordJudgement(ws, id, c, { levelId: "p62" });
    await recordSubmissionMark(ws, id, { mark: 62 });
  }
  const own = (id: string, target: string) => `For ${id} on ${target}, the argument is clear and the evidence is well chosen throughout. Next time, test it more widely.`;
  for (const id of ids) {
    for (const [i, c] of criteria.entries()) await recordFeedback(ws, id, c, { text: id === "sub-003" && i === 0 ? "Fine. Next time, more." : own(id, c) });
    await recordFeedback(ws, id, OVERALL, { text: own(id, "the whole piece") });
  }
  return { ws, criteria, ids };
}

/** What the educator is shown: every waiting submission's digest. */
const shown = async (ws: Awaited<ReturnType<typeof setUp>>["ws"]) => Object.fromEntries((await waitingFeedback(ws)).map((w) => [w.id, w.digest]));

test("the submissions ready to approve are listed with what each student will receive, and the ones the cohort checks flag say why", async () => {
  const { ws } = await setUp("fset-1");
  const waiting = await waitingFeedback(ws);
  expect(waiting.map((w) => w.id)).toEqual(["sub-001", "sub-002", "sub-003", "sub-004"]);
  expect(waiting.map((w) => [w.id, w.exceptions.length > 0])).toEqual([["sub-001", false], ["sub-002", false], ["sub-003", true], ["sub-004", false]]);
  expect(waiting[2].exceptions[0]).toMatch(/^sub-003 \[STUDENT_C\]: much shorter than the rest/);
  expect(waiting[0].feedback.mark).toBe(62);
  expect(waiting[0].feedback.overall).toContain("For sub-001");
});

test("nothing is approved without the confirmation that the rest were skimmed", async () => {
  const { ws } = await setUp("fset-2");
  await expect(approveFeedbackSet(ws, { opened: {}, skimmed: null })).rejects.toThrow(/confirm that you have skimmed the submissions that are not flagged/);
  expect((await waitingFeedback(ws)).length).toBe(4);
  expect(await loadSubmissionApproval(ws, "sub-001")).toBeNull();
});

test("the set is approved on the confirmation, an exception that was not opened is held back and said, and each approval records the set", async () => {
  const { ws } = await setUp("fset-3");
  const result = await approveFeedbackSet(ws, { opened: {}, skimmed: await shown(ws) });
  expect(result.approved).toEqual(["sub-001", "sub-002", "sub-004"]);
  expect(result.skipped).toEqual([{ id: "sub-003", label: "sub-003 [STUDENT_C]", why: "it is flagged, and what its student will receive hasn't been opened as it now is" }]);
  expect([result.size, result.flagged]).toEqual([4, 1]);
  expect((await loadSubmissionApproval(ws, "sub-001"))!.made_in_set).toEqual({ size: 4, flagged: 1, flagged_this: false, opened_this: false, skimmed_unflagged: true });
  expect(await loadSubmissionApproval(ws, "sub-003")).toBeNull();
});

test("an exception, once opened, is approved in a later set, and what is already approved is not approved again", async () => {
  const { ws } = await setUp("fset-4");
  await approveFeedbackSet(ws, { opened: {}, skimmed: await shown(ws), now: new Date("2026-01-01T10:00:00Z") });
  const before = (await loadSubmissionApproval(ws, "sub-001"))!.approved_at;
  const later = await approveFeedbackSet(ws, { opened: await shown(ws), skimmed: null, now: new Date("2026-01-02T10:00:00Z") });
  expect(later.approved).toEqual(["sub-003"]);
  expect([later.size, later.flagged]).toEqual([1, 1]);
  expect((await loadSubmissionApproval(ws, "sub-003"))!.made_in_set).toEqual({ size: 1, flagged: 1, flagged_this: true, opened_this: true, skimmed_unflagged: false });
  expect((await loadSubmissionApproval(ws, "sub-001"))!.approved_at).toBe(before);
  expect((await approveFeedbackSet(ws, { opened: {}, skimmed: null })).size).toBe(0); // nothing waits now
});

test("a submission changed after the list was shown is left out and said, not approved", async () => {
  const { ws, criteria } = await setUp("fset-5");
  const listed = await shown(ws);
  await recordFeedback(ws, "sub-002", criteria[1], { text: "A different piece of feedback, written after the list was shown. Next time, check the sources." });
  const result = await approveFeedbackSet(ws, { opened: {}, skimmed: listed });
  expect(result.approved).toEqual(["sub-001", "sub-004"]);
  expect(result.skipped.map((s) => s.id)).toEqual(["sub-002", "sub-003"]);
  expect(result.skipped[0].why).toMatch(/isn't what you confirmed you had skimmed/);
  expect(await loadSubmissionApproval(ws, "sub-002")).toBeNull();
  // An exception opened on one version is not approved once it has changed.
  const opened = await shown(ws);
  await recordFeedback(ws, "sub-003", criteria[1], { text: "Changed after it was opened. Next time, check the sources again." });
  const again = await approveFeedbackSet(ws, { opened, skimmed: await shown(ws) });
  expect(again.skipped.map((s) => s.id)).toContain("sub-003");
});

test("a submission approved on its own records no set, and the structured record carries the set", async () => {
  const { ws } = await setUp("fset-6");
  await approveSubmission(ws, "sub-001");
  expect((await loadSubmissionApproval(ws, "sub-001"))!.made_in_set).toBeNull();
  await approveFeedbackSet(ws, { opened: await shown(ws), skimmed: await shown(ws) });
  const record = await markingRecord(ws);
  expect(record.approvals.map((a) => [a.submission_id, a.made_in_set?.size ?? null])).toEqual([["sub-001", null], ["sub-002", 3], ["sub-003", 3], ["sub-004", 3]]);
  expect(await approveFeedbackSet(ws, { opened: {}, skimmed: null })).toMatchObject({ approved: [], size: 0 });
  await expect(approveSubmission(ws, "sub-009")).rejects.toBeInstanceOf(WorkspaceError);
});
