/**
 * Suggesting a verdict and a comment (ADR 0011), through the real proxy to a scripted fake API: what is shown and sent (the moderation of one
 * submission, never its text), what is refused until the review is complete, the check against what was confirmed, and the suggestion
 * returned for the moderator without being recorded as anything. No test contacts the API.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { fakeAnthropic, type Reply } from "../../proxy/test/fakeAnthropic.ts";
import {
  AISuggestion,
  anonymiseWorkspace,
  approve,
  bytesSource,
  enterMarking,
  addIdentifiersToRules,
  IdentifiersFound,
  importOriginals,
  importRubric,
  loadRubric,
  loadVerdict,
  planVerdictSuggestion,
  readingPath,
  recordJudgement,
  recordRequest,
  recordVerdict,
  runVerdictSuggestion,
  updateRules,
  VERDICT_PROMPT_VERSION,
  type Workspace,
} from "../src/core/index.ts";
import { makeZip, packFile } from "./builders.ts";
import { modelCall, prov } from "./helpers.ts";
import { newWorkspace } from "./proxyHarness.ts";

const answers =
  (verdict: string, comment: string) =>
  (): Reply => ({ message: { model: "claude-sonnet-5", content: [{ type: "text", text: JSON.stringify({ verdict, comment }) }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } }, requestId: "req_verdict" });

/** A moderation of one submission: original marking of 82 overall, the moderator's levels all upper second (62), and an AI reading of each criterion. */
async function setUp(name: string, options: { judge?: boolean; read?: boolean; note?: string; names?: string[] } = {}) {
  const replies: ((body: any) => Reply)[] = [];
  const fake = fakeAnthropic(replies);
  const made = await newWorkspace(name, { provider: fake.provider });
  const ws: Workspace = made.ws;
  await recordRequest(ws, [{ external_id: "100200301" }, { external_id: "100200302" }], { sample_note: options.note });
  await importOriginals(ws, bytesSource("o.zip", makeZip({ "100200301 - QUILL AVERY . - a.docx": packFile("submissions/sub-a.docx"), "100200302 - PIKE JORDAN - b.pdf": packFile("submissions/sub-b.pdf") })));
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic" });
  if (options.names) await updateRules(ws, { names: options.names });
  await anonymiseWorkspace(ws);
  await approve(ws, "sub-001");
  await enterMarking(ws, "sub-001", { overall: 82 });
  const rubric = await loadRubric(ws);
  if (options.judge !== false) for (const c of rubric.criteria) await recordJudgement(ws, "sub-001", c.id, { levelId: "p62", comment: `My view of ${c.id}` });
  if (options.read !== false) {
    const approval = ((await ws.readJson("submissions/sub-001.json")) as { approval: { id: string; approved_text_sha256: string } }).approval;
    const call = modelCall({ approval_id: approval.id, approved_text_sha256: approval.approved_text_sha256, rubric_version: rubric.version });
    const readings = rubric.criteria.map((c, i) => AISuggestion.parse({ id: `ai-${i}`, submission_id: "sub-001", criterion_id: c.id, suggested_level_id: "p62", rationale: `The AI's reason for ${c.id}.`, evidence: [{ text: "wrote this quote about the secret", verified: true }], call, provenance: prov({ kind: "model", label: "test-model" }, "generated") }));
    await ws.writeJson(readingPath("sub-001"), readings);
  }
  return { ws, client: made.client, path: made.path, replies, sent: fake.sent, rubric };
}

