/** Recording the moderator's own judgements (#19): open review, one level per criterion. */

import { beforeEach, expect, test } from "vitest";
import {
  anonymiseWorkspace,
  chooseReviewMode,
  enterMarking,
  isHidden,
  loadReviewState,
  reveal,
  reviewStatePath,
  rubricDigest,
  staleJudgements,
  approve,
  bytesSource,
  importOriginals,
  importRubric,
  JUDGEMENTS,
  judgementPath,
  loadJudgements,
  loadReadings,
  loadRubric,
  recordJudgement,
  recordRequest,
  sha256Text,
  updateRules,
  WorkspaceError,
  type Rubric,
  type Workspace,
} from "../src/core/index.ts";
import { makeZip, packFile, suggestion } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

let ws: Workspace;
let rubric: Rubric;

beforeEach(async () => {
  ({ ws } = await newWorkspace());
  await recordRequest(ws, [{ external_id: "100200301" }, { external_id: "100200302" }]);
  await importOriginals(
    ws,
    bytesSource("o.zip", makeZip({ "100200301 - QUILL AVERY . - a.docx": packFile("submissions/sub-a.docx"), "100200302 - PIKE JORDAN - b.pdf": packFile("submissions/sub-b.pdf") })),
  );
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic" });
  await updateRules(ws, { names: ["Morgan Ellis"] });
  await anonymiseWorkspace(ws);
  await approve(ws, "sub-001");
  rubric = await loadRubric(ws);
});

const first = () => rubric.criteria[0];
const level = (n: number, c = first()) => c.levels[n].id;
const NOW = new Date("2026-09-27T10:00:00Z");

test("nothing is recorded to begin with", async () => {
  expect(await loadJudgements(ws, "sub-001")).toEqual([]);
});

test("an open judgement records its level, mode, the approved text and the moderator", async () => {
  const j = await recordJudgement(ws, "sub-001", first().id, { levelId: level(1), comment: "  Clear design.  ", now: NOW });
  expect(j).toMatchObject({
    submission_id: "sub-001",
    criterion_id: first().id,
    mode: "open",
    first: { level_id: level(1), comment: "Clear design.", comment_derived_from_ai: false, recorded_at: "2026-09-27T10:00:00Z" },
    revealed_at: null,
    revised: null,
    provenance: { transformation: "recorded", actor: { kind: "moderator" } },
  });
  const sub = (await ws.readJson("submissions/sub-001.json")) as { anonymised: { text: string } };
  expect(j.provenance.input_hashes).toEqual([sha256Text(sub.anonymised.text), rubricDigest(rubric)]);
  expect(await loadJudgements(ws, "sub-001")).toEqual([j]);
});

test("changing a judgement replaces it and keeps the previous file in the history", async () => {
  await recordJudgement(ws, "sub-001", first().id, { levelId: level(0), now: NOW });
  const second = rubric.criteria[1];
  await recordJudgement(ws, "sub-001", second.id, { levelId: level(0, second), now: NOW });
  const changed = await recordJudgement(ws, "sub-001", first().id, { levelId: level(2), comment: "", now: new Date("2026-09-27T11:00:00Z") });
  expect(changed.provenance.transformation).toBe("revised");
  expect(changed.first.comment).toBeNull();
  const now = await loadJudgements(ws, "sub-001");
  expect(now.map((j) => [j.criterion_id, j.first.level_id])).toEqual([
    [first().id, level(2)],
    [second.id, level(0, second)],
  ]);
  const history = (await ws.fs.list(`${JUDGEMENTS}/history`)).map((e) => e.name);
  expect(history).toEqual(["sub-001--20260927T110000000000.json"]);
  expect(((await ws.readJson(`${JUDGEMENTS}/history/${history[0]}`)) as unknown[]).length).toBe(2);
});

