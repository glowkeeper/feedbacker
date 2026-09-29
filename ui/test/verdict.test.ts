/** The moderator's verdict on each submission's marking (#19). */

import { beforeEach, expect, test } from "vitest";
import {
  anonymiseWorkspace,
  approve,
  bytesSource,
  chooseReviewMode,
  enterMarking,
  importOriginals,
  importRubric,
  loadRubric,
  loadVerdict,
  markingDigest,
  OriginalAssessment,
  confirmMarking,
  staleVerdict,
  recordJudgement,
  recordRequest,
  recordVerdict,
  reveal,
  updateRules,
  verdictPath,
  VERDICTS,
  WorkspaceError,
  type Workspace,
} from "../src/core/index.ts";
import { makeZip, packFile } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

let ws: Workspace;
const NOW = new Date("2026-09-27T10:00:00Z");

beforeEach(async () => {
  ({ ws } = await newWorkspace());
  await recordRequest(ws, [{ external_id: "100200301" }, { external_id: "100200302" }]);
  await importOriginals(
    ws,
    bytesSource("o.zip", makeZip({ "100200301 - QUILL AVERY . - a.docx": packFile("submissions/sub-a.docx"), "100200302 - PIKE JORDAN - b.pdf": packFile("submissions/sub-b.pdf") })),
  );
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic" });
  await updateRules(ws, { names: ["Morgan Ellis"] });
  await anonymiseWorkspace(ws);
  await approve(ws, "sub-001");
  await approve(ws, "sub-002");
});

test("a verdict records the moderator, the approved text, and an anonymised comment", async () => {
  await enterMarking(ws, "sub-001", { overall: 62 });
  expect(await loadVerdict(ws, "sub-001")).toBeNull();
  const v = await recordVerdict(ws, "sub-001", { verdict: "generous", suggestedMark: 58, comment: " Morgan Ellis was over-rewarded. ", now: NOW });
  expect(v).toMatchObject({ submission_id: "sub-001", verdict: "generous", suggested_mark: 58, provenance: { actor: { kind: "moderator" }, transformation: "recorded" } });
  expect(v.comment).toMatch(/^\[[A-Z_0-9]+\] was over-rewarded\.$/);
  const marking = await ws.readJson("marking/sub-001--marker.json");
  // The text, the rubric, the moderator's levels and marks (none yet), and the marking.
  const { judgementsDigest, rubricDigest } = await import("../src/core/index.ts");
  expect(v.provenance.input_hashes).toEqual([
    ((await ws.readJson("submissions/sub-001.json")) as { approval: { approved_text_sha256: string } }).approval.approved_text_sha256,
    rubricDigest(await loadRubric(ws)),
    judgementsDigest([]),
    markingDigest(OriginalAssessment.parse(marking)),
  ]);
  expect(await loadVerdict(ws, "sub-001")).toEqual(v);
});

test("changing a verdict keeps the previous one in the history", async () => {
  await enterMarking(ws, "sub-001", { overall: 62 });
  await recordVerdict(ws, "sub-001", { verdict: "agree", now: NOW });
  const changed = await recordVerdict(ws, "sub-001", { verdict: "harsh", now: new Date("2026-09-27T11:00:00Z") });
  expect([changed.verdict, changed.suggested_mark, changed.comment, changed.provenance.transformation]).toEqual(["harsh", null, null, "revised"]);
  const history = (await ws.fs.list(`${VERDICTS}/history`)).map((e) => e.name);
  expect(history).toEqual(["sub-001--20260927T110000000000.json"]);
  expect(((await ws.readJson(`${VERDICTS}/history/${history[0]}`)) as { verdict: string }).verdict).toBe("agree");
});

test("a verdict needs marking to judge, in the sample", async () => {
  await expect(recordVerdict(ws, "sub-001", { verdict: "agree" })).rejects.toThrow("has no original marking to give a verdict on");
  await expect(recordVerdict(ws, "sub-009", { verdict: "agree" })).rejects.toThrow("not in the sample");
  await enterMarking(ws, "sub-001", { overall: 62 });
  await expect(recordVerdict(ws, "sub-001", { verdict: "agree", suggestedMark: -1 })).rejects.toThrow();
  expect(await ws.exists(verdictPath("sub-001"))).toBe(false);
});

