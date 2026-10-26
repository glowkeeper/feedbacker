/**
 * The request's marks as the original marking, when the marked views carry none: an overall mark only,
 * with no marks for the criteria and no comments, through every screen that uses marking.
 */

import { beforeEach, expect, test } from "vitest";
import { compare, compareOverall } from "../src/app/comparison.ts";
import { loadReview } from "../src/app/review.ts";
import { markingCheck, markingRecords } from "../src/app/markingRecords.ts";
import { agreement, approveRecord, confirmMarking, exportSummary, importMarking, loadMarking, recordRequest, useRequestMarks, bytesSource, WorkspaceError, type Rubric, type Workspace } from "../src/core/index.ts";
import { makeZip, pdfPages } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";
import { at, reviewBoth, setUpModeration } from "./moderation.ts";

let ws: Workspace;
let rubric: Rubric;

beforeEach(async () => {
  ({ ws, rubric } = await setUpModeration("mod-request-marks", { marking: "request" }));
});

test("the request's marks become the original marking: the initial mark the marker's, an agreed mark that differs, the internal moderator's record", async () => {
  const first = await loadMarking(ws, "sub-001", "marker");
  expect([first.import_route, first.overall_mark, first.criterion_marks, first.annotations, first.overall_comment, first.confirmed_at]).toEqual(["request_document", 62, [], [], null, null]);
  expect(first.import_notes).toEqual(["The request gave this overall mark only: it has no marks for the criteria and no comments."]);
  expect(first.provenance).toMatchObject({ source: "moderation request", transformation: "imported" });
  expect((await loadMarking(ws, "sub-001", "internal moderator")).overall_mark).toBe(60);
  expect((await loadMarking(ws, "sub-002", "marker")).overall_mark).toBe(48);
  // sub-002 had no agreed mark, so it has no record for one.
  expect((await markingRecords(ws)).map((r) => [r.submissionId, r.markerLabel, r.imported, r.confirmed])).toEqual([
    ["sub-001", "internal moderator", true, false],
    ["sub-001", "marker", true, false],
    ["sub-002", "marker", true, false],
  ]);
});

test("it replaces existing marking only when told to, keeping the old record, and says what it couldn't use", async () => {
  await expect(useRequestMarks(ws)).rejects.toThrow(WorkspaceError);
  const again = await useRequestMarks(ws, { replace: true, now: at(30) });
  expect(again.recorded.map((a) => [a.submission_id, a.marker_label])).toEqual([["sub-001", "marker"], ["sub-001", "internal moderator"], ["sub-002", "marker"]]);
  expect((await ws.fs.list("marking/history")).length).toBe(3);
  // A request that gives no mark for a student leaves that student with none, and says so.
  const { ws: ws2 } = await setUpModeration("mod-request-some", { marking: "request" });
  const request = (await ws2.readJson("request.json")) as { sample: { initial_mark: number | null; agreed_mark: number | null }[] };
  request.sample[1].initial_mark = null;
  await ws2.writeJson("request.json", request);
  const some = await useRequestMarks(ws2, { replace: true });
  expect(some.skipped).toEqual(["sub-002"]);
  request.sample[0].initial_mark = null;
  await ws2.writeJson("request.json", request);
  await expect(useRequestMarks(ws2, { replace: true })).rejects.toThrow("the request gives no marks to use");
});

test("a marked view that carries no marking says so, and points to the request's marks", async () => {
  const bare = pdfPages(["Submission ID: 100200301\nFile name: a.docx\nWord count: 10", "FINAL GRADE GENERAL COMMENTS\n/100\nPAGE 1"]);
  const result = await importMarking(ws, bytesSource("g.zip", makeZip({ "100200301 - QUILL AVERY - x.docx.pdf": bare, "100200302 - PIKE JORDAN - x.docx.pdf": bare })), { replace: true });
  expect(result.imported).toEqual([]);
  expect([...result.failed.keys()]).toEqual(["sub-001", "sub-002"]);
  expect(result.failed.get("sub-001")).toBe("this marked view carries no marking (no grade, rubric or comments); where the request lists the marks, use them as the original marking instead");
});

