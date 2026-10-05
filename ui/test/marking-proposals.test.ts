/**
 * Marking a cohort: the AI's proposals (with the marking instructions, through the real proxy to a scripted fake
 * API), the provisional mark worked out from them, open and blind marking, the educator's levels, marks and comments,
 * and their overall mark. No test contacts the API.
 */

import { expect, test } from "vitest";
import { fakeAnthropic, type Reply } from "../../proxy/test/fakeAnthropic.ts";
import { loadMarkingWork, provisionalText } from "../src/app/markingWork.ts";
import { criterionStatus, type Review } from "../src/app/review.ts";
import { loadOverview } from "../src/app/overview.ts";
import { markingStates, statusWord } from "../src/app/steps.ts";
import {
  anonymiseWorkspace,
  approve,
  bytesSource,
  chooseReviewMode,
  importCohort,
  importRubric,
  loadJudgements,
  loadReadings,
  loadRubric,
  loadSubmissionMark,
  MARKING_PROMPT_VERSION,
  planReadings,
  provisionalMark,
  recordJudgement,
  recordSubmissionMark,
  reveal,
  runReadings,
  updateRules,
  WorkspaceError,
  type Criterion,
  type Workspace,
} from "../src/core/index.ts";
import { PROMPTS } from "../src/core/prompts.ts";
import { makeZip, packFile } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

/** A proposal of `level` for every criterion, quoting the submission's first words. */
const proposal =
  (criteria: string[], level: string | null = "p68") =>
  (body: any): Reply => {
    const text: string = body.messages[0].content[2].text;
    const quote = [...text.split("\n\n").slice(2).join("\n\n")].slice(0, 40).join("");
    const criteriaOut = criteria.map((criterion_id, i) => ({
      criterion_id,
      suggested_level_id: i === criteria.length - 1 ? level : "p68",
      rationale: "Fits the descriptor.",
      evidence: [quote],
      draft_comment: "Explain how your tests show the requirements are met.",
      missing_evidence: level === null && i === criteria.length - 1,
    }));
    return { message: { model: "claude-sonnet-5", content: [{ type: "text", text: JSON.stringify({ criteria: criteriaOut }) }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } }, requestId: "req_mark" };
  };

