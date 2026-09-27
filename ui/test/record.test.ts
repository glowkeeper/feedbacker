/** The moderation record (#20): assembled, approved by the moderator, and exported only as approved. */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import {
  approve,
  approveRecord,
  assembleRecord,
  bytesSource,
  chooseReviewMode,
  exportRecord,
  importMarking,
  loadApprovedRecord,
  ModerationRecord,
  recordJudgement,
  RECORD,
  RecordNotReady,
  recordVerdict,
  type Rubric,
  type Workspace,
} from "../src/core/index.ts";
import { makeZip, packFile } from "./builders.ts";
import { at, REAL, reviewBoth as reviewModeration, setUpModeration } from "./moderation.ts";

let ws: Workspace;
let path: string;
let rubric: Rubric;

beforeEach(async () => {
  ({ ws, path, rubric } = await setUpModeration());
});

const reviewBoth = () => reviewModeration(ws, rubric);

test("until the moderation is complete, the record lists what is missing and can't be approved", async () => {
  const { record, problems } = await assembleRecord(ws);
  expect(record).toBeNull();
  expect(problems).toEqual([
    "sub-001 [STUDENT_A]: not reviewed yet",
    `sub-001 [STUDENT_A]: still to judge: ${rubric.criteria.map((c) => c.title).join(", ")}`,
    "sub-001 [STUDENT_A]: the marker marking isn't confirmed",
    "sub-001 [STUDENT_A]: no verdict on the marking yet",
    "sub-002 [STUDENT_B]: not reviewed yet",
    `sub-002 [STUDENT_B]: still to judge: ${rubric.criteria.map((c) => c.title).join(", ")}`,
    "sub-002 [STUDENT_B]: the marker marking isn't confirmed",
    "sub-002 [STUDENT_B]: no verdict on the marking yet",
  ]);
  await expect(approveRecord(ws)).rejects.toThrow(RecordNotReady);
  expect(await ws.exists(RECORD)).toBe(false);
});

test("a blind review not yet revealed keeps the record from being ready", async () => {
  await chooseReviewMode(ws, "sub-002", "blind", at(0));
  for (const c of rubric.criteria) await recordJudgement(ws, "sub-002", c.id, { levelId: c.levels[0].id, now: at(1) });
  const { problems } = await assembleRecord(ws);
  expect(problems).toContain("sub-002 [STUDENT_B]: its blind review hasn't been revealed");
});

test("the complete record is pseudonymous, self-contained and in a fixed order", async () => {
  await reviewBoth();
  const { record, problems } = await assembleRecord(ws, at(10));
  expect(problems).toEqual([]);
  const r = record!;
  expect(r.id).toBe("mod-record");
  expect(r.context?.module).toBe("Fictional 101");
  expect(r.submissions.map((s) => [s.id, s.pseudonym, s.extract, s.anonymised !== null, s.approval !== null])).toEqual([
    ["sub-001", "[STUDENT_A]", null, true, true],
    ["sub-002", "[STUDENT_B]", null, true, true],
  ]);
  expect(JSON.stringify(r)).not.toMatch(REAL); // no extract, name or external ID
  expect(r.original_assessments.map((a) => [a.submission_id, a.marker_label, a.confirmed_at !== null])).toEqual([
    ["sub-001", "marker", true],
    ["sub-002", "marker", true],
  ]);
  expect(r.ai_suggestions.map((s) => s.criterion_id)).toEqual(rubric.criteria.map((c) => c.id));
  expect(r.judgements.map((j) => [j.submission_id, j.criterion_id, j.mode, j.revised !== null])).toEqual([
    ...rubric.criteria.map((c) => ["sub-001", c.id, "open", false]),
    ...rubric.criteria.map((c, i) => ["sub-002", c.id, "blind", i === 0]),
  ]);
  expect(r.verdicts.map((v) => [v.submission_id, v.verdict, v.suggested_mark])).toEqual([
    ["sub-001", "generous", 58],
    ["sub-002", "agree", null],
  ]);
  expect([r.approved_by, r.approved_at, r.overall_comment]).toEqual([null, null, null]);
  expect(r.provenance).toMatchObject({ source: "workspace:mod-record", actor: { kind: "moderator" }, timestamp: "2026-09-27T10:10:00Z" });
  expect(r.provenance.input_hashes.length).toBe(1 + 2 + 2); // the rubric, two approved texts, two marking records
  // The same workspace gives the same record.
  expect((await assembleRecord(ws, at(10))).record).toEqual(r);
});