test("the marking is checked and confirmed like any other: an overall mark, and nothing to compare by criterion", async () => {
  const check = await markingCheck(ws, "sub-001", "marker");
  expect([check.overall, check.rows, check.inline, check.overallComment, check.confirmed]).toEqual(["62%", [], 0, false, false]);
  expect(check.route).toContain("an overall mark only");
  await confirmMarking(ws, "sub-001", "marker");
  expect((await markingCheck(ws, "sub-001", "marker")).confirmed).toBe(true);
});

test("review, the comparison, the agreement, the record and the summary all work from an overall mark only", async () => {
  await reviewBoth(ws, rubric);
  const review = await loadReview(ws, "sub-001");
  const rows = compare(review);
  // No marker mark for any criterion: said so, never an empty or zero mark.
  for (const row of rows) for (const m of row.markers) expect([m.cell.text, m.cell.differs]).toEqual(["No mark", false]);
  const overall = compareOverall(review)!;
  expect(overall.markers.map((m) => [m.marker, m.text.split(",")[0]])).toEqual([["internal moderator", "60%"], ["marker", "62%"]]);
  expect(overall.markers[1].text).toContain("as awarded");

  await confirmMarking(ws, "sub-001", "internal moderator"); // every record of marking is confirmed, the internal moderator's too
  const record = await approveRecord(ws, { overallComment: "Overall marks only.", now: at(20) });
  const { bySubmission, byCriterion } = agreement(record);
  // There is no marker's mark for any criterion, so nothing is compared (and nothing counted against anyone).
  const compared = (t: { agree: number; higher: number; lower: number; different: number }) => t.agree + t.higher + t.lower + t.different;
  expect([...bySubmission.values()].map((s) => compared(s.marking))).toEqual([0, 0]);
  expect([...byCriterion.values()].every((c) => compared(c.marking) === 0)).toBe(true);
  const { markdown } = await exportSummary(ws, at(25));
  expect(markdown).toContain("The marker's overall mark: 62%");
  expect(markdown).toContain("The internal moderator's overall mark: 60%");
  expect(markdown).toContain("No mark");
  expect(markdown.includes("NaN")).toBe(false);
});

test("an agreed mark the same as the initial one makes no record of its own, and the marker's record says so", async () => {
  const { ws: fresh } = await newWorkspace();
  await recordRequest(fresh, [{ external_id: "A1", initial_mark: 70, agreed_mark: 70 }, { external_id: "A2", initial_mark: 50, agreed_mark: 40 }, { external_id: "A3", initial_mark: 60 }]);
  const { recorded } = await useRequestMarks(fresh);
  expect(recorded.map((a) => [a.submission_id, a.marker_label, a.overall_mark])).toEqual([
    ["sub-001", "marker", 70], // agreed as it stood: nothing to compare, so no "internal moderator" record
    ["sub-002", "marker", 50],
    ["sub-002", "internal moderator", 40], // changed on agreement: both are kept
    ["sub-003", "marker", 60], // no agreed mark
  ]);
  expect((await loadMarking(fresh, "sub-001", "marker")).import_notes).toContain("The request's agreed mark (after internal moderation) is the same as this one.");
  expect((await loadMarking(fresh, "sub-002", "marker")).import_notes).toHaveLength(1);
});

test("an overall-only marking can be checked before a rubric is imported", async () => {
  const { ws: fresh } = await newWorkspace(); // no rubric yet
  await recordRequest(fresh, [{ external_id: "A1", initial_mark: 70 }]);
  await useRequestMarks(fresh);
  const check = await markingCheck(fresh, "sub-001", "marker");
  expect([check.overall, check.rows]).toEqual(["70%", []]);
});
