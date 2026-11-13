/** Approving a set of anonymised texts by exception (ADR 0012): what is flagged, and the one action. Every name and ID is fictional. */

import { expect, test } from "vitest";
import {
  anonymiseWorkspace,
  approve,
  approveSet,
  bytesSource,
  capitalisedMidSentence,
  excludeAllFigures,
  farFewer,
  headingLines,
  isCited,
  lowercaseWords,
  referenceRange,
  flagTexts,
  importCohort,
  importOriginals,
  includedFigureCounts,
  loadSubmission,
  manyUnexplained,
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

/** The unflagged texts waiting, as the list shows them: by ID, with the hash of each. What the educator confirms they read. */
const unflaggedOf = async (ws: Parameters<typeof flagTexts>[0]) => Object.fromEntries((await flagTexts(ws)).filter((t) => !t.approved && !t.reasons.length).map((t) => [t.id, t.sha256]));

test("capitalised words in the middle of a sentence are found; a sentence's first word, tokens and numbers are not", () => {
  const words = capitalisedMidSentence("We used Python and Django. Then [STUDENT_A] used Flask.\nKubernetes came later; Terraform too. 1. Docker, 2) Grafana. “Redis” is fast, said Alex. ABC and iPhone and McKay.");
  expect([...words].sort()).toEqual(["alex", "django", "flask", "grafana", "python"]);
});

test("the first word of a paragraph under a heading with no full stop starts a line, so it is not a capitalised word in the middle of a sentence", () => {
  const words = capitalisedMidSentence("Method and Results\n\nResults came from Python.\n\nDiscussion\nThen Django was used. See Flask.");
  expect([...words].sort()).toEqual(["django", "flask", "python", "results"]); // "Results" in the heading is mid-line; the paragraphs' and lines' first words are not
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
  expect(JSON.stringify(flags.map((f) => f.reasons))).not.toMatch(/555|Python|Django|Kubernetes|Quill|Avery/); // a reason never says what was found
  // The words themselves are for the educator's own screen: which, how often, in how many other texts, and where.
  expect(flags[0].unexplained).toBeNull();
  const unexplained = flags[2].unexplained!;
  expect(unexplained.words.map((w) => [w.word, w.count, w.alsoIn]).sort()).toEqual([["Django", 1, 0], ["Flask", 1, 0], ["Kubernetes", 1, 0], ["Python", 1, 0], ["Terraform", 1, 0]]);
  const text = (await loadSubmission(ws, "sub-003")).anonymised!.text;
  expect(unexplained.spans.map(([from, to]) => text.slice(from, to)).sort()).toEqual(["Django", "Flask", "Kubernetes", "Python", "Terraform"]);
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
  expect(flags.map((f) => f.reasons)).toEqual([[], [], [], [], ["nothing was replaced: no student name, link, email, phone number or ID was found in it, though a submission usually names someone"], [expect.stringMatching(/^far fewer replacements than the others \(1, against \d+ typically\)$/)]]);
});

test("a set is approved only after the unflagged texts are read, the flagged ones opened, and each approval says so", async () => {
  const { ws } = await setUp("set-4");
  const sha = async (id: string) => (await loadSubmission(ws, id)).anonymised!.text_sha256;
  // Not without the confirmation.
  await expect(approveSet(ws, { opened: {}, read: null })).rejects.toThrow("confirm that you have read the texts that are not flagged");
  expect((await loadSubmission(ws, "sub-001")).approval).toBeNull();
  // Confirmed, with nothing opened: the unflagged are approved, the flagged are not, and are said.
  const first = await approveSet(ws, { opened: {}, read: await unflaggedOf(ws), now: new Date("2026-10-29T10:00:00Z") });
  expect([first.approved, first.size, first.flagged]).toEqual([["sub-001", "sub-004"], 4, 2]);
  expect(first.skipped.map((s) => [s.id, s.why])).toEqual([
    ["sub-002", "it is flagged, and its review hasn't been opened as it now is"],
    ["sub-003", "it is flagged, and its review hasn't been opened as it now is"],
  ]);
  const one = (await loadSubmission(ws, "sub-001")).approval!;
  expect(one.approved_text_sha256).toBe(await sha("sub-001")); // each approval is of its own text, by hash
  expect(one.made_in_set).toEqual({ size: 4, flagged: 2, flagged_this: false, opened_this: false, read_unflagged: true });
  expect((await loadSubmission(ws, "sub-002")).approval).toBeNull();
  // A review opened for a text as it was, not as it now is, doesn't count; one opened as it is, does.
  const second = await approveSet(ws, { opened: { "sub-002": await sha("sub-002"), "sub-003": "0".repeat(64) }, read: {}, now: new Date("2026-10-29T11:00:00Z") });
  expect([second.approved, second.size, second.flagged, second.skipped.map((s) => s.id)]).toEqual([["sub-002"], 2, 2, ["sub-003"]]);
  expect((await loadSubmission(ws, "sub-002")).approval!.made_in_set).toEqual({ size: 2, flagged: 2, flagged_this: true, opened_this: true, read_unflagged: true });
  // What was approved already is left as it was.
  expect((await loadSubmission(ws, "sub-001")).approval).toEqual(one);
  // Approving a text on its own records no set.
  expect((await approve(ws, "sub-003")).made_in_set).toBeNull();
  // Nothing waiting: nothing to do, and no confirmation to ask for.
  expect(await approveSet(ws, { opened: {}, read: null })).toEqual({ approved: [], skipped: [], size: 0, flagged: 0 });
});

test("when every waiting text is flagged there is nothing unflagged to confirm", async () => {
  const { ws } = await setUp("set-5", [["100200301", "PIKE JORDAN", "Pike Jordan wrote this. Ring +1 555 010 0001."]]);
  const sha = (await loadSubmission(ws, "sub-001")).anonymised!.text_sha256;
  const done = await approveSet(ws, { opened: { "sub-001": sha }, read: null });
  expect(done.approved).toEqual(["sub-001"]);
  expect((await loadSubmission(ws, "sub-001")).approval!.made_in_set).toEqual({ size: 1, flagged: 1, flagged_this: true, opened_this: true, read_unflagged: false });
});

test("the confirmation that the unflagged were read is of those texts as they were: one that changed since is not approved by it", async () => {
  const { ws } = await setUp("set-6");
  const read = await unflaggedOf(ws); // sub-001 and sub-004, as listed
  await updateRules(ws, { redact: { planner: "TERM" } }); // sub-001's text changes when it is anonymised again
  await anonymiseWorkspace(ws);
  const done = await approveSet(ws, { opened: {}, read });
  expect(done.approved).toEqual(["sub-004"]); // unchanged: read as it is
  expect(done.skipped.map((s) => [s.id, s.why])).toEqual([
    ["sub-001", "its text isn't the one you confirmed you had read (it was anonymised again, or wasn't listed): read it, and confirm again"],
    ["sub-002", "it is flagged, and its review hasn't been opened as it now is"],
    ["sub-003", "it is flagged, and its review hasn't been opened as it now is"],
  ]);
  expect((await loadSubmission(ws, "sub-001")).approval).toBeNull();
  // A text opened as it now is counts as looked at, whatever was confirmed.
  const sha1 = (await loadSubmission(ws, "sub-001")).anonymised!.text_sha256;
  expect((await approveSet(ws, { opened: { "sub-001": sha1 }, read })).approved).toEqual(["sub-001"]);
});

test("a submission with an included figure is flagged, since an image is sent with it and redaction can't see inside; one with its figures left out is not", async () => {
  const { ws } = await newWorkspace("set-7", { workspace_type: "marking" });
  await importCohort(ws, bytesSource("100200301 - QUILL AVERY . - report.pdf", packFile("figures/report-with-figures.pdf")));
  await anonymiseWorkspace(ws);
  expect((await flagTexts(ws))[0].reasons).toContain("3 included figures, which are sent with the text and which redaction can't see inside: open the review and look at each");
  // Not approved in a set until it has been opened, whatever else was confirmed.
  const sha = (await loadSubmission(ws, "sub-001")).anonymised!.text_sha256;
  expect((await approveSet(ws, { opened: {}, read: {} })).skipped.map((s) => s.id)).toEqual(["sub-001"]);
  expect((await approveSet(ws, { opened: { "sub-001": sha }, read: {} })).approved).toEqual(["sub-001"]);
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

// --- A cohort whose texts all name many tools: the flag is judged against the cohort -------------------------------------------------------------

/** Words that are capitalised, not names or terms Feedbacker knows, and different for each prefix: "Quaa", "Quab", … */
const termsOf = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${String.fromCharCode(97 + i)}`);
const report = (words: string[]) => `Our report is about a small system. We built it then used ${words.join(", ")} for the work. It was done.`;
const NAMES = ["OAK ELLIS", "BAY NASH", "REED HALE", "FOX MARSH", "ASH PIKE", "ELM CROSS"];

/** A workspace of the given kind with one submission per report, anonymised, none approved. */
async function cohortOf(kind: "moderation" | "marking", name: string, reports: string[], names = NAMES) {
  // Each names its author once, as a submission usually does, so no text is flagged for having no replacements at all.
  const author = (i: number) => names[i].split(" ").map((w) => w[0] + w.slice(1).toLowerCase()).join(" ");
  const files = Object.fromEntries(reports.map((text, i) => [`10020030${i + 1} - ${names[i]} . - a.docx`, docx({ body: para(`${author(i)} wrote this. ${text}`) })]));
  if (kind === "marking") {
    const { ws } = await newWorkspace(name, { workspace_type: "marking" });
    await importCohort(ws, bytesSource("c.zip", makeZip(files)));
    await anonymiseWorkspace(ws);
    return ws;
  }
  const { ws } = await newWorkspace(name);
  await recordRequest(ws, reports.map((_, i) => ({ external_id: `10020030${i + 1}` })));
  await importOriginals(ws, bytesSource("o.zip", makeZip(files)));
  await anonymiseWorkspace(ws);
  return ws;
}

test("many unexplained capitalised words are flagged only when they are far more than the other texts' typical number", () => {
  expect(manyUnexplained(2, [])).toBe(false); // fewer than three is never enough
  expect(manyUnexplained(3, [])).toBe(true); // with nothing to compare, three is
  expect(manyUnexplained(3, [0, 0])).toBe(true); // an essay cohort: as before
  expect(manyUnexplained(8, [8, 9])).toBe(false); // a cohort that names many tools: nothing stands out
  expect(manyUnexplained(20, [8, 9])).toBe(true); // far above the median, 8.5
  expect(manyUnexplained(17, [8, 9])).toBe(false); // not over twice
  expect(manyUnexplained(40, [8])).toBe(true); // one other isn't enough to compare, so the plain number applies
});

for (const kind of ["moderation", "marking"] as const) {
  test(`${kind}: a cohort of reports that each name many tools isn't all flagged, and the one that names far more is`, async () => {
    const reports = ["Qua", "Zor", "Mib", "Vex", "Pol"].map((p) => report(termsOf(p, 8)));
    reports.push(report(termsOf("Fyn", 20)));
    const ws = await cohortOf(kind, `rel-${kind}`, reports);
    const flags = await flagTexts(ws);
    expect(flags.slice(0, 5).map((f) => f.reasons)).toEqual([[], [], [], [], []]);
    expect(flags[5].reasons).toEqual(["20 different capitalised words that aren't names or terms Feedbacker knows, far more than the other texts' 8, which may be names it hasn't been told"]);
    // So the unflagged are read and approved in one action, and the flagged one is opened first.
    const read = Object.fromEntries(flags.slice(0, 5).map((f) => [f.id, f.sha256]));
    const result = await approveSet(ws, { opened: {}, read });
    expect(result.approved).toEqual(["sub-001", "sub-002", "sub-003", "sub-004", "sub-005"]);
    expect(result.skipped.map((k) => k.id)).toEqual(["sub-006"]);
  });

  test(`${kind}: a capitalised word that several texts share is a term of the cohort, not a name`, async () => {
    const ws = await cohortOf(kind, `shared-${kind}`, [report(["Python", "Django", "Flask"]), report(["Python", "Django", "Flask"]), report(["Python", "Django", "Flask"])]);
    expect((await flagTexts(ws)).map((f) => f.reasons)).toEqual([[], [], []]); // each has three, and they are the same three
    // Two texts are not enough to share a term.
    const two = await cohortOf(kind, `shared2-${kind}`, [report(["Python", "Django", "Flask"]), report(["Python", "Django", "Flask"])]);
    expect((await flagTexts(two)).map((f) => f.reasons.length)).toEqual([1, 1]);
  });

  test(`${kind}: every included figure is left out of what is sent in one action, texts approved already are left as they are, and a figure can be included again`, async () => {
    const pdf = packFile("figures/report-with-figures.pdf");
    const names = ["100200301 - QUILL AVERY . - report.pdf", "100200302 - PIKE JORDAN . - report.pdf"];
    const ws =
      kind === "marking"
        ? (await newWorkspace(`fig-${kind}`, { workspace_type: "marking" })).ws
        : (await newWorkspace(`fig-${kind}`)).ws;
    if (kind === "marking") await importCohort(ws, names.map((n) => bytesSource(n, pdf)));
    else {
      await recordRequest(ws, [{ external_id: "100200301" }, { external_id: "100200302" }]);
      await importOriginals(ws, names.map((n) => bytesSource(n, pdf)));
    }
    await anonymiseWorkspace(ws);
    expect(await includedFigureCounts(ws)).toEqual({ texts: 2, figures: 6, approvedTexts: 0 });
    expect((await flagTexts(ws)).every((f) => f.reasons.some((r) => r.includes("included figures")))).toBe(true);
    // One text is approved (opened, so that it can be); its figures are not changed behind its approval.
    await approve(ws, "sub-001");
    const done = await excludeAllFigures(ws, "Not sent to the AI");
    expect(done).toEqual({ texts: 1, figures: 3, approvedTexts: 1 });
    expect((await loadSubmission(ws, "sub-001")).approval).not.toBeNull();
    expect((await loadSubmission(ws, "sub-001")).excluded_figures).toEqual([]);
    const second = await loadSubmission(ws, "sub-002");
    expect(second.excluded_figures.map((e) => [e.placeholder, e.reason])).toEqual([["[FIGURE_1]", "Not sent to the AI"], ["[FIGURE_2]", "Not sent to the AI"], ["[FIGURE_3]", "Not sent to the AI"]]);
    const flags = await flagTexts(ws);
    expect(flags.find((f) => f.id === "sub-002")!.reasons.some((r) => r.includes("figure"))).toBe(false); // nothing more to look at
    expect(await includedFigureCounts(ws)).toEqual({ texts: 1, figures: 3, approvedTexts: 1 });
    // One can be included again from its text's review.
    await setFigureExcluded(ws, "sub-002", "[FIGURE_2]", false);
    expect((await includedFigureCounts(ws)).figures).toBe(4);
  });
}

