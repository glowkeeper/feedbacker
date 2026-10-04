/**
 * Drafting feedback from the educator's marking (ADR 0006), through the real proxy to a scripted fake API: what is
 * planned and shown, what is sent (that one submission's marking, never anyone else's material or the AI's own
 * proposals), the check against what was confirmed, out-of-date drafts and drafting one criterion again, the
 * educator's feedback and its provenance, and batches. No test contacts the API.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { fakeAnthropic, type FakeBatches, type Reply } from "../../proxy/test/fakeAnthropic.ts";
import { loadFeedbackWork } from "../src/app/feedbackWork.ts";
import { loadOverview } from "../src/app/overview.ts";
import { markingStates, statusWord } from "../src/app/steps.ts";
import {
  anonymiseWorkspace,
  approve,
  bytesSource,
  acceptFlag,
  collectDraftBatch,
  feedbackFlags,
  feedbackSchema,
  FEEDBACK_PROMPT_VERSION,
  importCohort,
  importRubric,
  loadDrafts,
  loadFeedback,
  loadRubric,
  OVERALL,
  planDrafts,
  recordFeedback,
  recordJudgement,
  recordSubmissionMark,
  runDrafts,
  sendDraftBatch,
  updateRules,
  type Workspace,
} from "../src/core/index.ts";
import { makeZip, packFile } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

/** Drafts for exactly what the marking block asks for. */
const drafts = (body: any): Reply => {
  const marking: string = body.messages[0].content.at(-1).text;
  const ids = /Draft feedback for these criteria \(by id\): (.*)/.exec(marking)![1];
  const criteria = ids === "none" ? {} : Object.fromEntries(ids.split(", ").map((id) => [id, `You set out ${id} clearly. Next time, go further.`]));
  const overall = /Draft the overall summary: yes/.test(marking) ? "A solid piece overall. Next time, test more." : null;
  return { message: { model: "claude-sonnet-5", content: [{ type: "text", text: JSON.stringify({ criteria, overall }) }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } }, requestId: "req_draft" };
};

/** A marking workspace, two approved submissions, the first fully marked. */
async function setUp(name: string) {
  const replies: ((body: any) => Reply)[] = [];
  const fake = fakeAnthropic(replies);
  const made = await newWorkspace(name, { provider: fake.provider, workspace_type: "marking" });
  const ws = made.ws;
  await importCohort(ws, bytesSource("cohort_1.zip", makeZip({ "100200301 - QUILL AVERY . - a.docx": packFile("submissions/sub-a.docx"), "100200302 - PIKE JORDAN - b.pdf": packFile("submissions/sub-b.pdf") })));
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic" });
  await updateRules(ws, { names: ["Morgan Ellis"] });
  await anonymiseWorkspace(ws);
  for (const id of ["sub-001", "sub-002"]) await approve(ws, id);
  const criteria = (await loadRubric(ws)).criteria.map((c) => c.id);
  for (const c of criteria) await recordJudgement(ws, "sub-001", c, { levelId: "p62", comment: `Comment on ${c}` });
  await recordSubmissionMark(ws, "sub-001", { mark: 62, comment: "A clear piece of work." });
  return { ws, client: made.client, path: made.path, replies, sent: fake.sent, batches: fake.batches as FakeBatches, criteria };
}

const draftAll = async (ws: Workspace, client: any) => runDrafts(ws, await planDrafts(ws, client, null, { withBrief: false }), { proxy: client });

