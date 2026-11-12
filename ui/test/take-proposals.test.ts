/**
 * Taking the AI's proposed levels for many submissions in one action, by exception (ADR 0016): what can be listed and what can't, the confirmation tied to what was
 * listed, how each mark is recorded, and the guard at Export that keeps every such mark seen before it is released. A scripted fake API; nothing contacts the real one.
 */

import { expect, test } from "vitest";
import { fakeAnthropic, type Reply } from "../../proxy/test/fakeAnthropic.ts";
import {
  anonymiseWorkspace,
  approve,
  approveFeedbackSet,
  bytesSource,
  chooseReviewMode,
  importCohort,
  importRubric,
  loadJudgements,
  loadRubric,
  loadSubmissionMark,
  loadReviewState,
  OVERALL,
  planReadings,
  proposalsToTake,
  recordFeedback,
  recordJudgement,
  recordSubmissionMark,
  runReadings,
  showProposals,
  suggestFromOthers,
  takeProposals,
  waitingFeedback,
  WorkspaceError,
} from "../src/core/index.ts";
import { makeZip, packFile } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

/** A proposal of level p68 for every criterion, except that the last has none (too little evidence) when `gap`. */
const proposal =
  (criteria: string[], gap = false) =>
  (body: any): Reply => {
    const text: string = body.messages[0].content[2].text;
    const quote = [...text.split("\n\n").slice(2).join("\n\n")].slice(0, 40).join("");
    const out = criteria.map((criterion_id, i) => ({
      criterion_id,
      suggested_level_id: gap && i === criteria.length - 1 ? null : "p68",
      rationale: `Fits the descriptor for ${criterion_id}.`,
      evidence: [quote],
      draft_comment: "Explain how your tests show the requirements are met.",
      missing_evidence: gap && i === criteria.length - 1,
    }));
    return { message: { model: "claude-sonnet-5", content: [{ type: "text", text: JSON.stringify({ criteria: out }) }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } }, requestId: "req_take" };
  };

/**
 * A marking workspace of four approved submissions, each with an AI proposal: sub-001 and sub-004 complete, sub-002 with one criterion left (too little evidence),
 * and sub-003 complete. Then sub-003 is set to be marked blind, and sub-004 marked by hand.
 */
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
  replies.push(proposal(criteria), proposal(criteria, true), proposal(criteria), proposal(criteria));
  await runReadings(ws, await planReadings(ws, made.client, null, { withBrief: false }), { proxy: made.client });
  await chooseReviewMode(ws, "sub-003", "blind");
  await recordJudgement(ws, "sub-004", criteria[0], { levelId: "p62" });
  return { ws, criteria };
}

/** What the educator is shown, confirmed as skimmed: every listed submission by ID with its digest. */
const skimmedOf = async (ws: Awaited<ReturnType<typeof setUp>>["ws"]) => Object.fromEntries((await proposalsToTake(ws)).ready.map((r) => [r.id, r.digest]));

test("the submissions whose proposals can be taken are listed with each level, its reasons, and the provisional mark; the rest are named with why", async () => {
  const { ws, criteria } = await setUp("take-1");
  const { ready, notTaken } = await proposalsToTake(ws);
  expect(ready.map((r) => [r.id, r.proposals.length, r.left.length, r.provisional])).toEqual([["sub-001", criteria.length, 0, 68], ["sub-002", criteria.length - 1, 1, null]]);
  expect(ready[0].proposals[0]).toMatchObject({ criterionId: criteria[0], levelId: "p68", rationale: `Fits the descriptor for ${criteria[0]}.` });
  expect(ready[1].left[0]).toMatchObject({ criterionId: criteria.at(-1), why: "the AI found too little evidence to propose a level" });
  // For it, the levels to choose from, and a level suggested from the others (all proposed p68): an inference, not from the work.
  expect(ready[1].left[0].levels.map((l) => l.id)).toContain("p68");
  expect(ready[1].left[0].suggestion).toMatchObject({ levelId: "p68", from: criteria.length - 1 });
  expect(ready[0].left).toEqual([]);
  expect(notTaken.map((n) => [n.id, n.why.split(",")[0].split(" so ")[0]])).toEqual([["sub-003", "it is being marked blind"], ["sub-004", "it is marked already"]]);
  expect(ready.every((r) => /^[0-9a-f]{64}$/.test(r.digest))).toBe(true);
});

test("nothing is taken without the confirmation that the list was skimmed", async () => {
  const { ws } = await setUp("take-2");
  await expect(takeProposals(ws, { skimmed: null })).rejects.toThrow(/confirm that you have skimmed/);
  expect(await loadJudgements(ws, "sub-001")).toEqual([]);
});

