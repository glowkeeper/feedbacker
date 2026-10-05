/**
 * Suggesting an edit to the educator's flagged feedback (ADR 0006, amended), through the real proxy to a scripted fake
 * API: what is shown and sent (that one piece of feedback, its flags and its marking, never the submission), the check
 * against what was confirmed, the suggestion kept beside the feedback and never in its place, and feedback recorded
 * from it. No test contacts the API.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { fakeAnthropic, type Reply } from "../../proxy/test/fakeAnthropic.ts";
import { loadFeedbackWork } from "../src/app/feedbackWork.ts";
import {
  acceptFlag,
  approveSubmission,
  exportMarking,
  MarkingRecord,
  planDrafts,
  anonymiseWorkspace,
  approve,
  bytesSource,
  FeedbackDraft,
  importCohort,
  importRubric,
  loadFeedback,
  loadRubric,
  loadSuggestions,
  OVERALL,
  planSuggestion,
  recordFeedback,
  recordJudgement,
  recordSubmissionMark,
  runSuggestion,
  SUGGEST_PROMPT_VERSION,
  updateRules,
} from "../src/core/index.ts";
import { makeZip, packFile } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

const suggests =
  (text: string) =>
  (): Reply => ({ message: { model: "claude-sonnet-5", content: [{ type: "text", text: JSON.stringify({ text }) }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } }, requestId: "req_edit" });

/** A marking workspace with one submission marked 62 (an upper second) throughout, and its first criterion's feedback overstating it. */
async function setUp(name: string) {
  const replies: ((body: any) => Reply)[] = [];
  const fake = fakeAnthropic(replies);
  const made = await newWorkspace(name, { provider: fake.provider, workspace_type: "marking" });
  const ws = made.ws;
  await importCohort(ws, bytesSource("cohort_1.zip", makeZip({ "100200301 - QUILL AVERY . - a.docx": packFile("submissions/sub-a.docx"), "100200302 - PIKE JORDAN - b.pdf": packFile("submissions/sub-b.pdf") })));
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic" });
  await updateRules(ws, { names: ["Morgan Ellis"] });
  await anonymiseWorkspace(ws);
  await approve(ws, "sub-001");
  const criteria = (await loadRubric(ws)).criteria.map((c) => c.id);
  for (const c of criteria) await recordJudgement(ws, "sub-001", c, { levelId: "p62", comment: `Comment on ${c}` });
  await recordSubmissionMark(ws, "sub-001", { mark: 62, comment: "A clear piece of work." });
  await recordFeedback(ws, "sub-001", criteria[0], { text: "Your structure is excellent and easy to follow. Next time, cite more widely." });
  return { ws, client: made.client, path: made.path, replies, sent: fake.sent, criteria };
}

test("the plan shows exactly what will be sent: that criterion's marking, and the recorded feedback with its open flags; never the submission", async () => {
  const { ws, client, criteria } = await setUp("edit-1");
  const plan = await planSuggestion(ws, client, "sub-001", criteria[0]);
  expect(plan.request.prompt.version).toBe(SUGGEST_PROMPT_VERSION);
  expect(plan.request.blocks.map((b) => b.kind)).toEqual(["rubric", "marking", "feedback"]);
  expect([plan.request.blocks[1].text, plan.request.blocks[2].text]).toEqual([plan.marking, plan.feedback]); // shown exactly as sent
  expect(plan.marking).toBe(`The feedback is on criterion: ${(await loadRubric(ws)).criteria[0].title} (id ${criteria[0]})\nLevel: 2:1 (62) (level id p62)\nMark: 62 out of 100\nThe educator's comment: Comment on ${criteria[0]}`);
  expect(plan.feedback).toBe(`Your structure is excellent and easy to follow. Next time, cite more widely.\n\nWhat Feedbacker's checks flagged in it:\n- "excellent" is praise for first-class (70 and above) work, but the mark is upper second (60–69).`);
  expect(plan.marking).not.toContain(criteria[1]); // no other criterion
  expect(plan.cost).toBeGreaterThan(0);
});

test("for the overall feedback, the overall mark and comment and each criterion's level and mark are sent, not their comments", async () => {
  const { ws, client, criteria } = await setUp("edit-2");
  await recordFeedback(ws, "sub-001", OVERALL, { text: "An outstanding piece of work." });
  const plan = await planSuggestion(ws, client, "sub-001", OVERALL);
  expect(plan.marking.startsWith("The feedback is the overall feedback.\nOverall mark: 62 out of 100\nThe educator's overall comment: A clear piece of work.")).toBe(true);
  for (const c of criteria) expect(plan.marking).toContain(`(id ${c})\nLevel: 2:1 (62) (level id p62)\nMark: 62 out of 100`);
  expect(plan.marking).not.toContain("Comment on");
  expect(plan.feedback).toContain('There is no next step: say what to do "Next time".');
});

