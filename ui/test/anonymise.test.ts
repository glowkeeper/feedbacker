/**
 * Rules-based anonymisation, moderator review, approval, and the model gate.
 * A port of `core/tests/test_anonymise.py`.
 *
 * Its two command-line tests check the Python command line's output and
 * argument parsing. The behaviour behind them (rules added and kept, review
 * with and without real values, approving several submissions) is tested
 * here; parsing `--redact value=KIND` stays with the Python command line.
 *
 * The gate tests in `test_reading.py` need the reading run, so they are
 * ported with it (#53); the gate itself is tested here, including that a
 * refusal reaches no proxy or network.
 */

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import {
  anonymiseWorkspace,
  apply,
  approve,
  approvedText,
  bytesSource,
  detect,
  importOriginals,
  loadSubmission,
  namesFromFileName,
  PseudonymKey,
  recordRequest,
  requireApproved,
  reviewLines,
  RULES,
  UnapprovedText,
  updateRules,
  AnonymisationRules,
  type Detector,
  type Workspace,
} from "../src/core/index.ts";
import { makeZip, PACK, packFile } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

const SEEDED = JSON.parse(readFileSync(new URL("seeded-identifiers.json", PACK), "utf8"));
// Turnitin-style bulk names (fictional), so students' names come from file names.
const FILES: Record<string, [string, string, string]> = {
  "sub-a": ["100200301", "QUILL AVERY .", "docx"],
  "sub-b": ["100200302", "PIKE JORDAN", "pdf"],
  "sub-c": ["100200303", "MARSH RILEY", "docx"],
  "sub-d": ["100200304", "ROWAN CASEY", "pdf"],
};
const bulk = (name: string) =>
  bytesSource(
    name,
    makeZip(Object.fromEntries(Object.entries(FILES).map(([sid, [ext, who, fmt]]) => [`${ext} - ${who} - report.${fmt}`, packFile(`submissions/${sid}.${fmt}`)]))),
  );

let ws: Workspace;
let path: string;
let calls: string[];
beforeEach(async () => {
  ({ ws, path, calls } = await newWorkspace());
  await recordRequest(ws, Object.values(FILES).map(([ext]) => ({ external_id: ext })));
  await importOriginals(ws, bulk("originals_1.zip"));
});

const anonymised = async (id: string) => (await loadSubmission(ws, id)).anonymised!.text;

// --- Engine --------------------------------------------------------------------------------

test("names come from Turnitin-style file names", () => {
  expect(namesFromFileName("100200301 - QUILL AVERY . - x.docx", "100200301")).toEqual(["QUILL AVERY"]);
  expect(namesFromFileName("Quill_Avery_100200301.docx", "100200301")).toEqual([]);
  expect(namesFromFileName("100200301 - SOLO - x.docx", "100200301")).toEqual(["SOLO"]);
});

const keyWith = (name: string) =>
  PseudonymKey.parse({ entries: [{ submission_id: "sub-001", pseudonym: "[STUDENT_A]", external_id: "100200301", names: [name] }] });
const run = (text: string, key: PseudonymKey, rules: Partial<AnonymisationRules> = {}, extra: Detector[] = []) =>
  apply(text, detect(text, key, AnonymisationRules.parse(rules), extra), key)[0];

test("names match in either order, and single parts only when capitalised", () => {
  const text = "Avery Quill wrote this. Quill, Avery agreed. QUILL signed. A quill pen. Avery smiled.";
  expect(run(text, keyWith("QUILL AVERY"))).toBe(
    "[STUDENT_A] wrote this. [STUDENT_A] agreed. [STUDENT_A] signed. A quill pen. [STUDENT_A] smiled.",
  );
});

test("every rule kind, with stable tokens", () => {
  const key = keyWith("Avery Quill");
  const rules = { names: ["Sam"], organisations: ["Northwind Widgets Ltd"], redact: { aquill99: "USERNAME" } };
  const text =
    "S0000101 avery.quill@example.com https://example.org/x. 07700 900123 " +
    "+44 7700 900124 100200301 Sam Northwind Widgets Ltd aquill99 avery.quill@example.com";
  expect(run(text, key, rules)).toBe("[ID_1] [EMAIL_1] [URL_1]. [PHONE_1] [PHONE_2] [ID_2] [PERSON_1] [ORG_1] [USERNAME_1] [EMAIL_1]");
  expect(Object.fromEntries(key.tokens.map((t) => [t.token, t.value]))["[ORG_1]"]).toBe("Northwind Widgets Ltd");
});

test("ignore keeps false positives", () => {
  expect(run("Build 20260115 by Quill", keyWith("Avery Quill"), { ignore: ["20260115"] })).toBe("Build 20260115 by [STUDENT_A]");
});