/** A marking workspace with two approved submissions and the synthetic rubric. */
async function setUp(name: string) {
  const replies: ((body: any) => Reply)[] = [];
  const fake = fakeAnthropic(replies);
  const made = await newWorkspace(name, { provider: fake.provider, workspace_type: "marking" });
  await importCohort(
    made.ws,
    bytesSource(
      "cohort_1.zip",
      makeZip({ "100200301 - QUILL AVERY . - a.docx": packFile("submissions/sub-a.docx"), "100200302 - PIKE JORDAN - b.pdf": packFile("submissions/sub-b.pdf") }),
    ),
  );
  await importRubric(made.ws, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic" });
  await updateRules(made.ws, { names: ["Morgan Ellis"] });
  await anonymiseWorkspace(made.ws);
  for (const id of ["sub-001", "sub-002"]) await approve(made.ws, id);
  const criteria = (await loadRubric(made.ws)).criteria.map((c) => c.id);
  return { ...made, replies, sent: fake.sent, criteria };
}

const markAll = async (ws: Workspace, id: string, criteria: string[], level = "p62") => {
  for (const c of criteria) await recordJudgement(ws, id, c, { levelId: level, comment: `Comment on ${c}` });
};

test("proposals are asked for with the marking instructions, and never with the educator's marks or comments", async () => {
  const { ws, client, replies, sent, criteria } = await setUp("mark-p1");
  await recordJudgement(ws, "sub-001", criteria[0], { levelId: "p55", comment: "Morgan Ellis says SECRET-REMARK" });
  replies.push(proposal(criteria), proposal(criteria));
  const plan = await planReadings(ws, client, ["sub-001", "sub-002"], { replace: true, withBrief: false });
  expect(plan.readings.map((r) => r.request.prompt.version)).toEqual([MARKING_PROMPT_VERSION, MARKING_PROMPT_VERSION]);
  expect(plan.readings[0].request.prompt.instructions).toBe(PROMPTS["marking-v4"]);
  await runReadings(ws, plan, { proxy: client });
  const asked = JSON.stringify(sent);
  expect(asked).not.toContain("SECRET-REMARK");
  expect(asked).not.toContain("level_from_suggestion"); // nothing of the judgement record (its level id is the rubric's own, so it is sent anyway)
  expect(asked).toContain("You are assisting a university educator");
  expect((await loadReadings(ws, "sub-001"))[0].call.prompt_version).toBe("marking-v4");
});

test("the provisional mark is worked out from the proposed levels and the weights, and says why when it can't be", async () => {
  const { ws, client, replies, criteria } = await setUp("mark-p2");
  replies.push(proposal(criteria), proposal(criteria, null));
  await runReadings(ws, await planReadings(ws, client, null, { withBrief: false }), { proxy: client });
  const rubric = await loadRubric(ws);
  const one = new Map((await loadReadings(ws, "sub-001")).map((r) => [r.criterion_id, r]));
  expect(provisionalMark(rubric.criteria, (id) => one.get(id))).toEqual({ mark: 68 });
  const two = new Map((await loadReadings(ws, "sub-002")).map((r) => [r.criterion_id, r]));
  const missing = provisionalMark(rubric.criteria, (id) => two.get(id));
  expect("missing" in missing && missing.missing).toMatch(/^the AI proposed no level for .+ \(it found too little evidence\)$/);

  await chooseReviewMode(ws, "sub-001", "open");
  const work = await loadMarkingWork(ws, "sub-001");
  expect(provisionalText(work)).toBe("Provisional mark 68, from the AI's proposed levels (not a mark)");
  expect(work.next?.id).toBe("sub-002");
});

test("open marking can take a proposed level in one action, recorded as taken from it, by the educator", async () => {
  const { ws, client, replies, criteria } = await setUp("mark-p3");
  replies.push(proposal(criteria));
  await runReadings(ws, await planReadings(ws, client, ["sub-001"], { withBrief: false }), { proxy: client });
  const j = await recordJudgement(ws, "sub-001", criteria[0], { levelId: "p68", levelFromAi: true, comment: "Morgan Ellis did well" });
  expect([j.mode, j.provenance.actor.kind, j.first.level_from_suggestion !== null]).toEqual(["open", "educator", true]);
  expect(j.first.comment).not.toContain("Morgan"); // comments are anonymised when saved
  // Starting from the AI's draft comment: recorded as derived from it, however much it is changed.
  const [reading] = await loadReadings(ws, "sub-001");
  expect(reading.draft_comment).toBe("Explain how your tests show the requirements are met.");
  const adapted = await recordJudgement(ws, "sub-001", criteria[1], { levelId: "p62", comment: "Explain how your tests show it works.", derivedFromAi: true });
  expect(adapted.first.comment_derived_from_ai).toBe(true);
});

test("blind marking hides the proposals and the provisional mark until a level is recorded for every criterion", async () => {
  const { ws, client, replies, criteria } = await setUp("mark-p4");
  replies.push(proposal(criteria));
  await runReadings(ws, await planReadings(ws, client, ["sub-001"], { withBrief: false }), { proxy: client });
  await chooseReviewMode(ws, "sub-001", "blind");
  let work = await loadMarkingWork(ws, "sub-001");
  expect([work.review.shown, work.review.readings.size, work.provisional]).toEqual([false, 0, null]);
  await expect(recordJudgement(ws, "sub-001", criteria[0], { levelId: "p68", levelFromAi: true })).rejects.toThrow("isn't shown before the reveal");
  await recordJudgement(ws, "sub-001", criteria[0], { levelId: "p62" });
  await expect(reveal(ws, "sub-001")).rejects.toThrow("record a level for every criterion");
  await markAll(ws, "sub-001", criteria);
  await reveal(ws, "sub-001");
  work = await loadMarkingWork(ws, "sub-001");
  expect([work.review.shown, work.review.readings.size, work.provisional]).toEqual([true, criteria.length, { mark: 68 }]);
  expect((await loadJudgements(ws, "sub-001")).every((j) => j.mode === "blind" && j.provenance.actor.kind === "educator")).toBe(true);
});

test("the overall mark starts from the criterion marks, its comment is anonymised, and it is flagged when they change", async () => {
  const { ws, criteria } = await setUp("mark-p5");
  await markAll(ws, "sub-001", criteria);
  let work = await loadMarkingWork(ws, "sub-001");
  expect(work.implied).toBe(62);
  const mark = await recordSubmissionMark(ws, "sub-001", { mark: 64, comment: "Morgan Ellis helped; a solid piece" });
  expect([mark.mark, mark.criteria_mark, mark.provenance.actor.kind]).toEqual([64, 62, "educator"]);
  expect(mark.comment).not.toContain("Morgan");
  expect(await loadSubmissionMark(ws, "sub-001")).toEqual(mark);
  await recordJudgement(ws, "sub-001", criteria[0], { levelId: "p68" });
  work = await loadMarkingWork(ws, "sub-001");
  expect(work.overallStale).toBe(true);
  await expect(recordSubmissionMark(ws, "sub-001", { mark: -1 })).rejects.toThrow(WorkspaceError);
});

test("the overall mark is flagged when criterion marks change, even if the overall they imply doesn't", async () => {
  const { ws, criteria } = await setUp("mark-p9");
  const [a, b, ...rest] = criteria;
  await recordJudgement(ws, "sub-001", a, { levelId: "p62" });
  await recordJudgement(ws, "sub-001", b, { levelId: "p68" });
  for (const c of rest) await recordJudgement(ws, "sub-001", c, { levelId: "p62" });
  await recordSubmissionMark(ws, "sub-001", { mark: 64 });
  const implied = (await loadMarkingWork(ws, "sub-001")).implied;
  expect((await loadMarkingWork(ws, "sub-001")).overallStale).toBe(false);
  // Swapped between two equally weighted criteria: the same overall, but other marks.
  await recordJudgement(ws, "sub-001", a, { levelId: "p68" });
  await recordJudgement(ws, "sub-001", b, { levelId: "p62" });
  const work = await loadMarkingWork(ws, "sub-001");
  expect([work.implied, work.overallStale]).toEqual([implied, true]);
});

test("only a marking workspace records an overall mark", async () => {
  const { ws } = await newWorkspace("mod-p6");
  await expect(recordSubmissionMark(ws, "sub-001", { mark: 60 })).rejects.toThrow("only a marking workspace");
});

test("Marking opens once the rubric and an approved submission are there, and counts the submissions marked", async () => {
  const { ws, criteria } = await setUp("mark-p7");
  let mark = markingStates(await loadOverview(ws), null, null).get("mark")!;
  expect([mark.locked, `${statusWord(mark)}: ${mark.reason}`]).toEqual([null, "Not started: 0 of 2 submissions marked"]);
  await markAll(ws, "sub-001", criteria);
  mark = markingStates(await loadOverview(ws), null, null).get("mark")!;
  expect(`${statusWord(mark)}: ${mark.reason}`).toBe("Needs attention: 0 of 2 submissions marked"); // levels, but no overall mark yet
  await recordSubmissionMark(ws, "sub-001", { mark: 62 });
  mark = markingStates(await loadOverview(ws), null, null).get("mark")!;
  expect(mark.reason).toBe("1 of 2 submissions marked");

  const { ws: empty } = await newWorkspace("mark-p8", { workspace_type: "marking" });
  const locked = markingStates(await loadOverview(empty), null, null).get("mark")!;
  expect(locked.locked?.map((r) => r.goTo)).toEqual(["rubric", "cohort"]);
});

test("each criterion's status says the mark recorded", async () => {
  const { ws, criteria } = await setUp("mark-p10");
  await recordJudgement(ws, "sub-001", criteria[0], { levelId: "p68" });
  await recordJudgement(ws, "sub-001", criteria[1], { levelId: "p68", mark: 66 });
  const { review } = await loadMarkingWork(ws, "sub-001");
  const [a, b, c] = review.rubric.criteria;
  expect([criterionStatus(review, a, "Marked"), criterionStatus(review, b, "Marked"), criterionStatus(review, c, "Marked")]).toEqual([
    { kind: "done", text: "Marked: 68" },
    { kind: "done", text: "Marked: 66" },
    { kind: "missing", text: "Not yet marked" },
  ]);
});

test("a comment adapted from the AI keeps that provenance when recorded again after its proposal is out of date", async () => {
  const { ws, client, replies, criteria } = await setUp("mark-p11");
  replies.push(proposal(criteria));
  await runReadings(ws, await planReadings(ws, client, ["sub-001"], { withBrief: false }), { proxy: client });
  await recordJudgement(ws, "sub-001", criteria[0], { levelId: "p62", comment: "Explain how your tests show it works.", derivedFromAi: true });
  // A new rule changes the anonymised text, so it is approved again: the proposal is no longer current.
  await updateRules(ws, { names: ["Plant Swap"] });
  await anonymiseWorkspace(ws);
  await approve(ws, "sub-001");
  expect((await loadMarkingWork(ws, "sub-001")).review.readings.size).toBe(0);
  const again = await recordJudgement(ws, "sub-001", criteria[0], { levelId: "p55", comment: "Explain how your tests show it works.", derivedFromAi: true });
  expect([again.first.level_id, again.first.comment_derived_from_ai]).toEqual(["p55", true]);
  // Newly taking a draft still needs a current one.
  await expect(recordJudgement(ws, "sub-001", criteria[1], { levelId: "p62", comment: "Anything", derivedFromAi: true })).rejects.toThrow("no AI draft comment");
});

test("an out-of-date criterion shows only the mark it stored, never one worked out from the rubric as it is now", () => {
  const c = { id: "a", title: "A", levels: [{ id: "p70", label: "2:1 (70)", points: 70 }] } as unknown as Criterion;
  const judged = (mark: number | null) =>
    ({ judgements: new Map([["a", { first: { level_id: "p65", mark }, revised: null }]]), stale: new Set(["a"]) }) as unknown as Review;
  expect(criterionStatus(judged(65), c, "Marked")).toEqual({ kind: "attention", text: "Out of date: 65" });
  expect(criterionStatus(judged(null), c, "Marked")).toEqual({ kind: "attention", text: "Out of date" });
});