test("the plan shows exactly what will be sent: the marks, the moderator's judgements and the AI reading's rationales; never the submission or the AI's quoted evidence", async () => {
  const { ws, client, rubric } = await setUp("verdict-1");
  const plan = await planVerdictSuggestion(ws, client, "sub-001", { verdict: "generous" });
  expect(plan.request.prompt.version).toBe(VERDICT_PROMPT_VERSION);
  expect(plan.request.blocks.map((b) => b.kind)).toEqual(["rubric", "marking"]);
  expect(plan.request.blocks[1].text).toBe(plan.moderation); // shown exactly as sent
  expect(plan.moderation.startsWith("The original marker's overall mark: 82 out of 100\nThe moderator's overall mark, implied by their criterion marks: 62 out of 100\nThe verdict the moderator has chosen: generous\n")).toBe(true);
  const first = rubric.criteria[0];
  expect(plan.moderation).toContain(`Criterion: ${first.title} (id ${first.id})\nThe moderator's level: 2:1 (62) (level id p62); mark: 62 out of 100\nThe moderator's comment: My view of ${first.id}\nThe AI reading's suggested level: 2:1 (62) (level id p62)\nThe AI reading's rationale: The AI's reason for ${first.id}.`);
  expect(plan.moderation).not.toContain("secret"); // the AI's quoted evidence is not sent
  expect(plan.cost).toBeGreaterThan(0);
  expect((await planVerdictSuggestion(ws, client, "sub-001")).moderation).toContain("The verdict the moderator has chosen: none yet");
});

test("it is refused, with what to do, until the review is complete enough to suggest from", async () => {
  const unjudged = await setUp("verdict-2", { judge: false });
  await expect(planVerdictSuggestion(unjudged.ws, unjudged.client, "sub-001")).rejects.toThrow("judge every criterion first");
  const unread = await setUp("verdict-3", { read: false });
  await expect(planVerdictSuggestion(unread.ws, unread.client, "sub-001")).rejects.toThrow("no AI reading of this submission to use");
  const { ws, client } = await setUp("verdict-4");
  await expect(planVerdictSuggestion(ws, client, "sub-009")).rejects.toThrow("is not in the sample");
  await expect(planVerdictSuggestion(ws, client, "sub-002")).rejects.toThrow(/has not been|approved/); // its text isn't approved
});

test("a suggestion is sent only what was shown, returned to the moderator and not recorded as a verdict", async () => {
  const { ws, client, path, replies, sent } = await setUp("verdict-5");
  replies.push(answers("generous", "Marked too high overall: 82 against the 62 your judgements imply. The testing criterion accounts for most of it."));
  const plan = await planVerdictSuggestion(ws, client, "sub-001");
  const result = (await runVerdictSuggestion(ws, plan, { proxy: client }))!;
  const asked = JSON.stringify(sent);
  expect(asked).toContain("The original marker's overall mark: 82 out of 100");
  expect(asked).not.toContain("Study Buddy"); // no submission's text
  expect(asked).not.toContain("secret");
  expect([result.verdict, result.comment.startsWith("Marked too high overall"), result.call.prompt_version]).toEqual(["generous", true, VERDICT_PROMPT_VERSION]);
  expect(await loadVerdict(ws, "sub-001")).toBeNull(); // a suggestion is not a verdict
  expect(readdirSync(join(path, "verdicts", "calls"))).toHaveLength(1);
});

test("nothing is sent if what was confirmed has changed", async () => {
  const { ws, client, replies, sent } = await setUp("verdict-6");
  replies.push(answers("agree", "Fair."));
  const plan = await planVerdictSuggestion(ws, client, "sub-001", { verdict: "agree" });
  await expect(runVerdictSuggestion(ws, plan, { proxy: client, verdict: "harsh" })).rejects.toThrow("changed after you confirmed what would be sent");
  expect(sent).toHaveLength(0);
  const rubric = await loadRubric(ws);
  await recordJudgement(ws, "sub-001", rubric.criteria[0].id, { levelId: "p68" }); // the moderator's own mark changed
  await expect(runVerdictSuggestion(ws, plan, { proxy: client, verdict: "agree" })).rejects.toThrow("changed after you confirmed what would be sent");
  expect(sent).toHaveLength(0);
});

test("an answer that isn't a verdict and a comment is not trusted", async () => {
  const { ws, client, replies } = await setUp("verdict-7");
  replies.push(answers("terrible", "Whatever."));
  const plan = await planVerdictSuggestion(ws, client, "sub-001");
  expect(await runVerdictSuggestion(ws, plan, { proxy: client })).toBeNull();
});