test("only recorded, flagged feedback can have an edit suggested; an accepted flag isn't sent", async () => {
  const { ws, client, criteria } = await setUp("edit-3");
  await expect(planSuggestion(ws, client, "sub-001", criteria[1])).rejects.toThrow("record the feedback first");
  await recordFeedback(ws, "sub-001", criteria[1], { text: "You set this out clearly. Next time, go further." });
  await expect(planSuggestion(ws, client, "sub-001", criteria[1])).rejects.toThrow("nothing is flagged");
  await acceptFlag(ws, "sub-001", criteria[0], { check: "praise", detail: "excellent" }, "It fits this student's work");
  await expect(planSuggestion(ws, client, "sub-001", criteria[0])).rejects.toThrow("nothing is flagged");
});

test("a suggestion is sent only what was shown, kept beside the feedback, and the feedback is unchanged", async () => {
  const { ws, client, path, replies, sent, criteria } = await setUp("edit-4");
  replies.push(suggests("Your structure is clear and easy to follow. Next time, cite more widely."));
  const plan = await planSuggestion(ws, client, "sub-001", criteria[0]);
  const result = await runSuggestion(ws, plan, { proxy: client });
  const asked = JSON.stringify(sent);
  expect(asked).toContain("Your structure is excellent");
  expect(asked).not.toContain("Study Buddy"); // no submission's text
  expect(asked).not.toContain(`Comment on ${criteria[1]}`); // no other criterion's marking
  const s = result.suggestion!;
  expect([s.text, s.criterion_id, s.guide_version, s.call.prompt_version, s.provenance.actor.kind]).toEqual(["Your structure is clear and easy to follow. Next time, cite more widely.", criteria[0], null, SUGGEST_PROMPT_VERSION, "model"]);
  expect(s.edited_from).toBe(plan.editedFrom);
  expect(await loadSuggestions(ws, "sub-001")).toEqual([s]);
  expect((await loadFeedback(ws, "sub-001"))[0].text).toBe("Your structure is excellent and easy to follow. Next time, cite more widely."); // never replaced
  expect(readdirSync(join(path, "feedback", "calls"))).toHaveLength(1);
  // The row shows it, while it edits the feedback as recorded.
  let row = (await loadFeedbackWork(ws, "sub-001")).rows[0];
  expect([row.suggestion?.id, row.check(s.text)]).toEqual([s.id, []]);
  // Recorded from it: derived from the AI, with the suggestion it came from.
  const f = await recordFeedback(ws, "sub-001", criteria[0], { text: s.text, fromDraft: s.id });
  expect([f.derived_from_ai, f.from_draft]).toEqual([true, s.id]);
  row = (await loadFeedbackWork(ws, "sub-001")).rows[0];
  expect([row.open, row.suggestion]).toEqual([[], null]); // it edited other text than is recorded now
});

test("a change after confirming is caught before anything is sent", async () => {
  const { ws, client, replies, sent, criteria } = await setUp("edit-5");
  replies.push(suggests("Anything."));
  const plan = await planSuggestion(ws, client, "sub-001", criteria[0]);
  await recordFeedback(ws, "sub-001", criteria[0], { text: "Your structure is excellent. Next time, cite more widely." });
  await expect(runSuggestion(ws, plan, { proxy: client })).rejects.toThrow("changed after you confirmed what would be sent");
  expect(sent).toEqual([]);
});

test("the proxy refuses the educator's feedback in any request but a suggestion, and a suggestion with a submission in it", async () => {
  const { ws, client, criteria } = await setUp("edit-6");
  const plan = await planSuggestion(ws, client, "sub-001", criteria[0]);
  const run = (await client.openRun(1, 0.01)).id;
  const [rubric, marking, feedback] = plan.request.blocks;
  await expect(client.read(run, { ...plan.request, prompt: { version: "feedback-v3", instructions: "x" } })).rejects.toThrow("a drafting request's blocks must be");
  await expect(client.read(run, { ...plan.request, prompt: { version: "marking-v2", instructions: "x" } })).rejects.toThrow("the educator's feedback may be sent only in a suggestion request");
  const sub = { kind: "submission" as const, heading: "SUBMISSION", text: "x", approved_sha256: marking.approved_sha256 };
  await expect(client.read(run, { ...plan.request, blocks: [rubric, sub, marking, feedback] })).rejects.toThrow("a suggestion request's blocks must be a rubric, the educator's marking, then their feedback");
});

