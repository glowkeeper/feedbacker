/**
 * The app in Chrome, under the proxy's Content Security Policy. The
 * workspaces folder is the origin private file system, and the proxy is a
 * stand-in (as in main.ts), because automation can't use the folder picker;
 * the proxy itself is tested against the real proxy elsewhere. The page
 * starts with two empty workspaces registered, a moderation and a marking,
 * which the check sets up through the app; choosing the workspaces folder
 * "picks" this one.
 */

import "../src/app/app.css";
import "../src/platform/pdfWorker.ts";
import { mount } from "svelte";
import { anonymiseWorkspace, approve, bytesSource, FIGURE_LIMITS, importOriginals, importRubric, loadJudgements, openWorkspace, recordFeedback, recordJudgement, recordRequest, WorkspaceError, type ListedWorkspace, type ProxyHealth, type ReadingRequest } from "../src/core/index.ts";
import { BrowserFileSystem } from "../src/platform/browserFileSystem.ts";
import App from "../src/app/App.svelte";
import type { AppProxy, Platform } from "../src/app/platform.ts";

const FOLDER = "app-ws";
const MARKING_FOLDER = "app-mark";
const WORKSPACES = "/Users/moderator/Feedbacker/workspaces";
const PATH = `${WORKSPACES}/app-check`;
const MARK_PATH = `${WORKSPACES}/mark-check`; // the marking workspace's
const FOLDER_ID = "wf-app-check";

/** The stand-in proxy's registry: each registration, with its folder in the private file system. */
const ELSEWHERE = "/Users/moderator/Feedbacker/datavis"; // a workspace kept outside the workspaces folder (ADR 0013)
const registry: { id: string; folder: string; dir?: string; path: string; module?: string; elsewhere?: boolean }[] = [
  { id: "ws-app", folder: FOLDER, path: PATH },
  { id: "ws-mark", folder: MARKING_FOLDER, path: MARK_PATH },
  { id: "ws-gone", folder: "gone", path: `${WORKSPACES}/gone` }, // registered, but its folder has gone
  { id: "ws-datavis", folder: "datavis", path: ELSEWHERE, elsewhere: true }, // outside the workspaces folder: the browser has never been shown its folder
  { id: "ws-clash", folder: MARKING_FOLDER, dir: "archive-elsewhere", path: `/Users/moderator/Archive/${MARKING_FOLDER}`, elsewhere: true }, // outside it too, under a folder name already used in it
];
/** What this browser can do with each workspace kept elsewhere, as the browser's stored folder handle would say. */
const elsewhereState: Record<string, "granted" | "prompt" | "none"> = { "ws-datavis": "none" };
let made = 0;
const folderOf = async (id: string) => {
  const r = registry.find((x) => x.id === id);
  if (!r) return null;
  const root = await navigator.storage.getDirectory();
  // `dir` is where it is kept in this private file system, when that isn't its folder's name (two kept elsewhere can share a name).
  return r.module ? (await root.getDirectoryHandle(r.module)).getDirectoryHandle(r.folder) : root.getDirectoryHandle(r.dir ?? r.folder);
};

/** A stand-in reading, quoting the submission's first words: the first criterion's first level is suggested; the others have too little evidence. */
function standInReading(request: ReadingRequest) {
  const ids = [...request.blocks[0].text.matchAll(/^Criterion id: (.+)$/gm)].map((m) => m[1]);
  const firstLevel = /^- Level id: (\S+) \|/m.exec(request.blocks[0].text)?.[1] ?? null;
  const quote = [...request.blocks[2].text].slice(0, 30).join("");
  const criteria = ids.map((criterion_id, i) => ({
    criterion_id,
    suggested_level_id: i === 0 ? firstLevel : null,
    rationale: "A stand-in reading.",
    evidence: [quote],
    draft_comment: "Consider the brief.",
    missing_evidence: i !== 0,
  }));
  return { outcome: "complete", parsed: { criteria }, model_reported: request.model, request_id: "req_app", stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0 }, raw_json: "{}", provider: "stand-in", request_sha256: "0".repeat(64), cost_usd: 0.001 };
}

let draftCalls = 0;

