/** What the app shows for reviewing one submission (#19), and the judged count in the overview. */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { loadOverview } from "../src/app/overview.ts";
import { loadReview, readingProblems, reviewChoices, staleJudgements, whereOnPage } from "../src/app/review.ts";
import {
  AISuggestion,
  anonymiseWorkspace,
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
  recordRequest,
  sha256Text,
  type Workspace,
} from "../src/core/index.ts";
import { makeZip, packFile } from "./builders.ts";
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
  const r = await loadReview(ws, "sub-001");
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


const suggestion = (submission_id: string, criterion_id: string, approved: string) =>
  AISuggestion.parse({
    id: `ai-${submission_id}-${criterion_id}`,
    submission_id,
    criterion_id,
    call: {
      provider: "anthropic",
      model_requested: "claude-sonnet-5",
      prompt_version: "reading-v1",
      rubric_version: "1",
      approval_id: `approval-${submission_id}`,
      approved_text_sha256: approved,
      request_sha256: sha256Text("request"),
      produced_by: "live",
      timestamp: "2026-09-27T10:00:00Z",
    },
    provenance: { source: "x", transformation: "generated", actor: { kind: "model", label: "claude-sonnet-5" }, timestamp: "2026-09-27T10:00:00Z" },
  });

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
  const r = await loadReview(ws, "sub-001");
  expect(r.readings.size).toBe(0);
  expect(r.problems).toEqual(["readings/sub-001.json holds a reading of another submission ('sub-002'); run the reading again"]);
  const [row] = (await loadOverview(ws)).submissions;
  expect([row.reading, row.problem]).toEqual(["attention", r.problems[0]]);
});

test("a judgement of an earlier approved text is flagged for checking again", async () => {
  const rubric = await loadRubric(ws);
  const c = rubric.criteria[0];
  await recordJudgement(ws, "sub-001", c.id, { levelId: c.levels[0].id });
  const [j] = await loadJudgements(ws, "sub-001");
  expect(staleJudgements([j], j.provenance.input_hashes[0])).toEqual([]);
  expect(staleJudgements([j], null)).toEqual([]);
  await ws.writeJson("judgements/sub-001.json", [{ ...j, provenance: { ...j.provenance, input_hashes: [sha256Text("an earlier text")] } }]);
  const r = await loadReview(ws, "sub-001");
  expect(r.judgements.size).toBe(1);
  expect(r.problems).toEqual([`Your judgement of ${c.title} was recorded against an earlier approved text of this submission; check it again.`]);
  const [row] = (await loadOverview(ws)).submissions;
  expect([row.judgedStep, row.problem]).toEqual(["attention", "some judgements were recorded against an earlier approved text; check them again"]);
});