test("each criterion with a proposal is recorded taken from it, in a set, unopened; the overall mark too where every criterion had one; a criterion with none is left", async () => {
  const { ws, criteria } = await setUp("take-3");
  const result = await takeProposals(ws, { skimmed: await skimmedOf(ws) });
  expect(result.taken).toEqual(["sub-001", "sub-002"]);
  expect([result.size, result.flagged, result.skipped]).toEqual([2, 1, []]);
  expect(result.notTaken.map((n) => n.id)).toEqual(["sub-003", "sub-004"]);
  const first = await loadJudgements(ws, "sub-001");
  expect(first.map((j) => j.criterion_id)).toEqual(criteria);
  for (const j of first) {
    expect([j.mode, j.provenance.actor.kind, j.first.level_id, j.first.level_from_suggestion !== null]).toEqual(["open", "educator", "p68", true]);
    expect(j.first.taken_in_set).toEqual({ size: 2, flagged: 1, skimmed: true });
  }
  const overall = await loadSubmissionMark(ws, "sub-001");
  expect([overall!.mark, overall!.taken_in_set]).toEqual([68, { size: 2, flagged: 1, skimmed: true }]);
  // sub-002: the criteria with a proposal, and not the one with none; no overall mark, since it can't be worked out yet.
  expect((await loadJudgements(ws, "sub-002")).map((j) => j.criterion_id)).toEqual(criteria.slice(0, -1));
  expect(await loadSubmissionMark(ws, "sub-002")).toBeNull();
  // Taken once: they are marked now, so they are no longer listed.
  expect((await proposalsToTake(ws)).ready).toEqual([]);
});

