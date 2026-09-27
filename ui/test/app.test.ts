/** The app's logic outside the Svelte components (#19): the session token, and the overview. */

import { expect, test } from "vitest";
import { takeToken } from "../src/app/connection.ts";
import { loadOverview } from "../src/app/overview.ts";
import { anonymiseWorkspace, approve, bytesSource, confirmMarking, importOriginals, importRubric, importBrief, recordRequest } from "../src/core/index.ts";
import { makeZip, packFile } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

// --- The session token ---------------------------------------------------------------

function browser(hash: string) {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as unknown as Storage;
  const replaced: string[] = [];
  const history = { replaceState: (_: unknown, __: string, url: string) => void replaced.push(url) } as unknown as History;
  return { location: { hash, pathname: "/", search: "" } as Location, history, storage, replaced };
}

test("the token is taken from the address, removed from it, and kept for this tab", () => {
  const b = browser("#token=abc123");
  expect(takeToken(b.location, b.history, b.storage)).toBe("abc123");
  expect(b.replaced).toEqual(["/"]);
  const reloaded = { ...b, location: { hash: "", pathname: "/", search: "" } as Location };
  expect(takeToken(reloaded.location, reloaded.history, reloaded.storage)).toBe("abc123");
});

test("without a token in the address or the tab, there is none", () => {
  const b = browser("");
  expect(takeToken(b.location, b.history, b.storage)).toBeNull();
  expect(takeToken(b.location, b.history, null)).toBeNull();
});

test("storage that throws (a private window) doesn't stop the app", () => {
  const b = browser("#token=abc");
  const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } } as unknown as Storage;
  expect(takeToken(b.location, b.history, broken)).toBe("abc");
});

// --- The overview ----------------------------------------------------------------------

test("an empty workspace has no request yet", async () => {
  const { ws } = await newWorkspace();
  const overview = await loadOverview(ws);
  expect([overview.request, overview.rubric, overview.brief.imported, overview.submissions]).toEqual([null, "missing", "missing", []]);
});

test("each submission shows how far it has got", async () => {
  const { ws } = await newWorkspace();
  await recordRequest(ws, [{ external_id: "100200301", band: "60-69" }, { external_id: "100200302" }], { module: "Fictional 101", cohort_size: 40 });
  await importOriginals(ws, bytesSource("o.zip", makeZip({ "100200301 - QUILL AVERY . - a.docx": packFile("submissions/sub-a.docx"), "100200302 - PIKE JORDAN - b.pdf": packFile("submissions/sub-b.pdf") })));
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")));
  await importBrief(ws, bytesSource("brief.docx", packFile("brief.docx")));
  await anonymiseWorkspace(ws);
  await approve(ws, "sub-001");
  const { importMarking } = await import("../src/core/index.ts");
  await importMarking(ws, bytesSource("g.zip", makeZip({ "100200302 - PIKE JORDAN - x.docx.pdf": packFile("marked-view-replica.pdf"), "100200301 - QUILL AVERY - x.docx.pdf": packFile("marked-view-replica.pdf") })));
  await confirmMarking(ws, "sub-001");
  const overview = await loadOverview(ws);
  expect(overview.request).toEqual({ module: "Fictional 101", programme: null, cohortSize: 40 });
  expect([overview.rubric, overview.brief.imported, overview.brief.approved]).toEqual(["done", "done", "missing"]);
  const [a, b] = overview.submissions;
  expect([a.pseudonym, a.band, a.original, a.anonymised, a.approved, a.marking, a.reading]).toEqual(["[STUDENT_A]", "60-69", "done", "done", "done", "done", "missing"]);
  expect([b.approved, b.marking]).toEqual(["missing", "attention"]); // imported, not confirmed
});

test("a damaged record is shown as a problem, not skipped", async () => {
  const { ws, path } = await newWorkspace();
  await recordRequest(ws, [{ external_id: "100200301" }]);
  await importOriginals(ws, bytesSource("o.zip", makeZip({ "100200301 - QUILL AVERY . - a.docx": packFile("submissions/sub-a.docx") })));
  const { writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  writeFileSync(join(path, "sources", "originals", "sub-001.docx"), "tampered");
  const [row] = (await loadOverview(ws)).submissions;
  expect(row.original).toBe("attention");
  expect(row.problem).toContain("does not match the record");
});

test("a damaged rubric or AI reading is shown as a problem, not as done", async () => {
  const { ws, path } = await newWorkspace();
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  await recordRequest(ws, [{ external_id: "100200301" }]);
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")));
  writeFileSync(join(path, "rubric.json"), '{"kind": "rubric", "truncated');
  mkdirSync(join(path, "readings"), { recursive: true });
  writeFileSync(join(path, "readings", "sub-001.json"), '[{"kind": "ai_suggestion"}]');
  let overview = await loadOverview(ws);
  expect([overview.rubric, overview.rubricProblem]).toEqual(["attention", "rubric.json is not valid JSON"]);
  writeFileSync(join(path, "rubric.json"), '{"kind": "rubric", "criteria": []}');
  overview = await loadOverview(ws);
  expect([overview.rubric, overview.rubricProblem]).toEqual(["attention", "rubric.json is not a valid rubric; import the rubric again"]);
  const [row] = overview.submissions;
  expect([row.reading, row.problem]).toEqual(["attention", "readings/sub-001.json is not a valid AI reading; run the reading again"]);
});
