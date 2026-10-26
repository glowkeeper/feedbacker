/**
 * A rubric entered from an image of it. Everything here is fictional: the rubric, its criteria and its image.
 */

import { expect, test } from "vitest";
import { bytesSource, enterRubricFromImage, gridFlags, importRubric, loadRubric, rangeOfLabel, RubricError, rubricImagePath, sha256Bytes, WorkspaceError, type RubricGrid } from "../src/core/index.ts";
import { packFile } from "./builders.ts";
import { describeBetween } from "../src/core/index.ts";
import { DEFAULT_PATTERN, labelsFromPattern } from "../src/app/rubricPattern.ts";
import { newWorkspace } from "./proxyHarness.ts";

const IMAGE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]); // stands in for a screenshot: it is only kept, never read
const START = [80, 50, 30, 0]; // each level starts at this percentage of the criterion's points
const NAMES = ["Strong", "Sound", "Weak", "Absent"];

/** A regular fictional rubric: a criterion per weight, four levels, each a fixed percentage band of the criterion's points. */
function grid(weights: number[]): RubricGrid {
  return {
    title: "Fictional rubric",
    criteria: weights.map((w, c) => ({
      title: `Criterion ${c + 1}`,
      weight: `${w}%`,
      max_points: String(w),
      levels: START.map((p, i) => {
        const low = (w * p) / 100;
        const high = i === 0 ? w : (w * START[i - 1]) / 100 - 0.1;
        return { label: `${NAMES[i]} (${low}-${Math.round(high * 100) / 100})`, points: String(Math.round(((low + high) / 2) * 10) / 10), descriptor: `${NAMES[i]} work for criterion ${c + 1}.` };
      }),
    })),
  };
}

test("a level's range is read from its label, as written", () => {
  expect(rangeOfLabel("Excellent (16-20)")).toEqual({ low: 16, high: 20 });
  expect(rangeOfLabel("Good (12- 13.8)")).toEqual({ low: 12, high: 13.8 });
  expect(rangeOfLabel("2:1 (68)")).toBeNull();
  expect(rangeOfLabel("Fail")).toBeNull();
});

test("a regular grid has nothing flagged", () => {
  expect(gridFlags(grid([20, 50, 20, 10]))).toEqual([]);
});

test("what departs from the pattern is flagged in words, and nothing is corrected", () => {
  const g = grid([20, 50, 20, 10]);
  g.criteria[0].weight = "25%"; // the weights now add to 105
  g.criteria[1].levels.pop(); // one criterion with fewer levels
  g.criteria[2].levels[1].points = "5"; // outside its range, and not fewer than the level below it
  g.criteria[3].levels[2].label = "Weak (2.5-4.9)"; // starts at 25% of 10, where the others start at 30%
  g.criteria[0].levels[1].label = "Sound (10-16.5)"; // runs into the level above it, which starts at 16
  const flags = gridFlags(g);
  expect(flags).toContain("The weights add up to 105, not 100.");
  expect(flags).toContain("Criterion 2 has 3 levels; the others mostly have 4.");
  expect(flags.some((f) => f.startsWith("Criterion 3, Sound (10-15.9): 5 points is outside its range"))).toBe(true);
  expect(flags.some((f) => f.startsWith("Criterion 4, Weak (2.5-4.9): it starts at 25% of the criterion's points; the same level of the other criteria starts at 30%"))).toBe(true);
  expect(flags.some((f) => f.includes("overlaps"))).toBe(true);
  // The grid itself is as typed.
  expect(g.criteria[3].levels[2].label).toBe("Weak (2.5-4.9)");
});

test("a pattern is judged only where several criteria give a range", () => {
  const two = grid([50, 50]);
  two.criteria[1].levels[1].label = "Sound (27-39.9)"; // starts at 54%, where the other starts at 50%: two criteria are too few to say which is right
  expect(gridFlags(two)).toEqual([]);
});