for (const kind of ["moderation", "marking"] as const) {
  test(`${kind}: a part of a name that is also an ordinary word, used in lowercase by several texts, is not a name left behind; one used by a single text is`, async () => {
    // Students called Mark, Rose and Hope Ash, and Ellis Quinn: the first three are words, and every text uses them in lowercase.
    const words = "We will mark the rose and hope for the best.";
    const ws = await cohortOf(kind, `parts-${kind}`, [words, words, words, `${words} Thanks to ellis for the help.`], ["MARK ASH", "ROSE ASH", "HOPE ASH", "ELLIS QUINN"]);
    const flags = await flagTexts(ws);
    expect(flags.map((f) => f.reasons)).toEqual([[], [], [], ["a part of a name that Feedbacker holds is still in it, in a form that wasn't replaced"]]);
  });
}

test("the words counted are those not shared across the cohort, with how many other texts use each", async () => {
  const shared = "Python";
  const reports = [report([shared, "Zora", "Zorb", "Zorc"]), report([shared, "Mira", "Mirb", "Mirc"]), report([shared, "Zora", "Pola", "Polb"]), report(["Vexa", "Vexb", "Vexc"])];
  const ws = await cohortOf("moderation", "words-1", reports);
  const flags = await flagTexts(ws);
  // "Python" is in three texts, so it is a term of the cohort and not counted; "Zora" is in two, so it is counted, and said to be in one other.
  expect(flags[0].unexplained!.words.map((w) => [w.word, w.alsoIn]).sort()).toEqual([["Zora", 1], ["Zorb", 0], ["Zorc", 0]]);
  expect(flags[3].unexplained!.words.map((w) => w.word)).toEqual(["Vexa", "Vexb", "Vexc"]);
});