test("comments are anonymised with the submissions' tokens, and a new token is kept in the key", async () => {
  await updateRules(ws, { redact: { "zz-new-9": "USERNAME" } });
  const j = await recordJudgement(ws, "sub-001", first().id, { levelId: level(0), comment: "Morgan Ellis argues well, as zz-new-9." });
  expect(j.first.comment).not.toMatch(/Morgan|zz-new-9/);
  const token = j.first.comment!.match(/as (\[[A-Z_0-9]+\])\.$/)![1];
  const key = await ws.readKey();
  expect(key.tokens.find((t) => t.token === token)?.value).toBe("zz-new-9");
});

test.each([
  ["sub-009", () => first().id, () => level(0), "not in the sample"],
  ["sub-001", () => "no-such-criterion", () => level(0), "not a criterion of the source rubric"],
  ["sub-001", () => first().id, () => "no-such-level", "not a level of criterion"],
  ["sub-002", () => first().id, () => level(0), "has not been approved"],
])("refuses %s / a bad criterion or level / an unapproved text (%#)", async (id, criterion, levelId, message) => {
  await expect(recordJudgement(ws, id, criterion(), { levelId: levelId() })).rejects.toThrow(message);
  expect(await ws.exists(judgementPath(id))).toBe(false);
});


test.each([
  ["not a list", { nope: 1 }, "is not a valid set of judgements"],
  ["another submission's", "other", "another submission"],
  ["two of one criterion", "twice", "two judgements of criterion"],
  ["a criterion no longer in the rubric", "criterion", "is not a criterion of the source rubric"],
  ["a level no longer in the rubric", "level", "is not a level of criterion"],
])("a damaged file is reported, not ignored: %s", async (_, content, message) => {
  const j = await recordJudgement(ws, "sub-001", first().id, { levelId: level(0), now: NOW });
  const data =
    content === "other" ? [{ ...j, submission_id: "sub-002" }]
    : content === "twice" ? [j, j]
    : content === "criterion" ? [{ ...j, criterion_id: "gone" }]
    : content === "level" ? [{ ...j, first: { ...j.first, level_id: "gone" } }]
    : content;
  await ws.writeJson(judgementPath("sub-001"), data);
  await expect(loadJudgements(ws, "sub-001")).rejects.toThrow(WorkspaceError);
  await expect(loadJudgements(ws, "sub-001")).rejects.toThrow(message);
});

// --- Blind review ------------------------------------------------------------------------------

const judgeAll = async (id: string, n = 0, now = NOW) => {
  for (const c of rubric.criteria) await recordJudgement(ws, id, c.id, { levelId: c.levels[n].id, now });
};

test("the review mode is chosen once, and an open judgement chooses open", async () => {
  expect(await loadReviewState(ws, "sub-001")).toBeNull();
  await recordJudgement(ws, "sub-001", first().id, { levelId: level(0), now: NOW });
  expect(await loadReviewState(ws, "sub-001")).toMatchObject({ mode: "open", revealed_at: null });
  await expect(chooseReviewMode(ws, "sub-001", "blind")).rejects.toThrow("already being reviewed open");
  expect((await chooseReviewMode(ws, "sub-001", "open")).mode).toBe("open");
});

test("blind review can't be chosen once the marking has been confirmed or entered", async () => {
  await enterMarking(ws, "sub-001", { markerLabel: "second marker", overall: 58 });
  await expect(chooseReviewMode(ws, "sub-001", "blind")).rejects.toThrow("already been confirmed");
  expect(await ws.exists(reviewStatePath("sub-001"))).toBe(false);
});