test("the image is kept as the rubric's source, and the rubric records that it was entered from it", async () => {
  const { ws } = await newWorkspace();
  const entered = await enterRubricFromImage(ws, { name: "screenshot.png", bytes: IMAGE }, grid([20, 50, 20, 10]), { now: new Date(Date.UTC(2026, 9, 27)) });
  const hash = sha256Bytes(IMAGE);
  expect(entered.imagePath).toBe(rubricImagePath(hash, "screenshot.png"));
  expect(Array.from((await ws.readBytes(entered.imagePath))!)).toEqual(Array.from(IMAGE));
  const rubric = await loadRubric(ws);
  expect(rubric.provenance).toMatchObject({ source: `image:sha256:${hash}`, transformation: "entered", input_hashes: [hash] });
  expect(rubric.criteria.map((c) => [c.title, c.weight, c.max_points, c.levels.length])).toEqual([
    ["Criterion 1", 20, 20, 4],
    ["Criterion 2", 50, 50, 4],
    ["Criterion 3", 20, 20, 4],
    ["Criterion 4", 10, 10, 4],
  ]);
  // A mark between two levels says where it sits, never rounded to one.
  expect(describeBetween(30, rubric.criteria[1])).toMatch(/between|Sound|Weak/);
});

test("the flags are kept with the rubric as its warnings, and a rubric with a slip is still saved as written", async () => {
  const { ws } = await newWorkspace();
  const g = grid([25, 25, 25, 25]);
  g.criteria[2].levels[2].label = "Weak (8-12.4)"; // a slip in the source, kept as written (it starts at 32%, where the others start at 30%)
  const entered = await enterRubricFromImage(ws, { name: "screenshot.png", bytes: IMAGE }, g);
  expect(entered.flags).toHaveLength(1);
  expect((await ws.readJson("rubric-warnings.json"))).toEqual(entered.flags);
  expect((await loadRubric(ws)).criteria[2].levels[2].label).toBe("Weak (8-12.4)");
});

test("a rubric that can't be built is refused with every problem listed, and nothing is kept", async () => {
  const { ws } = await newWorkspace();
  const g = grid([50, 50]);
  g.criteria[0].levels[1].descriptor = ""; // empty
  g.criteria[1].weight = "lots";
  const err = await enterRubricFromImage(ws, { name: "screenshot.png", bytes: IMAGE }, g).catch((e) => e);
  expect(err).toBeInstanceOf(RubricError);
  expect((err as RubricError).problems.length).toBeGreaterThanOrEqual(2);
  expect(await ws.exists("rubric.json")).toBe(false);
  expect(await ws.exists(rubricImagePath(sha256Bytes(IMAGE), "screenshot.png"))).toBe(false); // the image is kept only with a rubric that was saved
});

test("it needs an image, and a rubric already saved is replaced only when told to", async () => {
  const { ws } = await newWorkspace();
  await expect(enterRubricFromImage(ws, { name: "rubric.pdf", bytes: IMAGE }, grid([100]))).rejects.toThrow("png, jpg, webp or gif");
  await enterRubricFromImage(ws, { name: "a.png", bytes: IMAGE }, grid([100]));
  await expect(enterRubricFromImage(ws, { name: "a.png", bytes: IMAGE }, grid([60, 40]))).rejects.toThrow(WorkspaceError);
  await enterRubricFromImage(ws, { name: "a.png", bytes: IMAGE }, grid([60, 40]), { replace: true });
  expect((await loadRubric(ws)).criteria).toHaveLength(2);
});

test("a pattern fills in a criterion's level labels with their ranges, and only those", () => {
  expect(labelsFromPattern(DEFAULT_PATTERN, 20)).toEqual([
    "Excellent (16-20)",
    "Very Good (14-15.8)",
    "Good (12-13.8)",
    "Adequate (10-11.8)",
    "Marginal Fail (8-9.8)",
    "Fail with omissions (6-7.8)",
    "Fail with major omissions (4-5.8)",
    "Not done (0-3.8)",
  ]);
  expect(labelsFromPattern(DEFAULT_PATTERN, 35)![5]).toBe("Fail with omissions (10.5-13.65)");
  expect(labelsFromPattern([{ name: "Pass", starts: "50" }, { name: "Fail", starts: "0" }], 10)).toEqual(["Pass (5-10)", "Fail (0-4.9)"]);
  // Not usable: no points to work from, a level that doesn't start lower than the one above, a missing name, or a start past 100.
  expect(labelsFromPattern(DEFAULT_PATTERN, 0)).toBeNull();
  expect(labelsFromPattern([{ name: "A", starts: "50" }, { name: "B", starts: "60" }], 10)).toBeNull();
  expect(labelsFromPattern([{ name: "", starts: "50" }], 10)).toBeNull();
  expect(labelsFromPattern([{ name: "A", starts: "150" }], 10)).toBeNull();
});

