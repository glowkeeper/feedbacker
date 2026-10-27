/** The rubric a marked view carries, kept as shown and compared with the source rubric. All material is synthetic. */

import { expect, test } from "vitest";
import {
  bytesSource,
  compareWithEmbedded,
  EMBEDDED_RUBRIC,
  importMarking,
  importRubric,
  loadCriteriaMap,
  loadEmbeddedRubric,
  loadRubric,
  parseMarkedView,
  recordEmbeddedRubric,
  recordRequest,
  Rubric,
  type EmbeddedRubric,
} from "../src/core/index.ts";
import { makeZip, packFile } from "./builders.ts";
import { prov } from "./helpers.ts";
import { newWorkspace } from "./proxyHarness.ts";

const REPLICA = packFile("marked-view-replica.pdf");
const zip = () => bytesSource("g.zip", makeZip({ "100200302 - PIKE JORDAN - x.docx.pdf": REPLICA, "download_report.txt": "Failed file count: 0\n" }));

async function imported() {
  const { ws } = await newWorkspace();
  await recordRequest(ws, [{ external_id: "100200302" }]);
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic" });
  await importMarking(ws, zip());
  return ws;
}

/** A source rubric that says what the embedded one says, to change one thing at a time. */
const sourceLike = (e: EmbeddedRubric) =>
  Rubric.parse({
    id: "r",
    version: "1",
    title: "Same",
    criteria: e.criteria.map((c, i) => ({
      id: `c${i}`,
      title: c.name,
      weight: c.weight,
      max_points: c.max_points,
      levels: c.levels.map((l) => ({ id: `p${l.points}`, label: l.label, descriptor: "A descriptor.", points: l.points })),
    })),
    provenance: prov(),
  });
const map = { mapping: {} };

test("the rubric the marked views carry is kept as shown, beside the marking, and holds no student's mark", async () => {
  const ws = await imported();
  const e = (await loadEmbeddedRubric(ws))!;
  expect(e).toMatchObject({ max: 100, views: 1, differing: 0 });
  expect(e.criteria.map((c) => [c.name, c.weight, c.max_points, c.levels.length])).toEqual([["REQUIREMENTS", 25, 100, 8], ["IMPLEMENTATION", 25, 100, 8], ["TESTING", 25, 100, 8], ["PROFESSIONALISM", 25, 100, 8]]);
  expect(e.criteria[0].levels.slice(0, 3)).toEqual([{ label: "1ST (85)", points: 85 }, { label: "1ST (75)", points: 75 }, { label: "2:1 (68)", points: 68 }]);
  const text = JSON.stringify(await ws.readJson(EMBEDDED_RUBRIC));
  expect(text).not.toContain("59.75"); // the total printed beside the rubric's name is the student's
  expect(e.provenance.source).toContain("not the source rubric");
  // It is not among the marking records, and the source rubric is untouched.
  expect((await ws.fs.list("marking")).map((x) => x.name)).toEqual(["sub-001--marker.json"]);
  expect((await loadRubric(ws)).title).toBe("Synthetic");
});

test("each difference from the source rubric is listed in words, never corrected", async () => {
  const ws = await imported();
  const lines = compareWithEmbedded(await loadRubric(ws), (await loadEmbeddedRubric(ws))!, await loadCriteriaMap(ws));
  expect(lines).toContain("'Testing and evaluation': the level of 68 points is '2:1' in the marked views and '2:2' in the rubric.");
  expect(lines).toContain("'Requirements and design': the marked views have a level '2:2 (58)' (58 points) with no counterpart in the rubric.");
  expect(lines).toContain("'Implementation': the rubric has a level 'FAIL (20)' (20 points) with no counterpart in the marked views.");
  expect(lines).toContain("The marked views' criterion 'PROFESSIONALISM' has no counterpart in the rubric.");
  expect(lines).toContain("The rubric's criterion 'Reflection and professional practice' has no counterpart in the marked views.");
  expect((await loadRubric(ws)).criteria).toHaveLength(4); // nothing was changed
});

test("a rubric that says what the marked views say has no differences, and each slip is found", async () => {
  const ws = await imported();
  const e = (await loadEmbeddedRubric(ws))!;
  const same = sourceLike(e);
  expect(compareWithEmbedded(same, e, map)).toEqual([]);
  const changed = structuredClone(same);
  changed.criteria[0].weight = 30;
  changed.criteria[1].max_points = 80;
  changed.criteria[2].levels[0].points = 86; // a slip in the typing
  changed.criteria[2].levels[1].label = "Distinction (75)";
  const lines = compareWithEmbedded(changed, e, map);
  expect(lines).toContain("'REQUIREMENTS': the marked views give a weight of 25%, and the rubric 30%.");
  expect(lines).toContain("'IMPLEMENTATION': the marked views give a maximum of 100, and the rubric 80.");
  expect(lines).toContain("'TESTING': the marked views have a level '1ST (85)' (85 points) with no counterpart in the rubric.");
  expect(lines).toContain("'TESTING': the rubric has a level '1ST (85)' (86 points) with no counterpart in the marked views.");
  expect(lines).toContain("'TESTING': the level of 75 points is '1st' in the marked views and 'distinction' in the rubric.");
  expect(lines).toHaveLength(5);
});

test("where no marked view carries a rubric there is nothing to compare with, and an earlier record is kept", async () => {
  const { ws } = await newWorkspace();
  expect(await loadEmbeddedRubric(ws)).toBeNull();
  const bare = { ...(await parseMarkedView(REPLICA)), criteria: [] };
  expect(await recordEmbeddedRubric(ws, [{ view: bare, sha256: "0".repeat(64) }])).toBeNull();
  expect(await ws.exists(EMBEDDED_RUBRIC)).toBe(false);
});

test("views whose rubrics differ are counted, and the first's is the one kept", async () => {
  const { ws } = await newWorkspace();
  const view = await parseMarkedView(REPLICA);
  const other = structuredClone(view);
  other.criteria[0].weight = 40;
  const e = (await recordEmbeddedRubric(ws, [{ view, sha256: "1".repeat(64) }, { view: other, sha256: "2".repeat(64) }, { view, sha256: "3".repeat(64) }]))!;
  expect([e.views, e.differing, e.criteria[0].weight]).toEqual([2, 1, 25]);
  expect(compareWithEmbedded(sourceLike(e), e, map).at(-1)).toBe("1 of the marked views carried a rubric that differs from the one compared (the first view's).");
});