test("blind: first judgements, the reveal once every criterion is judged, then revisions beside them", async () => {
  const state = await chooseReviewMode(ws, "sub-001", "blind", NOW);
  expect(isHidden(state)).toBe(true);
  const [a, b] = rubric.criteria;
  await recordJudgement(ws, "sub-001", a.id, { levelId: a.levels[0].id, now: NOW });
  await recordJudgement(ws, "sub-001", a.id, { levelId: a.levels[1].id, now: NOW }); // still changeable before the reveal
  await expect(reveal(ws, "sub-001")).rejects.toThrow(`still to judge: ${rubric.criteria.slice(1).map((c) => c.title).join(", ")}`);
  expect(isHidden(await loadReviewState(ws, "sub-001"))).toBe(true);

  await judgeAll("sub-001", 0, NOW);
  await recordJudgement(ws, "sub-001", a.id, { levelId: a.levels[1].id, now: NOW });
  const revealedAt = new Date("2026-09-27T12:00:00Z");
  const revealed = await reveal(ws, "sub-001", revealedAt);
  expect(revealed.revealed_at).toBe("2026-09-27T12:00:00Z");
  expect(isHidden(revealed)).toBe(false);
  const judgements = await loadJudgements(ws, "sub-001");
  expect(judgements.every((j) => j.mode === "blind" && j.revealed_at === "2026-09-27T12:00:00Z" && j.revised === null)).toBe(true);

  const revision = await recordJudgement(ws, "sub-001", b.id, { levelId: b.levels[2].id, comment: "On reflection.", now: new Date("2026-09-27T13:00:00Z") });
  expect(revision).toMatchObject({
    mode: "blind",
    first: { level_id: b.levels[0].id, recorded_at: "2026-09-27T10:00:00Z" },
    revealed_at: "2026-09-27T12:00:00Z",
    revised: { level_id: b.levels[2].id, comment: "On reflection.", recorded_at: "2026-09-27T13:00:00Z" },
    provenance: { transformation: "recorded" }, // the first judgement's provenance is kept
    revised_provenance: { transformation: "revised" }, // and the revision has its own
  });
  expect(new Date(revision.revised_provenance!.timestamp).toISOString()).toBe("2026-09-27T13:00:00.000Z");
  // The file as it was just before the revision is archived under the revision's time: b unrevised, with its first provenance.
  const archived = (await ws.readJson("judgements/history/sub-001--20260927T130000000000.json")) as { criterion_id: string; revised: unknown; revised_provenance?: unknown; provenance: { transformation: string; timestamp: string } }[];
  const before = archived.find((j) => j.criterion_id === b.id)!;
  expect([before.revised, before.revised_provenance ?? null, before.provenance.transformation]).toEqual([null, null, "recorded"]);
  expect(before.provenance).toEqual(revision.provenance);
  expect((await reveal(ws, "sub-001")).revealed_at).toBe("2026-09-27T12:00:00Z"); // revealing again changes nothing
  await expect(chooseReviewMode(ws, "sub-001", "open")).rejects.toThrow("already being reviewed blind");
});

test("a revision must come after the reveal, so a clock set back is refused", async () => {
  await chooseReviewMode(ws, "sub-001", "blind", NOW);
  await judgeAll("sub-001", 0, NOW);
  await reveal(ws, "sub-001", new Date("2026-09-27T12:00:00Z"));
  await expect(recordJudgement(ws, "sub-001", first().id, { levelId: level(1), now: NOW })).rejects.toThrow("revision must be recorded after the reveal");
});

test("only a blind review can be revealed", async () => {
  await expect(reveal(ws, "sub-001")).rejects.toThrow("isn't being reviewed blind");
});

test.each([
  ["a judgement in the other mode", "mode", "was made open, but the submission is reviewed blind"],
  ["a reveal that doesn't match", "reveal", "a judgement's reveal doesn't match"],
  ["a review record of another submission", "state", "records the review of another submission"],
  ["an open review record with a reveal", "open-revealed", "is not a valid review record"],
])("a damaged blind review is reported: %s", async (_, what, message) => {
  await chooseReviewMode(ws, "sub-001", "blind", NOW);
  const j = await recordJudgement(ws, "sub-001", first().id, { levelId: level(0), now: NOW });
  if (what === "mode") await ws.writeJson(judgementPath("sub-001"), [{ ...j, mode: "open" }]);
  if (what === "reveal") await ws.writeJson(judgementPath("sub-001"), [{ ...j, revealed_at: "2026-09-27T12:00:00Z" }]);
  if (what === "open-revealed") await ws.writeJson(reviewStatePath("sub-001"), { ...(await loadReviewState(ws, "sub-001")), mode: "open", revealed_at: "2026-09-27T12:00:00Z" });
  if (what === "state") await ws.writeJson(reviewStatePath("sub-001"), { ...(await loadReviewState(ws, "sub-001")), submission_id: "sub-002" });
  await expect(loadJudgements(ws, "sub-001")).rejects.toThrow(message);
});

