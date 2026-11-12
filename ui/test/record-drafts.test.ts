/**
 * Recording the AI's unflagged drafts of feedback for many submissions in one action, by exception (ADR 0015): which drafts are listed and which are held back, the
 * confirmation tied to what was listed, how each piece is recorded, and the guard at Export that keeps every such piece seen before it is released.
 * A scripted fake API; nothing contacts the real one.
 */

import { expect, test } from "vitest";
import { fakeAnthropic, type Reply } from "../../proxy/test/fakeAnthropic.ts";
import {
  anonymiseWorkspace,
  approve,
  approveFeedbackSet,
  bytesSource,
  draftsToRecord,
  importCohort,
  importRubric,
  loadFeedback,
  loadRubric,
  OVERALL,
  planDrafts,
  recordDrafts,
  recordFeedback,
  recordJudgement,
  recordSubmissionMark,
  runDrafts,
  waitingFeedback,
  WorkspaceError,
} from "../src/core/index.ts";
import { makeZip, packFile } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

/** A draft of `target`, its own words for each call and piece (so none is nearly the same as another); the first piece of the third call has no next step, so it is flagged. */
const textFor = (call: number, piece: number, target: string) =>
  call === 3 && piece === 0
    ? `The work on ${target} is sound, and well argued, and it was a pleasure to read.`
    : `Draft ${call}${piece}: the u${call}${piece}a argument holds together, the sources are u${call}${piece}b chosen, and the structure helps the reader u${call}${piece}c. Next time, test it more widely.`;

/** Four approved submissions, every criterion marked 62 with an overall mark, and the AI's drafts for all of them (one call a submission, in order). */
async function setUp(name: string) {
  const replies: ((body: any) => Reply)[] = [];
  const fake = fakeAnthropic(replies);
  const made = await newWorkspace(name, { provider: fake.provider, workspace_type: "marking" });
  const ws = made.ws;
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
  let call = 0;
  const drafter = (body: any): Reply => {
    call += 1;
    const marking: string = body.messages[0].content.at(-1).text;
    const wanted = /Draft feedback for these criteria \(by id\): (.*)/.exec(marking)![1];
    const out = wanted === "none" ? {} : Object.fromEntries(wanted.split(", ").map((id, i) => [id, textFor(call, i, id)]));
    const overall = /Draft the overall summary: yes/.test(marking) ? textFor(call, 99, "the whole piece") : null;
    return { message: { model: "claude-sonnet-5", content: [{ type: "text", text: JSON.stringify({ criteria: out, overall }) }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } }, requestId: "req_draft" };
  };
  replies.push(drafter, drafter, drafter, drafter);
  await runDrafts(ws, await planDrafts(ws, made.client, null, { withBrief: false, withGuide: false }), { proxy: made.client });
  return { ws, criteria };
}

/** What the educator is shown, confirmed as skimmed: every listed submission by ID with its digest. */
const skimmedOf = async (ws: Awaited<ReturnType<typeof setUp>>["ws"]) => Object.fromEntries((await draftsToRecord(ws)).ready.map((r) => [r.id, r.digest]));

test("the submissions with unflagged drafts are listed with every piece in full; a flagged piece is held back with why, and is not in the set", async () => {
  const { ws, criteria } = await setUp("drafts-1");
  const { ready, notListed } = await draftsToRecord(ws);
  expect(notListed).toEqual([]);
  expect(ready.map((r) => [r.id, r.pieces.length, r.held.length])).toEqual([["sub-001", criteria.length + 1, 0], ["sub-002", criteria.length + 1, 0], ["sub-003", criteria.length, 1], ["sub-004", criteria.length + 1, 0]]);
  expect(ready[0].mark).toBe(62);
  expect(ready[0].pieces[0].text).toBe(textFor(1, 0, criteria[0])); // in full, as it would be recorded
  const held = ready[2].held[0];
  expect([held.target, held.why.length > 0]).toEqual([criteria[0], true]);
  expect(held.why.join(" ")).toMatch(/Next time|next step/i);
  expect(ready[2].pieces.map((p) => p.target)).not.toContain(criteria[0]);
});

