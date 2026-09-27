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
  expect(v.provenance.input_hashes).toEqual([
    ((await ws.readJson("submissions/sub-001.json")) as { approval: { approved_text_sha256: string } }).approval.approved_text_sha256,
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
  expect(staleVerdict(verdict, approved, await markings())).toBe(false);
  await confirmMarking(ws, "sub-001");
  expect(staleVerdict(verdict, approved, await markings())).toBe(false); // confirming changes nothing it was given on
  await enterMarking(ws, "sub-001", { overall: 70 }); // a correction by hand replaces the record (the app asks first)
  expect(staleVerdict(verdict, approved, await markings())).toBe(true);
  expect(staleVerdict(verdict, approved, [...(await markings()), ...(await markings())])).toBe(true); // another marker's record too
  expect(staleVerdict(verdict, null, [])).toBe(false); // with no approved text, nothing to compare
});