test("the marking of a blind review can't be confirmed or entered before the reveal, even outside the app", async () => {
  const { confirmMarking, importMarking } = await import("../src/core/index.ts");
  await importMarking(ws, bytesSource("g.zip", makeZip({ "100200301 - QUILL AVERY - x.docx.pdf": packFile("marked-view-replica.pdf"), "100200302 - PIKE JORDAN - x.docx.pdf": packFile("marked-view-replica.pdf") })));
  await chooseReviewMode(ws, "sub-001", "blind", NOW);
  await expect(confirmMarking(ws, "sub-001")).rejects.toThrow("sub-001 is being reviewed blind: check, confirm or enter its marking after the reveal");
  await expect(enterMarking(ws, "sub-001", { markerLabel: "second marker", overall: 58 })).rejects.toThrow("being reviewed blind");
  await judgeAll("sub-001", 0, NOW);
  await reveal(ws, "sub-001", new Date("2026-09-27T12:00:00Z"));
  expect((await confirmMarking(ws, "sub-001")).confirmed_at).not.toBeNull();
  await enterMarking(ws, "sub-001", { markerLabel: "second marker", overall: 58 });
  // A review record that can't be read keeps them hidden too.
  await ws.writeJson(reviewStatePath("sub-002"), { nope: 1 });
  await expect(confirmMarking(ws, "sub-002")).rejects.toThrow("sub-002's review can't be read");
});

test("a marking record filed under the submission but recording another refuses blind review (it may have been seen)", async () => {
  await enterMarking(ws, "sub-002", { overall: 62 }); // entered, so confirmed
  const other = (await ws.readJson("marking/sub-002--marker.json")) as Record<string, unknown>;
  await ws.writeJson("marking/sub-001--marker.json", { ...other, confirmed_at: null, confirmed_by: null });
  await expect(chooseReviewMode(ws, "sub-001", "blind")).rejects.toThrow("can't be reviewed blind");
});

// --- Comments adapted from the AI draft ---------------------------------------------------------

const withDraft = async (id: string, draft: string | null = "A clear, well-justified design.") => {
  const sub = (await ws.readJson(`submissions/${id}.json`)) as { approval: { approved_text_sha256: string } };
  await ws.writeJson(`readings/${id}.json`, rubric.criteria.map((c) => suggestion(id, c.id, sub.approval.approved_text_sha256, { suggested_level_id: c.levels[0].id, draft_comment: draft })));
};

test("a comment adapted from the AI draft is marked as derived from it; without a comment, nothing is", async () => {
  await withDraft("sub-001");
  const j = await recordJudgement(ws, "sub-001", first().id, { levelId: level(0), comment: "A clear design, well justified.", derivedFromAi: true, now: NOW });
  expect(j.first).toMatchObject({ comment: "A clear design, well justified.", comment_derived_from_ai: true });
  const none = await recordJudgement(ws, "sub-001", first().id, { levelId: level(0), comment: "  ", derivedFromAi: true, now: NOW });
  expect(none.first).toMatchObject({ comment: null, comment_derived_from_ai: false });
  const own = await recordJudgement(ws, "sub-001", first().id, { levelId: level(0), comment: "My own words." });
  expect(own.first.comment_derived_from_ai).toBe(false);
});

