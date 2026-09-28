/**
 * The workspace in a real browser (#46), on the origin private file system,
 * which gives the same folder handles as the folder picker without needing a
 * person to click. Step 1 opens and writes a workspace and remembers its
 * handle, and records a request and imports its sampled originals (#48);
 * step 2 (after a reload) recalls the handle, reads back, and deletes.
 */

import "../src/platform/pdfWorker.ts";
import { loadReadings, planReadings, runReadings, type ReadingProxy, anonymiseWorkspace, confirmMarking, importMarking, loadMarking, parseMarkedView, approve, approvedBriefText, approvedText, importBrief, requireApprovedBrief, importOriginals, importRubric, loadSubmission, openWorkspace, PseudonymKey, recordRequest, requireApproved, Rubric, RUBRIC, UnapprovedText, type ProxyClient } from "../src/core/index.ts";
import { runRubricImports } from "./rubric.ts";
import { caseBlock, caseDigests, runRedactions } from "./anonymise.ts";
import { fileSource } from "../src/platform/fileSource.ts";
import { runExtraction } from "./extraction.ts";
import { BrowserFileSystem } from "../src/platform/browserFileSystem.ts";
import { forgetWorkspace, recallWorkspace, rememberWorkspace } from "../src/platform/handleStore.ts";
import { openRememberedWorkspace } from "../src/platform/openWorkspace.ts";

/**
 * The proxy's side is tested against the real proxy elsewhere. Here it
 * confirms "ws-check", and writes its one-time identity value into the
 * registered folder, which is "mod-1" in the private file system.
 */
const proxy: ProxyClient = {
  createWorkspace: async () => ({ registration_id: "", path: "" }),
  registerWorkspace: async () => ({ registration_id: "", path: "" }),
  forgetWorkspace: async () => ({ forgotten: false }),
  confirmWorkspace: async (id, options) => {
    if (id !== "ws-check") return { confirmed: false, path: null, reason: "unknown", tightened: [] };
    const result = { confirmed: true, path: "/Users/moderator/Feedbacker/workspaces/mod-1", reason: null, tightened: [] as string[] };
    if (!options?.challenge) return result;
    const registered = await (await navigator.storage.getDirectory()).getDirectoryHandle("mod-1");
    const value = crypto.randomUUID();
    const file = `challenge-${value.replaceAll("-", "")}.json`;
    await new BrowserFileSystem(registered).writeText(file, JSON.stringify({ challenge: value }));
    return { ...result, challenge: { file, value } };
  },
};

const checks: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, detail?: string) => checks.push([name, ok, detail]);
const rejects = async (run: () => Promise<unknown>, message: string) => {
  try {
    await run();
    return false;
  } catch (err) {
    return String((err as Error).message).includes(message);
  }
};