test("a plan shows exactly what of the marking will be sent, for marked submissions only", async () => {
  const { ws, client, criteria } = await setUp("draft-1");
  const plan = await planDrafts(ws, client, null, { withBrief: false });
  expect(plan.drafts.map((d) => [d.submissionId, d.targets])).toEqual([["sub-001", [...criteria, OVERALL]]]);
  expect(plan.skipped.get("sub-002")).toMatch(/isn't marked yet/);
  const [d] = plan.drafts;
  expect(d.request.prompt.version).toBe(FEEDBACK_PROMPT_VERSION);
  expect(d.request.blocks.map((b) => b.kind)).toEqual(["rubric", "submission", "marking"]);
  expect(d.request.blocks.at(-1)!.text).toBe(d.marking); // shown exactly as sent
  expect(d.marking).toContain(`Criterion id: ${criteria[0]}\nLevel: 2:1 (62) (level id p62)\nMark: 62 out of 100\nThe educator's comment: Comment on ${criteria[0]}`);
  expect(d.marking).toContain("Overall mark: 62\nThe educator's overall comment: A clear piece of work.");
});

test("the reply's shape requires a draft of every criterion asked for, and the summary only when asked", () => {
  const schema = feedbackSchema(["a", "b", OVERALL]) as any;
  expect(schema.properties.criteria.required).toEqual(["a", "b"]);
  expect(schema.properties.criteria.additionalProperties).toBe(false);
  expect(schema.properties.overall).toEqual({ type: "string" });
  expect((feedbackSchema(["a"]) as any).properties.overall).toEqual({ type: "null" });
});

test("drafting sends that submission's marking only, never another student's material or the AI's proposals, and records every call", async () => {
  const { ws, client, path, replies, sent, criteria } = await setUp("draft-2");
  replies.push(drafts);
  const result = await draftAll(ws, client);
  expect([...result.drafted.keys()]).toEqual(["sub-001"]);
  const asked = JSON.stringify(sent);
  expect(asked).toContain("Comment on");
  expect(asked).not.toContain("Study Buddy"); // the other submission's text
  expect(asked).not.toContain("Fits the descriptor"); // no AI proposal
  const stored = await loadDrafts(ws, "sub-001");
  expect(stored.map((d) => d.criterion_id)).toEqual([...criteria, null]);
  expect(stored.every((d) => d.call.prompt_version === "feedback-v2" && d.provenance.actor.kind === "model")).toBe(true);
  expect(readdirSync(join(path, "feedback", "calls"))).toHaveLength(1);
  expect(readdirSync(join(path, "feedback", "runs"))).toHaveLength(1);
});

test("a change after confirming is caught before anything is sent", async () => {
  const { ws, client, replies, sent, criteria } = await setUp("draft-3");
  replies.push(drafts);
  const plan = await planDrafts(ws, client, null, { withBrief: false });
  await recordJudgement(ws, "sub-001", criteria[0], { levelId: "p62", comment: "A changed comment" });
  const result = await runDrafts(ws, plan, { proxy: client });
  expect(result.failed.get("sub-001")).toMatch(/changed after you confirmed what would be sent/);
  expect(sent).toEqual([]);
});

test("a draft is flagged when its marking changes, and that criterion is drafted again alone", async () => {
  const { ws, client, replies, criteria } = await setUp("draft-4");
  replies.push(drafts);
  await draftAll(ws, client);
  const before = await loadDrafts(ws, "sub-001");
  await recordJudgement(ws, "sub-001", criteria[1], { levelId: "p68", comment: "Better than I first thought" });
  let work = await loadFeedbackWork(ws, "sub-001");
  expect(work.rows.filter((r) => r.draftStale).map((r) => r.target)).toEqual([criteria[1], OVERALL]); // the summary rests on every mark
  // The overall mark now rests on other criterion marks, so it is out of date until recorded again.
  expect(work.rows.find((r) => r.target === OVERALL)!.missing).toMatch(/overall mark is out of date/);
  replies.push(drafts);
  const again = await runDrafts(ws, await planDrafts(ws, client, [{ submissionId: "sub-001", targets: [criteria[1]] }], { withBrief: false }), { proxy: client });
  expect(again.drafted.get("sub-001")!.map((d) => d.criterion_id)).toEqual([criteria[1]]);
  const after = await loadDrafts(ws, "sub-001");
  expect(after.find((d) => d.criterion_id === criteria[0])).toEqual(before.find((d) => d.criterion_id === criteria[0])); // the others kept
  work = await loadFeedbackWork(ws, "sub-001");
  expect(work.rows.filter((r) => r.draftStale).map((r) => r.target)).toEqual([OVERALL]); // until the overall mark is recorded again
});

test("feedback adapted from a draft is derived from the AI, keeps that when recorded again, and is anonymised; written from scratch it isn't", async () => {
  const { ws, client, replies, criteria } = await setUp("draft-5");
  replies.push(drafts);
  await draftAll(ws, client);
  const [first] = await loadDrafts(ws, "sub-001");
  const adapted = await recordFeedback(ws, "sub-001", criteria[0], { text: "Morgan Ellis would agree: you set this out clearly. Next time, go further.", fromDraft: first.id });
  expect([adapted.derived_from_ai, adapted.from_draft, adapted.text.includes("Morgan")]).toEqual([true, first.id, false]);
  const again = await recordFeedback(ws, "sub-001", criteria[0], { text: "Edited again. Next time, go further.", fromDraft: first.id });
  expect(again.derived_from_ai).toBe(true);
  const own = await recordFeedback(ws, "sub-001", OVERALL, { text: "My own summary. Next time, plan earlier." });
  expect([own.derived_from_ai, own.from_draft]).toEqual([false, null]);
  await expect(recordFeedback(ws, "sub-001", criteria[1], { text: "x", fromDraft: "fd-not-a-draft" })).rejects.toThrow("there is no draft");
  await expect(recordFeedback(ws, "sub-002", criteria[0], { text: "x" })).rejects.toThrow("isn't marked yet");
  expect((await loadFeedback(ws, "sub-001")).map((f) => f.criterion_id)).toEqual([criteria[0], null]);
  // A changed mark puts that criterion's feedback out of date.
  await recordJudgement(ws, "sub-001", criteria[0], { levelId: "p55", comment: "Comment" });
  expect((await loadFeedbackWork(ws, "sub-001")).rows[0].feedbackStale).toBe(true);
});

test("drafts can be sent as one batch, and are kept only if nothing has changed since", async () => {
  const { ws, client, replies, batches, criteria } = await setUp("draft-6");
  for (const c of criteria) await recordJudgement(ws, "sub-002", c, { levelId: "p48" });
  await recordSubmissionMark(ws, "sub-002", { mark: 48 });
  const plan = await planDrafts(ws, client, null, { withBrief: false, batch: true, fallback: false });
  const { batch } = await sendDraftBatch(ws, plan, { proxy: client });
  expect(batch!.items.map((i) => i.submission_id)).toEqual(["sub-001", "sub-002"]);
  expect(batch!.prompt_version).toBe("feedback-v2"); // the instructions sent, kept for the call records made on collection
  await recordJudgement(ws, "sub-002", criteria[0], { levelId: "p55" }); // changed after sending
  batches.ended = true;
  replies.push(drafts, drafts);
  const result = await collectDraftBatch(ws, client, batch!.id);
  expect([...result.drafted.keys()]).toEqual(["sub-001"]);
  expect(result.failed.get("sub-002")).toMatch(/changed after the batch was sent/);
  expect((await loadDrafts(ws, "sub-001")).every((d) => d.call.produced_by === "batch")).toBe(true);
});

test("Feedback opens once a submission is marked, and counts the submissions with feedback", async () => {
  const { ws, criteria } = await setUp("draft-7");
  let step = markingStates(await loadOverview(ws), null, null).get("feedback")!;
  expect([step.locked, `${statusWord(step)}: ${step.reason}`]).toEqual([null, "Not started: 0 of 2 submissions have feedback"]);
  for (const t of [...criteria, OVERALL]) await recordFeedback(ws, "sub-001", t, { text: "Feedback. Next time, more." });
  step = markingStates(await loadOverview(ws), null, null).get("feedback")!;
  expect(`${statusWord(step)}: ${step.reason}`).toBe("Needs attention: 1 of 2 submissions have feedback");

  const { ws: unmarked } = await newWorkspace("draft-8", { workspace_type: "marking" });
  expect(markingStates(await loadOverview(unmarked), null, null).get("feedback")!.locked).not.toBeNull();
});

test("drafts that don't load are reported, never taken for none (which could pay to draft them again)", async () => {
  const { ws, client, replies } = await setUp("draft-9");
  replies.push(drafts);
  await draftAll(ws, client);
  await ws.writeJson("feedback/drafts/sub-001.json", [{ kind: "feedback_draft", text: "" }]);
  const plan = await planDrafts(ws, client, null, { withBrief: false });
  expect(plan.drafts).toEqual([]);
  expect(plan.skipped.get("sub-001")).toBe("feedback/drafts/sub-001.json is not a valid set of feedback drafts");
});

test("recorded feedback is checked against its mark; a flag is accepted with a reason, and new text clears it", async () => {
  const { ws, criteria } = await setUp("draft-10"); // every criterion marked 62: an upper second
  await recordFeedback(ws, "sub-001", criteria[0], { text: "Excellent and outstanding work." });
  let [flags] = await feedbackFlags(ws, "sub-001");
  expect(flags.open.map((f) => `${f.check}:${f.detail}`)).toEqual(["praise:excellent", "praise:outstanding", "next_step:no next step"]);
  await expect(acceptFlag(ws, "sub-001", criteria[0], { check: "praise", detail: "excellent" }, "  ")).rejects.toThrow("give a short reason");
  await expect(acceptFlag(ws, "sub-001", criteria[0], { check: "praise", detail: "superb" }, "x")).rejects.toThrow("isn't raised");
  const kept = await acceptFlag(ws, "sub-001", criteria[0], { check: "praise", detail: "excellent" }, "The brief's own wording");
  expect([kept.text, kept.accepted_flags]).toEqual(["Excellent and outstanding work.", [{ check: "praise", detail: "excellent", reason: "The brief's own wording" }]]);
  [flags] = await feedbackFlags(ws, "sub-001");
  expect(flags.open.map((f) => f.detail)).toEqual(["outstanding", "no next step"]);
  // A submission with flags to check needs attention.
  const row = (await loadOverview(ws)).submissions.find((r) => r.id === "sub-001")!;
  expect(row.feedback).toBe("attention");
  // New text: the acceptance belonged to the old text.
  const again = await recordFeedback(ws, "sub-001", criteria[0], { text: "Excellent. Next time, cite more." });
  expect(again.accepted_flags).toEqual([]);
});