/** Stand-in drafts of feedback, for exactly what the marking block asks for. */
function standInDrafts(request: ReadingRequest) {
  const marking = request.blocks.at(-1)!.text;
  const ids = /Draft feedback for these criteria \(by id\): (.*)/.exec(marking)?.[1] ?? "none";
  draftCalls += 1; // each call's drafts differ, as a real AI's would
  const criteria = ids === "none" ? {} : Object.fromEntries(ids.split(", ").map((id) => [id, `You set this out clearly. Next time, go further (draft ${draftCalls}).`]));
  const overall = /Draft the overall summary: yes/.test(marking) ? "A clear piece of work. Next time, test more widely." : null;
  return { outcome: "complete", parsed: { criteria, overall }, model_reported: request.model, request_id: "req_draft", stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0 }, raw_json: "{}", provider: "stand-in", request_sha256: "0".repeat(64), cost_usd: 0.001 };
}

/** A stand-in suggested edit: the flagged praise gone, the rest kept. */
function standInVerdict(request: ReadingRequest) {
  return { outcome: "complete", parsed: { verdict: "generous", comment: "Marked too high overall: 60 against the 58 your judgements imply." }, model_reported: request.model, request_id: "req_verdict", stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0 }, raw_json: "{}", provider: "stand-in", request_sha256: "0".repeat(64), cost_usd: 0.001 };
}

function standInOverall(request: ReadingRequest) {
  return { outcome: "complete", parsed: { comment: "Two submissions were sampled; both were marked a little generously. The sample is too small to say more." }, model_reported: request.model, request_id: "req_overall", stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0 }, raw_json: "{}", provider: "stand-in", request_sha256: "0".repeat(64), cost_usd: 0.001 };
}

function standInSuggestion(request: ReadingRequest) {
  return { outcome: "complete", parsed: { text: "Clear work. Next time, go further." }, model_reported: request.model, request_id: "req_edit", stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0 }, raw_json: "{}", provider: "stand-in", request_sha256: "0".repeat(64), cost_usd: 0.001 };
}

/** A stand-in batch: it has ended by the second time it is checked. */
const batch = { requests: [] as ReadingRequest[], checks: 0, cancelled: false };
const batchProgress = () => {
  const n = batch.requests.length;
  const ended = batch.checks >= 2 || batch.cancelled;
  return {
    id: "msgbatch_app",
    status: ended ? "ended" : "in_progress",
    counts: { processing: ended ? 0 : n, succeeded: ended ? n : 0, errored: 0, canceled: 0, expired: 0 },
    created_at: "2026-09-28T09:00:00Z",
    expires_at: "2026-09-29T09:00:00Z",
    ended_at: ended ? "2026-09-28T09:05:00Z" : null,
  };
};

/** What the stand-in proxy answers a rubric transcription request with: a fictional rubric of two criteria, as the proxy returns a reading. */
const standInRubric = async () => {
  await (window as unknown as { __rubricGate?: Promise<void> }).__rubricGate; // a check can hold the answer back, to change the grid while it waits
  return standInRubricAnswer();
};
const standInRubricAnswer = () => ({
  outcome: "complete",
  parsed: {
    title: "Fictional rubric",
    criteria: [
      { title: "Criterion one", weight_percent: 60, max_points: 60, levels: [{ label: "Strong (48-60)", points: 54, descriptor: "Strong work." }, { label: "Weak (0-47.4)", points: 20, descriptor: "Weak work." }] },
      { title: "Criterion two", weight_percent: 40, max_points: 40, levels: [{ label: "Strong (32-40)", points: 36, descriptor: "Strong work." }, { label: "Weak (0-31.6)", points: 12, descriptor: "Weak work." }] },
    ],
  },
  model_reported: "claude-sonnet-5",
  request_id: "msg_rubric",
  stop_reason: "end_turn",
  usage: {},
  raw_json: "{}",
  provider: "stand-in",
  request_sha256: "0".repeat(64),
  cost_usd: 0.0012,
});