test("what the educator chooses for each unexplained word is a rule: a name or organisation is redacted, and a word that is not a name stops being flagged", async () => {
  const { ws } = await setUp("words-2");
  const before = (await flagTexts(ws))[2];
  expect(before.unexplained!.words.map((w) => w.word).sort()).toEqual(["Django", "Flask", "Kubernetes", "Python", "Terraform"]);
  expect(before.reasons.length).toBe(1);
  // Not names: three of them, so fewer than three remain unexplained and the text is no longer flagged for it. One is an organisation, so it is redacted.
  await updateRules(ws, { names: [], organisations: ["Kubernetes"], ignore: ["Python", "Django", "Flask"] });
  await anonymiseWorkspace(ws);
  const after = (await flagTexts(ws))[2];
  expect(after.unexplained!.words.map((w) => w.word)).toEqual(["Terraform"]);
  expect(after.reasons).toEqual([]);
  expect((await loadSubmission(ws, "sub-003")).anonymised!.text).not.toMatch(/Kubernetes/);
  expect((await loadSubmission(ws, "sub-003")).anonymised!.text).toMatch(/Python/); // left as it was: it is not a name
});

// --- Ordinary words and headings: the cohort's own dictionary ---------------------------------------------------------------------------------

test("the lowercase words of a text, and the lines that read as headings", () => {
  expect([...lowercaseWords("The Methodology was sound; the methodology, and a Python script. It's [STUDENT_A]'s own.")].sort()).toEqual(["and", "methodology", "own", "script", "sound", "the", "was"]);
  const text = "Literature Review\n\nThis is a sentence that is long enough to be prose, and it ends here.\n\nDr Jane Smith\n\nData collection methods and the rest of it go on for more than ten words in this line";
  expect(headingLines(text).map(([from, to]) => text.slice(from, to))).toEqual(["Literature Review", "Dr Jane Smith"]);
  const caption = "Frequency of Meeting Unwelcome Items:\n\nA sentence that is long enough to be prose, and it ends here.";
  expect(headingLines(caption).map(([from, to]) => caption.slice(from, to))).toEqual(["Frequency of Meeting Unwelcome Items:"]); // a caption ending in a colon
});