test("no verdict before a blind review's reveal", async () => {
  await chooseReviewMode(ws, "sub-002", "blind", NOW);
  const { importMarking } = await import("../src/core/index.ts");
  await importMarking(ws, bytesSource("g.zip", makeZip({ "100200301 - QUILL AVERY - x.docx.pdf": packFile("marked-view-replica.pdf"), "100200302 - PIKE JORDAN - x.docx.pdf": packFile("marked-view-replica.pdf") })));
  await expect(recordVerdict(ws, "sub-002", { verdict: "agree" })).rejects.toThrow("isn't shown yet");
  for (const c of (await loadRubric(ws)).criteria) await recordJudgement(ws, "sub-002", c.id, { levelId: c.levels[0].id, now: NOW });
  await reveal(ws, "sub-002", new Date("2026-09-27T12:00:00Z"));
  expect((await recordVerdict(ws, "sub-002", { verdict: "inconsistent" })).verdict).toBe("inconsistent");
});

test.each([
  ["not a verdict", { nope: 1 }, "is not a valid verdict"],
  ["another submission's", "other", "the verdict on another submission"],
])("a damaged verdict is reported: %s", async (_, content, message) => {
  await enterMarking(ws, "sub-001", { overall: 62 });
  const v = await recordVerdict(ws, "sub-001", { verdict: "agree" });
  await ws.writeJson(verdictPath("sub-001"), content === "other" ? { ...v, submission_id: "sub-002" } : content);
  await expect(loadVerdict(ws, "sub-001")).rejects.toThrow(WorkspaceError);
  await expect(loadVerdict(ws, "sub-001")).rejects.toThrow(message);
});

test("marking filed under the submission but recording another isn't its marking", async () => {
  await enterMarking(ws, "sub-002", { overall: 62 });
  const other = await ws.readJson("marking/sub-002--marker.json");
  await ws.writeJson("marking/sub-001--marker.json", other); // a valid record of sub-002, misfiled
  await expect(recordVerdict(ws, "sub-001", { verdict: "agree" })).rejects.toThrow("has no original marking to give a verdict on");
});

test("a verdict is stale once the marking it was given on changes, but not when that marking is confirmed", async () => {
  const { importMarking } = await import("../src/core/index.ts");
  await importMarking(ws, bytesSource("g.zip", makeZip({ "100200301 - QUILL AVERY - x.docx.pdf": packFile("marked-view-replica.pdf"), "100200302 - PIKE JORDAN - x.docx.pdf": packFile("marked-view-replica.pdf") })));
  const verdict = await recordVerdict(ws, "sub-001", { verdict: "agree" });
  const approved = ((await ws.readJson("submissions/sub-001.json")) as { approval: { approved_text_sha256: string } }).approval.approved_text_sha256;
  const markings = async () => [OriginalAssessment.parse(await ws.readJson("marking/sub-001--marker.json"))];
  const rubric = await loadRubric(ws);
  expect(staleVerdict(verdict, approved, await markings(), rubric, [])).toBe(false);
  await confirmMarking(ws, "sub-001");
  expect(staleVerdict(verdict, approved, await markings(), rubric, [])).toBe(false); // confirming changes nothing it was given on
  await enterMarking(ws, "sub-001", { overall: 70 }); // a correction by hand replaces the record (the app asks first)
  expect(staleVerdict(verdict, approved, await markings(), rubric, [])).toBe(true);
  expect(staleVerdict(verdict, approved, [...(await markings()), ...(await markings())], rubric, [])).toBe(true); // another marker's record too
  expect(staleVerdict(verdict, null, [], rubric, [])).toBe(false); // with no approved text, nothing to compare
});