test("a suggestion's record says what it edits, and is sent no guide", () => {
  const base = { id: "fs-sub-001-a", submission_id: "sub-001", criterion_id: "c1", text: "T.", drafted_from: "a".repeat(64), call: { provider: "anthropic", model_requested: "m", model_reported: "m", request_id: "r", prompt_version: "feedback-edit-v1", rubric_version: "v", approval_id: "appr-1", approved_text_sha256: "b".repeat(64), brief_approval_id: null, brief_sha256: null, fallback_from: null, request_sha256: "c".repeat(64), response_sha256: "d".repeat(64), stop_reason: "end_turn", usage: {}, produced_by: "live", cached_from_request_id: null, timestamp: "2026-10-05T09:00:00Z", error: null }, provenance: { source: "s", transformation: "generated", actor: { kind: "model", label: "m" }, timestamp: "2026-10-05T09:00:00Z" } };
  expect(FeedbackDraft.parse({ ...base, edited_from: "e".repeat(64) }).edited_from).toBe("e".repeat(64));
  expect(FeedbackDraft.parse(base).edited_from).toBeNull();
  expect(() => FeedbackDraft.parse({ ...base, edited_from: "e".repeat(64), guide_version: 1 })).toThrow("a suggested edit is sent no feedback guide");
});

// --- From code review ----------------------------------------------------------------------------------------

test("a comment that a rule added since would redact more of is not sent, for a suggestion or a draft", async () => {
  const { ws, client, criteria } = await setUp("edit-7");
  await updateRules(ws, { names: ["Comment"] }); // the saved comments say "Comment on …"
  await expect(planSuggestion(ws, client, "sub-001", criteria[0])).rejects.toThrow(/your comment on .+ now redact; record its mark again/);
  const drafting = await planDrafts(ws, client, null, { withBrief: false });
  expect(drafting.drafts).toEqual([]);
  expect(drafting.skipped.get("sub-001")).toMatch(/your comment on .+ now redact/);
  // Recorded again, it is anonymised as the rules are now, and can be sent.
  await recordJudgement(ws, "sub-001", criteria[0], { levelId: "p62", comment: `Comment on ${criteria[0]}` });
  await expect(planSuggestion(ws, client, "sub-001", criteria[0])).resolves.toBeTruthy();
});

test("a suggestion can't be used once the feedback it edits has been changed", async () => {
  const { ws, client, replies, criteria } = await setUp("edit-8");
  replies.push(suggests("Your structure is clear and easy to follow. Next time, cite more widely."));
  const { suggestion } = await runSuggestion(ws, await planSuggestion(ws, client, "sub-001", criteria[0]), { proxy: client });
  await recordFeedback(ws, "sub-001", criteria[0], { text: "Your structure is excellent. Next time, cite more widely." }); // as if in another tab
  await expect(recordFeedback(ws, "sub-001", criteria[0], { text: suggestion!.text, fromDraft: suggestion!.id })).rejects.toThrow("that suggestion edits feedback that has been changed since");
});

test("the marking record carries each suggestion, so feedback recorded from one keeps its provenance", async () => {
  const { ws, client, path, replies, criteria } = await setUp("edit-9");
  replies.push(suggests("Your structure is clear and easy to follow. Next time, cite more widely."));
  const { suggestion } = await runSuggestion(ws, await planSuggestion(ws, client, "sub-001", criteria[0]), { proxy: client });
  await recordFeedback(ws, "sub-001", criteria[0], { text: suggestion!.text, fromDraft: suggestion!.id });
  for (const c of criteria.slice(1)) await recordFeedback(ws, "sub-001", c, { text: "You set this out clearly. Next time, go further." });
  await recordFeedback(ws, "sub-001", OVERALL, { text: "A clear piece of work. Next time, test more widely." });
  await approveSubmission(ws, "sub-001");
  const { paths } = await exportMarking(ws);
  const record = MarkingRecord.parse(JSON.parse(readFileSync(join(path, paths.at(-1)!), "utf8")));
  expect([record.suggestions.map((x) => x.id), record.feedback.find((f) => f.criterion_id === criteria[0])!.from_draft]).toEqual([[suggestion!.id], suggestion!.id]);
  // A suggestion among the drafts, or a draft among the suggestions, isn't a valid record.
  expect(() => MarkingRecord.parse({ ...record, drafts: [suggestion], suggestions: [] })).toThrow("a suggested edit belongs in suggestions");
  expect(() => MarkingRecord.parse({ ...record, suggestions: [{ ...suggestion!, edited_from: null }] })).toThrow("it doesn't name the feedback it edits");
});
