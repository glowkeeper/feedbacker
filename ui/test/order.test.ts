/**
 * Anonymisation is complete whatever the order of steps: a name the key
 * learns, or a rule added, after text was anonymised is caught before sending,
 * applied by "Anonymise now", and checked before the record is approved or
 * exported. Messages name the text, never the value found.
 */

import { beforeEach, expect, test } from "vitest";
import {
  anonymiseAll,
  approve,
  approveRecord,
  assembleRecord,
  currentApprovedRecord,
  loadSubmission,
  planReadings,
  RecordNotReady,
  requireApproved,
  updateRules,
  UnapprovedText,
  type ProxyHealth,
  type Rubric,
  type Workspace,
} from "../src/core/index.ts";
import { briefProblem } from "../src/app/readingPlan.ts";
import { at, reviewBoth, setUpModeration } from "./moderation.ts";

let ws: Workspace;
let rubric: Rubric;
// Words in the synthetic material, made "identifying" late: one in sub-001's text, one in the marker's comment.
const IN_TEXT = "risky";
const IN_COMMENT = "timetable";
const NAME_IN_TEXT = "Plant Swap"; // capitalised, as a name is matched
const proxy = {
  health: async (): Promise<ProxyHealth> => ({
    key_configured: true,
    provider: "anthropic",
    prices: { "claude-sonnet-5": { input: 2, output: 10 }, "claude-opus-5": { input: 5, output: 25 } },
  }),
} as unknown as Parameters<typeof planReadings>[1];

beforeEach(async () => {
  ({ ws, rubric } = await setUpModeration("mod-order"));
  const text = (await loadSubmission(ws, "sub-001")).anonymised!.text;
  expect(text).toMatch(new RegExp(`\\b${IN_TEXT}\\b`, "i"));
  const marking = (await ws.readJson("marking/sub-001--marker.json")) as { overall_comment: string };
  expect(marking.overall_comment).toMatch(new RegExp(`\\b${IN_TEXT}\\b|\\b${IN_COMMENT}\\b`, "i"));
});

const approvedText = async (id: string) => (await loadSubmission(ws, id)).anonymised!.text;

test("a rule added after approval: nothing of that text is sent, and the message never gives the value", async () => {
  await updateRules(ws, { redact: { [IN_TEXT]: "TERM" } });
  const err = await requireApproved(ws, "sub-001", await approvedText("sub-001")).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(UnapprovedText);
  expect((err as Error).message).toBe(
    "sub-001: its approved text contains something the anonymisation rules or pseudonym key now redact; anonymise it again and approve it (nothing of it is sent until then)",
  );
  expect((err as Error).message).not.toMatch(new RegExp(IN_TEXT, "i"));
  // The plan leaves it out, with that reason; sub-002 (unaffected) is still planned.
  const plan = await planReadings(ws, proxy, null, { withBrief: false, replace: true });
  expect(plan.readings.map((r) => r.submissionId)).toEqual(["sub-002"]);
  expect(plan.skipped.get("sub-001")).toMatch(/now redact; anonymise it again and approve it/);
  // "Anonymise now" redacts it, which clears that text's approval; approving again makes it sendable.
  const result = await anonymiseAll(ws);
  expect([result.approvalKept["sub-001"], result.approvalKept["sub-002"]]).toEqual([false, true]);
  await approve(ws, "sub-001");
  await expect(requireApproved(ws, "sub-001", await approvedText("sub-001"))).resolves.toBeTruthy();
});

test("a name the key learns after approval (as a later marking import can) is caught the same way", async () => {
  const key = await ws.readKey();
  expect(await approvedText("sub-001")).toContain(NAME_IN_TEXT);
  await ws.writeKey({ ...key, entries: key.entries.map((e) => (e.submission_id === "sub-001" ? { ...e, names: [...e.names, NAME_IN_TEXT] } : e)) });
  await expect(requireApproved(ws, "sub-001", await approvedText("sub-001"))).rejects.toThrow("now redact");
  expect((await anonymiseAll(ws)).approvalKept["sub-001"]).toBe(false);
});

test("the brief is checked before sending too", async () => {
  const brief = ((await ws.readJson("brief.json")) as { anonymised: { text: string } }).anonymised.text;
  const word = brief.match(/\b[a-z]{7,}\b/)![0]; // any word of the brief, made identifying late
  expect(await briefProblem(ws)).toBeNull();
  await updateRules(ws, { redact: { [word]: "TERM" } });
  expect(await briefProblem(ws)).toMatch(/^the brief: its approved text contains something the anonymisation rules or pseudonym key now redact/);
  await expect(planReadings(ws, proxy)).rejects.toThrow("the brief: its approved text contains something");
});