/** A marking workspace of reports given as lists of paragraphs, anonymised. */
async function reportsOf(name: string, reports: string[][]) {
  const { ws } = await newWorkspace(name, { workspace_type: "marking" });
  const files = Object.fromEntries(reports.map((paras, i) => [`10020030${i + 1} - ${NAMES[i]} . - a.docx`, docx({ body: paras.map((t) => para(t)).join("") })]));
  await importCohort(ws, bytesSource("c.zip", makeZip(files)));
  await anonymiseWorkspace(ws);
  return ws;
}

test("a capitalised word that the text uses in lowercase is an ordinary word, whether it is in a heading or not; a name never is", async () => {
  const body = "We describe the method, the data collection and the analysis, then the review, the results and the discussion of them.";
  const ws = await reportsOf("ordinary-1", [
    // Title-cased headings (their first words start the line, so the rest are counted) over a body that uses the same words in lowercase.
    ["Literature Review Method Collection Analysis Results Discussion", body],
    ["Thanks to Kowalski Zelinski Ostrowski for the help.", body],
    [body],
  ]);
  const [first, second] = await flagTexts(ws);
  expect(first.unexplained).toBeNull(); // every one is an ordinary word
  expect(first.reasons.some((r) => r.includes("capitalised"))).toBe(false);
  // Names that no text writes in lowercase are still counted, and flagged.
  expect(second.unexplained!.words.map((w) => w.word)).toEqual(["Kowalski", "Ostrowski", "Zelinski"]);
  expect(second.reasons[0]).toBe("3 different capitalised words that aren't names or terms Feedbacker knows, which may be names it hasn't been told");
});

