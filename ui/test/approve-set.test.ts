/** Approving a set of anonymised texts by exception (ADR 0012): what is flagged, and the one action. Every name and ID is fictional. */

import { expect, test } from "vitest";
import {
  anonymiseWorkspace,
  approve,
  approveSet,
  bytesSource,
  capitalisedMidSentence,
  farFewer,
  flagTexts,
  importCohort,
  importOriginals,
  loadSubmission,
  recordRequest,
  setFigureExcluded,
  updateRules,
} from "../src/core/index.ts";
import { docx, makeZip, packFile, para } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

const STUDENTS = [
  ["100200301", "QUILL AVERY", "Quill Avery built the planner. Avery tested it with users, and Quill Avery wrote this report for the module. Quill reflected on it."],
  ["100200302", "PIKE JORDAN", "Pike Jordan built a game. Jordan tested it too, and Pike Jordan wrote this. Pike was pleased. Ring +1 555 010 0001 about it."],
  ["100200303", "MARSH RILEY", "Marsh Riley used Python with Django and Flask, then Kubernetes and Terraform for deployment. Marsh Riley wrote this. Riley tested it."],
  ["100200304", "FENN SASHA", "Fenn Sasha built a small shop. Sasha tested it, and Fenn Sasha wrote this report. Fenn enjoyed it."],
];

/** A moderation with four submissions, anonymised, none approved. */
async function setUp(name: string, students = STUDENTS) {
  const { ws, client } = await newWorkspace(name);
  await recordRequest(ws, students.map(([id]) => ({ external_id: id })));
  await importOriginals(ws, bytesSource("o.zip", makeZip(Object.fromEntries(students.map(([id, who, text]) => [`${id} - ${who} . - a.docx`, docx({ body: para(text) })])))));
  await anonymiseWorkspace(ws);
  return { ws, client };
}

/** The unflagged texts waiting, as the list shows them: by ID, with the hash of each. What the educator confirms they skimmed. */
const unflaggedOf = async (ws: Parameters<typeof flagTexts>[0]) => Object.fromEntries((await flagTexts(ws)).filter((t) => !t.approved && !t.reasons.length).map((t) => [t.id, t.sha256]));

test("capitalised words in the middle of a sentence are found; a sentence's first word, tokens and numbers are not", () => {
  const words = capitalisedMidSentence("We used Python and Django. Then [STUDENT_A] used Flask.\nKubernetes came later; Terraform too. 1. Docker, 2) Grafana. “Redis” is fast, said Alex. ABC and iPhone and McKay.");
  expect([...words].sort()).toEqual(["alex", "django", "flask", "grafana", "python"]);
});