// The stand-in's answer to each kind of request, by its instructions.
const readStandIn = (request: Parameters<AppProxy["read"]>[1]) =>
  request.prompt.version.startsWith("rubric-transcription-")
    ? standInRubric()
    : request.prompt.version.startsWith("overall-comment-")
      ? standInOverall(request)
      : request.prompt.version.startsWith("verdict-comment-")
        ? standInVerdict(request)
        : request.prompt.version.startsWith("feedback-edit-")
          ? standInSuggestion(request)
          : request.prompt.version.startsWith("feedback-")
            ? standInDrafts(request)
            : standInReading(request);

// How long each request to the AI takes, for the checks that say it is working: none unless a check sets it.
let aiDelayMs = 0;
const slow = () => (aiDelayMs ? new Promise<void>((resolve) => setTimeout(resolve, aiDelayMs)) : undefined);
Object.assign(window, { __setAiDelay: (ms: number) => (aiDelayMs = ms) });

const proxy: AppProxy = {
  // ?health=fail: the proxy stops answering after the app has opened (to check the error screen).
  health: async (): Promise<ProxyHealth> => {
    if (new URLSearchParams(location.search).get("health") === "fail") {
      await new Promise((resolve) => setTimeout(resolve, 300));
      throw new Error("the Feedbacker proxy could not be reached; is it running?");
    }
    return {
      key_configured: true,
      provider: "stand-in",
      batch: true,
      prices: { "claude-sonnet-5": { input: 2, output: 10, batch: 0.5 }, "claude-opus-5": { input: 5, output: 25, batch: 0.5 } },
    };
  },
  openRun: async () => ({ id: "run-app-check" }),
  read: async (_run, request) => {
    await slow();
    return readStandIn(request);
  },
  sendBatch: async (_run, requests) => {
    await slow();
    Object.assign(batch, { requests, checks: 0, cancelled: false });
    return { ...batchProgress(), items: requests.map((_, i) => ({ custom_id: `r${i + 1}`, request_sha256: "0".repeat(64) })) };
  },
  batchStatus: async () => {
    await slow();
    batch.checks += 1;
    return batchProgress();
  },
  batchResults: async () => {
    await slow();
    return {
      id: "msgbatch_app",
      items: batch.requests.map((request, i) => ({ custom_id: `r${i + 1}`, ...standInReading(request), request_id: `msg_r${i + 1}`, cost_usd: 0.0005 })),
    };
  },
  cancelBatch: async () => {
    await slow();
    batch.cancelled = true;
    return batchProgress();
  },
  createWorkspace: async () => ({ registration_id: "ws-app", path: PATH }),
  // As the proxy makes one by name: its folder, manifest and registration, in the workspaces folder.
  createNamedWorkspace: async (name, settings) => {
    const root = await navigator.storage.getDirectory();
    const { module, ...manifest } = settings;
    if (registry.some((r) => r.folder === name && r.module === module)) throw new WorkspaceError(`a workspace called '${name}' already exists; choose another name`);
    const parent = module ? await root.getDirectoryHandle(module) : root;
    const fs = new BrowserFileSystem(await parent.getDirectoryHandle(name, { create: true }));
    const id = `ws-new-${++made}`; // never reused, however many have been removed
    const path = module ? `${WORKSPACES}/${module}/${name}` : `${WORKSPACES}/${name}`;
    await fs.writeText("registration.json", JSON.stringify({ registration_id: id }));
    await fs.writeText("workspace.json", JSON.stringify({ layout_version: 1, name, created_at: "2026-10-07T09:00:00.000Z", ...manifest, ...(module ? { module } : {}) }));
    registry.push({ id, folder: name, path, ...(module ? { module } : {}) });
    return { registration_id: id, path };
  },
  // From each registered folder's manifest, newest first, as the proxy lists them.
  listWorkspaces: async () => {
    const workspaces: ListedWorkspace[] = [];
    for (const r of registry) {
      const handle = await folderOf(r.id).catch(() => null);
      const text = handle ? await new BrowserFileSystem(handle).readText("workspace.json") : null;
      const m = text ? JSON.parse(text) : null;
      workspaces.push({
        registration_id: r.id,
        path: r.path,
        folder: r.folder,
        in_workspaces_folder: !r.elsewhere,
        name: m?.name ?? null,
        workspace_type: m ? (m.workspace_type ?? "moderation") : null,
        module: m?.module ?? null,
        created_at: m?.created_at ?? null,
        retention_days: m ? (m.retention_days ?? 90) : null,
        retention_source: m ? (m.retention_source ?? "default") : null,
        problem: m ? null : `the registered folder is no longer at ${r.path}`,
      });
    }
    return { folder: WORKSPACES, folder_id: FOLDER_ID, workspaces: workspaces.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")) };
  },
  registerWorkspace: async () => ({ registration_id: "ws-app", path: PATH }),
  // Recorded, so the check can see a deleted workspace's registration was forgotten.
  forgetWorkspace: async (id) => {
    Object.assign(window, { __forgotten: [...((window as unknown as { __forgotten?: string[] }).__forgotten ?? []), id] });
    const at = registry.findIndex((r) => r.id === id);
    // A deleted module takes its assessments' registrations with it, as the proxy does.
    const gone = at >= 0 ? registry[at] : null;
    if (gone) for (let i = registry.length - 1; i >= 0; i--) if (i === at || (registry[i].module !== undefined && registry[i].module === gone.folder && !gone.module)) registry.splice(i, 1);
    return { forgotten: at >= 0 };
  },
  // As the proxy moves one in: the folder keeps its registration, and is now in the workspaces folder.
  moveWorkspace: async (id, name) => {
    const r = registry.find((x) => x.id === id);
    if (!r?.elsewhere) throw new WorkspaceError("this workspace is already in the workspaces folder");
    const as = name ?? r.folder;
    if (registry.some((x) => !x.elsewhere && !x.module && x.folder.toLowerCase() === as.toLowerCase())) {
      throw new WorkspaceError(`a workspace called '${as}' already exists in the workspaces folder; give it another name`);
    }
    const at = r.dir ?? r.folder; // where it is kept in this private file system
    if (as !== at) {
      // Renamed: its folder takes the name, and so does the name in its manifest; nothing else inside changes. (This stand-in's folders hold only these two files.)
      const root = await navigator.storage.getDirectory();
      const from = new BrowserFileSystem((await folderOf(id))!);
      const to = new BrowserFileSystem(await root.getDirectoryHandle(as, { create: true }));
      await to.writeText("registration.json", (await from.readText("registration.json"))!);
      await to.writeText("workspace.json", JSON.stringify({ ...JSON.parse((await from.readText("workspace.json"))!), ...(as !== r.folder ? { name: as } : {}) }));
      await root.removeEntry(at, { recursive: true });
      r.folder = as;
    }
    delete r.dir;
    r.elsewhere = false;
    r.path = `${WORKSPACES}/${r.folder}`;
    return { registration_id: id, path: r.path };
  },
  confirmWorkspace: async (id, options) => {
    const registered = registry.find((r) => r.id === id);
    if (!registered) return { confirmed: false, path: null, reason: "unknown", tightened: [] };
    const result = { confirmed: true, path: registered.path, reason: null, tightened: [] as string[] };
    if (!options?.challenge) return result;
    const value = crypto.randomUUID();
    const file = `challenge-${value.replaceAll("-", "")}.json`;
    await new BrowserFileSystem((await folderOf(id))!).writeText(file, JSON.stringify({ challenge: value }));
    return { ...result, challenge: { file, value } };
  },
};

// A fresh, empty workspace, as the proxy creates one; the check then sets it up through the app.
const root = await navigator.storage.getDirectory();
for await (const name of root.keys()) await root.removeEntry(name, { recursive: true }); // nothing left from an earlier run
const fs = new BrowserFileSystem(await root.getDirectoryHandle(FOLDER, { create: true }));
await fs.writeText("registration.json", JSON.stringify({ registration_id: "ws-app" }));
await fs.writeText("workspace.json", JSON.stringify({ layout_version: 1, name: "app-check", created_at: "2026-09-27T09:00:00.000Z", retention_days: 90, retention_source: "default" }));
// And one kept elsewhere, whose folder this browser has not been shown.
const elsewhereFs = new BrowserFileSystem(await root.getDirectoryHandle("datavis", { create: true }));
await elsewhereFs.writeText("registration.json", JSON.stringify({ registration_id: "ws-datavis" }));
await elsewhereFs.writeText("workspace.json", JSON.stringify({ layout_version: 1, name: "datavis", created_at: "2026-09-29T09:00:00.000Z", retention_days: 90, retention_source: "default" }));
const archiveFs = new BrowserFileSystem(await root.getDirectoryHandle("archive-elsewhere", { create: true }));
await archiveFs.writeText("registration.json", JSON.stringify({ registration_id: "ws-clash" }));
await archiveFs.writeText("workspace.json", JSON.stringify({ layout_version: 1, name: "archive", created_at: "2026-09-30T09:00:00.000Z", retention_days: 90, retention_source: "default" }));
// And a fresh marking workspace beside it.
const markingFs = new BrowserFileSystem(await root.getDirectoryHandle(MARKING_FOLDER, { create: true }));
await markingFs.writeText("registration.json", JSON.stringify({ registration_id: "ws-mark" }));
await markingFs.writeText(
  "workspace.json",
  JSON.stringify({ layout_version: 1, name: "mark-check", workspace_type: "marking", created_at: "2026-10-04T09:00:00.000Z", retention_days: 90, retention_source: "default" }),
);

// The workspaces folder: its ID, as the proxy writes it; the browser's access to it starts as never chosen.
await new BrowserFileSystem(root).writeText("feedbacker-workspaces.json", JSON.stringify({ folder_id: FOLDER_ID }));
let access: "granted" | "prompt" | "none" = "none";
const platform: Platform = {
  proxy,
  folderAccess: async () => access,
  chooseFolder: async (folderId) => {
    Object.assign(window, { __chosen: ((window as unknown as { __chosen?: number }).__chosen ?? 0) + 1 }); // counted: only a press that needs the folder asks for it
    const text = await new BrowserFileSystem(root).readText("feedbacker-workspaces.json");
    if (!text || JSON.parse(text).folder_id !== folderId) throw new WorkspaceError("that isn't the Feedbacker workspaces folder");
    access = "granted";
  },
  allowFolder: async () => ((access = "granted"), "granted"),
  elsewhereAccess: async (id) => elsewhereState[id] ?? "none",
  openElsewhereIfAllowed: async (id) => (elsewhereState[id] === "granted" ? openWorkspace(new BrowserFileSystem((await folderOf(id))!), proxy) : null),
  openInFolder: async (name) => openWorkspace(new BrowserFileSystem(await root.getDirectoryHandle(name)), proxy),
  openInModule: async (module, name) => {
    await slow();
    const moduleWorkspace = await openWorkspace(new BrowserFileSystem(await root.getDirectoryHandle(module)), proxy);
    return openWorkspace(new BrowserFileSystem(await (await root.getDirectoryHandle(module)).getDirectoryHandle(name)), proxy, moduleWorkspace);
  },
  // The stand-in "chooses" the folder, counted: only a press that needs the picker asks for it.
  openElsewhere: async (id) => {
    if (elsewhereState[id] === "none") Object.assign(window, { __chosenElsewhere: ((window as unknown as { __chosenElsewhere?: number }).__chosenElsewhere ?? 0) + 1 });
    elsewhereState[id] = "granted";
    return openWorkspace(new BrowserFileSystem((await folderOf(id))!), proxy);
  },
  // Recorded, so the check can see a moved workspace's stale remembered folder was forgotten.
  forget: async (id) => {
    Object.assign(window, { __forgotHandle: [...((window as unknown as { __forgotHandle?: string[] }).__forgotHandle ?? []), id] });
    delete elsewhereState[id];
  },
};
mount(App, { target: document.getElementById("app")!, props: { platform } });
// A moderation made in the page for the check that what looks like an identifier is shown: one student whose approved text holds a table of numbers.
Object.assign(window, {
  __makeLeaky: async (docxBase64: string, rubricBase64: string, name = "Leaky") => {
    const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const made = await proxy.createNamedWorkspace(name, { retention_days: 90, retention_source: "default", workspace_type: "moderation" });
    const ws = await openWorkspace(new BrowserFileSystem(await (await navigator.storage.getDirectory()).getDirectoryHandle(made.path.split("/").pop()!)), proxy);
    await recordRequest(ws, [{ external_id: "100200301" }]);
    await importOriginals(ws, bytesSource("100200301 - QUILL AVERY - a.docx", bytes(docxBase64)));
    await importRubric(ws, bytesSource("rubric.csv", bytes(rubricBase64)), { title: "Synthetic" });
    await anonymiseWorkspace(ws);
    await approve(ws, "sub-001");
  },
});
// Change the comment on a submission's first judged criterion, for the check that what looks like an identifier in a judgement is shown before a suggestion is asked for.
Object.assign(window, {
  __setJudgementComment: async (submissionId: string, comment: string) => {
    const ws = await openWorkspace(new BrowserFileSystem(await (await navigator.storage.getDirectory()).getDirectoryHandle(FOLDER)), proxy);
    const [j] = await loadJudgements(ws, submissionId);
    await recordJudgement(ws, submissionId, j.criterion_id, { levelId: (j.revised ?? j.first).level_id!, comment });
  },
});
// Change the words of a submission's first AI reading (as the AI wrote them, so nothing anonymises them), for the check that what the rules now redact is listed; it returns the words it had.
Object.assign(window, {
  __setReadingRationale: async (submissionId: string, rationale: string) => {
    const ws = await openWorkspace(new BrowserFileSystem(await (await navigator.storage.getDirectory()).getDirectoryHandle(FOLDER)), proxy);
    const readings = (await ws.readJson(`readings/${submissionId}.json`)) as { rationale: string }[];
    const before = readings[0].rationale;
    readings[0].rationale = rationale;
    await ws.writeJson(`readings/${submissionId}.json`, readings);
    return before;
  },
});
// Lower (and restore) the most images a request may carry, for the check that a submission with more figures than the AI can be sent is offered a choice.
Object.assign(window, {
  __setFigureLimit: (n: number) => {
    (FIGURE_LIMITS as { perRequest: number }).perRequest = n;
  },
});
// Make the read the Feedback screen repeats after an action fail (and succeed again), for the check that a refresh that fails is said beside what was done,
// and not left once it can be read. Recording feedback doesn't read this, so what is done succeeds; the refresh after it is what fails.
let guideReadFails = false;
const realExists = BrowserFileSystem.prototype.exists;
BrowserFileSystem.prototype.exists = function (this: BrowserFileSystem, path: string) {
  return guideReadFails && path === "feedback/guide.json" ? Promise.reject(new Error("the feedback guide's folder can't be read")) : realExists.call(this, path);
};
Object.assign(window, { __failGuideRead: (fails: boolean) => (guideReadFails = fails) });
// Change a piece of a marking workspace's feedback behind the page's back, as a record finishing late would, for the check that what is approved is what was shown.
Object.assign(window, {
  __changeFeedback: async (submissionId: string, target: string, text: string) => {
    const ws = await openWorkspace(new BrowserFileSystem(await (await navigator.storage.getDirectory()).getDirectoryHandle(MARKING_FOLDER)), proxy);
    await recordFeedback(ws, submissionId, target, { text });
  },
});
// A moderation of four submissions, anonymised and none approved, for the check that a set is approved by exception: the originals are one zip of files named for their students.
Object.assign(window, {
  __makeSet: async (zipBase64: string, ids: string[]) => {
    const made = await proxy.createNamedWorkspace("Set", { retention_days: 90, retention_source: "default", workspace_type: "moderation" });
    const ws = await openWorkspace(new BrowserFileSystem(await (await navigator.storage.getDirectory()).getDirectoryHandle(made.path.split("/").pop()!)), proxy);
    await recordRequest(ws, ids.map((external_id) => ({ external_id })));
    await importOriginals(ws, bytesSource("originals.zip", Uint8Array.from(atob(zipBase64), (c) => c.charCodeAt(0))));
    await anonymiseWorkspace(ws);
  },
});
// A module and two assessments in it, all with names of the longest length (64 characters, no spaces), for the check that the module bar fits a narrow screen.
Object.assign(window, {
  __makeLongNames: async (moduleName: string, assessmentNames: string[]) => {
    await proxy.createNamedWorkspace(moduleName, { retention_days: 90, retention_source: "default", workspace_type: "module", shared_key: false });
    for (const name of assessmentNames) await proxy.createNamedWorkspace(name, { retention_days: 90, retention_source: "default", workspace_type: "moderation", module: moduleName });
  },
});
Object.assign(window, { __appReady: true });
