/**
 * Finding sampled students' files by name, when the request's IDs aren't the
 * marking platform's. Every name here is fictional.
 */

import { beforeEach, expect, test } from "vitest";
import {
  bytesSource,
  confirmMatches,
  importMarking,
  importOriginals,
  importRubric,
  loadSubmission,
  nameKey,
  platformIdOfFileName,
  proposeMatches,
  recordRequest,
  WorkspaceError,
  type ByteSource,
  type Workspace,
} from "../src/core/index.ts";
import { optionsFor } from "../src/app/matchChoices.ts";
import { makeZip, packFile } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

const loose = (name: string, content: Uint8Array | string = "x"): ByteSource => bytesSource(name, typeof content === "string" ? new TextEncoder().encode(content) : content);
const QUILL = "100200301 - QUILL AVERY . - report.docx";
const PIKE = "100200302 - PIKE JORDAN - late report.pdf";
const MARSH = "100200303 - MARSH RILEY-SMITH - report.pdf";
const OTHER = "100200399 - OTHER STUDENT - report.docx";
const files = () => [loose(QUILL), loose(PIKE), loose(MARSH), loose(OTHER), loose("manifest.txt", "Failed file count: 0")];

let ws: Workspace;
beforeEach(async () => {
  ({ ws } = await newWorkspace());
  // The request's own IDs and the students' names, as a request document gives them.
  await recordRequest(ws, [
    { external_id: "A0000001", names: ["Quill Avery"] },
    { external_id: "A0000002", names: ["Jordan, Pike"] },
    { external_id: "A0000003", names: ["Marsh Riley"] },
  ]);
});

test("a name is a set of parts, whatever the case, accents, punctuation and order", () => {
  expect(nameKey("Quill Avery")).toBe(nameKey("AVERY, quill"));
  expect(nameKey("QUILL AVERY .")).toBe(nameKey("Quill  Avery"));
  expect(nameKey("García Núñez")).toBe(nameKey("garcia nunez"));
  expect(nameKey("Marsh Riley")).not.toBe(nameKey("Marsh Riley-Smith")); // a different set of parts is a different name
  expect(nameKey("Quill")).not.toBe(nameKey("Quill Avery"));
  expect(nameKey(" . - ")).toBe("");
});

test("the platform's ID is the number at the start of a Turnitin-style name", () => {
  expect([QUILL, "report.docx", "12 - A B - c.pdf", "Pike_Jordan_100200302_report.pdf"].map(platformIdOfFileName)).toEqual(["100200301", null, null, null]);
});

test("a name matches only when exactly one file has it; the rest are left for picking by hand", async () => {
  const { proposals, free } = await proposeMatches(ws, files());
  expect(proposals.map((p) => [p.pseudonym, p.status, p.file])).toEqual([
    ["[STUDENT_A]", "matched", QUILL],
    ["[STUDENT_B]", "matched", PIKE], // "Jordan, Pike" is "PIKE JORDAN"
    ["[STUDENT_C]", "none", null], // "Marsh Riley" is not "MARSH RILEY-SMITH"
  ]);
  expect(proposals[2].formName).toBe("Marsh Riley");
  // The files nobody was matched to, for picking by hand (the report and the unmatched files aren't).
  expect(free.map((f) => f.fileName)).toEqual([MARSH, OTHER]);
});

test("two files with one name, or two students with one file, match nobody", async () => {
  const twoFiles = await proposeMatches(ws, [...files(), loose("100200377 - QUILL AVERY - again.docx")]);
  expect(twoFiles.proposals[0]).toMatchObject({ status: "several", file: null });
  const { ws: ws2 } = await newWorkspace();
  await recordRequest(ws2, [{ external_id: "A1", names: ["Quill Avery"] }, { external_id: "A2", names: ["Avery Quill"] }]);
  const twoStudents = await proposeMatches(ws2, [loose(QUILL)]);
  expect(twoStudents.proposals.map((p) => [p.status, p.file])).toEqual([["several", null], ["several", null]]);
  expect(twoStudents.free.map((f) => f.fileName)).toEqual([QUILL]); // contested, so it is left for the moderator to give to one of them
});