test("overlaps prefer the longest earliest span", () => {
  const key = keyWith("Avery Quill");
  expect(run("Avery Quill Studios", key, { organisations: ["Quill Studios"] })).toBe("[STUDENT_A] Studios");
  expect(run("Quill Studios", key, { organisations: ["Quill Studios"] })).toBe("[ORG_1]");
});

test("extra detectors plug in", () => {
  const fakeNer: Detector = (text) => {
    const i = text.indexOf("Taylor");
    return i >= 0 ? [{ start: i, end: i + 6, kind: "PERSON", value: "Taylor" }] : [];
  };
  expect(run("Thanks to Taylor.", keyWith("Avery Quill"), {}, [fakeNer])).toBe("Thanks to [PERSON_1].");
});

// --- Workspace: every planted identifier is removed ----------------------------------------

test("every seeded identifier is redacted", async () => {
  await updateRules(ws, { names: ["Sam"], organisations: ["Northwind Widgets Ltd", "Fabrikam Games"] });
  await anonymiseWorkspace(ws);
  let n = 0;
  for (const sid of Object.keys(FILES)) {
    const text = await anonymised(`sub-${String(++n).padStart(3, "0")}`);
    const seeded = SEEDED[sid];
    for (const value of [...seeded.names, ...seeded.student_ids, ...seeded.emails, ...seeded.urls, ...seeded.organisations]) {
      expect(text, `${sid}: ${value}`).not.toContain(value);
    }
    for (const part of seeded.names[0].split(" ")) expect(text, `${sid}: ${part}`).not.toContain(part);
  }
  expect(await anonymised("sub-001")).toContain("[STUDENT_A]");
});

test("names come only from the key, and the rules stay private", async () => {
  await anonymiseWorkspace(ws);
  expect((await ws.readKey()).entries[0].names).toEqual(["QUILL AVERY"]);
  await updateRules(ws, { names: ["Sam"] });
  expect(statSync(join(path, RULES)).mode & 0o777).toBe(0o600);
});

test("nothing happens without imports", async () => {
  const { ws: empty } = await newWorkspace("empty");
  await recordRequest(empty, [{ external_id: "100200301" }]);
  await expect(anonymiseWorkspace(empty)).rejects.toThrow("nothing to anonymise");
});

// --- Approval and the gate ---------------------------------------------------------------

test("approval records who, when, and the hash", async () => {
  await anonymiseWorkspace(ws);
  const approval = await approve(ws, "sub-001");
  const sub = await loadSubmission(ws, "sub-001");
  expect(approval.approved_by.kind).toBe("moderator");
  expect(approval.approved_text_sha256).toBe(sub.anonymised!.text_sha256);
  expect(await approvedText(ws, "sub-001")).toEqual([sub.anonymised!.text, approval]);
});

test("an unchanged rerun keeps the approval, but changes clear it", async () => {
  await anonymiseWorkspace(ws);
  await approve(ws, "sub-001");
  expect((await anonymiseWorkspace(ws)).approvalKept["sub-001"]).toBe(true);
  await updateRules(ws, { redact: { MoSCoW: "REDACTED" } });
  expect((await anonymiseWorkspace(ws)).approvalKept["sub-001"]).toBe(false);
  await expect(approvedText(ws, "sub-001")).rejects.toThrow("not been approved");
});

test("the gate refuses unanonymised, unapproved and modified text", async () => {
  await expect(approvedText(ws, "sub-001")).rejects.toThrow("not been anonymised");
  await anonymiseWorkspace(ws);
  await expect(approvedText(ws, "sub-002")).rejects.toThrow("not been approved");
  await approve(ws, "sub-002");
  const [text, approval] = await approvedText(ws, "sub-002");
  expect(await requireApproved(ws, "sub-002", text)).toEqual(approval); // the exact text passes
  await expect(requireApproved(ws, "sub-002", text + " ")).rejects.toThrow("nothing was sent");
  await expect(requireApproved(ws, "sub-002", text.replace("[STUDENT_B]", "Jordan Pike"))).rejects.toThrow(UnapprovedText);
});

test("the gate is bound to the submission", async () => {
  // An approval cannot be borrowed from another submission.
  await anonymiseWorkspace(ws);
  await approve(ws, "sub-001");
  const [text1] = await approvedText(ws, "sub-001");
  await expect(requireApproved(ws, "sub-002", text1)).rejects.toThrow("not been approved"); // sub-002 is unapproved
  await approve(ws, "sub-002");
  await expect(requireApproved(ws, "sub-002", text1)).rejects.toThrow("does not match"); // sub-001's text is not sub-002's
});

// --- Token persistence and short names ------------------------------------------------------

test("tokens survive request replacement and reimport", async () => {
  await updateRules(ws, { organisations: ["Northwind Widgets Ltd"] });
  await anonymiseWorkspace(ws);
  const before = (await ws.readKey()).tokens;
  expect(before.length).toBeGreaterThan(0);
  await recordRequest(ws, Object.values(FILES).map(([ext]) => ({ external_id: ext })), { replace: true });
  expect((await ws.readKey()).tokens).toEqual(before);
  await importOriginals(ws, bulk("again.zip"), { replace: true });
  expect((await ws.readKey()).tokens).toEqual(before);
  await anonymiseWorkspace(ws);
  expect((await ws.readKey()).tokens).toEqual(before); // nothing renumbered
});

