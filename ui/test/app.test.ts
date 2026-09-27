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

test("every marker's record is listed and counted, and a damaged one is shown", async () => {
  const { markingRecords } = await import("../src/app/markingRecords.ts");
  const { enterMarking, importMarking } = await import("../src/core/index.ts");
  const { ws, path } = await newWorkspace();
  await recordRequest(ws, [{ external_id: "100200302" }]);
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")));
  await importMarking(ws, bytesSource("g.zip", makeZip({ "100200302 - PIKE JORDAN - x.docx.pdf": packFile("marked-view-replica.pdf") })));
  await enterMarking(ws, "sub-001", { markerLabel: "second marker", overall: 58 });
  const records = await markingRecords(ws);
  expect(records.map((r) => [r.markerLabel, r.confirmed])).toEqual([["marker", false], ["second marker", true]]);
  expect((await loadOverview(ws)).submissions[0].marking).toBe("attention"); // the imported one isn't confirmed
  await confirmMarking(ws, "sub-001");
  expect((await loadOverview(ws)).submissions[0].marking).toBe("done");
  const { writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  writeFileSync(join(path, "marking", "sub-001--second-marker.json"), '{"not": "marking"}');
  const damaged = (await markingRecords(ws)).find((r) => r.file === "sub-001--second-marker.json")!;
  expect(damaged.problem).toBe("marking/sub-001--second-marker.json is not a valid marking record");
  expect((await loadOverview(ws)).submissions[0].marking).toBe("attention");
});

// --- Entering marking by hand -----------------------------------------------------------------

test("an empty hand entry is refused, and replacing a record needs saying so", async () => {
  const { entryProblem, markingRecords } = await import("../src/app/markingRecords.ts");
  const { enterMarking, importMarking } = await import("../src/core/index.ts");
  const { ws, path } = await newWorkspace();
  await recordRequest(ws, [{ external_id: "100200302" }]);
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")));
  const empty = { overall: null, criteria: 0, comment: "  " };
  const some = { overall: 58, criteria: 0, comment: "" };
  expect(entryProblem([], "sub-001", "marker", empty, true)).toBe("enter an overall mark, a mark for at least one criterion, or a comment; nothing was entered");
  expect(entryProblem([], "sub-001", "marker", some, false)).toBeNull();

  await importMarking(ws, bytesSource("g.zip", makeZip({ "100200302 - PIKE JORDAN - x.docx.pdf": packFile("marked-view-replica.pdf") })));
  await enterMarking(ws, "sub-001", { markerLabel: "Second Marker", overall: 60 });
  const records = await markingRecords(ws);
  expect(records.map((r) => [r.markerLabel, r.imported])).toEqual([["marker", true], ["Second Marker", false]]);
  expect(entryProblem(records, "sub-001", "marker", some, false)).toBe(
    'sub-001 already has marking imported from its marked view for the marker; to replace it, tick "Replace the existing record" (the old one is kept in the history), or enter this under another marker role',
  );
  expect(entryProblem(records, "sub-001", "second marker", some, false)).toMatch(/^sub-001 already has a record entered by hand for the second marker;/); // the same file
  expect(entryProblem(records, "sub-001", "marker", some, true)).toBeNull();
  expect(entryProblem(records, "sub-001", "third marker", { ...some, overall: null, comment: "Fair." }, false)).toBeNull();
  // A damaged record can't be replaced here (its history copy would need it read), even with the tick.
  const { writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  writeFileSync(join(path, "marking", "sub-001--marker.json"), "{");
  const damaged = await markingRecords(ws);
  expect(entryProblem(damaged, "sub-001", "marker", some, true)).toBe(
    "marking/sub-001--marker.json can't be read (marking/sub-001--marker.json is not valid JSON), so it can't be replaced here; move it out of the workspace, or enter this under another marker role",
  );
});

test("an unready brief is explained in the app's terms", async () => {
  const { briefProblem } = await import("../src/app/readingPlan.ts");
  const { ws } = await newWorkspace();
  const untick = 'or untick "Include the approved brief" to read without it';
  expect(await briefProblem(ws)).toBe(`no brief has been imported; import it (Brief) and approve it (Anonymisation), ${untick}`);
  await recordRequest(ws, [{ external_id: "100200301" }]);
  await importBrief(ws, bytesSource("brief.docx", packFile("brief.docx")));
  expect(await briefProblem(ws)).toBe(`the brief has not been anonymised; review and approve it under Anonymisation, ${untick}`);
  await anonymiseWorkspace(ws);
  expect(await briefProblem(ws)).toBe(`the brief has not been approved by the moderator; review and approve it under Anonymisation, ${untick}`);
  await approve(ws, "brief");
  expect(await briefProblem(ws)).toBeNull();
});
