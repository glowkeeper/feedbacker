/** The workspace's steps (#103): their order, each one's status, and the locks on Review and Export. */

import { expect, test } from "vitest";
import type { Overview, SubmissionRow } from "../src/app/overview.ts";
import { MODERATION, moderationStates, MODERATION_STEPS, navigationFor, statusWord, stepList } from "../src/app/steps.ts";

function row(id: string, fields: Partial<SubmissionRow> = {}): SubmissionRow {
  return {
    id,
    pseudonym: `[${id}]`,
    band: null,
    original: "done",
    anonymised: "done",
    approved: "done",
    marking: "done",
    markingImported: true,
    reading: "missing",
    judged: 0,
    judgedStep: "missing",
    verdict: null,
    verdictStale: false,
    review: null,
    problem: null,
    problems: { original: null, marking: null, reading: null, review: null },
    ...fields,
  };
}

function overview(submissions: SubmissionRow[], fields: Partial<Overview> = {}): Overview {
  return {
    request: { module: null, programme: null, cohortSize: null },
    rubric: "done",
    criteria: 4,
    rubricProblem: null,
    brief: { imported: "missing", approved: "missing", problem: null },
    submissions,
    problem: null,
    ...fields,
  };
}

const notReady = { reasons: [{ text: "sub-001 [STUDENT_A]: not reviewed yet", area: "review" as const }], current: false };
const ready = { reasons: [], current: false };

test("the steps are in working order, the rubric before the submissions, with related steps grouped", () => {
  expect(stepList(MODERATION_STEPS).map((s) => s.id)).toEqual(["overview", "request", "rubric", "brief", "originals", "marking", "anonymisation", "reading", "review", "export"]);
  const groups = MODERATION_STEPS.flatMap((e) => ("group" in e ? [[e.group, e.steps.map((s) => s.label)]] : []));
  expect(groups).toEqual([
    ["Assessment", ["Rubric", "Brief"]],
    ["Submissions", ["Original files", "Original marking"]],
  ]);
});

test("in an empty workspace, Review and Export wait for the request, and nothing is started", () => {
  const states = moderationStates(overview([], { request: null, rubric: "missing", criteria: 0 }), { reasons: [{ text: "record the moderation request first", area: null }], current: false });
  expect(states.get("review")!.locked).toEqual([{ text: "Record the moderation request", goTo: "request" }]);
  expect(states.get("export")!.locked).toEqual([{ text: "Record the moderation request", goTo: "request" }]);
  expect(states.get("overview")).toMatchObject({ status: null, locked: null });
  for (const id of ["request", "rubric", "brief", "originals", "marking", "anonymisation", "reading"] as const) expect(states.get(id)).toMatchObject({ status: "missing", locked: null });
});

test("Review says what is left, each with the step where it is done", () => {
  const o = overview(
    [row("sub-001"), row("sub-002", { original: "missing", anonymised: "missing", approved: "missing", marking: "missing", markingImported: false }), row("sub-003", { approved: "missing" })],
    { rubric: "missing" },
  );
  expect(moderationStates(o, notReady).get("review")!.locked).toEqual([
    { text: "Save the source rubric", goTo: "rubric" },
    { text: "Import the original files of 1 more submission", goTo: "originals" },
    { text: "Import the original marking of 1 more submission, so that each has a marking record that loads", goTo: "marking" },
    { text: "Approve the anonymised text of 2 more submissions", goTo: "anonymisation" },
  ]);
});

test("marking imported but not confirmed doesn't lock Review, so a submission can be reviewed blind", () => {
  const states = moderationStates(overview([row("sub-001"), row("sub-002", { marking: "attention" })]), notReady);
  expect(states.get("review")!.locked).toBeNull();
  expect(states.get("marking")!.status).toBe("attention");
});

test("Export stays locked with the record's reasons until it is ready, and is done once an approval matches the workspace", () => {
  const o = overview([row("sub-001", { judgedStep: "done", judged: 4, verdict: "agree" })]);
  expect(moderationStates(o, notReady).get("export")!.locked).toEqual([{ text: "sub-001 [STUDENT_A]: not reviewed yet", goTo: "review" }]);
  expect(moderationStates(o, ready).get("export")).toMatchObject({ status: "missing", locked: null });
  expect(moderationStates(o, { reasons: [], current: true }).get("export")).toMatchObject({ status: "done", locked: null });
  expect(moderationStates(o, ready).get("review")).toMatchObject({ status: "done", locked: null });
});

test("a step locks again when the workspace changes under it", () => {
  const prepared = overview([row("sub-001"), row("sub-002")]);
  expect(moderationStates(prepared, notReady).get("review")!.locked).toBeNull();
  // Changing the rules cleared sub-002's approval.
  const changed = overview([row("sub-001"), row("sub-002", { approved: "missing" })]);
  expect(moderationStates(changed, notReady).get("review")!.locked).toEqual([{ text: "Approve the anonymised text of 1 more submission", goTo: "anonymisation" }]);
  expect(moderationStates(changed, ready).get("export")!.locked).toEqual([{ text: "Approve the anonymised text of 1 more submission", goTo: "anonymisation" }]);
});