test("a verdict records whether it and its comment came from the AI", async () => {
  const { ws } = await setUp("verdict-8");
  const v = await recordVerdict(ws, "sub-001", { verdict: "generous", suggestedMark: 62, comment: "Marked too high.", verdictFromAi: true, commentFromAi: true });
  expect([v.verdict_taken_from_ai, v.comment_derived_from_ai]).toEqual([true, true]);
  const own = await recordVerdict(ws, "sub-001", { verdict: "agree", comment: "   " });
  expect([own.verdict_taken_from_ai, own.comment_derived_from_ai]).toEqual([false, false]);
  const noComment = await recordVerdict(ws, "sub-001", { verdict: "agree", commentFromAi: true });
  expect(noComment.comment_derived_from_ai).toBe(false); // there is no comment to be derived
});

// --- The overall comment on the sample (ADR 0011) -------------------------------------------------------------------------------

import { OVERALL_PROMPT_VERSION, planOverallSuggestion, runOverallSuggestion, approveRecord } from "../src/core/index.ts";

const says = (comment: string) => (): Reply => ({ message: { model: "claude-sonnet-5", content: [{ type: "text", text: JSON.stringify({ comment }) }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } }, requestId: "req_overall" });

test("the overall comment's plan shows the sample's verdicts and marks, and nothing else; it needs a verdict on every sampled submission", async () => {
  const { ws, client } = await setUp("overall-1");
  await expect(planOverallSuggestion(ws, client)).rejects.toThrow("record a verdict on every sampled submission first");
  await recordVerdict(ws, "sub-001", { verdict: "generous", suggestedMark: 62, comment: "Marked too high on every criterion." });
  await expect(planOverallSuggestion(ws, client)).rejects.toThrow("still to do: sub-002"); // sub-002 has none (its text isn't approved, so it can't be judged here)
});

test("an overall comment is planned and sent from the recorded verdicts, never recorded, and its record says where it came from", async () => {
  const { ws, client, replies, sent, path } = await setUp("overall-2");
  // The second sampled submission is moderated too, so every verdict can be recorded.
  await approve(ws, "sub-002");
  await enterMarking(ws, "sub-002", { overall: 58 });
  for (const c of (await loadRubric(ws)).criteria) await recordJudgement(ws, "sub-002", c.id, { levelId: "p62" });
  const approval = ((await ws.readJson("submissions/sub-002.json")) as { approval: { id: string; approved_text_sha256: string } }).approval;
  const rubric = await loadRubric(ws);
  await ws.writeJson(readingPath("sub-002"), rubric.criteria.map((c, i) => AISuggestion.parse({ id: `ai2-${i}`, submission_id: "sub-002", criterion_id: c.id, suggested_level_id: "p62", rationale: "A reason.", evidence: [], call: modelCall({ approval_id: approval.id, approved_text_sha256: approval.approved_text_sha256, rubric_version: rubric.version }), provenance: prov({ kind: "model", label: "test-model" }, "generated") })));
  await recordVerdict(ws, "sub-001", { verdict: "generous", suggestedMark: 62, comment: "Marked too high on every criterion." });
  await recordVerdict(ws, "sub-002", { verdict: "agree", comment: "Fair." });
  replies.push(says("Two submissions were sampled; one was marked too generously and one fairly. The sample is too small to say more."));
  const plan = await planOverallSuggestion(ws, client);
  expect(plan.request.prompt.version).toBe(OVERALL_PROMPT_VERSION);
  expect(plan.request.blocks.map((b) => b.kind)).toEqual(["marking"]); // no rubric, no submission
  expect(plan.sample.startsWith("The moderation of 2 sampled submissions.\nHow the sample was chosen: not recorded\n\nSubmission sub-001 ([STUDENT_")).toBe(true);
  expect(plan.sample).toContain("The original marker's overall mark: 82 out of 100");
  expect(plan.sample).toContain("Verdict: generous\nThe moderator's comment: Marked too high on every criterion.");
  expect(plan.sample).not.toContain("My view of"); // not the moderator's criterion comments
  expect(plan.sample).not.toContain("The AI's reason"); // not the AI reading
  const got = (await runOverallSuggestion(ws, plan, { proxy: client }))!;
  expect(got.comment.startsWith("Two submissions were sampled")).toBe(true);
  expect(JSON.stringify(sent)).not.toContain("Study Buddy"); // no submission's text
  expect(readdirSync(join(path, "verdicts", "calls")).some((f) => f.startsWith("overall--"))).toBe(true);
  // A suggestion is not the comment: the record carries what the moderator approves, and says if it began as the AI's.
  const own = await approveRecord(ws, { overallComment: "My own words." });
  expect([own.overall_comment, own.overall_comment_derived_from_ai]).toEqual(["My own words.", false]);
  const used = await approveRecord(ws, { overallComment: got.comment, overallCommentFromAi: true });
  expect(used.overall_comment_derived_from_ai).toBe(true);
  expect((await approveRecord(ws, { overallComment: "  ", overallCommentFromAi: true })).overall_comment_derived_from_ai).toBe(false); // no comment, nothing derived
});