test("in a line that reads as a heading, a word that any text uses in lowercase is ordinary; in prose it takes three texts", async () => {
  const ws = await reportsOf("ordinary-2", [
    ["Heading line Appendices Glossary Addenda", "Plain body one."],
    ["Another body, see Appendices Glossary Addenda for more."],
    ["It also mentions the appendices once, and the glossary, and the addenda."], // the only text that writes them in lowercase
  ]);
  const [first, second] = await flagTexts(ws);
  // A heading-like line: the lowercase forms are in another text, so the words are ordinary there.
  expect(first.unexplained).toBeNull();
  // The same words in a sentence: they are used in lowercase by one text only, not three, and not by this one's own prose, so they are still counted.
  expect(second.unexplained!.words.map((w) => w.word).sort()).toEqual(["Addenda", "Appendices", "Glossary"]);
});

// --- Cited authors ----------------------------------------------------------------------------------------------------------------------------

test("an author is cited when the name is followed, past other names, by a year; or is in the reference list", () => {
  const cited = (text: string, word: string) => {
    const start = text.indexOf(word);
    return isCited(text, { start, end: start + word.length }, referenceRange(text));
  };
  expect(cited("Over half reported stress (Kowalski X et al., 2024).", "Kowalski")).toBe(true);
  expect(cited("As Zelinski and Ostrowski (2020) showed.", "Zelinski")).toBe(true);
  expect(cited("As Zelinski and Ostrowski (2020) showed.", "Ostrowski")).toBe(true);
  expect(cited("This agrees (Novak, 2019; Petrova, 2018).", "Petrova")).toBe(true);
  expect(cited("Novak, A. (2019) Learning. Springer.", "Novak")).toBe(true);
  // Not cited: no year after it, or a sentence between.
  expect(cited("We thank Marek Novak for the help in 2020.", "Marek")).toBe(false);
  expect(cited("We used Kubernetes. The 2020 release was stable.", "Kubernetes")).toBe(false);
  // The reference list: from its heading to an appendix heading, or the end.
  const text = "Method\n\nSome body text.\n\nReferences\n\nNovak, A. (2019) Learning. Springer.\n\nAppendix A\n\nA table by Zelinski";
  const range = referenceRange(text)!;
  expect(text.slice(range[0], range[1])).toContain("Springer");
  expect(text.slice(range[0], range[1])).not.toContain("Zelinski");
  expect(referenceRange("No such section here.")).toBeNull();
  expect(referenceRange("1. Bibliography\n\nSmith, J. (2020) Title.")).not.toBeNull();
});