test("a comment can't be adapted from a draft there isn't, or before a blind review's reveal", async () => {
  await expect(recordJudgement(ws, "sub-001", first().id, { levelId: level(0), comment: "x", derivedFromAi: true })).rejects.toThrow("there is no AI draft comment");
  await withDraft("sub-001", null);
  await expect(recordJudgement(ws, "sub-001", first().id, { levelId: level(0), comment: "x", derivedFromAi: true })).rejects.toThrow("there is no AI draft comment");

  await approve(ws, "sub-002");
  await withDraft("sub-002");
  await chooseReviewMode(ws, "sub-002", "blind", NOW);
  await expect(recordJudgement(ws, "sub-002", first().id, { levelId: level(0), comment: "x", derivedFromAi: true, now: NOW })).rejects.toThrow("isn't shown before the reveal");
  await judgeAll("sub-002", 0, NOW);
  await reveal(ws, "sub-002", new Date("2026-09-27T12:00:00Z"));
  const revised = await recordJudgement(ws, "sub-002", first().id, { levelId: level(1), comment: "Adapted.", derivedFromAi: true, now: new Date("2026-09-27T13:00:00Z") });
  expect([revised.first.comment_derived_from_ai, revised.revised?.comment_derived_from_ai]).toEqual([false, true]);
});

test("a comment can't be adapted from a stale reading's draft, or a blank one", async () => {
  await ws.writeJson("readings/sub-001.json", rubric.criteria.map((c) => suggestion("sub-001", c.id, sha256Text("an earlier text"), { draft_comment: "An old draft." })));
  await expect(recordJudgement(ws, "sub-001", first().id, { levelId: level(0), comment: "x", derivedFromAi: true })).rejects.toThrow("there is no AI draft comment");
  await withDraft("sub-001", "   ");
  await expect(recordJudgement(ws, "sub-001", first().id, { levelId: level(0), comment: "x", derivedFromAi: true })).rejects.toThrow("there is no AI draft comment");
});

// --- Marks within a level ---------------------------------------------------------------------------

test("a judgement records a mark within its level: the level's points unless moved, and never nearer another level", async () => {
  const c = first(); // 1ST (85), 1ST (75), 2:1 (68), 2:1 (62), …
  expect((await recordJudgement(ws, "sub-001", c.id, { levelId: level(2), now: NOW })).first.mark).toBe(68);
  expect((await recordJudgement(ws, "sub-001", c.id, { levelId: level(2), mark: 70, now: NOW })).first.mark).toBe(70);
  await expect(recordJudgement(ws, "sub-001", c.id, { levelId: level(2), mark: 72 })).rejects.toThrow("a mark of 72 is nearer 1ST (75) than 2:1 (68)");
  await expect(recordJudgement(ws, "sub-001", c.id, { levelId: level(0), mark: 101 })).rejects.toThrow("is marked out of 100, so 101 is too high");
  expect((await loadJudgements(ws, "sub-001"))[0].first.mark).toBe(70); // refused marks change nothing
});

test("a level with a mark range but no points needs a mark, within its range", async () => {
  const ranged = { ...rubric, criteria: rubric.criteria.map((c, i) => (i ? c : { ...c, levels: [{ ...c.levels[0], points: null, min_mark: 70, max_mark: 100 }, ...c.levels.slice(1)] })) };
  await ws.writeJson("rubric.json", ranged);
  await expect(recordJudgement(ws, "sub-001", first().id, { levelId: level(0), now: NOW })).rejects.toThrow("has a mark range (70 to 100) but no default points");
  await expect(recordJudgement(ws, "sub-001", first().id, { levelId: level(0), mark: 65, now: NOW })).rejects.toThrow("is outside");
  expect((await recordJudgement(ws, "sub-001", first().id, { levelId: level(0), mark: 78, now: NOW })).first.mark).toBe(78);
});