async function step1() {
  const root = await navigator.storage.getDirectory();
  await root.removeEntry("mod-1", { recursive: true }).catch(() => {});
  const handle = await root.getDirectoryHandle("mod-1", { create: true });
  const fs = new BrowserFileSystem(handle);
  // What the proxy writes when it creates a workspace.
  await fs.writeText("registration.json", JSON.stringify({ registration_id: "ws-check" }));
  await fs.writeText("workspace.json", JSON.stringify({ layout_version: 1, name: "mod-1", created_at: "2026-01-15T09:00:00.000Z", retention_days: 90, retention_source: "default" }));

  const ws = await openWorkspace(fs, proxy);
  check("opens a confirmed workspace and shows its registered path", ws.registration.path.endsWith("/mod-1"));
  await ws.writeJson("marking/sub-001--marker.json", { kind: "original_assessment", note: "Zoë 🙂" });
  check("writes a record into a new subfolder and reads it back", JSON.stringify(await ws.readJson("marking/sub-001--marker.json")) === '{"kind":"original_assessment","note":"Zoë 🙂"}');
  check("writes exactly the Python core's JSON format", (await fs.readText("marking/sub-001--marker.json")) === '{\n  "kind": "original_assessment",\n  "note": "Zoë 🙂"\n}\n');
  check("sees files and folders", (await fs.exists("marking")) && (await fs.exists("marking/sub-001--marker.json")) && !(await fs.exists("nothing")));
  check("reads a missing file as absent", (await fs.readText("private/none.json")) === null);
  const listing = (await fs.list("")).map((e) => `${e.name}:${e.kind}`).join(",");
  check("lists the folder, with no identity check left behind", listing === "marking:directory,registration.json:file,workspace.json:file", listing);
  await ws.writeKey(PseudonymKey.parse({ entries: [{ submission_id: "sub-001", pseudonym: "[STUDENT_A]", external_id: "100200300" }] }));
  check("keeps the pseudonym key in private/", (await ws.readKey()).entries[0].external_id === "100200300");
  const every = Uint8Array.from({ length: 256 }, (_, i) => i);
  await ws.writeBytes("sources/every-byte.bin", every);
  const back = await ws.readBytes("sources/every-byte.bin");
  check("writes and reads back every byte value", back !== null && back.length === 256 && back.every((b, i) => b === i));
  check("reads a missing file's bytes as absent", (await ws.readBytes("sources/none.bin")) === null);
  await fs.remove("sources/every-byte.bin");
  await recordRequest(ws, [{ external_id: "100200301" }, { external_id: "100200303" }]);
  const blob = await (await fetch("/zips/sample.zip")).blob();
  const imported = await importOriginals(ws, fileSource(new File([blob], "sample.zip")));
  check(
    "imports only the sampled originals from a bulk download",
    imported.imported.map((s) => `${s.id}.${s.source_format}`).join() === "sub-002.docx,sub-003.pdf" && imported.ignoredCount === 1,
    JSON.stringify(imported),
  );
  const loaded = await loadSubmission(ws, "sub-003");
  check("loads an imported submission, its stored original matching the record", loaded.extract?.blocks.length !== 0);
  const originals = (await fs.list("sources/originals")).map((e) => e.name).join();
  check("stores only the selected files, under pseudonymous names", originals === "sub-002.docx,sub-003.pdf", originals);
  const brief = await importBrief(ws, fileSource(new File([await (await fetch("/pack/brief.docx")).blob()], "brief.docx")));
  check("imports the brief, extracted locally", brief.extract.text.includes("Design, build, and evaluate") && (await fs.exists(`sources/brief-${brief.source_sha256.slice(0, 16)}.docx`)));
  const anonymised = await anonymiseWorkspace(ws);
  const redactedText = (await loadSubmission(ws, "sub-002")).anonymised!.text;
  check("anonymises the imported originals, removing the student's name", "sub-002" in anonymised.counts && !/quill/i.test(redactedText) && redactedText.includes("[STUDENT_B]"));
  let refused = false;
  try {
    await approvedText(ws, "sub-002");
  } catch (err) {
    refused = err instanceof UnapprovedText;
  }
  check("the gate refuses text the moderator hasn't approved", refused);
  await approve(ws, "sub-002");
  const [approvedBody] = await approvedText(ws, "sub-002");
  check("approves, and the gate then passes exactly the approved text", approvedBody === redactedText && (await requireApproved(ws, "sub-002", approvedBody)).approved_by.kind === "moderator");
  await approve(ws, "brief");
  const [briefText] = await approvedBriefText(ws);
  check("anonymises and approves the brief, which then passes the gate", "brief" in anonymised.counts && /\[EMAIL_\d+\]/.test(briefText) && !briefText.includes("m.ellis@example.com"));
  check("the gate passes exactly the approved brief", (await requireApprovedBrief(ws, briefText)).approved_by.kind === "moderator");
  check("the gate refuses a brief that isn't exactly the approved text", await rejects(() => requireApprovedBrief(ws, briefText + " "), "nothing was sent"));
  const views = await (await fetch("/zips/views.zip")).blob();
  await importRubric(ws, fileSource(new File([await (await fetch("/pack/rubric.csv")).blob()], "rubric.csv")));
  const marking = await importMarking(ws, fileSource(new File([views], "views.zip")));
  const mark = await loadMarking(ws, "sub-002");
  check(
    "imports the marking from marked views, mapped to the rubric, comments anonymised",
    marking.imported.length === 2 &&
      marking.ignoredCount === 2 &&
      mark.overall_mark === 60 &&
      /\[EMAIL_\d+\]/.test(mark.overall_comment ?? "") &&
      !(mark.overall_comment ?? "").includes("j.pike@example.com") &&
      mark.import_notes.some((n) => n.includes("Submission ID inside the marked view differs")),
    JSON.stringify(mark.import_notes).slice(0, 200),
  );
  check("the moderator confirms it", (await confirmMarking(ws, "sub-002")).confirmed_by?.kind === "moderator");
  await fs.remove("rubric.json");
  await fs.remove("rubric-warnings.json");
  const packFile = async (name: string) => fileSource(new File([await (await fetch(`/pack/${name}`)).blob()], name));
  const preview = await importRubric(ws, await packFile("rubric-grid.xlsx"));
  check("previews a grid rubric without writing it", !preview.written && !(await fs.exists(RUBRIC)));
  const confirmed = await importRubric(ws, await packFile("rubric-grid.xlsx"), { confirm: true });
  check("writes a confirmed rubric, which reads back", confirmed.written && JSON.stringify(Rubric.parse(await ws.readJson(RUBRIC))) === JSON.stringify(confirmed.rubric));
  // The AI reading, with an in-page stand-in for the proxy's reading API (the
  // HTTP path to the real proxy is checked in Node).
  const readingProxy: ReadingProxy = {
    health: async () => ({ key_configured: true, provider: "stand-in", prices: { "claude-sonnet-5": { input: 2, output: 10 }, "claude-opus-5": { input: 5, output: 25 } } }),
    openRun: async () => ({ id: "run-check" }),
    read: async (_run, request) => {
      const ids = [...request.blocks[0].text.matchAll(/^Criterion id: (.+)$/gm)].map((m) => m[1]);
      const quote = [...request.blocks[2].text].slice(0, 30).join("");
      const criteria = ids.map((criterion_id) => ({ criterion_id, suggested_level_id: null, rationale: "A stand-in reading.", evidence: [quote], draft_comment: "", missing_evidence: true }));
      return { outcome: "complete", parsed: { criteria }, model_reported: request.model, request_id: "req_check", stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0 }, raw_json: "{}", provider: "stand-in", request_sha256: "0".repeat(64), cost_usd: 0.001 };
    },
  };
  const readingPlan = await planReadings(ws, readingProxy);
  const reading = await runReadings(ws, readingPlan, { proxy: readingProxy });
  const [suggestion] = await loadReadings(ws, "sub-002");
  check(
    "plans and runs an AI reading of approved text only, recorded through the folder API",
    [...reading.read.keys()].join() === "sub-002" && readingPlan.skipped.get("sub-003")?.includes("not been approved") === true && suggestion.evidence[0].verified && (await fs.exists("readings/runs")),
    JSON.stringify({ read: [...reading.read.keys()], failed: [...reading.failed], skipped: [...readingPlan.skipped] }).slice(0, 300),
  );
  check("writes exports only into exports/", (await ws.writeExport("record", "json", "{}")) === "exports/record.feedbacker-export.json" && (await fs.exists("exports/record.feedbacker-export.json")));
  check("refuses paths that would leave the folder", await rejects(() => ws.writeJson("../escape.json", {}), "not a path inside the workspace"));
  check("refuses an unconfirmed folder", await rejects(async () => {
    const other = await root.getDirectoryHandle("other", { create: true });
    const otherFs = new BrowserFileSystem(other);
    await otherFs.writeText("registration.json", JSON.stringify({ registration_id: "ws-unknown" }));
    return openWorkspace(otherFs, proxy);
  }, "can't be opened: unknown"));
  await root.removeEntry("other", { recursive: true });
  check("refuses a copy of the registered folder, with the original still in place", await rejects(async () => {
    const copy = await root.getDirectoryHandle("copy", { create: true });
    const copyFs = new BrowserFileSystem(copy);
    for (const file of ["registration.json", "workspace.json"]) await copyFs.writeText(file, (await fs.readText(file))!);
    return openWorkspace(copyFs, proxy);
  }, "is not the registered workspace"));
  await root.removeEntry("copy", { recursive: true });
  for await (const name of handle.keys()) if (name.startsWith("challenge-")) await handle.removeEntry(name); // the copy's uncollected check
  await rememberWorkspace(handle);
  check("remembers only the folder handle", true);
}

