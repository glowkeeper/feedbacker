/**
 * The assessment brief: import, redaction, approval, and the model gate. A
 * port of `core/tests/test_brief.py`.
 *
 * Its command-line test checks the Python command line's output; the
 * behaviour behind it (import, anonymise with a name, review, approve) is
 * tested here. Its test of a failed file copy becomes a source that can't be
 * read, as a browser `File` can fail (for example after the file changed).
 */

import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import {
  anonymiseWorkspace,
  approve,
  approvedBriefText,
  approvedText,
  BRIEF,
  bytesSource,
  ExtractionError,
  importBrief,
  loadBrief,
  recordRequest,
  requireApprovedBrief,
  reviewLines,
  updateRules,
  WorkspaceError,
  type ByteSource,
  type ProxyClient,
  type Workspace,
} from "../src/core/index.ts";
import { packFile, pdfPages } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

const BRIEF_FILE = () => bytesSource("brief.docx", packFile("brief.docx"));
let ws: Workspace;
let path: string;
let client: ProxyClient;
beforeEach(async () => {
  ({ ws, path, client } = await newWorkspace());
  await recordRequest(ws, [{ external_id: "100200301" }]);
});

test("import extracts locally, without metadata", async () => {
  const brief = await importBrief(ws, BRIEF_FILE());
  expect(brief.extract.text).toContain("Design, build, and evaluate");
  // The docx author metadata is a staff name that must never be read.
  expect(brief.extract.text.split("Morgan Ellis").length - 1).toBe(1); // only the body's contact line
  expect(brief.provenance.transformation).toBe("imported");
  expect(statSync(join(path, BRIEF)).mode & 0o777).toBe(0o600);
  expect(await loadBrief(ws)).toEqual(brief);
});

test("staff contact details are redacted", async () => {
  await importBrief(ws, BRIEF_FILE());
  await updateRules(ws, { names: ["Morgan Ellis"] });
  const result = await anonymiseWorkspace(ws);
  const text = (await loadBrief(ws)).anonymised!.text;
  for (const value of ["Morgan Ellis", "Ellis", "m.ellis@example.com", "020 7946 0123"]) expect(text, value).not.toContain(value);
  for (const token of ["[PERSON_1]", "[EMAIL_1]", "[PHONE_1]"]) expect(text).toContain(token);
  expect("brief" in result.counts).toBe(true);
  expect(result.approvalKept.brief).toBe(false);
});

test("the brief can be anonymised before any submission", async () => {
  await importBrief(ws, BRIEF_FILE());
  expect(Object.keys((await anonymiseWorkspace(ws)).counts)).toEqual(["brief"]);
});

test("approval and the gate", async () => {
  await importBrief(ws, BRIEF_FILE());
  await expect(approvedBriefText(ws)).rejects.toThrow("not been anonymised");
  await anonymiseWorkspace(ws);
  await expect(approvedBriefText(ws)).rejects.toThrow("not been approved");
  const approval = await approve(ws, "brief");
  const [text, persisted] = await approvedBriefText(ws);
  expect(persisted).toEqual(approval);
  expect(approval.approved_by.kind).toBe("moderator");
  expect(await requireApprovedBrief(ws, text)).toEqual(approval);
  await expect(requireApprovedBrief(ws, text + " ")).rejects.toThrow("nothing was sent");
});

test("changes clear the brief's approval", async () => {
  await importBrief(ws, BRIEF_FILE());
  await anonymiseWorkspace(ws);
  await approve(ws, "brief");
  expect((await anonymiseWorkspace(ws)).approvalKept.brief).toBe(true);
  await updateRules(ws, { names: ["Morgan Ellis"] });
  expect((await anonymiseWorkspace(ws)).approvalKept.brief).toBe(false);
  await expect(approvedBriefText(ws)).rejects.toThrow("not been approved");
});

test("the brief's approval is not a submission's approval", async () => {
  await importBrief(ws, BRIEF_FILE());
  await anonymiseWorkspace(ws);
  await approve(ws, "brief");
  await expect(approvedText(ws, "sub-001")).rejects.toThrow("has not been imported");
});

test("the replace guard, bad files, and tampering", async () => {
  await importBrief(ws, BRIEF_FILE());
  await expect(importBrief(ws, BRIEF_FILE())).rejects.toThrow("already imported");
  await expect(importBrief(ws, bytesSource("brief.pdf", new TextEncoder().encode("not a pdf")), { replace: true })).rejects.toThrow(ExtractionError);
  expect((await loadBrief(ws)).source_format).toBe("docx"); // the previous brief is intact
  const stored = readdirSync(join(path, "sources")).find((f) => f.startsWith("brief-") && f.endsWith(".docx"))!;
  writeFileSync(join(path, "sources", stored), "tampered");
  await expect(loadBrief(ws)).rejects.toThrow("does not match the record");
});

