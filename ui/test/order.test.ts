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
  keepValues,
  loadRules,
  loadSubmission,
  matchesOn,
  redactionsIn,
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
  // What was found is on the error, for the educator's own screen: exactly what, where, and that it isn't one a pattern found, so isn't offered to keep.
  const found = matchesOn(err);
  expect(found.length).toBeGreaterThan(0);
  expect(found.every((m) => m.value.toLowerCase() === IN_TEXT && m.where === "approved text" && m.field === "text" && !m.keepable && m.kind === "a value you asked to redact")).toBe(true);
  expect(found[0].before.length + found[0].after.length).toBeGreaterThan(0);
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

test("what an AI reading holds that the rules cover is listed exactly, with whose it is and where; a name is not offered to keep, an address is, and keeping it needs no new reading", async () => {
  await reviewBoth(ws, rubric);
  const readings = (await ws.readJson("readings/sub-001.json")) as { rationale: string }[];
  readings[0].rationale = "Compares well with the Contoso project; ask helpdesk@example.org.";
  await ws.writeJson("readings/sub-001.json", readings);
  await updateRules(ws, { organisations: ["Contoso"] });
  const { reasons } = await assembleRecord(ws);
  expect(reasons).toHaveLength(1);
  const [reason] = reasons;
  expect([reason.area, reason.subject]).toEqual(["reading", "sub-001 [STUDENT_A]"]);
  expect(reason.text).toMatch(/run the reading again, or keep what was found$/); // something can be kept
  expect(reason.matches!.map((m) => [m.value, m.kind, m.field, m.keepable])).toEqual([
    ["Contoso", "an organisation from the rules", "reading", false],
    ["helpdesk@example.org", "an email address", "reading", true],
  ]);
  expect(reason.matches![0].where).toMatch(/^the AI reading's reasoning on /);
  expect(reason.matches![0].before.endsWith("Compares well with the ")).toBe(true);
  // Keep the address (never the organisation, which is the educator's own rule): that part of the record is complete without reading again.
  expect(await keepValues(ws, reason.matches!)).toBe(1);
  expect(((await loadRules(ws)).ignore)).toEqual(["helpdesk@example.org"]);
  const after = (await assembleRecord(ws)).reasons;
  expect(after[0].matches!.map((m) => m.value)).toEqual(["Contoso"]);
  expect(after[0].text).toMatch(/run the reading again$/); // nothing left to keep
  expect(JSON.stringify(await ws.readJson("readings/sub-001.json"))).toContain("helpdesk@example.org"); // the reading is untouched
});

test("a student's ID and a name from the key are never offered to keep", async () => {
  const key = await ws.readKey();
  const entry = key.entries.find((e) => e.pseudonym === "[STUDENT_A]")!;
  const id = entry.external_id ?? entry.platform_id!;
  const found = await redactionsIn(ws, [["a comment", "comment", `Write to ${id} or ${entry.names[0] ?? "Quill Avery"}.`]]);
  expect(found.length).toBeGreaterThan(0);
  expect(found.some((m) => m.keepable)).toBe(false);
  expect(await keepValues(ws, found)).toBe(0);
  expect((await loadRules(ws)).ignore).toEqual([]);
});

test("a value the educator asked to redact is never offered to keep, whatever its token says or whatever pattern also finds it", async () => {
  await updateRules(ws, { redact: { "staff-code": "ID", "ops@example.org": "EMAIL", "AB1234567": "ID" } });
  const found = await redactionsIn(ws, [["a comment", "comment", "Staff-Code, ops@example.org, AB1234567 and helpdesk@example.org."]]);
  expect(found.map((m) => [m.value, m.kind, m.keepable])).toEqual([
    ["Staff-Code", "a value you asked to redact", false],
    ["ops@example.org", "a value you asked to redact", false], // an explicit rule, though a pattern finds it as well
    ["AB1234567", "a value you asked to redact", false],
    ["helpdesk@example.org", "an email address", true], // only a pattern found this
  ]);
  expect(await keepValues(ws, found)).toBe(1);
  expect((await loadRules(ws)).ignore).toEqual(["helpdesk@example.org"]); // the educator's own rules stay on
  expect(Object.keys((await loadRules(ws)).redact)).toEqual(["staff-code", "ops@example.org", "AB1234567"]);
});

test("what the proxy's identifier check would still refuse is marked, so keeping it isn't offered where text is sent", async () => {
  const found = await redactionsIn(ws, [["a comment", "comment", "Write to helpdesk@example.org or Zoë@exämple.ac.uk, or ring 07700 900123."]]);
  expect(found.map((m) => [m.value, m.keepable, m.refusedWhenSent])).toEqual([
    ["helpdesk@example.org", true, true], // an address: the check before a request refuses it however the rules are set
    ["Zoë@exämple.ac.uk", true, false], // outside the check's pattern, so keeping it does put it right
    ["07700 900123", true, true],
  ]);
});
