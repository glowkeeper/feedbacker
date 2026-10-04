/**
 * Consistency across the cohort: the feedback guide (written, anonymised, approved, sent with every draft, and recorded
 * on each), and the cohort's feedback grouped by level with its outliers, on a synthetic cohort with deliberately
 * inconsistent feedback. Through the real proxy to a scripted fake API; nothing contacts the API.
 */

import { expect, test } from "vitest";
import { fakeAnthropic, type FakeBatches, type Reply } from "../../proxy/test/fakeAnthropic.ts";
import { loadCohortFeedback, outliersOf, similarity, type LevelGroup } from "../src/app/cohortFeedback.ts";
import {
  anonymiseWorkspace,
  approve,
  approveGuide,
  buildDraftRequest,
  bytesSource,
  currentMaterial,
  educatorMarking,
  requestKey,
  collectDraftBatch,
  importCohort,
  importRubric,
  loadDrafts,
  loadGuide,
  loadRubric,
  planDrafts,
  recordFeedback,
  recordJudgement,
  recordSubmissionMark,
  runDrafts,
  saveGuide,
  sendDraftBatch,
  updateRules,
} from "../src/core/index.ts";
import { makeZip, packFile } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

const drafts = (body: any): Reply => {
  const marking: string = body.messages[0].content.at(-1).text;
  const ids = /Draft feedback for these criteria \(by id\): (.*)/.exec(marking)![1];
  const criteria = ids === "none" ? {} : Object.fromEntries(ids.split(", ").map((id) => [id, `Feedback on ${id}. Next time, go further.`]));
  const overall = /Draft the overall summary: yes/.test(marking) ? "Overall. Next time, test more." : null;
  return { message: { model: "claude-sonnet-5", content: [{ type: "text", text: JSON.stringify({ criteria, overall }) }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } }, requestId: "req_c" };
};

/** A marking workspace of four approved synthetic submissions, every criterion of each marked 62 with an overall mark. */
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
  await updateRules(ws, { names: ["Morgan Ellis"] });
  await anonymiseWorkspace(ws);
  const ids = ["sub-001", "sub-002", "sub-003", "sub-004"];
  for (const id of ids) await approve(ws, id);
  const criteria = (await loadRubric(ws)).criteria.map((c) => c.id);
  for (const id of ids) {
    for (const c of criteria) await recordJudgement(ws, id, c, { levelId: "p62" });
    await recordSubmissionMark(ws, id, { mark: 62 });
  }
  return { ws, client: made.client, replies, sent: fake.sent, batches: fake.batches as FakeBatches, criteria, ids };
}

/** The request key a sent batch's first item was sent with. */
const record0Key = (batch: { items: { request_key: string }[] }) => batch.items[0].request_key;

const group = (label: string, texts: (string | null)[]): LevelGroup => ({ key: label, label, entries: texts.map((text, i) => ({ submissionId: `sub-00${i + 1}`, label: `sub-00${i + 1}`, mark: 62, text })) });

test("similar feedback is measured by its shared three-word runs", () => {
  expect(similarity("You set out the requirements clearly. Next time, rank them.", "You set out the requirements clearly. Next time, rank them.")).toBe(1);
  expect(similarity("You set out the requirements clearly. Next time, rank them.", "Your testing is thin. Next time, plan your tests early.")).toBeLessThan(0.3);
});