test("a recorded mark that doesn't fit its level on the rubric as it is (edited, say) is to be judged again, never counted", async () => {
  await recordJudgement(ws, "sub-001", first().id, { levelId: level(2), mark: 70, now: NOW });
  const approved = ((await ws.readJson("submissions/sub-001.json")) as { approval: { approved_text_sha256: string } }).approval.approved_text_sha256;
  expect(staleJudgements(await loadJudgements(ws, "sub-001"), approved, rubric)).toEqual([]);
  const edited = (await ws.readJson(judgementPath("sub-001"))) as { first: { mark: number } }[];
  edited[0].first.mark = 79; // nearer 1ST (75) than 2:1 (68)
  await ws.writeJson(judgementPath("sub-001"), edited);
  expect(staleJudgements(await loadJudgements(ws, "sub-001"), approved, rubric)).toEqual([first().id]);
  // Recording it again puts it right.
  await recordJudgement(ws, "sub-001", first().id, { levelId: level(2), mark: 68, now: NOW });
  expect(staleJudgements(await loadJudgements(ws, "sub-001"), approved, rubric)).toEqual([]);
});

// --- Levels taken from the AI suggestion ---------------------------------------------------------

test("a level taken from the AI suggestion is recorded as such; otherwise it is the moderator's own", async () => {
  await withDraft("sub-001"); // suggests level 0 for every criterion
  const taken = await recordJudgement(ws, "sub-001", first().id, { levelId: level(0), levelFromAi: true, now: NOW });
  const source = (await loadReadings(ws, "sub-001")).find((r) => r.criterion_id === first().id)!;
  expect(taken.first).toMatchObject({ level_id: level(0), level_from_suggestion: source.id, comment_derived_from_ai: false });
  const own = await recordJudgement(ws, "sub-001", first().id, { levelId: level(0), now: NOW });
  expect(own.first.level_from_suggestion).toBeNull();
});

test("nothing is taken from a reading the review wouldn't show: under another approval, or against another rubric version", async () => {
  const sub = (await ws.readJson("submissions/sub-001.json")) as { approval: { approved_text_sha256: string } };
  const reading = (call: object) =>
    rubric.criteria.map((c) => {
      const s = suggestion("sub-001", c.id, sub.approval.approved_text_sha256, { suggested_level_id: c.levels[0].id, draft_comment: "A draft." });
      return { ...s, call: { ...s.call, ...call } };
    });
  for (const call of [{ approval_id: "appr-another" }, { rubric_version: "0.9" }]) {
    await ws.writeJson("readings/sub-001.json", reading(call));
    await expect(recordJudgement(ws, "sub-001", first().id, { levelId: level(0), levelFromAi: true })).rejects.toThrow("doesn't suggest");
    await expect(recordJudgement(ws, "sub-001", first().id, { levelId: level(0), comment: "x", derivedFromAi: true })).rejects.toThrow("there is no AI draft comment");
  }
});

test("a level can't be recorded as from the AI unless a current reading suggests it, or before a blind review's reveal", async () => {
  await expect(recordJudgement(ws, "sub-001", first().id, { levelId: level(0), levelFromAi: true })).rejects.toThrow("doesn't suggest");
  await withDraft("sub-001");
  await expect(recordJudgement(ws, "sub-001", first().id, { levelId: level(1), levelFromAi: true })).rejects.toThrow("doesn't suggest");
  await ws.writeJson("readings/sub-001.json", rubric.criteria.map((c) => suggestion("sub-001", c.id, sha256Text("an earlier text"), { suggested_level_id: c.levels[0].id })));
  await expect(recordJudgement(ws, "sub-001", first().id, { levelId: level(0), levelFromAi: true })).rejects.toThrow("doesn't suggest");

  await approve(ws, "sub-002");
  await withDraft("sub-002");
  await chooseReviewMode(ws, "sub-002", "blind", NOW);
  await expect(recordJudgement(ws, "sub-002", first().id, { levelId: level(0), levelFromAi: true, now: NOW })).rejects.toThrow("isn't shown before the reveal");
});

// --- Judgements made against something that has since changed -----------------------------------