test("a record filed under another marker's name isn't marking to give a verdict on", async () => {
  await enterMarking(ws, "sub-001", { markerLabel: "second marker", overall: 62 });
  await ws.writeJson("marking/sub-001--marker.json", await ws.readJson("marking/sub-001--second-marker.json"));
  const { rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  rmSync(join(ws.registration.path, "marking", "sub-001--second-marker.json"));
  await expect(recordVerdict(ws, "sub-001", { verdict: "agree" })).rejects.toThrow("has no original marking to give a verdict on");
});

test("a change to a marking record's import notes makes a verdict on it stale", async () => {
  await enterMarking(ws, "sub-001", { overall: 62 });
  const verdict = await recordVerdict(ws, "sub-001", { verdict: "agree" });
  const approved = ((await ws.readJson("submissions/sub-001.json")) as { approval: { approved_text_sha256: string } }).approval.approved_text_sha256;
  const record = OriginalAssessment.parse(await ws.readJson("marking/sub-001--marker.json"));
  const rubric = await loadRubric(ws);
  expect(staleVerdict(verdict, approved, [record], rubric, [])).toBe(false);
  expect(staleVerdict(verdict, approved, [{ ...record, import_notes: ["the rubric total 60 differs from the grade 62"] }], rubric, [])).toBe(true);
});

test("a verdict records the overall the moderator's criterion marks imply, once every criterion is judged and current", async () => {
  await enterMarking(ws, "sub-001", { overall: 62 });
  const rubric = await loadRubric(ws); // four criteria, 25% each, out of 100
  expect((await recordVerdict(ws, "sub-001", { verdict: "agree" })).criteria_mark).toBeNull(); // nothing judged yet
  const marks = [70, 68, 65, 62]; // 2:1 (68) moved up 2, the level's own points, and 2:1 (62) moved up 3 and left as it is
  const levels = [2, 2, 3, 3];
  for (const [i, c] of rubric.criteria.entries()) await recordJudgement(ws, "sub-001", c.id, { levelId: c.levels[levels[i]].id, mark: marks[i], now: NOW });
  const v = await recordVerdict(ws, "sub-001", { verdict: "agree", suggestedMark: 66 });
  expect([v.suggested_mark, v.criteria_mark]).toEqual([66, 66.3]); // (70 + 68 + 65 + 62) / 4 = 66.25
  // Judged against a rubric since changed: it can't be worked out.
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic", replace: true, weights: Object.fromEntries(rubric.criteria.map((c, i) => [c.id, i === 0 ? 40 : 20])) });
  expect((await recordVerdict(ws, "sub-001", { verdict: "agree" })).criteria_mark).toBeNull();
});

test("a verdict is stale once the moderator's levels or marks, or the rubric, change: its overall from their marks rested on them", async () => {
  await enterMarking(ws, "sub-001", { overall: 62 });
  const rubric = await loadRubric(ws);
  for (const c of rubric.criteria) await recordJudgement(ws, "sub-001", c.id, { levelId: c.levels[2].id, now: NOW });
  const verdict = await recordVerdict(ws, "sub-001", { verdict: "agree" });
  const approved = ((await ws.readJson("submissions/sub-001.json")) as { approval: { approved_text_sha256: string } }).approval.approved_text_sha256;
  const markings = [OriginalAssessment.parse(await ws.readJson("marking/sub-001--marker.json"))];
  const { loadJudgements } = await import("../src/core/index.ts");
  expect(staleVerdict(verdict, approved, markings, rubric, await loadJudgements(ws, "sub-001"))).toBe(false);
  // A comment changes nothing the overall rests on; a mark does.
  await recordJudgement(ws, "sub-001", rubric.criteria[0].id, { levelId: rubric.criteria[0].levels[2].id, comment: "On reflection.", now: NOW });
  expect(staleVerdict(verdict, approved, markings, rubric, await loadJudgements(ws, "sub-001"))).toBe(false);
  await recordJudgement(ws, "sub-001", rubric.criteria[0].id, { levelId: rubric.criteria[0].levels[2].id, mark: 70, now: NOW });
  expect(staleVerdict(verdict, approved, markings, rubric, await loadJudgements(ws, "sub-001"))).toBe(true);
  // The rubric too.
  const fresh = await recordVerdict(ws, "sub-001", { verdict: "agree" });
  const judgements = await loadJudgements(ws, "sub-001");
  expect(staleVerdict(fresh, approved, markings, rubric, judgements)).toBe(false);
  expect(staleVerdict(fresh, approved, markings, { ...rubric, criteria: rubric.criteria.map((c, i) => (i ? c : { ...c, weight: 40 })) }, judgements)).toBe(true);
});
