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
import { boxesAfterRecording, needsRecording, rowFor, submissionsWithDrafts, loadFeedbackWork } from "../src/app/feedbackWork.ts";
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
  anonymiseAll,
  loadSubmissionMark,
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
  expect(stored.every((d) => d.call.prompt_version === "feedback-v3" && d.provenance.actor.kind === "model")).toBe(true);
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
  expect(batch!.prompt_version).toBe("feedback-v3"); // the instructions sent, kept for the call records made on collection
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

test("drafting a criterion again can avoid the words a check flagged, said in the marking exactly as sent", async () => {
  const { ws, client, replies, sent, criteria } = await setUp("draft-11");
  replies.push(drafts);
  const plan = await planDrafts(ws, client, [{ submissionId: "sub-001", targets: [criteria[0]], avoid: { [criteria[0]]: ["excellent", "outstanding"] } }], { withBrief: false });
  expect(plan.drafts[0].marking).toContain(`The educator's comment: Comment on ${criteria[0]}\nWords to avoid in this feedback, because they overstate the mark: excellent, outstanding`);
  expect(plan.drafts[0].marking.match(/Words to avoid/g)).toHaveLength(1); // only for the criterion drafted
  const result = await runDrafts(ws, plan, { proxy: client }); // rebuilt with the same words, so it matches what was confirmed
  expect([...result.drafted.keys()]).toEqual(["sub-001"]);
  expect(JSON.stringify(sent)).toContain("because they overstate the mark: excellent, outstanding");
});

test("a draft that comes back cut off mid-sentence is kept, but reported, and its feedback is flagged", async () => {
  const { ws, client, replies, criteria } = await setUp("draft-12");
  replies.push((body: any) => {
    const reply = drafts(body) as any;
    const out = JSON.parse(reply.message.content[0].text);
    out.criteria[criteria[0]] = "You disclose your use of AI clearly. There is also a tension: your final statement says AI ";
    reply.message.content[0].text = JSON.stringify(out);
    return reply;
  });
  const result = await runDrafts(ws, await planDrafts(ws, client, [{ submissionId: "sub-001" }], { withBrief: false }), { proxy: client });
  expect(result.warnings.get("sub-001")).toEqual([`the draft for criterion '${criteria[0]}' seems to end mid-sentence; check it, or draft it again`]);
  const [cut] = await loadDrafts(ws, "sub-001");
  await recordFeedback(ws, "sub-001", criteria[0], { text: cut.text, fromDraft: cut.id });
  const [flags] = await feedbackFlags(ws, "sub-001");
  expect(flags.open.map((f) => f.check)).toEqual(["cut_off", "next_step"]);
});

test("a draft that ends with a stray quotation mark and comma after its last sentence is kept without them, and that is said", async () => {
  const { ws, client, replies, criteria } = await setUp("draft-13");
  replies.push((body: any) => {
    const reply = drafts(body) as any;
    const out = JSON.parse(reply.message.content[0].text);
    out.criteria[criteria[0]] = "You set this out clearly. Next time, interrogate them.”,\n";
    reply.message.content[0].text = JSON.stringify(out);
    return reply;
  });
  const result = await runDrafts(ws, await planDrafts(ws, client, [{ submissionId: "sub-001" }], { withBrief: false }), { proxy: client });
  expect(result.warnings.get("sub-001")).toEqual([`the draft for criterion '${criteria[0]}' ended with a stray quotation mark and comma, which were removed`]);
  expect((await loadDrafts(ws, "sub-001"))[0].text).toBe("You set this out clearly. Next time, interrogate them.");
});

test("marking that looks like it holds an identifier is left out of the plan, with what was found; the rest is planned", async () => {
  const { ws, client, criteria, sent } = await setUp("draft-id");
  await recordJudgement(ws, "sub-001", criteria[0], { levelId: "p62", comment: "Good. Ring +1 555 010 0001." }); // not a number the anonymisation rules cover
  const plan = await planDrafts(ws, client, null, { withBrief: false });
  expect(plan.drafts).toEqual([]);
  expect(plan.skipped.get("sub-001")).toBe("can't be sent, because it may identify someone: the marking contains a phone number. What was found is listed below; your marking is changed and recorded again");
  expect(plan.identifiers.get("sub-001")!.map((m) => [m.where, m.value])).toEqual([["marking", "+1 555 010 0001"]]);
  expect(sent).toHaveLength(0);
});