test("cited authors are shown, and not counted toward flagging a text; the same name where it isn't cited is counted", async () => {
  const ws = await reportsOf("cited-1", [
    ["As Kowalski (2020) and Zelinski and Ostrowski (2019) argued, memory matters, and so does Pavlova.", "References", "Kowalski, A. (2020) Learning. Springer.", "Zelinski, B. and Ostrowski, C. (2019) Memory. Wiley."],
    ["Thanks to Marek Novak, Ana Petrova and Kowalski for the help."],
    ["Plain text one."],
  ]);
  const [first, second] = await flagTexts(ws);
  const byWord = Object.fromEntries(first.unexplained!.words.map((w) => [w.word, w.cited]));
  expect(byWord).toEqual({ Kowalski: true, Learning: true, Ostrowski: true, Pavlova: false, Zelinski: true }); // a word that starts a sentence is not counted at all
  expect(first.unexplained!.words.map((w) => w.word)[0]).toBe("Pavlova"); // the word that counts is listed first; the cited after
  expect(first.unexplained!.citedSpans.length).toBeGreaterThan(0);
  expect(first.reasons.some((r) => r.includes("capitalised"))).toBe(false); // one that counts, under three
  // In the other text the same author is named with no year, so it counts there, with the others: four.
  expect(second.unexplained!.words.map((w) => [w.word, w.cited]).sort()).toEqual([["Ana", false], ["Kowalski", false], ["Marek", false], ["Novak", false], ["Petrova", false]]);
  expect(second.reasons[0]).toMatch(/^5 different capitalised words/);
});