test("a student found by their ID, or with no name, isn't proposed a match", async () => {
  const { ws: ws2 } = await newWorkspace();
  await recordRequest(ws2, [{ external_id: "100200301", names: ["Someone Else"] }, { external_id: "A9" }]);
  const { proposals } = await proposeMatches(ws2, files());
  expect(proposals.map((p) => [p.pseudonym, p.status])).toEqual([["[STUDENT_B]", "no-name"]]); // the first is found by its ID in a file name
});

test("nothing is recorded until a match is confirmed, and then both ID routes find the files", async () => {
  expect((await ws.readKey()).entries.map((e) => e.platform_id)).toEqual([null, null, null]);
  await confirmMatches(ws, [
    { pseudonym: "[STUDENT_A]", fileName: QUILL },
    { pseudonym: "[STUDENT_B]", fileName: PIKE },
    { pseudonym: "[STUDENT_C]", fileName: MARSH }, // picked by hand
  ]);
  expect((await ws.readKey()).entries.map((e) => [e.external_id, e.platform_id])).toEqual([
    ["A0000001", "100200301"],
    ["A0000002", "100200302"],
    ["A0000003", "100200303"],
  ]);
  // The originals are found by the platform's ID now, and nobody is left to propose.
  const result = await importOriginals(ws, [loose(QUILL, packFile("submissions/sub-a.docx")), loose(PIKE, packFile("submissions/sub-b.pdf")), loose(MARSH, packFile("submissions/sub-d.pdf"))]);
  expect(result.imported.map((s) => s.id)).toEqual(["sub-001", "sub-002", "sub-003"]);
  expect((await loadSubmission(ws, "sub-001")).extract?.text).toContain("Plant Swap");
  expect((await proposeMatches(ws, files())).proposals).toEqual([]);
});

test("the marked views are found by the same ID, with no complaint that their Submission ID differs", async () => {
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic" });
  await confirmMatches(ws, [{ pseudonym: "[STUDENT_B]", fileName: PIKE }]);
  // Student B's marked view says "Submission ID: 100200302" inside, as the platform's views do.
  const zip = bytesSource("grademark.zip", makeZip({ "100200302 - PIKE JORDAN - Study_Buddy.docx.pdf": packFile("marked-view-replica.pdf") }));
  await recordRequest(ws, [{ external_id: "A0000002", names: ["Jordan, Pike"] }], { replace: true });
  const result = await importMarking(ws, zip).catch((e) => e);
  expect(result.problems ?? []).toEqual([]); // found, not "no file found"
  expect(result.imported.map((a: { submission_id: string }) => a.submission_id)).toEqual(["sub-002"]);
  expect(result.imported[0].import_notes.some((n: string) => n.includes("differs from its file's identifier"))).toBe(false);
});

test("a confirmation that can't be right records nothing", async () => {
  const refused = async (matches: Parameters<typeof confirmMatches>[1], options?: { replace?: boolean }) => {
    const err = await confirmMatches(ws, matches, options).catch((e) => e);
    expect(err).toBeInstanceOf(WorkspaceError);
    expect((await ws.readKey()).entries.map((e) => e.platform_id)).toEqual([null, null, null]);
    return (err as Error).message;
  };
  expect(await refused([{ pseudonym: "[STUDENT_A]", fileName: "report.docx" }])).toContain("has no marking-platform ID in its name");
  expect(await refused([{ pseudonym: "[STUDENT_Z]", fileName: QUILL }])).toContain("is not a sampled student");
  expect(await refused([{ pseudonym: "[STUDENT_A]", fileName: QUILL }, { pseudonym: "[STUDENT_B]", fileName: QUILL }])).toContain("were matched to the same file");
  // Matching a student to a different file later needs replace.
  await confirmMatches(ws, [{ pseudonym: "[STUDENT_A]", fileName: QUILL }]);
  const err = await confirmMatches(ws, [{ pseudonym: "[STUDENT_A]", fileName: OTHER }]).catch((e) => e);
  expect((err as Error).message).toContain("already matched to another ID");
  await confirmMatches(ws, [{ pseudonym: "[STUDENT_A]", fileName: OTHER }], { replace: true });
  expect((await ws.readKey()).entries[0].platform_id).toBe("100200399");
  // An ID that already belongs to another student can't be given to a second.
  const other = await confirmMatches(ws, [{ pseudonym: "[STUDENT_B]", fileName: OTHER }]).catch((e) => e);
  expect((other as Error).message).toContain("already belongs to [STUDENT_A]");
});

