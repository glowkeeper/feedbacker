/** The readable moderation summary (#20), from the approved record: a snapshot on the synthetic moderation. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { agreement, approveRecord, exportSummary, recordVerdict, RecordNotReady, renderSummary, type Rubric, type Workspace } from "../src/core/index.ts";
import { at, REAL, reviewBoth, setUpModeration } from "./moderation.ts";

let ws: Workspace;
let path: string;
let rubric: Rubric;

beforeEach(async () => {
  ({ ws, path, rubric } = await setUpModeration("mod-summary"));
  await reviewBoth(ws, rubric);
});

test("the summary of the approved record, in full", async () => {
  await approveRecord(ws, { overallComment: "Marking was broadly consistent with the rubric; Implementation was marked a little generously.", now: at(20) });
  const { path: exported, markdown } = await exportSummary(ws, at(25));
  expect(exported).toBe("exports/mod-summary-summary.feedbacker-export.md");
  expect(readFileSync(join(path, exported), "utf8")).toBe(markdown);
  await expect(markdown).toMatchFileSnapshot("__snapshots__/summary.md");
});

test("it is pseudonymous, labels the AI's part, and has real structure", async () => {
  const record = await approveRecord(ws, { now: at(20) });
  const md = renderSummary(record, new Map([["sub-001", "60-69"], ["sub-002", "50-59"]]));
  expect(md).not.toMatch(REAL);
  expect(md).toContain("AI suggestion (not a mark)");
  expect(md).toContain("A draft, adapted. (adapted from the AI draft)");
  expect(md).toContain("(revised after the reveal from ");
  // Headings step down one level at a time, and every table has a header row.
  const levels = md.split("\n").filter((l) => /^#+ /.test(l)).map((l) => l.indexOf(" "));
  expect(levels[0]).toBe(1);
  expect(levels.every((n, i) => i === 0 || n <= levels[i - 1] + 1)).toBe(true);
  const tables = md.split("\n\n").filter((b) => b.startsWith("| "));
  expect(tables.length).toBeGreaterThan(3);
  expect(tables.every((t) => /^\|( --- \|)+$/.test(t.split("\n")[1]))).toBe(true);
  // With no overall comment, the form section says so rather than being blank.
  expect(md).toContain("### Moderator's comments\n\nNo overall comment was recorded.");
});

test("the form section lists the sample by grade band, in the request's order", async () => {
  const record = await approveRecord(ws, { now: at(20) });
  const md = renderSummary(record, new Map([["sub-001", "60-69"], ["sub-002", null]]));
  const form = md.slice(md.indexOf("## For the moderation form"));
  expect(form).toContain("#### 60-69\n\n- [STUDENT_A] (sub-001): Generous; suggested mark 58\n");
  expect(form).toContain("#### No band listed\n\n- [STUDENT_B] (sub-002): Agree\n");
  expect(form.indexOf("#### 60-69")).toBeLessThan(form.indexOf("#### No band listed"));
});

test("agreement counts each marker's mark against the moderator's current level", async () => {
  const record = await approveRecord(ws, { now: at(20) });
  const { bySubmission, byCriterion } = agreement(record);
  const total = (t: { agree: number; higher: number; lower: number; different: number }) => t.agree + t.higher + t.lower + t.different;
  // Every criterion of both submissions is compared with the one marker; only sub-001 has an AI reading.
  expect(total(bySubmission.get("sub-001")!.marking) + total(bySubmission.get("sub-002")!.marking)).toBe(
    record.original_assessments.flatMap((a) => a.criterion_marks.filter((m) => m.mark !== null)).length,
  );
  expect(total(bySubmission.get("sub-001")!.ai)).toBe(rubric.criteria.length);
  expect(total(bySubmission.get("sub-002")!.ai)).toBe(0);
  expect([...byCriterion.keys()]).toEqual(rubric.criteria.map((c) => c.id));
});

test("the summary is exported only while the workspace matches the approval", async () => {
  await expect(exportSummary(ws)).rejects.toThrow("hasn't been approved");
  await approveRecord(ws, { now: at(20) });
  await recordVerdict(ws, "sub-002", { verdict: "harsh" });
  await expect(exportSummary(ws)).rejects.toThrow(RecordNotReady);
});

test("text is safe in tables and lines: pipes and line breaks don't break the structure", async () => {
  const record = await approveRecord(ws, { overallComment: "Line one\nline | two", now: at(20) });
  const md = renderSummary(record);
  expect(md).toContain("Line one line \\| two");
});