test("a month or day, written out or abbreviated, is a calendar word, not a name and not a cited author: an access date reads \"14 Apr 2024\"", async () => {
  const ws = await reportsOf("calendar-1", [
    ["Some body text.", "References", "Novak, A. (2019) Learning. Available at: a web page [Accessed 14 Apr 2024] and [Accessed 3 Oct 2023], seen on Mon 5 Jun 2023."],
    ["Plain text one."],
  ]);
  const [first] = await flagTexts(ws);
  expect((first.unexplained?.words ?? []).map((w) => w.word)).toEqual(["Learning"]); // the title word only: no Apr, Oct, Mon or Jun (and "Novak" starts a line)
});

test("a numbered reference list with no heading, \"et al.\" with no year, and an author cited once, are each recognised", async () => {
  const cited = (text: string, word: string) => {
    const start = text.indexOf(word);
    return isCited(text, { start, end: start + word.length }, referenceRange(text));
  };
  // "et al." says it is a citation, with or without a year.
  expect(cited("In contrast, Thornley et al. adopt a different view.", "Thornley")).toBe(true);
  expect(cited("In contrast, Thornley and Calloway et al. adopt it.", "Thornley")).toBe(true);
  expect(cited("We then asked Thornley about it.", "Thornley")).toBe(false);
  // Numbered entries, one to a line, are a reference list even with no heading above them (IEEE style: initials first, no year after the name).
  const text = "Body text here.\n\nMore body.\n[1] A. Smith, \u201cTitle,\u201d Journal, 2020.\n[2] F. Pemberton, \u201cOnline risks,\u201d Journal, 2010.\n[3] B. Lee and C. Wu, \u201cMemory,\u201d Press, 2019.";
  const range = referenceRange(text)!;
  expect(text.slice(range[0], range[1]).startsWith("[1] A. Smith")).toBe(true);
  expect(cited(text, "Pemberton")).toBe(true);
  expect(referenceRange("Body.\n[1] One entry only.\n[2] Two.")).toBeNull(); // two lines are not a list
  // A name cited once in a text is the cited author wherever else it is named there, bare or in brackets.
  const ws = await reportsOf("cited-2", [
    ["Earlier work by Pemberton (2010) set it out, and the risks were raised again (Pemberton) later, as Thornley et al. then adopt a different view. We also thank Zelinski."],
    ["Thanks to Marek Novak and Ana Petrova and Zelinski."],
    ["Plain text."],
  ]);
  const [first] = await flagTexts(ws);
  expect(Object.fromEntries(first.unexplained!.words.map((w) => [w.word, w.cited]))).toEqual({ Thornley: true, Pemberton: true, Zelinski: false });
});