test("short names and single names are redacted", () => {
  const text = "Jo presented. Li agreed. Jo Li and Li Jo. A jo-jo? No: 'li' stays lowercase.";
  expect(run(text, keyWith("LI JO"))).toBe(
    "[STUDENT_A] presented. [STUDENT_A] agreed. [STUDENT_A] and [STUDENT_A]. A jo-jo? No: 'li' stays lowercase.",
  );
  expect(run("Thanks, Ed.", keyWith("LI JO"), { names: ["Ed"] })).toBe("Thanks, [PERSON_1].");
  expect(run("Mononym Bo said.", keyWith("BO"))).toBe("Mononym [STUDENT_A] said.");
});

// --- What the command line shows (its output format stays in Python) ----------------------

test("review without values shows no real values; with them, a warning first", async () => {
  await updateRules(ws, { names: ["Sam"], organisations: ["Northwind Widgets Ltd"], redact: { aquill99: "USERNAME" }, ignore: ["20260115"] });
  const result = await anonymiseWorkspace(ws);
  expect(result.counts["sub-001"]).toBeTruthy();
  const shown = (await reviewLines(ws, "sub-001", false)).join("\n");
  expect(shown).toContain("NOT APPROVED");
  expect(shown).not.toContain("REAL VALUES");
  expect(shown).not.toContain("Quill");
  expect(shown).toContain("[STUDENT_A]");
  expect((await reviewLines(ws, "sub-001", true)).join("\n")).toContain("Do not share");
  for (const id of ["sub-001", "sub-002"]) await approve(ws, id);
  expect((await reviewLines(ws, "sub-001", false))[0]).toContain("APPROVED");
});

test("a redaction kind must be 2–12 capital letters", async () => {
  await expect(updateRules(ws, { redact: { x: "lowercase" } })).rejects.toThrow("must be 2–12 capital letters");
});

// --- Beyond the Python tests -------------------------------------------------------------------

test("a refusal at the gate reaches no proxy or network", async () => {
  await anonymiseWorkspace(ws);
  const before = calls.length;
  await expect(approvedText(ws, "sub-001")).rejects.toThrow(UnapprovedText);
  await expect(requireApproved(ws, "sub-001", "anything")).rejects.toThrow(UnapprovedText);
  expect(calls.length).toBe(before);
});

test("case-insensitive matching follows Python: İ matches i, ı matches I, and ſ matches s", () => {
  // Results checked with Python. "ıSLA" starts lowercase, so the single part isn't kept.
  expect(run("İsla and ıSLA met Sam.", keyWith("Isla Moss"), { names: ["ſam"] })).toBe("[STUDENT_A] and ıSLA met [PERSON_1].");
  expect(run("ISLA and Isla Moss and İSLA MOSS", keyWith("ısla moss"))).toBe("[STUDENT_A] and [STUDENT_A] and [STUDENT_A]");
});

test("offsets count code points, so text after emoji is redacted in the right place", async () => {
  const key = keyWith("Avery Quill");
  const text = "🙂🙂 Avery Quill 🙂 a@b.co";
  const spans = detect(text, key, AnonymisationRules.parse({}));
  expect(spans.map((s) => [s.start, s.end, s.value])).toEqual([[3, 14, "Avery Quill"], [17, 23, "a@b.co"]]);
  expect(apply(text, spans, key)[0]).toBe("🙂🙂 [STUDENT_A] 🙂 [EMAIL_1]");
});

test("tokens compare values with Python's casefold (ß matches SS)", () => {
  const key = keyWith("Avery Quill");
  expect(run("Straße GmbH and STRASSE GMBH", key, { organisations: ["Straße GmbH", "STRASSE GMBH"] })).toBe("[ORG_1] and [ORG_1]");
});

test("an empty value to redact is refused clearly", async () => {
  await ws.writeJson(RULES, { redact: { "": "REDACTED" } }, { private: true });
  await expect(anonymiseWorkspace(ws)).rejects.toThrow("a value to redact is empty");
});

test("if a record can't be written, what was written is still made private", async () => {
  await anonymiseWorkspace(ws);
  const writeText = ws.fs.writeText.bind(ws.fs);
  ws.fs.writeText = async (p: string, t: string) => {
    if (p === "submissions/sub-003.json") throw new Error("disk full");
    return writeText(p, t);
  };
  await updateRules(ws, { names: ["Sam"] });
  await expect(anonymiseWorkspace(ws)).rejects.toThrow("disk full");
  expect(statSync(join(path, "submissions", "sub-001.json")).mode & 0o777).toBe(0o600);
});