test("a rule added after a comment was recorded leaves that submission out of the plan, and says exactly what in the comments it now redacts", async () => {
  const { ws, client, criteria, sent } = await setUp("draft-redact");
  await updateRules(ws, { redact: { "A clear piece": "NOTE" } }); // the overall comment, "A clear piece of work.", now holds something to redact
  const plan = await planDrafts(ws, client, null, { withBrief: false });
  expect(plan.drafts).toEqual([]);
  expect(plan.skipped.get("sub-001")).toBe("your overall comment contains something the anonymisation rules or pseudonym key now redact; record the overall mark again (nothing is sent until then)");
  expect(plan.redactions.get("sub-001")!.map((m) => [m.where, m.field, m.value])).toEqual([["your overall comment", "comment", "A clear piece"]]);
  expect(criteria.length).toBeGreaterThan(0);
  expect(sent).toHaveLength(0);
  // Anonymise now brings the overall mark's comment up to the rules too, so the plan is made.
  const again = await anonymiseAll(ws);
  expect(again.commentsUpdated).toContain("judgements/sub-001--mark.json");
  expect((await loadSubmissionMark(ws, "sub-001"))!.comment).not.toContain("A clear piece");
  expect((await planDrafts(ws, client, null, { withBrief: false })).drafts.map((d) => d.submissionId)).toEqual(["sub-001"]);
});

test("only a submission that came back with a draft is offered for reading: a complete reply can give none", () => {
  const draft = { text: "x" };
  expect(submissionsWithDrafts(new Map([["sub-001", [draft, draft]], ["sub-002", [draft]]]))).toEqual(["sub-001", "sub-002"]);
  expect(submissionsWithDrafts(new Map([["sub-001", []], ["sub-002", [draft]]]))).toEqual(["sub-002"]); // every text blank: only a warning, nothing to read
  expect(submissionsWithDrafts(new Map([["sub-001", []]]))).toEqual([]);
  expect(submissionsWithDrafts(new Map())).toEqual([]);
});

test("a request from Export finds its piece of feedback: a criterion by its place and title, else by its title, or the overall", () => {
  const rows = [
    { target: "requirements", title: "Requirements" },
    { target: "design", title: "Design" },
    { target: "overall", title: "Overall" },
  ];
  expect(rowFor(rows, { criterion: 1, title: "Design" })?.target).toBe("design");
  expect(rowFor(rows, "overall")?.target).toBe("overall");
  // The place no longer matches (the rubric changed): found by its title instead.
  expect(rowFor(rows, { criterion: 0, title: "Design" })?.target).toBe("design");
  // Never the overall by a criterion's place, and nothing when there is nothing to find.
  expect(rowFor(rows, { criterion: 2, title: "Overall" })).toBeNull();
  expect(rowFor(rows, { criterion: 0, title: "Gone" })).toBeNull();
  expect(rowFor([], "overall")).toBeNull();
});

test("a piece needs recording when its box differs from what is recorded, when what is recorded is out of date, or when it is from another draft", () => {
  const recorded = { text: "Good work.", from_draft: "d1" };
  const row = (extra: object = {}) => ({ marking: "Your mark: 62", feedback: recorded, feedbackStale: false, ...extra });
  expect(needsRecording(row(), "Good work.", "d1")).toBe(false); // as recorded
  expect(needsRecording(row(), "Better work.", "d1")).toBe(true); // changed
  expect(needsRecording(row({ feedbackStale: true }), "Good work.", "d1")).toBe(true); // the marking changed since: it is recorded again on what there is now
  expect(needsRecording(row(), "Good work.", "d2")).toBe(true); // started from another draft: its provenance is different
  expect(needsRecording(row({ feedback: { text: "Good work.", from_draft: null } }), "Good work.", null)).toBe(false); // nothing to do with a draft either way
  expect(needsRecording(row({ feedback: null }), "New.", null)).toBe(true); // not recorded yet
  // Never what can't be recorded: nothing typed, or no marking to be given on.
  expect(needsRecording(row({ feedback: null }), "   ", null)).toBe(false);
  expect(needsRecording(row({ marking: null, feedback: null }), "Text.", null)).toBe(false);
});

test("after recording, a box still holding what was sent takes what was recorded; one typed in meanwhile keeps what is there", () => {
  const sent = new Map([
    ["a", { text: "First.", from: null }],
    ["b", { text: "Second.", from: "d2" }],
    ["c", { text: "Third.", from: null }],
  ]);
  const recorded = new Map([["a", "First."], ["b", "Second (anonymised)."], ["c", "Third."]]);
  // b is as sent; a was edited while it saved; c was started from another draft while it saved.
  const { texts, changedWhileSaving } = boxesAfterRecording({ a: "First, and more.", b: "Second.", c: "Third." }, { a: null, b: "d2", c: "d9" }, sent, recorded);
  expect(texts).toEqual({ a: "First, and more.", b: "Second (anonymised).", c: "Third." }); // a keeps what was typed; b shows what was saved
  expect(changedWhileSaving).toEqual(["a", "c"]);
  // Nothing changed meanwhile: every box takes what was recorded, and nothing is named.
  expect(boxesAfterRecording({ a: "First.", b: "Second.", c: "Third." }, { a: null, b: "d2", c: null }, sent, recorded).changedWhileSaving).toEqual([]);
});