test("a reference list is found under a heading with a colon, or with no heading when its entries are author-date style", () => {
  const entries = "Aaa, A., Bbb, B., & Ccc, C. (2024). A title. Journal.\nDdd, D., & Eee, E. (2025). Another title. Press.\nFff, F. (2018). A third. Journal.";
  const titled = `Body text.\n\nReferences:\n\n${entries}`;
  const r1 = referenceRange(titled)!;
  expect(titled.slice(r1[0], r1[1]).trim().startsWith("Aaa, A.")).toBe(true);
  const untitled = `Body text here.\n\nMore body.\n\n${entries}`;
  const r2 = referenceRange(untitled)!;
  expect(untitled.slice(r2[0], r2[1]).startsWith("Aaa, A.")).toBe(true);
  expect(referenceRange("Body.\n\nAaa, A. (2024). One entry only.\nBbb, B. (2025). Two.")).toBeNull(); // two entries are not a list
  expect(referenceRange("Smith, A., said so. Then Lee, B. disagreed (see 2020).")).toBeNull(); // prose that mentions names and a year is not an entry
});

test("numbered items scattered through prose are not a reference list; a run of entries is, and only that run", async () => {
  const method = "Method\n[1] First we set it up.\n\nThen a long paragraph of prose follows, at some length, describing the work.\n[2] Second we ran it.\n\nMore prose, describing results.\n[3] Third we wrote it up.\n\nThanks to Kowalski Zelinski Ostrowski.";
  expect(referenceRange(method)).toBeNull();
  const text = "Body.\n\n[1] A. Smith, \u201cOne,\u201d 2020.\n[2] B. Lee, \u201cTwo,\u201d 2019.\n\n[3] C. Wu, \u201cThree,\u201d 2018.\n\nThanks to Kowalski Zelinski Ostrowski.";
  const range = referenceRange(text)!;
  expect(text.slice(range[0], range[1])).toBe("[1] A. Smith, \u201cOne,\u201d 2020.\n[2] B. Lee, \u201cTwo,\u201d 2019.\n\n[3] C. Wu, \u201cThree,\u201d 2018."); // the run, blank lines and all, and not the thanks after it
  // So acknowledgements under such items are still counted, and flagged.
  const ws = await reportsOf("refs-runs", [[method], ["Plain text one."], ["Plain text two."]]);
  const [first] = await flagTexts(ws);
  expect(first.unexplained!.words.filter((w) => !w.cited).map((w) => w.word).sort()).toEqual(["Kowalski", "Ostrowski", "Zelinski"]);
  expect(first.reasons.some((r) => r.includes("capitalised words"))).toBe(true);
  // The same with author-date entries.
  const entries = "Aaa, A., & Bbb, B. (2024). Title one.\nCcc, C. (2025). Title two.\n\nSome prose in between, which ends the run.\n\nDdd, D. (2018). Title three.";
  expect(referenceRange(entries)).toBeNull();
});

test("a part of a held name left capitalised in three texts is still a name left behind, not an ordinary word", async () => {
  const ws = await reportsOf("held-capitalised", [["We thank Zelda for the help."], ["Our thanks go to Zelda again."], ["Zelda also helped, so thanks to Zelda."], ["Plain text."]]);
  await updateRules(ws, { names: ["Zelda"] }); // the rule is added after anonymising: the texts still hold the name
  const flags = await flagTexts(ws);
  expect(flags.slice(0, 3).map((f) => f.reasons.some((r) => r.includes("of a name that Feedbacker holds is still in it")))).toEqual([true, true, true]);
  expect(flags[3].reasons.some((r) => r.includes("still in it"))).toBe(false);
});

test("an author cited at the start of a sentence is the cited author where the text names them again mid-sentence", async () => {
  const ws = await reportsOf("cited-start", [
    ["Pemberton (2010) studied this. We discuss Pemberton again, and Thornley (2012) agreed. We then cite Thornley and Calloway (2014) as well."],
    ["Plain text one."],
    ["Plain text two."],
  ]);
  const [first] = await flagTexts(ws);
  expect(Object.fromEntries(first.unexplained!.words.map((w) => [w.word, w.cited]))).toEqual({ Calloway: true, Pemberton: true, Thornley: true });
  expect(first.reasons.some((r) => r.includes("capitalised words"))).toBe(false); // three authors, all cited: none counts
});