test("a grid built from the pattern, with points and descriptors typed in, has nothing flagged", () => {
  const criteria = [20, 50, 20, 10].map((w, c) => ({
    title: `Criterion ${c + 1}`,
    weight: String(w),
    max_points: "",
    levels: labelsFromPattern(DEFAULT_PATTERN, w)!.map((label) => ({ label, points: String(rangeOfLabel(label)!.low), descriptor: `Work at ${label}.` })),
  }));
  expect(gridFlags({ title: "Fictional", criteria })).toEqual([]);
});

test("a literal backslash-n in a descriptor typed in is kept as written, and what the builder notes is shown", async () => {
  const { ws } = await newWorkspace();
  const g = grid([100]);
  g.criteria[0].levels[0].descriptor = "Uses the \\n escape correctly.";
  const entered = await enterRubricFromImage(ws, { name: "a.png", bytes: IMAGE }, g);
  expect((await loadRubric(ws)).criteria[0].levels[0].descriptor).toBe("Uses the \\n escape correctly."); // not turned into a line break
  expect(entered.flags).toEqual([]); // and no warning that it was
});

test("a rubric imported from a file over one entered from an image leaves no record of an AI proposal behind", async () => {
  const { ws } = await newWorkspace();
  await enterRubricFromImage(ws, { name: "a.png", bytes: IMAGE }, grid([100]), { proposal: { prompt_version: "rubric-transcription-v1", model: "m", provider: "p", request_id: null, request_sha256: "a".repeat(64), image_sha256: sha256Bytes(IMAGE), sent_sha256: "b".repeat(64), cost_usd: 0.01, at: "2026-10-27T12:00:00.000Z" } });
  expect(await ws.exists("rubric-proposal.json")).toBe(true);
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "From a file", replace: true });
  expect(await ws.exists("rubric-proposal.json")).toBe(false);
  expect((await loadRubric(ws)).title).toBe("From a file");
});

test("a save that fails part-way puts the rubric, its warnings and the proposal's record back as they were", async () => {
  const { ws } = await newWorkspace();
  const record = { prompt_version: "rubric-transcription-v1", model: "m", provider: "p", request_id: null, request_sha256: "a".repeat(64), image_sha256: sha256Bytes(IMAGE), sent_sha256: "b".repeat(64), cost_usd: 0.01, at: "2026-10-27T12:00:00.000Z" };
  const first = grid([60, 40]);
  first.criteria[0].weight = "70"; // flagged: the weights add to 110
  await enterRubricFromImage(ws, { name: "a.png", bytes: IMAGE }, first, { proposal: record });
  const before = [await ws.readJson("rubric.json"), await ws.readJson("rubric-warnings.json"), await ws.readJson("rubric-proposal.json")];
  expect((before[1] as string[]).length).toBeGreaterThan(0);
  // Replacing it, with the record's removal failing: nothing of the old rubric's metadata is lost, and the old rubric stands.
  const original = ws.fs.remove.bind(ws.fs);
  ws.fs.remove = async (path: string) => {
    if (path === "rubric-proposal.json") throw new Error("disk trouble");
    return original(path);
  };
  await expect(enterRubricFromImage(ws, { name: "b.png", bytes: new Uint8Array([...IMAGE, 0]) }, grid([100]), { replace: true })).rejects.toThrow("disk trouble");
  ws.fs.remove = original;
  expect([await ws.readJson("rubric.json"), await ws.readJson("rubric-warnings.json"), await ws.readJson("rubric-proposal.json")]).toEqual(before);
  // The image of the failed save isn't left behind.
  expect(await ws.exists(rubricImagePath(sha256Bytes(new Uint8Array([...IMAGE, 0])), "b.png"))).toBe(false);
});