test("a submission whose proposals aren't what was confirmed is left out and named, and what was confirmed is taken", async () => {
  const { ws } = await setUp("take-4");
  const skimmed = await skimmedOf(ws);
  skimmed["sub-001"] = "0".repeat(64); // as if its proposals changed after the list was shown
  const result = await takeProposals(ws, { skimmed });
  expect(result.taken).toEqual(["sub-002"]);
  expect(result.skipped.map((s) => [s.id, s.label])).toEqual([["sub-001", "sub-001 [STUDENT_A]"]]);
  expect(result.skipped[0].why).toMatch(/aren't the ones you confirmed you had skimmed/);
  expect(await loadJudgements(ws, "sub-001")).toEqual([]);
  // Not listed, it isn't taken either.
  const without = await skimmedOf(ws);
  delete without["sub-001"];
  expect((await takeProposals(ws, { skimmed: without })).skipped.map((s) => s.id)).toEqual(["sub-001"]);
});

test("a level can only be taken in a set from an AI suggestion", async () => {
  const { ws, criteria } = await setUp("take-5");
  await expect(recordJudgement(ws, "sub-002", criteria[0], { levelId: "p68", takenInSet: { size: 2, flagged: 1, skimmed: true } })).rejects.toThrow(WorkspaceError);
});

test("at Export a submission with marks taken in a set is an exception: held back until opened, and recording the mark again by hand ends it", async () => {
  const { ws, criteria } = await setUp("take-6");
  await takeProposals(ws, { skimmed: await skimmedOf(ws) });
  // Everything else a student needs, on sub-001: feedback on every criterion and the overall (checks pass: each has a next step).
  for (const c of [...criteria, OVERALL]) await recordFeedback(ws, "sub-001", c, { text: `A clear piece on ${c}, with a real strength. Next time, test it more widely.` });
  const [waiting] = await waitingFeedback(ws);
  expect(waiting.id).toBe("sub-001");
  expect(waiting.exceptions.some((e) => e.includes("taken from the AI's proposals, or accepted as suggested from the other criteria, in a set and haven't been opened"))).toBe(true);
  // Not approved in a set until it has been opened, as it now is.
  const held = await approveFeedbackSet(ws, { opened: {}, skimmed: {} });
  expect(held.approved).toEqual([]);
  expect(held.skipped.map((s) => s.id)).toEqual(["sub-001"]);
  const opened = await approveFeedbackSet(ws, { opened: { "sub-001": waiting.digest }, skimmed: null });
  expect(opened.approved).toEqual(["sub-001"]);
  // Recording a criterion by hand clears the mark on that criterion; recording the overall again clears it there.
  await recordJudgement(ws, "sub-001", criteria[0], { levelId: "p62" });
  await recordSubmissionMark(ws, "sub-001", { mark: 66 });
  const after = await loadJudgements(ws, "sub-001");
  expect(after[0].first.taken_in_set ?? null).toBeNull();
  expect(after[1].first.taken_in_set).not.toBeNull(); // the others are still as they were taken
  expect((await loadSubmissionMark(ws, "sub-001"))!.taken_in_set ?? null).toBeNull();
});

test("a level is suggested for a criterion with no proposal from the others' levels, by their share of the maximum; and not when too few criteria have one", async () => {
  const { ws } = await setUp("take-7");
  const rubric = await loadRubric(ws);
  const level = (c: (typeof rubric.criteria)[number], id: string) => ({ criterion: c, level: c.levels.find((l) => l.id === id)! });
  const [target, ...others] = rubric.criteria;
  // Every other criterion at p62: the level of the target nearest what that share of its maximum is, p62 when the scales agree.
  expect(suggestFromOthers(rubric, target, others.map((c) => level(c, "p62")))).toMatchObject({ levelId: "p62", from: others.length });
  expect(suggestFromOthers(rubric, target, others.map((c) => level(c, "p75")))).toMatchObject({ levelId: "p75" });
  // Too few: fewer than half of the criteria have a proposal, so nothing is suggested.
  expect(suggestFromOthers(rubric, target, [level(others[0], "p75")])).toBeNull();
  expect(suggestFromOthers(rubric, target, [])).toBeNull();
});

test("a criterion with no proposal can be given a level in the set: accepted as suggested, or the educator's own choice, or left; the overall mark follows only when none is left", async () => {
  const { ws, criteria } = await setUp("take-8");
  const gap = criteria.at(-1)!;
  const { ready } = await proposalsToTake(ws);
  const sug = ready[1].left[0].suggestion!.levelId;
  const skimmed = await skimmedOf(ws);
  // Left: nothing recorded for the gap, no overall mark.
  // (sub-001 has no gap; sub-002 is given the suggested level.)
  const result = await takeProposals(ws, { skimmed, filled: { "sub-002": { [gap]: sug } } });
  expect(result.taken).toEqual(["sub-001", "sub-002"]);
  expect(result.filled).toEqual({ accepted: 1, chosen: 0 });
  const entry = (await loadJudgements(ws, "sub-002")).find((j) => j.criterion_id === gap)!.first;
  expect([entry.level_id, entry.level_from_other_criteria, entry.level_from_suggestion, entry.taken_in_set]).toEqual([sug, true, null, { size: 2, flagged: 1, skimmed: true }]);
  const overall = await loadSubmissionMark(ws, "sub-002");
  expect(overall!.taken_in_set).toEqual({ size: 2, flagged: 1, skimmed: true }); // every criterion has a level now, so the overall mark follows
});

test("a level the educator chooses in the list for a criterion with no proposal is recorded as theirs; one left empty keeps the overall mark from being taken", async () => {
  const { ws, criteria } = await setUp("take-9");
  const gap = criteria.at(-1)!;
  const mine = await takeProposals(ws, { skimmed: await skimmedOf(ws), filled: { "sub-002": { [gap]: "p55" } } });
  expect(mine.filled).toEqual({ accepted: 0, chosen: 1 });
  const entry = (await loadJudgements(ws, "sub-002")).find((j) => j.criterion_id === gap)!.first;
  expect([entry.level_id, entry.level_from_other_criteria, entry.level_from_suggestion, entry.taken_in_set ?? null]).toEqual(["p55", false, null, null]); // their own level, not marked as taken
  expect(await loadSubmissionMark(ws, "sub-002")).not.toBeNull();
  // Not filled, in another workspace: the gap stays theirs, and there is no overall mark.
  const { ws: other, criteria: c2 } = await setUp("take-10");
  await takeProposals(other, { skimmed: await skimmedOf(other) });
  expect((await loadJudgements(other, "sub-002")).map((j) => j.criterion_id)).toEqual(c2.slice(0, -1));
  expect(await loadSubmissionMark(other, "sub-002")).toBeNull();
});

test("a level that is not one of the criterion's is refused for that submission, and a level can't be both from the AI and from the other criteria", async () => {
  const { ws, criteria } = await setUp("take-11");
  const gap = criteria.at(-1)!;
  const result = await takeProposals(ws, { skimmed: await skimmedOf(ws), filled: { "sub-002": { [gap]: "no-such-level" } } });
  const title = (await loadRubric(ws)).criteria.at(-1)!.title;
  expect(result.skipped.map((s) => [s.id, s.why])).toEqual([["sub-002", `'no-such-level' is not a level of ${title}; nothing of it was recorded`]]);
  expect(await loadJudgements(ws, "sub-002")).toEqual([]); // checked before anything was written, so it isn't left half marked
  await expect(recordJudgement(ws, "sub-001", criteria[0], { levelId: "p68", levelFromAi: true, levelFromOthers: true })).rejects.toThrow(WorkspaceError);
});

test("a submission whose every proposal is flagged as having too little evidence is named as that, not as having no proposal", async () => {
  const replies: ((body: any) => Reply)[] = [];
  const fake = fakeAnthropic(replies);
  const made = await newWorkspace("take-12", { provider: fake.provider, workspace_type: "marking" });
  const ws = made.ws;
  await importCohort(ws, bytesSource("cohort_1.zip", makeZip({ "100200301 - QUILL AVERY . - a.docx": packFile("submissions/sub-a.docx") })));
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic" });
  await anonymiseWorkspace(ws);
  await approve(ws, "sub-001");
  const criteria = (await loadRubric(ws)).criteria.map((c) => c.id);
  // A tentative level for every criterion, each flagged as having too little evidence behind it.
  replies.push((body: any): Reply => {
    const out = criteria.map((criterion_id) => ({ criterion_id, suggested_level_id: "p62", rationale: "Little to go on.", evidence: [], draft_comment: "Add more.", missing_evidence: true }));
    return { message: { model: "claude-sonnet-5", content: [{ type: "text", text: JSON.stringify({ criteria: out }) }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } }, requestId: "req_low" };
  });
  await runReadings(ws, await planReadings(ws, made.client, null, { withBrief: false }), { proxy: made.client });
  const { ready, notTaken } = await proposalsToTake(ws);
  expect(ready).toEqual([]);
  expect(notTaken).toEqual([{ id: "sub-001", label: "sub-001 [STUDENT_A]", why: "the AI found too little evidence to propose a level for any criterion (this can happen when a submission is mostly figures that were left out): mark it yourself" }]);
});

test("a submission the educator marked after the list was shown is not overwritten: it is left out and named", async () => {
  const { ws, criteria } = await setUp("take-12");
  const skimmed = await skimmedOf(ws);
  await recordJudgement(ws, "sub-001", criteria[0], { levelId: "p62" }); // by hand, meanwhile
  const result = await takeProposals(ws, { skimmed });
  expect(result.taken).toEqual(["sub-002"]);
  expect(result.notTaken.filter((n) => n.id === "sub-001").map((n) => /marked already/.test(n.why))).toEqual([true]); // not listed now, so named with why
  expect((await loadJudgements(ws, "sub-001")).map((j) => j.criterion_id)).toEqual([criteria[0]]);
});

test("a level that is a range can't be taken from the AI or chosen here: it is left for the educator to mark, and nothing is half written", async () => {
  const { ws, criteria } = await setUp("take-13");
  const rubric = await loadRubric(ws);
  // The proposed level p68 of the first criterion becomes a range: it needs a mark of the educator's own within it.
  const ranged = { ...rubric, criteria: rubric.criteria.map((c, i) => (i ? c : { ...c, levels: c.levels.map((l) => (l.id === "p68" ? { ...l, points: null, min_mark: 65, max_mark: 69 } : l)) })) };
  await ws.writeJson("rubric.json", ranged);
  const { ready } = await proposalsToTake(ws);
  const first = ready.find((r) => r.id === "sub-001")!;
  const left = first.left.find((l) => l.criterionId === criteria[0])!;
  expect(left.why).toMatch(/a range, which needs a mark of your own/);
  expect(left.levels.map((l) => l.id)).not.toContain("p68");
  const result = await takeProposals(ws, { skimmed: await skimmedOf(ws), filled: { "sub-001": { [criteria[0]]: "p68" } } });
  expect(result.skipped.map((s) => s.id)).toEqual(["sub-001"]);
  expect(await loadJudgements(ws, "sub-001")).toEqual([]); // refused before anything was written
});

test("choosing to see the cohort's proposals is kept: each submission shown is then reviewed openly and can't be marked blind", async () => {
  const { ws } = await setUp("take-14");
  expect(await loadReviewState(ws, "sub-001")).toBeNull();
  expect(await showProposals(ws)).toBe(2); // sub-001 and sub-002 are listed (sub-003 is blind, sub-004 marked)
  expect((await loadReviewState(ws, "sub-001"))?.mode).toBe("open");
  await expect(chooseReviewMode(ws, "sub-001", "blind")).rejects.toThrow(/can't be changed/);
  expect((await loadReviewState(ws, "sub-003"))?.mode).toBe("blind"); // already blind: left as it was
});