test("a marked view's grade is checked against the initial mark the request listed", async () => {
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic" });
  const zip = () => bytesSource("grademark.zip", makeZip({ "100200302 - PIKE JORDAN - Study_Buddy.docx.pdf": packFile("marked-view-replica.pdf") })); // its grade is 60 / 100
  const noteAfter = async (initial: number | null) => {
    await recordRequest(ws, [{ external_id: "100200302", initial_mark: initial }], { replace: true });
    const result = await importMarking(ws, zip(), { replace: true });
    return result.imported[0].import_notes.filter((n) => n.includes("initial mark"));
  };
  expect(await noteAfter(60)).toEqual([]);
  expect(await noteAfter(null)).toEqual([]); // nothing to check against
  expect(await noteAfter(72)).toEqual(["the marked view's overall grade differs from the initial mark the request listed"]);
  expect(await noteAfter(60.4)).toHaveLength(1); // no tolerance: a difference is a difference
  expect((await ws.readJson("request.json")) as { sample: { initial_mark: number }[] }).toMatchObject({ sample: [{ initial_mark: 60.4 }] });
});

test("a file already found for one student by ID is never proposed to another with the same name", async () => {
  const { ws: ws2 } = await newWorkspace();
  // A is found by the ID in a file name; B has the same name as A.
  await recordRequest(ws2, [{ external_id: "100200301", names: ["Quill Avery"] }, { external_id: "A2", names: ["Avery Quill"] }]);
  const { proposals, free } = await proposeMatches(ws2, files());
  expect(proposals.map((p) => [p.pseudonym, p.status, p.file])).toEqual([["[STUDENT_B]", "none", null]]);
  expect(free.map((f) => f.fileName)).not.toContain(QUILL);
});

test("two files for one name, or one ID in two files, are ambiguous, however they are numbered", async () => {
  const { ws: ws2 } = await newWorkspace();
  await recordRequest(ws2, [{ external_id: "A1", names: ["Quill Avery"] }]);
  // The same download twice (two sources): one ID, two files.
  const twice = await proposeMatches(ws2, [loose(QUILL), loose(`copy/${QUILL}`), loose(OTHER)]);
  expect(twice.proposals[0]).toMatchObject({ status: "several", file: null });
  expect(twice.free.map((f) => f.fileName)).toEqual([OTHER]); // an ID in two files can't be imported, so it isn't offered
  // Another file with the same ID but a different name makes the match unsafe too.
  const clash = await proposeMatches(ws2, [loose(QUILL), loose("100200301 - SOMEONE ELSE - other.docx")]);
  expect(clash.proposals[0]).toMatchObject({ status: "several", file: null }); // one file has the name, but its ID is in two files
});

test("a file released from one student's row can be given to another's", () => {
  const pool = ["f1", "f2", "f3"];
  const picks = { "[STUDENT_A]": "f1", "[STUDENT_B]": "" };
  // B is offered the files A hasn't taken, but not f1 while A has it.
  expect(optionsFor(pool, picks, "[STUDENT_B]")).toEqual(["f2", "f3"]);
  expect(optionsFor(pool, picks, "[STUDENT_A]")).toEqual(["f1", "f2", "f3"]);
  // Released by A ("Not matched"), f1 can be given to B.
  expect(optionsFor(pool, { ...picks, "[STUDENT_A]": "" }, "[STUDENT_B]")).toEqual(["f1", "f2", "f3"]);
  // Chosen by B, it is no longer offered to A.
  expect(optionsFor(pool, { "[STUDENT_A]": "", "[STUDENT_B]": "f1" }, "[STUDENT_A]")).toEqual(["f2", "f3"]);
});
