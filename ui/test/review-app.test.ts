/** What the app shows for reviewing one submission, and the judged count in the overview. */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { loadOverview } from "../src/app/overview.ts";
import { loadReview, passageAt, passageOf, reviewChoices, whereOnPage } from "../src/app/review.ts";
import {
  anonymiseWorkspace,
  chooseReviewMode,
  approve,
  bytesSource,
  enterMarking,
  importBrief,
  importMarking,
  importOriginals,
  importRubric,
  loadJudgements,
  loadRubric,
  recordJudgement,
  readingProblems,
  recordRequest,
  reveal,
  staleJudgements,
  sha256Text,
  type Workspace,
} from "../src/core/index.ts";
import { makeZip, packFile, suggestion } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

let ws: Workspace;
let path: string;

beforeEach(async () => {
  ({ ws, path } = await newWorkspace());
  await recordRequest(ws, [{ external_id: "100200301" }, { external_id: "100200302" }]);
  await importOriginals(
    ws,
    bytesSource("o.zip", makeZip({ "100200301 - QUILL AVERY . - a.docx": packFile("submissions/sub-a.docx"), "100200302 - PIKE JORDAN - b.pdf": packFile("submissions/sub-b.pdf") })),
  );
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic" });
  await importBrief(ws, bytesSource("brief.docx", packFile("brief.docx")));
  await anonymiseWorkspace(ws);
  await approve(ws, "sub-001");
});

test("the sample is offered for review, by pseudonym", async () => {
  expect(await reviewChoices(ws)).toEqual([
    { id: "sub-001", label: "sub-001 [STUDENT_A]" },
    { id: "sub-002", label: "sub-002 [STUDENT_B]" },
  ]);
});