test("nothing is sent if a verdict changed after the overall comment's plan was confirmed", async () => {
  const { ws, client, replies, sent } = await setUp("overall-3");
  await approve(ws, "sub-002");
  await enterMarking(ws, "sub-002", { overall: 58 });
  for (const c of (await loadRubric(ws)).criteria) await recordJudgement(ws, "sub-002", c.id, { levelId: "p62" });
  const approval = ((await ws.readJson("submissions/sub-002.json")) as { approval: { id: string; approved_text_sha256: string } }).approval;
  const rubric = await loadRubric(ws);
  await ws.writeJson(readingPath("sub-002"), rubric.criteria.map((c, i) => AISuggestion.parse({ id: `ai3-${i}`, submission_id: "sub-002", criterion_id: c.id, suggested_level_id: "p62", rationale: "A reason.", evidence: [], call: modelCall({ approval_id: approval.id, approved_text_sha256: approval.approved_text_sha256, rubric_version: rubric.version }), provenance: prov({ kind: "model", label: "test-model" }, "generated") })));
  await recordVerdict(ws, "sub-001", { verdict: "generous", comment: "Too high." });
  await recordVerdict(ws, "sub-002", { verdict: "agree" });
  replies.push(says("Fine."));
  const plan = await planOverallSuggestion(ws, client);
  await recordVerdict(ws, "sub-002", { verdict: "harsh", comment: "Actually too low." });
  await expect(runOverallSuggestion(ws, plan, { proxy: client })).rejects.toThrow("changed after you confirmed what would be sent");
  expect(sent).toHaveLength(0);
});

// --- Anonymisation is checked as of now (reviewed) --------------------------------------------------------------------------

test("a name added to the rules after a comment was written stops a verdict suggestion until it is recorded again", async () => {
  const { ws, client } = await setUp("anon-1");
  await planVerdictSuggestion(ws, client, "sub-001"); // fine as it is
  await updateRules(ws, { redact: { "My view": "NOTE" } }); // "My view of …" in the moderator's comments now contains something to redact
  await expect(planVerdictSuggestion(ws, client, "sub-001")).rejects.toThrow("now redact; record your judgement again");
});