test("nothing is recorded without the confirmation that the list was skimmed", async () => {
  const { ws } = await setUp("drafts-2");
  await expect(recordDrafts(ws, { skimmed: null })).rejects.toThrow(/confirm that you have skimmed/);
  expect(await loadFeedback(ws, "sub-001")).toEqual([]);
});

test("each unflagged piece is recorded from its draft, derived from the AI, in a set, unopened; the flagged one is left for the educator", async () => {
  const { ws, criteria } = await setUp("drafts-3");
  const result = await recordDrafts(ws, { skimmed: await skimmedOf(ws) });
  expect(result.recorded).toEqual(["sub-001", "sub-002", "sub-003", "sub-004"]);
  expect([result.size, result.flagged, result.pieces, result.skipped]).toEqual([4, 1, 4 * (criteria.length + 1) - 1, []]);
  const first = await loadFeedback(ws, "sub-001");
  expect(first).toHaveLength(criteria.length + 1);
  for (const f of first) {
    expect([f.derived_from_ai, f.from_draft !== null, f.provenance.actor.kind, f.recorded_in_set]).toEqual([true, true, "educator", { size: 4, flagged: 1, skimmed: true }]);
  }
  expect(first[0].text).toBe(textFor(1, 0, criteria[0]));
  // sub-003: every piece but the flagged one.
  const third = await loadFeedback(ws, "sub-003");
  expect(third.map((f) => f.criterion_id ?? OVERALL).sort()).toEqual([...criteria.slice(1), OVERALL].sort());
  // Recorded now, so nothing more is listed for them, except sub-003's held piece, which is theirs to record.
  const again = await draftsToRecord(ws);
  expect(again.ready).toEqual([]);
});

test("a submission whose drafts aren't what was confirmed is left out and named", async () => {
  const { ws, criteria } = await setUp("drafts-4");
  const skimmed = await skimmedOf(ws);
  // The educator records a piece of sub-002 by hand after the list was shown: what would be recorded for it has changed.
  await recordFeedback(ws, "sub-002", criteria[1], { text: "Written by hand. Next time, check the sources." });
  const result = await recordDrafts(ws, { skimmed });
  expect(result.recorded).toEqual(["sub-001", "sub-003", "sub-004"]);
  expect(result.skipped.map((s) => [s.id, s.label])).toEqual([["sub-002", "sub-002 [STUDENT_B]"]]);
  expect(result.skipped[0].why).toMatch(/aren't the ones you confirmed you had skimmed/);
  expect((await loadFeedback(ws, "sub-002")).map((f) => f.recorded_in_set ?? null)).toEqual([null]); // only the one by hand
});

test("feedback can only be recorded in a set from an AI draft", async () => {
  const { ws, criteria } = await setUp("drafts-5");
  await expect(recordFeedback(ws, "sub-001", criteria[0], { text: "By hand. Next time, more.", recordedInSet: { size: 4, flagged: 1, skimmed: true } })).rejects.toThrow(WorkspaceError);
});

test("at Export a submission with feedback recorded in a set is an exception: held back until opened, and recording a piece again by hand ends the mark on it", async () => {
  const { ws, criteria } = await setUp("drafts-6");
  await recordDrafts(ws, { skimmed: await skimmedOf(ws) });
  const waiting = await waitingFeedback(ws);
  const first = waiting.find((w) => w.id === "sub-001")!;
  expect(first.exceptions.some((e) => e.includes("its feedback was recorded from the AI's drafts in a set and hasn't been opened"))).toBe(true);
  // Not approved in a set until it has been opened, as it now is.
  const held = await approveFeedbackSet(ws, { opened: {}, skimmed: {} });
  expect(held.approved).not.toContain("sub-001");
  expect(held.skipped.map((s) => s.id)).toContain("sub-001");
  const opened = await approveFeedbackSet(ws, { opened: { "sub-001": first.digest }, skimmed: null });
  expect(opened.approved).toContain("sub-001");
  // Recording one piece again by hand ends the mark on that piece, and the others are as they were.
  await recordFeedback(ws, "sub-004", criteria[0], { text: "Redone by hand. Next time, test it more widely." });
  const redone = await loadFeedback(ws, "sub-004");
  expect(redone.find((f) => f.criterion_id === criteria[0])!.recorded_in_set ?? null).toBeNull();
  expect(redone.find((f) => f.criterion_id === criteria[1])!.recorded_in_set).not.toBeNull();
});