test("statuses: done when every submission is, needing attention when some are, and the brief needs approving once imported", () => {
  const o = overview([row("sub-001", { reading: "done", judgedStep: "attention", judged: 2 }), row("sub-002", { reading: "missing", approved: "missing" })], {
    brief: { imported: "done", approved: "missing", problem: null },
  });
  const states = moderationStates(o, notReady);
  expect(states.get("originals")!.status).toBe("done");
  expect(states.get("reading")!.status).toBe("attention");
  expect(states.get("anonymisation")!.status).toBe("attention");
  expect(states.get("brief")!.status).toBe("attention");
  expect(states.get("review")!.status).toBe("attention");
  // A verdict given on earlier marking leaves the review needing attention.
  const stale = overview([row("sub-001", { judgedStep: "done", judged: 4, verdict: "agree", verdictStale: true })]);
  expect(moderationStates(stale, notReady).get("review")!.status).toBe("attention");
});

test("a marking record that doesn't load doesn't count as imported, so Review stays locked", () => {
  const states = moderationStates(overview([row("sub-001"), row("sub-002", { marking: "attention", markingImported: false, problem: "marking/sub-002--marker.json is not a valid marking record" })]), notReady);
  expect(states.get("review")!.locked).toEqual([{ text: "Import the original marking of 1 more submission, so that each has a marking record that loads", goTo: "marking" }]);
});

test("each of Export's reasons goes to the step where it is put right; one with no single place has no button", () => {
  const o = overview([row("sub-001"), row("sub-002", { marking: "attention" })]);
  const readiness = {
    reasons: [
      { text: "sub-001 [STUDENT_A]: still to judge: Implementation", area: "review" as const },
      { text: "sub-002 [STUDENT_B]: the marker marking isn't confirmed", area: "marking" as const },
      { text: "sub-002 [STUDENT_B]: your comments on its criteria contain something to redact", area: "anonymisation" as const },
      { text: "sub-002 [STUDENT_B]: the AI reading is of an earlier text", area: "reading" as const },
      { text: "the record doesn't validate: …", area: null },
    ],
    current: false,
  };
  expect(moderationStates(o, readiness).get("export")!.locked!.map((r) => r.goTo)).toEqual(["review", "marking", "anonymisation", "reading", null]);
});

test("a workspace's navigation comes from its type", () => {
  const ws = { manifest: { name: "w" } } as unknown as Parameters<typeof navigationFor>[0];
  expect(navigationFor(ws)).toBe(MODERATION);
  expect(MODERATION.label).toBe("Moderation steps");
  expect(MODERATION.entries).toBe(MODERATION_STEPS);
});

test("each step's reason gives its own problem, not another step's (#127 review)", () => {
  const broken = row("sub-001", {
    original: "attention",
    marking: "attention",
    markingImported: false,
    problem: "the original doesn't load",
    problems: { original: "the original doesn't load", marking: "the marking record doesn't load", reading: null, review: null },
  });
  const states = moderationStates(overview([broken]), notReady);
  expect(states.get("originals")!.reason).toBe("the original doesn't load");
  expect(states.get("marking")!.reason).toBe("the marking record doesn't load");
});

test("every step's status line says why, in the navigation's words (#128)", () => {
  const o = overview(
    [
      row("sub-001", { reading: "done", judgedStep: "done", judged: 4, verdict: "agree" }),
      row("sub-002", { marking: "attention", approved: "missing", anonymised: "done" }),
    ],
    { brief: { imported: "done", approved: "done", problem: null } },
  );
  const states = moderationStates(o, notReady);
  const line = (id: Parameters<typeof states.get>[0]) => `${statusWord(states.get(id))}: ${states.get(id)!.reason}`;
  expect(line("marking")).toBe("Needs attention: 2 of 2 sampled submissions imported; 1 confirmed");
  expect(line("anonymisation")).toBe("Needs attention: 2 of 3 texts approved");
  expect(line("reading")).toBe("Needs attention: 1 of 2 sampled submissions read");
  expect(states.get("review")!.reason).toBe("1 of 2 sampled submissions reviewed, with a current verdict");
  // Export: not ready, ready, then approved and current.
  expect(states.get("export")!.reason).toBe("not ready to approve yet");
  const prepared = overview([row("sub-001", { judgedStep: "done", judged: 4, verdict: "agree" })]);
  expect(moderationStates(prepared, { reasons: [], current: false }).get("export")!.reason).toBe("nothing approved yet; everything is ready for you to approve");
  expect(moderationStates(prepared, { reasons: [], current: true }).get("export")!.reason).toBe("approved, and nothing has changed since");
});
