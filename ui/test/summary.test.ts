/** The readable moderation summary (#20), from the approved record: a snapshot on the synthetic moderation. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { agreement, approveRecord, exportSummary, recordJudgement, recordVerdict, RecordNotReady, renderSummary, type Rubric, type Workspace } from "../src/core/index.ts";
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
  const md = renderSummary(record);
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

test("a level taken from the AI suggestion says so, and the agreement with the AI says how many were", async () => {
  const c = rubric.criteria[1];
  await recordJudgement(ws, "sub-001", c.id, { levelId: c.levels[1].id, levelFromAi: true, now: at(4) }); // the reading suggests levels[1]
  const md = renderSummary(await approveRecord(ws, { now: at(20) }));
  expect(md).toContain(`| ${c.title} | ${c.levels[1].label} (taken from the AI suggestion) |`);
  expect(md).toContain("1 of your levels was taken from the AI suggestion, so that agreement is not independent.");
});

test("the form section lists the sample by grade band, in the request's order", async () => {
  const record = await approveRecord(ws, { now: at(20) });
  const md = renderSummary({ ...record, submissions: record.submissions.map((s) => (s.id === "sub-002" ? { ...s, listed_band: null } : s)) });
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

test("text is text, never structure: tables, headings, emphasis, HTML and links are escaped", async () => {
  const record = await approveRecord(ws, { overallComment: "# Line one\nline | two, *bold*, <b>html</b>, `code`, [a link](https://example.com), [STUDENT_A]", now: at(20) });
  const md = renderSummary(record);
  // (The link's address is anonymised, as any URL in a comment is.)
  expect(md).toMatch(/^\\# Line one line \\\| two, \\\*bold\\\*, \\<b\\>html\\<\/b\\>, \\`code\\`, \[a link\]\\\(\[URL_\d+\]\), \[STUDENT_A\]$/m);
  expect(md).not.toMatch(/^# Line one/m);
});

test("times are given in UTC, whatever offset they were recorded with", async () => {
  const record = await approveRecord(ws, { now: at(20) });
  expect(renderSummary({ ...record, approved_at: "2026-09-27T11:20:00+01:00" })).toContain("Approved by the moderator on 2026-09-27 10:20 UTC.");
});

test("the review is described as it was: no AI reading is claimed where there wasn't one", async () => {
  const md = renderSummary(await approveRecord(ws, { now: at(20) }));
  expect(md).toContain("- Review: open; the original marking and the AI reading were shown throughout");
  expect(md).toContain("- Review: blind; the original marking was (there was no AI reading) revealed on 2026-09-27 10:02 UTC");
});

test("a mark between two levels says where it sits on the source rubric, never rounded", async () => {
  const md = renderSummary(await approveRecord(ws, { now: at(20) }));
  expect(md).toMatch(/58 \/ 100; the marker's level: 2:2 \(55\); on the source rubric: between /);
});

test("the grade bands are part of the approval: changing one after it stops the export", async () => {
  const record = await approveRecord(ws, { now: at(20) });
  expect(record.submissions.map((s) => s.listed_band)).toEqual(["60-69", "50-59"]);
  const request = (await ws.readJson("request.json")) as { sample: { listed_band: string | null }[] };
  request.sample[1].listed_band = "40-49";
  await ws.writeJson("request.json", request);
  await expect(exportSummary(ws)).rejects.toThrow("the moderation has changed since it was approved");
});

test("an empty overall comment is no comment", async () => {
  const record = await approveRecord(ws, { now: at(20) });
  const md = renderSummary({ ...record, overall_comment: "   " });
  expect(md).toContain("## Overall moderator's comment\n\nNo overall comment was recorded.");
  expect(md).toContain("### Moderator's comments\n\nNo overall comment was recorded.");
});