test("feedback much shorter or longer than the rest at its level is an outlier, given at least three to compare", () => {
  // Feedback of n words, each piece its own (so none is a near-duplicate of another).
  const of = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${i}`).join(" ");
  expect(outliersOf([group("2:1 (62)", [of(10, "a"), of(11, "b"), of(10, "c"), "Too short."])]).map((o) => o.message)).toEqual([
    "sub-004: much shorter than the rest at 2:1 (62) (2 words; their median is 10)",
  ]);
  expect(outliersOf([group("2:1 (62)", [of(10, "a"), of(30, "b"), of(10, "c")])]).map((o) => o.message)).toEqual(["sub-002: much longer than the rest at 2:1 (62) (30 words; their median is 10)"]);
  expect(outliersOf([group("2:1 (62)", [of(10, "a"), "Short."])])).toEqual([]); // two aren't enough for a median
  expect(outliersOf([group("2:1 (62)", [of(10, "a"), null, "Short.", null])])).toEqual([]); // nor are those not yet recorded
});

test("nearly the same feedback for two students is an outlier, at any level", () => {
  const a = "You set out the requirements clearly and justified the design. Next time, rank the requirements.";
  const b = "You set out the requirements clearly and justified the design. Next time, rank the requirements!";
  const c = "Your testing was informal and evaluation thin. Next time, write a test plan first.";
  expect(outliersOf([group("2:1", [a, c]), { ...group("2:2", [b]), entries: [{ submissionId: "sub-009", label: "sub-009", mark: 55, text: b }] }]).map((o) => o.message)).toEqual([
    "sub-001 and sub-009: nearly the same feedback; check each says what is true of that student's work",
  ]);
});

test("the cohort's feedback is grouped by level, with its outliers, from a deliberately inconsistent synthetic cohort", async () => {
  const { ws, criteria } = await setUp("cons-1");
  await recordJudgement(ws, "sub-004", criteria[0], { levelId: "p48" });
  const same = "You set out clear requirements and justified your design well against the brief. Next time, rank them.";
  await recordFeedback(ws, "sub-001", criteria[0], { text: same });
  await recordFeedback(ws, "sub-002", criteria[0], { text: same });
  await recordFeedback(ws, "sub-003", criteria[0], { text: "Fine. Next time, more." });
  const [first] = await loadCohortFeedback(ws);
  expect(first.groups.map((g) => [g.label, g.entries.map((e) => e.submissionId)])).toEqual([
    ["2:1 (62)", ["sub-001", "sub-002", "sub-003"]],
    ["3RD (48)", ["sub-004"]],
  ]);
  expect(first.outliers.map((o) => o.message)).toEqual([
    "sub-003 [STUDENT_C]: much shorter than the rest at 2:1 (62) (4 words; their median is 17)",
    "sub-001 [STUDENT_A] and sub-002 [STUDENT_B]: nearly the same feedback; check each says what is true of that student's work",
  ]);
  const overall = (await loadCohortFeedback(ws)).at(-1)!;
  expect([overall.title, overall.groups.map((g) => g.label)]).toEqual(["Overall", ["upper second (60–69)"]]);
});

test("the guide is anonymised when saved, versioned, and must be approved again after each change", async () => {
  const { ws } = await setUp("cons-2");
  const first = await saveGuide(ws, "Morgan Ellis says a 2:1 needs to hear about priorities. Next time, rank them.");
  expect([first.version, first.text.includes("Morgan"), first.approval]).toEqual([1, false, null]);
  expect((await approveGuide(ws)).approval?.approved_by.kind).toBe("educator");
  const second = await saveGuide(ws, "A 2:1 needs to hear about priorities and testing. Next time, rank them.");
  expect([second.version, second.approval]).toEqual([2, null]);
  expect((await loadGuide(ws))!.version).toBe(2);
});

test("an approved guide is sent with every draft, before the submission, and each draft records its version; an unapproved one stops the plan", async () => {
  const { ws, client, replies, sent } = await setUp("cons-3");
  await saveGuide(ws, "A 2:1 needs to hear about priorities. Next time, rank them.");
  await expect(planDrafts(ws, client, [{ submissionId: "sub-001" }], { withBrief: false })).rejects.toThrow("not been approved");
  await approveGuide(ws);
  replies.push(drafts);
  const plan = await planDrafts(ws, client, [{ submissionId: "sub-001" }], { withBrief: false });
  expect(plan.guideVersion).toBe(1);
  expect(plan.drafts[0].request.blocks.map((b) => b.kind)).toEqual(["rubric", "guide", "submission", "marking"]);
  await runDrafts(ws, plan, { proxy: client });
  expect(JSON.stringify(sent)).toContain("needs to hear about priorities");
  expect((await loadDrafts(ws, "sub-001")).every((d) => d.guide_version === 1)).toBe(true);
  // Without it, when the educator chooses.
  const without = await planDrafts(ws, client, [{ submissionId: "sub-002" }], { withBrief: false, withGuide: false });
  expect([without.guideVersion, without.drafts[0].request.blocks.map((b) => b.kind)]).toEqual([null, ["rubric", "submission", "marking"]]);
});

test("a batch across the cohort sends the same guide and prompt version for every submission", async () => {
  const { ws, client, replies, batches, ids } = await setUp("cons-4");
  await saveGuide(ws, "A 2:1 needs to hear about priorities. Next time, rank them.");
  await approveGuide(ws);
  const plan = await planDrafts(ws, client, null, { withBrief: false, batch: true, fallback: false });
  const { batch } = await sendDraftBatch(ws, plan, { proxy: client });
  expect([batch!.guide_version, batch!.prompt_version, batch!.items.map((i) => i.submission_id)]).toEqual([1, "feedback-v2", ids]);
  const guides = new Set(plan.drafts.map((d) => JSON.stringify(d.request.blocks.find((b) => b.kind === "guide"))));
  expect(guides.size).toBe(1);
  // A guide changed after sending: the batch's drafts were made with the old one, so they aren't kept.
  await saveGuide(ws, "A changed guide. Next time, rank them.");
  await approveGuide(ws);
  batches.ended = true;
  replies.push(drafts, drafts, drafts, drafts);
  const result = await collectDraftBatch(ws, client, batch!.id);
  expect(result.drafted.size).toBe(0);
  expect(result.failed.get("sub-001")).toMatch(/changed after the batch was sent/);
});

test("a batch sent with earlier instructions is still collected, rebuilt with its own instructions", async () => {
  const { ws, client, replies, batches } = await setUp("cons-5");
  const plan = await planDrafts(ws, client, [{ submissionId: "sub-001" }], { withBrief: false, withGuide: false, batch: true, fallback: false });
  const { batch } = await sendDraftBatch(ws, plan, { proxy: client });
  // As if it had been sent before feedback-v2: its record names feedback-v1, and the request key it was sent with.
  const m = await educatorMarking(ws, "sub-001");
  const v1 = buildDraftRequest({ ...(await currentMaterial(ws, false)), guide: null }, m, plan.drafts[0].targets, plan.model, "feedback-v1");
  expect(v1.prompt.version).toBe("feedback-v1");
  expect(requestKey(v1)).not.toBe(record0Key(batch!)); // so collecting it can't succeed by matching the current version
  const path = `feedback/batches/${batch!.id}.json`; // (its record is read below)
  const record = (await ws.readJson(path)) as any;
  await ws.writeJson(path, { ...record, prompt_version: "feedback-v1", items: record.items.map((i: any) => ({ ...i, request_key: requestKey(v1) })) });
  batches.ended = true;
  replies.push(drafts);
  const result = await collectDraftBatch(ws, client, batch!.id);
  expect([...result.drafted.keys()]).toEqual(["sub-001"]);
  expect((await loadDrafts(ws, "sub-001")).every((d) => d.call.prompt_version === "feedback-v1")).toBe(true);
});

test("out-of-date marks and feedback aren't compared: they are listed, with why", async () => {
  const { ws, criteria } = await setUp("cons-6");
  for (const id of ["sub-001", "sub-002", "sub-003"]) await recordFeedback(ws, id, criteria[0], { text: `Feedback for ${id}. Next time, more.` });
  await recordJudgement(ws, "sub-002", criteria[0], { levelId: "p68" }); // its feedback was given on the old mark
  const [first, , , , overall] = await loadCohortFeedback(ws);
  const level = (key: string) => first.groups.find((g) => g.key === key)!.entries.map((e) => [e.submissionId, e.text !== null]);
  expect(level("p68")).toEqual([["sub-002", false]]);
  expect(first.notCompared).toEqual(["sub-002 [STUDENT_B]: its feedback was given on other marking than there is now; check it"]);
  // Its overall mark rests on the changed mark, so it is out of date too: listed, not grouped.
  expect(overall.groups.flatMap((g) => g.entries.map((e) => e.submissionId))).not.toContain("sub-002");
  expect(overall.notCompared[0]).toMatch(/^sub-002 \[STUDENT_B\]: the overall mark is out of date/);
});