test("import, anonymise with a name, review and approve (as the command line does)", async () => {
  await importBrief(ws, BRIEF_FILE());
  await updateRules(ws, { names: ["Morgan Ellis"] });
  expect((await anonymiseWorkspace(ws)).counts.brief).toBeTruthy();
  const shown = (await reviewLines(ws, "brief", false)).join("\n");
  expect(shown.startsWith("brief:")).toBe(true);
  expect(shown).not.toContain("Ellis");
  await approve(ws, "brief");
  expect((await reviewLines(ws, "brief", false))[0]).toContain("APPROVED");
});

// --- Atomic replacement and read errors ---------------------------------------------------

const newPdf = () => bytesSource("new.pdf", pdfPages(["A different fictional brief."]));

test("a failed record write keeps the previous brief", async () => {
  const before = await importBrief(ws, BRIEF_FILE());
  const writeText = ws.fs.writeText.bind(ws.fs);
  ws.fs.writeText = async (p: string, t: string) => {
    if (p === BRIEF) throw Object.assign(new Error("disk full"), { name: "QuotaExceededError" });
    return writeText(p, t);
  };
  await expect(importBrief(ws, newPdf(), { replace: true })).rejects.toThrow(
    "could not be imported (QuotaExceededError); any previously imported brief is unchanged",
  );
  ws.fs.writeText = writeText;
  expect(await loadBrief(ws)).toEqual(before); // the old record and its source still match
  const stored = readdirSync(join(path, "sources"));
  expect(stored).toHaveLength(1); // no unused new source left behind
  expect(stored[0].endsWith(".docx")).toBe(true);
});

test("if the workspace can't be confirmed after the switch-over, the new brief is in place and the error says so", async () => {
  await importBrief(ws, BRIEF_FILE());
  const confirm = client.confirmWorkspace;
  client.confirmWorkspace = async () => ({ confirmed: false, path: null, reason: "moved", tightened: [] });
  const err = await importBrief(ws, newPdf(), { replace: true }).catch((e) => e);
  client.confirmWorkspace = confirm;
  expect(err.message).toContain("can no longer be confirmed: moved");
  expect(err.message).not.toContain("unchanged"); // it isn't: the new brief was imported
  expect((await loadBrief(ws)).source_format).toBe("pdf"); // the record and its source agree
});

test("an old source that can't be removed is only left over", async () => {
  await importBrief(ws, BRIEF_FILE());
  const remove = ws.fs.remove.bind(ws.fs);
  ws.fs.remove = async (p: string) => {
    if (p.startsWith("sources/brief-") && p.endsWith(".docx")) throw new Error("busy");
    return remove(p);
  };
  const replaced = await importBrief(ws, newPdf(), { replace: true });
  ws.fs.remove = remove;
  expect(await loadBrief(ws)).toEqual(replaced);
  await importBrief(ws, newPdf(), { replace: true }); // the next import tidies it
  expect(readdirSync(join(path, "sources")).map((f) => f.slice(f.lastIndexOf(".")))).toEqual([".pdf"]);
});

test("a successful replacement removes the old source", async () => {
  await importBrief(ws, BRIEF_FILE());
  await importBrief(ws, newPdf(), { replace: true });
  const files = readdirSync(join(path, "sources")).filter((f) => statSync(join(path, "sources", f)).isFile());
  expect(files.map((f) => f.slice(f.lastIndexOf(".")))).toEqual([".pdf"]);
  expect((await loadBrief(ws)).source_format).toBe("pdf");
});

test("read errors are reported cleanly", async () => {
  const unreadable: ByteSource = {
    name: "brief.docx",
    size: 10,
    read: async () => {
      throw Object.assign(new Error("denied"), { name: "NotReadableError" });
    },
  };
  await expect(importBrief(ws, unreadable)).rejects.toThrow(WorkspaceError);
  await expect(importBrief(ws, unreadable)).rejects.toThrow("could not be imported (NotReadableError)");
  expect(await ws.exists(BRIEF)).toBe(false);
});

// --- Beyond the Python tests ------------------------------------------------------------

test("an unsupported type is refused before anything is read", async () => {
  let read = false;
  const odt: ByteSource = { name: "brief.odt", size: 1, read: async () => ((read = true), new Uint8Array(1)) };
  await expect(importBrief(ws, odt)).rejects.toThrow(ExtractionError);
  expect(read).toBe(false);
});

test("the gate refuses a brief that was never imported", async () => {
  await expect(approvedBriefText(ws)).rejects.toThrow("no brief has been imported");
  await expect(requireApprovedBrief(ws, "anything")).rejects.toThrow(WorkspaceError); // as Python's load_brief does
});