test("the note on how the sample was chosen is anonymised before it is shown or sent, and so are later rules", async () => {
  const { ws, client, replies, sent } = await setUp("anon-2", { note: "Chosen after Morgan Ellis asked for it.", names: ["Morgan Ellis"] });
  await approve(ws, "sub-002");
  await enterMarking(ws, "sub-002", { overall: 58 });
  const rubric = await loadRubric(ws);
  for (const c of rubric.criteria) await recordJudgement(ws, "sub-002", c.id, { levelId: "p62" });
  const approval = ((await ws.readJson("submissions/sub-002.json")) as { approval: { id: string; approved_text_sha256: string } }).approval;
  await ws.writeJson(readingPath("sub-002"), rubric.criteria.map((c, i) => AISuggestion.parse({ id: `ai4-${i}`, submission_id: "sub-002", criterion_id: c.id, suggested_level_id: "p62", rationale: "A reason.", evidence: [], call: modelCall({ approval_id: approval.id, approved_text_sha256: approval.approved_text_sha256, rubric_version: rubric.version }), provenance: prov({ kind: "model", label: "test-model" }, "generated") })));
  await recordVerdict(ws, "sub-001", { verdict: "generous", comment: "Too high, as Quill Avery's work shows." });
  await recordVerdict(ws, "sub-002", { verdict: "agree", comment: "Fair." });
  const plan = await planOverallSuggestion(ws, client);
  expect(plan.sample).not.toContain("Morgan Ellis"); // the note, typed by the moderator, is redacted as the rules say
  expect(plan.sample).toMatch(/How the sample was chosen: Chosen after \[[A-Z_0-9]+\] asked for it\./);
  expect(plan.request.blocks[0].text).toBe(plan.sample); // shown exactly as sent
  // A rule added after the verdict comment was recorded redacts it in what is sent, and what was confirmed no longer matches.
  await updateRules(ws, { redact: { "Too high": "NOTE" } });
  replies.push(says("Fine."));
  await expect(runOverallSuggestion(ws, plan, { proxy: client })).rejects.toThrow("changed after you confirmed what would be sent");
  expect(sent).toHaveLength(0);
  const again = await planOverallSuggestion(ws, client);
  expect(again.sample).not.toContain("Too high");
});

test("a judgement that looks like it holds an identifier stops a verdict suggestion, with what was found; nothing is sent", async () => {
  const { ws, client, rubric, sent } = await setUp("verdict-id");
  await recordJudgement(ws, "sub-001", rubric.criteria[0].id, { levelId: "p62", comment: "Ring +1 555 010 0001." }); // not a number the anonymisation rules cover
  const err = await planVerdictSuggestion(ws, client, "sub-001").catch((e) => e);
  expect(err).toBeInstanceOf(IdentifiersFound);
  expect(err.matches.map((m: { where: string; value: string }) => [m.where, m.value])).toEqual([["marking", "+1 555 010 0001"]]);
  expect(sent).toHaveLength(0);
});

test("the note on how the sample was chosen is checked too, before the overall comment is planned", async () => {
  const { ws, client, sent } = await setUp("overall-id", { note: "Chosen by lot; ring +1 555 010 0001." });
  await approve(ws, "sub-002");
  await enterMarking(ws, "sub-002", { overall: 58 });
  const rubric = await loadRubric(ws);
  for (const c of rubric.criteria) await recordJudgement(ws, "sub-002", c.id, { levelId: "p62" });
  const approval = ((await ws.readJson("submissions/sub-002.json")) as { approval: { id: string; approved_text_sha256: string } }).approval;
  await ws.writeJson(readingPath("sub-002"), rubric.criteria.map((c, i) => AISuggestion.parse({ id: `ai5-${i}`, submission_id: "sub-002", criterion_id: c.id, suggested_level_id: "p62", rationale: "A reason.", evidence: [], call: modelCall({ approval_id: approval.id, approved_text_sha256: approval.approved_text_sha256, rubric_version: rubric.version }), provenance: prov({ kind: "model", label: "test-model" }, "generated") })));
  await recordVerdict(ws, "sub-001", { verdict: "generous", comment: "Too high." });
  await recordVerdict(ws, "sub-002", { verdict: "agree", comment: "Fair." });
  const err = await planOverallSuggestion(ws, client).catch((e) => e);
  expect(err).toBeInstanceOf(IdentifiersFound);
  expect(err.matches.map((m: { where: string; value: string }) => [m.where, m.value])).toEqual([["sample", "+1 555 010 0001"]]); // the rules reach it, so it isn't "the marking"
  expect(err.message).toBe("can't be sent, because it may identify someone: the sample contains a phone number. What was found is listed below, to add to the anonymisation rules");
  expect(sent).toHaveLength(0);
  // Added to the rules, it is redacted in the sample as it is planned, and the plan is made.
  await addIdentifiersToRules(ws, err.matches);
  const plan = await planOverallSuggestion(ws, client);
  expect(plan.sample).not.toContain("+1 555 010 0001");
});