test("a changed source rubric makes judgements stale, and a blind reveal waits for them to be judged again", async () => {
  await chooseReviewMode(ws, "sub-001", "blind", NOW);
  await judgeAll("sub-001", 0, NOW);
  const approved = ((await ws.readJson("submissions/sub-001.json")) as { approval: { approved_text_sha256: string } }).approval.approved_text_sha256;
  expect(staleJudgements(await loadJudgements(ws, "sub-001"), approved, rubric)).toEqual([]);

  // The same rubric re-imported with different weights: the same IDs, different content, the same version label.
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic", replace: true, weights: Object.fromEntries(rubric.criteria.map((c, i) => [c.id, i === 0 ? 40 : 20])) });
  const changed = await loadRubric(ws);
  expect(changed.version).toBe(rubric.version);
  expect(rubricDigest(changed)).not.toBe(rubricDigest(rubric));
  expect(staleJudgements(await loadJudgements(ws, "sub-001"), approved, changed)).toEqual(changed.criteria.map((c) => c.id));
  await expect(reveal(ws, "sub-001", new Date("2026-09-27T12:00:00Z"))).rejects.toThrow(
    `to judge again (judged against an earlier approved text or rubric): ${changed.criteria.map((c) => c.title).join(", ")}`,
  );

  // Judged again (a first judgement can still change before the reveal), the reveal opens.
  for (const c of changed.criteria) await recordJudgement(ws, "sub-001", c.id, { levelId: c.levels[1].id, now: NOW });
  expect((await reveal(ws, "sub-001", new Date("2026-09-27T12:00:00Z"))).revealed_at).toBe("2026-09-27T12:00:00Z");
});

test("after a blind reveal, a judgement made stale by a changed rubric is brought up to date by recording a revision", async () => {
  await chooseReviewMode(ws, "sub-001", "blind", NOW);
  await judgeAll("sub-001", 0, NOW);
  await reveal(ws, "sub-001", new Date("2026-09-27T12:00:00Z"));
  const approved = ((await ws.readJson("submissions/sub-001.json")) as { approval: { approved_text_sha256: string } }).approval.approved_text_sha256;
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic", replace: true, weights: Object.fromEntries(rubric.criteria.map((c, i) => [c.id, i === 0 ? 40 : 20])) });
  const changed = await loadRubric(ws);
  expect(staleJudgements(await loadJudgements(ws, "sub-001"), approved, changed)).toHaveLength(changed.criteria.length);
  const at = new Date("2026-09-27T13:00:00Z");
  const j = await recordJudgement(ws, "sub-001", first().id, { levelId: level(1), now: at });
  expect(staleJudgements(await loadJudgements(ws, "sub-001"), approved, changed)).toEqual(changed.criteria.slice(1).map((c) => c.id));
  // The first judgement, its provenance (the earlier rubric) and the reveal are kept; the revision records what it rests on.
  expect([j.first.level_id, j.first.recorded_at, j.revised?.level_id, j.revealed_at]).toEqual([level(0), "2026-09-27T10:00:00Z", level(1), "2026-09-27T12:00:00Z"]);
  expect(j.provenance.transformation).toBe("recorded");
  expect(j.provenance.input_hashes).toContain(rubricDigest(rubric));
  expect([j.revised_provenance?.transformation, new Date(j.revised_provenance!.timestamp).getTime()]).toEqual(["revised", at.getTime()]);
  expect(j.revised_provenance?.input_hashes).toContain(rubricDigest(changed));
});

test("a judgement of an earlier approved text doesn't count towards the reveal", async () => {
  await chooseReviewMode(ws, "sub-001", "blind", NOW);
  await judgeAll("sub-001", 0, NOW);
  const judgements = (await ws.readJson(judgementPath("sub-001"))) as { provenance: { input_hashes: string[] } }[];
  judgements[0].provenance.input_hashes = [sha256Text("an earlier text"), judgements[0].provenance.input_hashes[1]];
  await ws.writeJson(judgementPath("sub-001"), judgements);
  await expect(reveal(ws, "sub-001")).rejects.toThrow(`to judge again (judged against an earlier approved text or rubric): ${first().title}`);
});