test("an approved submission is shown with the marking, and says what is still missing", async () => {
  await importMarking(ws, bytesSource("g.zip", makeZip({ "100200301 - QUILL AVERY - x.docx.pdf": packFile("marked-view-replica.pdf"), "100200302 - PIKE JORDAN - x.docx.pdf": packFile("marked-view-replica.pdf") })));
  await enterMarking(ws, "sub-001", { markerLabel: "second marker", overall: 58 });
  let r = await loadReview(ws, "sub-001");
  expect([r.mode, r.shown, r.markings]).toEqual([null, false, []]); // nothing is shown until the mode is chosen
  await chooseReviewMode(ws, "sub-001", "open");
  r = await loadReview(ws, "sub-001");
  expect(r.text).toContain("[STUDENT_A]");
  expect(r.text).not.toMatch(/QUILL|AVERY/i);
  expect(r.brief).toBeNull(); // imported, not approved
  expect(r.markings.map((m) => m.marker_label)).toEqual(["marker", "second marker"]);
  expect(r.notes).toEqual([
    expect.stringMatching(/^The brief isn't shown: the brief has not been approved/),
    "Not yet confirmed: the marker marking.",
    "There is no AI reading of this submission.",
  ]);
  expect(r.problems).toEqual([]);
  await approve(ws, "brief");
  expect((await loadReview(ws, "sub-001")).brief).toBeTruthy();
});

test("an unapproved submission's text isn't shown", async () => {
  const r = await loadReview(ws, "sub-002");
  expect(r.text).toBeNull();
  expect(r.problems).toEqual(["The submission can't be reviewed yet: sub-002 has not been approved by the moderator."]);
});

test("recorded judgements are shown, and counted in the overview", async () => {
  const rubric = await loadRubric(ws);
  const [a, b] = rubric.criteria;
  await recordJudgement(ws, "sub-001", a.id, { levelId: a.levels[0].id });
  let r = await loadReview(ws, "sub-001");
  expect([...r.judgements.keys()]).toEqual([a.id]);
  let [row] = (await loadOverview(ws)).submissions;
  expect([row.judged, row.judgedStep]).toEqual([1, "attention"]);
  for (const c of rubric.criteria) await recordJudgement(ws, "sub-001", c.id, { levelId: c.levels[0].id });
  [row] = (await loadOverview(ws)).submissions;
  expect([row.judged, row.judgedStep]).toEqual([rubric.criteria.length, "done"]);
  r = await loadReview(ws, "sub-001");
  expect(r.judgements.get(b.id)?.first.level_id).toBe(b.levels[0].id);
});

test("damaged judgements, readings or marking are reported with everything else still shown", async () => {
  await enterMarking(ws, "sub-001", { markerLabel: "second marker", overall: 58 });
  await chooseReviewMode(ws, "sub-001", "open");
  await import("node:fs").then(({ mkdirSync }) => {
    mkdirSync(join(path, "judgements"), { recursive: true });
    mkdirSync(join(path, "readings"), { recursive: true });
  });
  writeFileSync(join(path, "judgements", "sub-001.json"), '{"nope": 1}');
  writeFileSync(join(path, "readings", "sub-001.json"), "[{}]");
  writeFileSync(join(path, "marking", "sub-001--marker.json"), "{}");
  const r = await loadReview(ws, "sub-001");
  expect(r.text).toBeTruthy();
  expect(r.markings.map((m) => m.marker_label)).toEqual(["second marker"]);
  expect(r.problems).toEqual([
    "sub-001--marker.json: marking/sub-001--marker.json is not a valid marking record",
    "readings/sub-001.json is not a valid AI reading; run the reading again",
    "judgements/sub-001.json is not a valid set of judgements",
  ]);
  const [row] = (await loadOverview(ws)).submissions;
  expect(row.judgedStep).toBe("attention");
});

test("a review needs the rubric and a sampled submission", async () => {
  await expect(loadReview(ws, "sub-009")).rejects.toThrow("not in the sample");
  const { ws: empty } = await newWorkspace("mod-2");
  await recordRequest(empty, [{ external_id: "100200301" }]);
  await expect(loadReview(empty, "sub-001")).rejects.toThrow("import the source rubric");
});

test.each([
  [null, null, "position not known"],
  [2, null, "page 2"],
  [1, 0.1, "page 1, near the top"],
  [1, 0.5, "page 1, near the middle"],
  [3, 0.9, "page 3, near the bottom"],
])("an inline comment on page %s at %s is described as '%s'", (page, position, words) => {
  expect(whereOnPage(page, position)).toBe(words);
});

// --- Readings and judgements that no longer fit -------------------------------------------------



test("a reading of another submission, a criterion read twice, or an earlier text is reported, not shown", async () => {
  const now = sha256Text("now");
  expect(readingProblems("sub-001", [suggestion("sub-001", "a", now), suggestion("sub-001", "b", now)], now)).toEqual([]);
  expect(readingProblems("sub-001", [suggestion("sub-002", "a", now)], now)).toEqual(["readings/sub-001.json holds a reading of another submission ('sub-002'); run the reading again"]);
  expect(readingProblems("sub-001", [suggestion("sub-001", "a", now), suggestion("sub-001", "a", now)], now)).toEqual(["readings/sub-001.json reads criterion 'a' twice; run the reading again"]);
  expect(readingProblems("sub-001", [suggestion("sub-001", "a", sha256Text("before"))], now)).toEqual([
    "readings/sub-001.json is a reading of an earlier approved text of this submission; run the reading again",
  ]);

  const rubric = await loadRubric(ws);
  const sub = (await ws.readJson("submissions/sub-001.json")) as { approval: { approved_text_sha256: string } };
  await ws.writeJson("readings/sub-001.json", [suggestion("sub-002", rubric.criteria[0].id, sub.approval.approved_text_sha256)]);
  await chooseReviewMode(ws, "sub-001", "open");
  const r = await loadReview(ws, "sub-001");
  expect(r.readings.size).toBe(0);
  expect(r.problems).toEqual([
    "readings/sub-001.json holds a reading of another submission ('sub-002'); run the reading again",
    "readings/sub-001.json was read under another approval of this text; run the reading again",
  ]);
  const [row] = (await loadOverview(ws)).submissions;
  expect([row.reading, row.problem]).toEqual(["attention", r.problems[0]]);
});

test("a judgement of an earlier approved text is flagged for checking again", async () => {
  const rubric = await loadRubric(ws);
  const c = rubric.criteria[0];
  await recordJudgement(ws, "sub-001", c.id, { levelId: c.levels[0].id });
  const [j] = await loadJudgements(ws, "sub-001");
  expect(staleJudgements([j], j.provenance.input_hashes[0], rubric)).toEqual([]);
  expect(staleJudgements([j], null, rubric)).toEqual([]);
  await ws.writeJson("judgements/sub-001.json", [{ ...j, provenance: { ...j.provenance, input_hashes: [sha256Text("an earlier text")] } }]);
  const r = await loadReview(ws, "sub-001");
  expect(r.judgements.size).toBe(1);
  expect(r.problems).toEqual([`Your judgement of ${c.title} was recorded against an earlier approved text of this submission, or an earlier source rubric; check it again.`]);
  const [row] = (await loadOverview(ws)).submissions;
  expect([row.judgedStep, row.problem]).toEqual(["attention", "some judgements were recorded against an earlier approved text or source rubric; check them again"]);
});

// --- Blind review: nothing is revealed before the moderator's judgement -----------------------

test("in blind review, the marking and the AI reading aren't even loaded until the reveal", async () => {
  const { markingRecords } = await import("../src/app/markingRecords.ts");
  await importMarking(ws, bytesSource("g.zip", makeZip({ "100200301 - QUILL AVERY - x.docx.pdf": packFile("marked-view-replica.pdf"), "100200302 - PIKE JORDAN - x.docx.pdf": packFile("marked-view-replica.pdf") })));
  const rubric = await loadRubric(ws);
  const sub = (await ws.readJson("submissions/sub-001.json")) as { approval: { approved_text_sha256: string } };
  await ws.writeJson("readings/sub-001.json", rubric.criteria.map((c) => suggestion("sub-001", c.id, sub.approval.approved_text_sha256)));
  await chooseReviewMode(ws, "sub-001", "blind");

  const hidden = await loadReview(ws, "sub-001");
  expect([hidden.mode, hidden.shown, hidden.markings, hidden.readings.size]).toEqual(["blind", false, [], 0]);
  expect(hidden.text).toBeTruthy();
  expect(hidden.notes).toContain("Blind review: the original marking and the AI reading stay hidden until you have recorded a level for every criterion and reveal them.");
  expect(JSON.stringify(hidden)).not.toMatch(/marker|ai_suggestion/);
  expect((await markingRecords(ws)).map((m) => [m.submissionId, m.hidden])).toEqual([["sub-001", true], ["sub-002", false]]);
  let [row] = (await loadOverview(ws)).submissions;
  expect(row.review).toBe("blind, not yet revealed");

  for (const c of rubric.criteria) await recordJudgement(ws, "sub-001", c.id, { levelId: c.levels[0].id });
  expect((await loadReview(ws, "sub-001")).shown).toBe(false); // judging everything doesn't reveal: only the reveal does
  await reveal(ws, "sub-001");
  const shown = await loadReview(ws, "sub-001");
  expect([shown.shown, shown.markings.map((m) => m.marker_label), shown.readings.size]).toEqual([true, ["marker"], rubric.criteria.length]);
  expect((await markingRecords(ws)).every((m) => !m.hidden)).toBe(true);
  [row] = (await loadOverview(ws)).submissions;
  expect([row.review, row.judgedStep]).toEqual(["blind, revealed", "done"]);
});

test("a review record that can't be read keeps everything hidden", async () => {
  await chooseReviewMode(ws, "sub-001", "open");
  writeFileSync(join(path, "judgements", "sub-001--review.json"), "{}");
  const { markingHidden } = await import("../src/app/markingRecords.ts");
  const r = await loadReview(ws, "sub-001");
  expect([r.shown, r.problems]).toEqual([false, ["judgements/sub-001--review.json is not a valid review record"]]);
  expect(await markingHidden(ws, "sub-001")).toBe(true);
});

test.each([
  ["a damaged judgements file", '{"nope": 1}', "judgements/sub-001.json is not a valid set of judgements"],
  ["blind judgements", "blind", "judgements/sub-001.json holds blind judgements, but judgements/sub-001--review.json is missing"],
])("without a review record, %s keeps the marking hidden", async (_, content, problem) => {
  const { markingHidden } = await import("../src/app/markingRecords.ts");
  const rubric = await loadRubric(ws);
  await chooseReviewMode(ws, "sub-001", "blind");
  const j = await recordJudgement(ws, "sub-001", rubric.criteria[0].id, { levelId: rubric.criteria[0].levels[0].id });
  const { rmSync } = await import("node:fs");
  rmSync(join(path, "judgements", "sub-001--review.json"));
  writeFileSync(join(path, "judgements", "sub-001.json"), content === "blind" ? JSON.stringify([j]) : content);
  const r = await loadReview(ws, "sub-001");
  expect([r.shown, r.markings, r.problems[0]]).toEqual([false, [], problem]);
  expect(await markingHidden(ws, "sub-001")).toBe(true);
  await expect(chooseReviewMode(ws, "sub-001", "open")).rejects.toThrow(problem);
});

test("the verdict is shown with the marking, and in the overview", async () => {
  const { recordVerdict } = await import("../src/core/index.ts");
  await enterMarking(ws, "sub-001", { overall: 62 });
  await chooseReviewMode(ws, "sub-001", "open");
  expect((await loadReview(ws, "sub-001")).verdict).toBeNull();
  await recordVerdict(ws, "sub-001", { verdict: "harsh", suggestedMark: 66 });
  expect((await loadReview(ws, "sub-001")).verdict).toMatchObject({ verdict: "harsh", suggested_mark: 66 });
  const [row] = (await loadOverview(ws)).submissions;
  expect(row.verdict).toBe("harsh");
  writeFileSync(join(path, "verdicts", "sub-001.json"), "{}");
  const r = await loadReview(ws, "sub-001");
  expect([r.verdict, r.problems]).toEqual([null, ["verdicts/sub-001.json is not a valid verdict"]]);
});

test("a verdict given on marking that has since been corrected is flagged, in the review and the overview", async () => {
  const { recordVerdict } = await import("../src/core/index.ts");
  await enterMarking(ws, "sub-001", { overall: 62 });
  await chooseReviewMode(ws, "sub-001", "open");
  await recordVerdict(ws, "sub-001", { verdict: "agree" });
  let r = await loadReview(ws, "sub-001");
  expect([r.verdictStale, r.problems]).toEqual([false, []]);
  await enterMarking(ws, "sub-001", { overall: 55 }); // corrected by hand
  r = await loadReview(ws, "sub-001");
  expect(r.verdictStale).toBe(true);
  expect(r.problems).toEqual(["Your verdict was recorded against earlier marking, an earlier approved text or rubric, or other marks of yours; check it again."]);
  const [row] = (await loadOverview(ws)).submissions;
  expect([row.verdict, row.verdictStale, row.problem]).toEqual(["agree", true, "the verdict was recorded against earlier marking, an earlier approved text or rubric, or other marks of yours; check it again"]);
});

test("a verdict given before a mark changed is flagged; given again, it is current", async () => {
  const { recordJudgement, recordVerdict } = await import("../src/core/index.ts");
  await enterMarking(ws, "sub-001", { overall: 62 });
  await enterMarking(ws, "sub-001", { markerLabel: "second marker", overall: 58 });
  await chooseReviewMode(ws, "sub-001", "open");
  const rubric = await loadRubric(ws);
  await recordJudgement(ws, "sub-001", rubric.criteria[0].id, { levelId: rubric.criteria[0].levels[2].id });
  await recordVerdict(ws, "sub-001", { verdict: "generous", suggestedMark: 58 });
  expect((await loadReview(ws, "sub-001")).verdictStale).toBe(false);
  await recordJudgement(ws, "sub-001", rubric.criteria[1].id, { levelId: rubric.criteria[1].levels[0].id });
  expect((await loadReview(ws, "sub-001")).verdictStale).toBe(true);
  await recordVerdict(ws, "sub-001", { verdict: "generous", suggestedMark: 58 });
  expect((await loadReview(ws, "sub-001")).verdictStale).toBe(false);
});

test("a reading under another approval, of another rubric version, or of a criterion or level the rubric lacks is reported", async () => {
  const rubric = await loadRubric(ws);
  const [c] = rubric.criteria;
  const sha = sha256Text("now");
  const current = { approvalId: `appr-sub-001-${sha.slice(0, 12)}`, rubric };
  const ok = suggestion("sub-001", c.id, sha, { suggested_level_id: c.levels[0].id });
  expect(readingProblems("sub-001", [ok], sha, current)).toEqual([]);
  expect(readingProblems("sub-001", [ok], sha, { ...current, approvalId: "appr-sub-001-other" })).toEqual([
    "readings/sub-001.json was read under another approval of this text; run the reading again",
  ]);
  expect(readingProblems("sub-001", [{ ...ok, call: { ...ok.call, rubric_version: "0" } }], sha, current)).toEqual([
    `readings/sub-001.json was read against rubric version '0', not '${rubric.version}'; run the reading again`,
  ]);
  expect(readingProblems("sub-001", [{ ...ok, criterion_id: "gone" }], sha, current)).toEqual([
    "readings/sub-001.json reads criterion 'gone', which isn't in the source rubric; run the reading again",
  ]);
  expect(readingProblems("sub-001", [{ ...ok, suggested_level_id: "gone" }], sha, current)).toEqual([
    `readings/sub-001.json suggests level 'gone', which isn't a level of criterion '${c.id}'; run the reading again`,
  ]);
});

// --- Passages in the text ------------------------------------------------------

test("a verified quote is found by its code-point offsets, only where the text there is the quote", () => {
  const text = "Café 🌱 garden: plants swap here.";
  // Offsets count code points: the emoji is one.
  expect(passageAt(text, "garden", 7, 13)).toEqual({ before: "Café 🌱 ", match: "garden", after: ": plants swap here." });
  // Offsets in range but not the quote's: nothing is highlighted, rather than something else.
  expect(passageAt(text, "garden", 15, 21)).toBeNull();
  expect(passageAt(text, "garden", null, 4)).toBeNull();
  expect(passageAt(text, "garden", 4, 4)).toBeNull();
  expect(passageAt(text, "garden", 0, 99)).toBeNull();
});

test("a marker's anchor text is found only where it appears exactly, and only once, so nothing is guessed", () => {
  const text = "The design is clear. The tests are thin.";
  expect(passageOf(text, "  The tests are thin. ")).toEqual({ before: "The design is clear. ", match: "The tests are thin.", after: "" });
  expect(passageOf(text, "the tests are thin")).toBeNull(); // not as written
  expect(passageOf(text, "The ")).toBeNull(); // twice: which one is meant can't be known
  expect(passageOf(text, "")).toBeNull();
  expect(passageOf(text, null)).toBeNull();
});
