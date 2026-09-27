/**
 * A complete synthetic moderation for the record and summary tests: two
 * sampled submissions (fictional students), the source rubric, the brief,
 * anonymisation and approval, both marked views, and an AI reading of
 * sub-001. `reviewBoth` then reviews sub-001 openly and sub-002 blind, with
 * a revision after the reveal and a verdict on each.
 */

import { expect } from "vitest";
import {
  anonymiseWorkspace,
  approve,
  bytesSource,
  chooseReviewMode,
  confirmMarking,
  importBrief,
  importMarking,
  importOriginals,
  importRubric,
  loadRubric,
  recordJudgement,
  recordRequest,
  recordVerdict,
  reveal,
  updateRules,
  type Rubric,
  type Workspace,
} from "../src/core/index.ts";
import { makeZip, packFile, suggestion } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

export const at = (minutes: number) => new Date(Date.UTC(2026, 8, 27, 10, minutes));
export const REAL = /\b(QUILL|AVERY|PIKE|JORDAN|Morgan Ellis|100200301|100200302)\b/i; // the fictional students' names and IDs, as words

/** A moderation set up to the review: sub-001 to be reviewed openly, sub-002 blind. */
export async function setUpModeration(name = "mod-record"): Promise<{ ws: Workspace; path: string; rubric: Rubric }> {
  const { ws, path } = await newWorkspace(name);
  await recordRequest(ws, [{ external_id: "100200301", band: "60-69" }, { external_id: "100200302", band: "50-59" }], { module: "Fictional 101", cohort_size: 40 });
  await importOriginals(
    ws,
    bytesSource("o.zip", makeZip({ "100200301 - QUILL AVERY . - a.docx": packFile("submissions/sub-a.docx"), "100200302 - PIKE JORDAN - b.pdf": packFile("submissions/sub-b.pdf") })),
  );
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic" });
  await importBrief(ws, bytesSource("brief.docx", packFile("brief.docx")));
  await updateRules(ws, { names: ["Morgan Ellis"] });
  await anonymiseWorkspace(ws);
  for (const id of ["sub-001", "sub-002", "brief"]) await approve(ws, id);
  await importMarking(ws, bytesSource("g.zip", makeZip({ "100200301 - QUILL AVERY - x.docx.pdf": packFile("marked-view-replica.pdf"), "100200302 - PIKE JORDAN - x.docx.pdf": packFile("marked-view-replica.pdf") })));
  const rubric = await loadRubric(ws);
  // An AI reading of sub-001, of its approved text.
  const sub = (await ws.readJson("submissions/sub-001.json")) as { approval: { id: string; approved_text_sha256: string } };
  const readings = rubric.criteria.map((c) => suggestion("sub-001", c.id, sub.approval.approved_text_sha256, { suggested_level_id: c.levels[1].id, draft_comment: "A draft." }));
  expect(readings[0].call.approval_id).toBe(sub.approval.id);
  await ws.writeJson("readings/sub-001.json", readings);
  return { ws, path, rubric };
}

/** Review both: sub-001 openly (marking confirmed first), sub-002 blind (confirmed after the reveal); a verdict on each. */
export async function reviewBoth(ws: Workspace, rubric: Rubric) {
  await chooseReviewMode(ws, "sub-002", "blind", at(0));
  await confirmMarking(ws, "sub-001");
  for (const [i, c] of rubric.criteria.entries()) {
    // The first criterion's comment is adapted from the AI draft.
    await recordJudgement(ws, "sub-001", c.id, { levelId: c.levels[2].id, comment: i === 0 ? "A draft, adapted." : `On ${c.title}.`, derivedFromAi: i === 0, now: at(1) });
    await recordJudgement(ws, "sub-002", c.id, { levelId: c.levels[4].id, now: at(1) });
  }
  await reveal(ws, "sub-002", at(2));
  await recordJudgement(ws, "sub-002", rubric.criteria[0].id, { levelId: rubric.criteria[0].levels[3].id, comment: "Better than I first thought.", now: at(3) });
  await confirmMarking(ws, "sub-002");
  await recordVerdict(ws, "sub-001", { verdict: "generous", suggestedMark: 58, comment: "A little generous." });
  await recordVerdict(ws, "sub-002", { verdict: "agree" });
}