test("what is flagged, and why, without quoting the text", async () => {
  const { ws } = await setUp("set-1");
  const flags = await flagTexts(ws);
  expect(flags.map((f) => [f.id, f.label.startsWith(f.id), f.approved, f.reasons])).toEqual([
    ["sub-001", true, false, []],
    ["sub-002", true, false, ["something that looks like an identifier is still in it: a phone number"]],
    ["sub-003", true, false, ["5 different capitalised words that aren't names or terms Feedbacker knows, which may be names it hasn't been told"]],
    ["sub-004", true, false, []],
  ]);
  expect(flags[0].replaced).toEqual({ student: 4 }); // what was replaced, by kind
  expect(JSON.stringify(flags)).not.toMatch(/555|Python|Django|Kubernetes|Quill|Avery/); // never what was found
  expect(flags.every((f) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
});

test("what a pattern can tell, what the rules and the brief explain, and what is a lowercase part of a name left behind", async () => {
  const { ws } = await setUp("set-2", [
    ["100200301", "QUILL AVERY", "Quill Avery used Python with Django and Flask. Quill Avery wrote this."],
    ["100200302", "PIKE JORDAN", "Pike Jordan wrote this report. Pike Jordan thanks pike jordan's friend, jordan, and pike."],
  ]);
  // Terms the educator has told it of are not names it hasn't been told: three or more unexplained words flag, fewer or explained ones don't.
  expect((await flagTexts(ws))[0].reasons).toEqual(["3 different capitalised words that aren't names or terms Feedbacker knows, which may be names it hasn't been told"]);
  await updateRules(ws, { organisations: ["Django Flask"] });
  await anonymiseWorkspace(ws);
  expect((await flagTexts(ws))[0].reasons).toEqual([]); // "Django" and "Flask" are known now (and replaced); "Python" alone is one word
  // The lowercase parts of a student's name are left by the replacing, which only takes a capitalised single part.
  expect((await flagTexts(ws))[1].reasons).toEqual(["2 parts of a name that Feedbacker holds is still in it, in a form that wasn't replaced"]);
  // A part the educator said to leave (a false positive, say) is not counted.
  await updateRules(ws, { ignore: ["jordan"] });
  expect((await flagTexts(ws))[1].reasons).toEqual(["a part of a name that Feedbacker holds is still in it, in a form that wasn't replaced"]);
});

test("a text with no replacements, or far fewer than the others, is flagged once there are enough texts to compare", async () => {
  const many = "Quill Avery wrote this. Avery tested it. Quill Avery thanks Avery. Quill Avery again. Avery. Quill Avery. Avery. Quill Avery.";
  const students = [
    ["100200301", "QUILL AVERY", many],
    ["100200302", "PIKE JORDAN", many.replaceAll("Quill Avery", "Pike Jordan").replaceAll("Avery", "Jordan")],
    ["100200303", "MARSH RILEY", many.replaceAll("Quill Avery", "Marsh Riley").replaceAll("Avery", "Riley")],
    ["100200304", "FENN SASHA", many.replaceAll("Quill Avery", "Fenn Sasha").replaceAll("Avery", "Sasha")],
    ["100200305", "OAK ELLIS", "This one names no one at all."],
    ["100200306", "BAY NASH", "Bay Nash wrote it, and that is all."],
  ];
  const { ws } = await setUp("set-3", students);
  const flags = await flagTexts(ws);
  expect(flags.map((f) => f.reasons)).toEqual([[], [], [], [], ["no replacements at all, though a submission usually names someone"], [expect.stringMatching(/^far fewer replacements than the others \(1, against \d+ typically\)$/)]]);
});

test("a set is approved only after the unflagged texts are skimmed, the flagged ones opened, and each approval says so", async () => {
  const { ws } = await setUp("set-4");
  const sha = async (id: string) => (await loadSubmission(ws, id)).anonymised!.text_sha256;
  // Not without the confirmation.
  await expect(approveSet(ws, { opened: {}, skimmed: null })).rejects.toThrow("confirm that you have skimmed the texts that are not flagged");
  expect((await loadSubmission(ws, "sub-001")).approval).toBeNull();
  // Confirmed, with nothing opened: the unflagged are approved, the flagged are not, and are said.
  const first = await approveSet(ws, { opened: {}, skimmed: await unflaggedOf(ws), now: new Date("2026-10-29T10:00:00Z") });
  expect([first.approved, first.size, first.flagged]).toEqual([["sub-001", "sub-004"], 4, 2]);
  expect(first.skipped.map((s) => [s.id, s.why])).toEqual([
    ["sub-002", "it is flagged, and its review hasn't been opened as it now is"],
    ["sub-003", "it is flagged, and its review hasn't been opened as it now is"],
  ]);
  const one = (await loadSubmission(ws, "sub-001")).approval!;
  expect(one.approved_text_sha256).toBe(await sha("sub-001")); // each approval is of its own text, by hash
  expect(one.made_in_set).toEqual({ size: 4, flagged: 2, flagged_this: false, opened_this: false, skimmed_unflagged: true });
  expect((await loadSubmission(ws, "sub-002")).approval).toBeNull();
  // A review opened for a text as it was, not as it now is, doesn't count; one opened as it is, does.
  const second = await approveSet(ws, { opened: { "sub-002": await sha("sub-002"), "sub-003": "0".repeat(64) }, skimmed: {}, now: new Date("2026-10-29T11:00:00Z") });
  expect([second.approved, second.size, second.flagged, second.skipped.map((s) => s.id)]).toEqual([["sub-002"], 2, 2, ["sub-003"]]);
  expect((await loadSubmission(ws, "sub-002")).approval!.made_in_set).toEqual({ size: 2, flagged: 2, flagged_this: true, opened_this: true, skimmed_unflagged: true });
  // What was approved already is left as it was.
  expect((await loadSubmission(ws, "sub-001")).approval).toEqual(one);
  // Approving a text on its own records no set.
  expect((await approve(ws, "sub-003")).made_in_set).toBeNull();
  // Nothing waiting: nothing to do, and no confirmation to ask for.
  expect(await approveSet(ws, { opened: {}, skimmed: null })).toEqual({ approved: [], skipped: [], size: 0, flagged: 0 });
});

test("when every waiting text is flagged there is nothing unflagged to confirm", async () => {
  const { ws } = await setUp("set-5", [["100200301", "PIKE JORDAN", "Pike Jordan wrote this. Ring +1 555 010 0001."]]);
  const sha = (await loadSubmission(ws, "sub-001")).anonymised!.text_sha256;
  const done = await approveSet(ws, { opened: { "sub-001": sha }, skimmed: null });
  expect(done.approved).toEqual(["sub-001"]);
  expect((await loadSubmission(ws, "sub-001")).approval!.made_in_set).toEqual({ size: 1, flagged: 1, flagged_this: true, opened_this: true, skimmed_unflagged: false });
});

test("the confirmation that the unflagged were skimmed is of those texts as they were: one that changed since is not approved by it", async () => {
  const { ws } = await setUp("set-6");
  const skimmed = await unflaggedOf(ws); // sub-001 and sub-004, as listed
  await updateRules(ws, { redact: { planner: "TERM" } }); // sub-001's text changes when it is anonymised again
  await anonymiseWorkspace(ws);
  const done = await approveSet(ws, { opened: {}, skimmed });
  expect(done.approved).toEqual(["sub-004"]); // unchanged: skimmed as it is
  expect(done.skipped.map((s) => [s.id, s.why])).toEqual([
    ["sub-001", "its text isn't the one you confirmed you had skimmed (it was anonymised again, or wasn't listed): skim it, and confirm again"],
    ["sub-002", "it is flagged, and its review hasn't been opened as it now is"],
    ["sub-003", "it is flagged, and its review hasn't been opened as it now is"],
  ]);
  expect((await loadSubmission(ws, "sub-001")).approval).toBeNull();
  // A text opened as it now is counts as looked at, whatever was confirmed.
  const sha1 = (await loadSubmission(ws, "sub-001")).anonymised!.text_sha256;
  expect((await approveSet(ws, { opened: { "sub-001": sha1 }, skimmed })).approved).toEqual(["sub-001"]);
});

test("a submission with an included figure is flagged, since an image is sent with it and redaction can't see inside; one with its figures left out is not", async () => {
  const { ws } = await newWorkspace("set-7", { workspace_type: "marking" });
  await importCohort(ws, bytesSource("100200301 - QUILL AVERY . - report.pdf", packFile("figures/report-with-figures.pdf")));
  await anonymiseWorkspace(ws);
  expect((await flagTexts(ws))[0].reasons).toContain("3 included figures, which are sent with the text and which redaction can't see inside: open the review and look at each");
  // Not approved in a set until it has been opened, whatever else was confirmed.
  const sha = (await loadSubmission(ws, "sub-001")).anonymised!.text_sha256;
  expect((await approveSet(ws, { opened: {}, skimmed: {} })).skipped.map((s) => s.id)).toEqual(["sub-001"]);
  expect((await approveSet(ws, { opened: { "sub-001": sha }, skimmed: {} })).approved).toEqual(["sub-001"]);
  // With every figure left out (so none is sent), there is nothing more to look at.
  const { ws: other } = await newWorkspace("set-8", { workspace_type: "marking" });
  await importCohort(other, bytesSource("100200301 - QUILL AVERY . - report.pdf", packFile("figures/report-with-figures.pdf")));
  await anonymiseWorkspace(other);
  for (const p of ["[FIGURE_1]", "[FIGURE_2]", "[FIGURE_3]"]) await setFigureExcluded(other, "sub-001", p, true, "Shows a colleague");
  expect((await flagTexts(other))[0].reasons.some((r) => r.includes("included figure"))).toBe(false);
});

test("far fewer replacements is judged against the others, and only with two others to compare", async () => {
  expect(farFewer(1, [4, 8])).toBe(true); // the one among [1, 4, 8]: under a quarter of the others' median, 6
  expect(farFewer(4, [1, 8])).toBe(false); // against 4.5
  expect(farFewer(8, [1, 4])).toBe(false);
  expect(farFewer(0, [0, 0])).toBe(true); // none, with two others
  expect(farFewer(0, [3])).toBe(false); // one other is not enough to compare: a small set of already anonymous texts isn't all flagged
  expect(farFewer(0, [])).toBe(false);
  expect(farFewer(2, [7, 7])).toBe(false); // the median is under four: too few to say
  const { ws } = await setUp("set-9", [["100200301", "OAK ELLIS", "This one names no one at all."], ["100200302", "BAY NASH", "Nor does this one."]]);
  expect((await flagTexts(ws)).map((f) => f.reasons)).toEqual([[], []]);
});