test("stored comments: the record isn't ready until Anonymise now brings them up to the rules, which it notes", async () => {
  await reviewBoth(ws, rubric);
  expect((await assembleRecord(ws)).problems).toEqual([]);
  await updateRules(ws, { redact: { [IN_COMMENT]: "TERM" } });
  const { problems } = await assembleRecord(ws);
  expect(problems).toContain("sub-001 [STUDENT_A]: the marker's comments contain something the anonymisation rules or pseudonym key now redact; press Anonymise now");
  expect(problems.join(" ")).not.toMatch(new RegExp(IN_COMMENT, "i"));

  const result = await anonymiseAll(ws, { now: at(30) });
  expect(result.commentsUpdated).toEqual(expect.arrayContaining(["marking/sub-001--marker.json", "marking/sub-002--marker.json"]));
  const marking = (await ws.readJson("marking/sub-001--marker.json")) as { overall_comment: string; import_notes: string[] };
  expect(marking.overall_comment).not.toMatch(new RegExp(IN_COMMENT, "i"));
  expect(marking.import_notes.at(-1)).toBe("comments anonymised again on 2026-09-27, after the anonymisation rules or pseudonym key changed");
  expect((await assembleRecord(ws)).problems.filter((p) => p.includes("comments contain"))).toEqual([]);
  // Running it again changes nothing more.
  expect((await anonymiseAll(ws)).commentsUpdated).toEqual([]);
});

test("the moderator's own comments are brought up to the rules too", async () => {
  await reviewBoth(ws, rubric);
  await updateRules(ws, { redact: { "a little generous": "TERM" } }); // the verdict's comment, in the fixture moderation
  expect((await assembleRecord(ws)).problems).toContain(
    "sub-001 [STUDENT_A]: your comment on its marking contains something the anonymisation rules or pseudonym key now redact; press Anonymise now",
  );
  const result = await anonymiseAll(ws);
  expect(result.commentsUpdated).toContain("verdicts/sub-001.json");
});

test("an approved overall comment that the rules now redact needs the record approving again", async () => {
  await reviewBoth(ws, rubric);
  await approveRecord(ws, { overallComment: "The timetable criterion was well handled.", now: at(20) });
  await expect(currentApprovedRecord(ws)).resolves.toBeTruthy();
  await updateRules(ws, { redact: { [IN_COMMENT]: "TERM" } });
  await anonymiseAll(ws); // the stored comments are fixed, but the approved record's overall comment is as approved
  const err = await currentApprovedRecord(ws).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(RecordNotReady);
});

test("an inline comment's anchor text is brought up to the rules and checked, like its text", async () => {
  await reviewBoth(ws, rubric);
  // The import never fills anchor text yet; a record that has it is still covered.
  const path = "marking/sub-001--marker.json";
  const record = (await ws.readJson(path)) as { annotations: { anchor_text: string | null }[] };
  record.annotations[0].anchor_text = "the Northwind integration";
  await ws.writeJson(path, record);
  await updateRules(ws, { organisations: ["Northwind"] });
  expect((await assembleRecord(ws)).problems).toContain(
    "sub-001 [STUDENT_A]: the marker's comments contain something the anonymisation rules or pseudonym key now redact; press Anonymise now",
  );
  await anonymiseAll(ws);
  const fixed = (await ws.readJson(path)) as { annotations: { anchor_text: string | null }[] };
  expect(fixed.annotations[0].anchor_text).toMatch(/^the \[ORG_\d+\] integration$/);
});

test("an AI reading whose words the rules now cover keeps the record from being ready (it is never rewritten)", async () => {
  await reviewBoth(ws, rubric);
  const readings = (await ws.readJson("readings/sub-001.json")) as { rationale: string }[];
  readings[0].rationale = "Compares well with the Contoso project.";
  await ws.writeJson("readings/sub-001.json", readings);
  expect((await assembleRecord(ws)).problems).toEqual([]);
  await updateRules(ws, { organisations: ["Contoso"] });
  expect((await assembleRecord(ws)).problems).toEqual([
    "sub-001 [STUDENT_A]: its AI reading contains something the anonymisation rules or pseudonym key now redact; run the reading again",
  ]);
  await anonymiseAll(ws);
  expect(((await ws.readJson("readings/sub-001.json")) as { rationale: string }[])[0].rationale).toContain("Contoso"); // as the model wrote it
});