test("the moderator approves the record, which is then exported exactly as approved", async () => {
  await reviewBoth();
  const approved = await approveRecord(ws, { overallComment: "Marking was consistent; Morgan Ellis's module is well run.", now: at(20) });
  expect(approved.approved_by).toEqual({ kind: "moderator", label: "moderator" });
  expect(approved.approved_at).toBe("2026-09-27T10:20:00Z");
  expect(approved.overall_comment).not.toContain("Morgan"); // anonymised
  expect(await loadApprovedRecord(ws)).toEqual(approved);

  const { path: exported } = await exportRecord(ws, at(25));
  expect(exported).toBe("exports/mod-record-record.feedbacker-export.json");
  const text = readFileSync(join(path, exported), "utf8");
  expect(ModerationRecord.parse(JSON.parse(text))).toEqual(approved);
  expect(text).not.toMatch(REAL);
  expect(readdirSync(join(path, "exports"))).toEqual(["mod-record-record.feedbacker-export.json"]);
});

test("a change after the approval stops the export until the record is approved again, keeping the earlier approval", async () => {
  await reviewBoth();
  await expect(exportRecord(ws)).rejects.toThrow("hasn't been approved");
  await approveRecord(ws, { now: at(20) });
  await recordVerdict(ws, "sub-002", { verdict: "harsh" }); // a change of mind
  await expect(exportRecord(ws)).rejects.toThrow("the moderation has changed since it was approved; approve it again before exporting");
  const again = await approveRecord(ws, { now: at(30) });
  expect(again.verdicts[1].verdict).toBe("harsh");
  // The earlier approval is kept, named by when it was replaced (as the other histories are).
  expect(readdirSync(join(path, "record", "history"))).toEqual(["record--20260927T103000000000.json"]);
  expect(((await ws.readJson("record/history/record--20260927T103000000000.json")) as { approved_at: string }).approved_at).toBe("2026-09-27T10:20:00Z");
  expect((await exportRecord(ws)).record).toEqual(again);
});

test("a change that makes the moderation incomplete is listed at export", async () => {
  await reviewBoth();
  await approveRecord(ws, { now: at(20) });
  await importMarking(
    ws,
    bytesSource("g.zip", makeZip({ "100200301 - QUILL AVERY - x.docx.pdf": packFile("marked-view-replica.pdf"), "100200302 - PIKE JORDAN - x.docx.pdf": packFile("marked-view-replica.pdf") })),
    { replace: true },
  );
  const err = await exportRecord(ws).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(RecordNotReady);
  expect((err as RecordNotReady).problems).toContain("sub-001 [STUDENT_A]: the marker marking isn't confirmed");
});

test("a damaged approved record is reported", async () => {
  await reviewBoth();
  await approveRecord(ws, { now: at(20) });
  await ws.writeJson(RECORD, { kind: "moderation_record" });
  await expect(exportRecord(ws)).rejects.toThrow("record/record.json is not a valid approved moderation record");
});

test("a reading of an earlier rubric version is a reason the record isn't ready, not a raw error", async () => {
  await reviewBoth();
  const readings = (await ws.readJson("readings/sub-001.json")) as { call: { rubric_version: string } }[];
  await ws.writeJson("readings/sub-001.json", readings.map((r) => ({ ...r, call: { ...r.call, rubric_version: "0" } })));
  const { record, problems } = await assembleRecord(ws);
  expect(record).toBeNull();
  expect(problems).toEqual([`sub-001 [STUDENT_A]: readings/sub-001.json was read against rubric version '0', not '${rubric.version}'; run the reading again`]);
  await expect(approveRecord(ws)).rejects.toThrow(RecordNotReady);
});