async function step2() {
  const handle = await recallWorkspace();
  check("recalls the folder after a reload", handle !== null && handle.name === "mod-1");
  if (!handle) return;
  const ws = await openRememberedWorkspace(proxy);
  check("reopens the remembered folder, with read and write access", ws !== null && ws.registration.path.endsWith("/mod-1"));
  if (!ws) return;
  check("reads back through the recalled handle", (await ws.readKey()).entries[0].pseudonym === "[STUDENT_A]");
  check("won't delete without the name typed", await rejects(() => ws.delete("mod"), "type the workspace's name"));
  await ws.delete("mod-1");
  const root = await navigator.storage.getDirectory();
  const left: string[] = [];
  for await (const name of root.keys()) left.push(name);
  check("deletes the whole folder in one action", !left.includes("mod-1"), left.join(","));
  await forgetWorkspace();
  check("forgets the handle", (await recallWorkspace()) === null);
}

/** Step 3: extraction, inspection and selection in the browser, for the runner to compare with Node. */
async function step3() {
  const started = performance.now();
  const results = await runExtraction(async (name) => {
    const path = name === "sample.zip" ? "/zips/sample.zip" : `/pack/${name}`;
    const blob = await (await fetch(path)).blob();
    const file = new File([blob], name.split("/").at(-1)!);
    return { bytes: new Uint8Array(await blob.arrayBuffer()), source: fileSource(file) };
  });
  const rubrics = await runRubricImports(async (name) => fileSource(new File([await (await fetch(`/pack/${name}`)).blob()], name)));
  const replica = new Uint8Array(await (await (await fetch("/pack/marked-view-replica.pdf")).blob()).arrayBuffer());
  Object.assign(window, { __markedView: await parseMarkedView(replica), __extraction: results, __rubrics: rubrics, __cases: caseDigests(), __caseBlock: caseBlock, __redactions: runRedactions(), __extractionMs: performance.now() - started });
}

const step = new URLSearchParams(location.search).get("step");
try {
  await (step === "3" ? step3() : step === "2" ? step2() : step1());
} catch (err) {
  check("no unexpected error", false, String(err));
}
Object.assign(window, { __result: checks });
document.getElementById("status")!.textContent = checks.every(([, ok]) => ok) ? "All checks passed." : "Some checks failed.";
