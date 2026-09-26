/**
 * Inspection reports structure only: never text, metadata values, or names.
 * A port of `core/tests/test_structure.py`. The two command-line tests check
 * the same output through `inspectFile`, since the app has no command line.
 */

import { expect, test } from "vitest";
import { InspectionError, inspectFile, nameShape } from "../src/core/index.ts";
import { docx, makeZip, packFile, para } from "./builders.ts";

const seeded = JSON.parse(new TextDecoder().decode(packFile("seeded-identifiers.json")));

function* allIdentifiers(): Generator<string> {
  for (const ids of Object.values(seeded) as any[]) {
    yield ids.metadata_author;
    for (const key of ["names", "student_ids", "emails", "urls", "organisations"]) yield* ids[key];
  }
}

function assertNoContent(lines: string[]) {
  const joined = lines.join("\n");
  for (const value of allIdentifiers()) expect(joined, value).not.toContain(value);
  for (const word of ["Plant Swap", "MoSCoW", "WebSockets", "Good choice of framework", "Grade: 62"]) {
    expect(joined).not.toContain(word);
  }
}

test("name shapes hide letters and digits", () => {
  expect(nameShape("Pike_Jordan_100200302_final Report.DOCX")).toBe("Aaaa_Aaaaaa_999999999_aaaaa Aaaaaa.docx");
});

test("inspecting docx and pdf shows no content", async () => {
  for (const f of ["sub-a.docx", "sub-c.docx", "sub-b.pdf", "sub-d.pdf"]) {
    const lines = await inspectFile(f, packFile(`submissions/${f}`));
    expect(lines[0].startsWith("type:")).toBe(true);
    assertNoContent(lines);
  }
});

test("inspecting the marked view reveals its structure only", async () => {
  const lines = await inspectFile("marked-view-replica.pdf", packFile("marked-view-replica.pdf"));
  expect(lines[0]).toContain("pages: 7");
  const page = Object.fromEntries(lines.slice(2).map((l) => [l.split(":")[0], l]));
  for (const p of ["p2", "p3", "p4"]) expect(page[p]).toContain("largest-image=89%");
  expect(page.p5).toContain("comment-headings=3");
  expect(page.p6).toContain("band-labels=24");
  assertNoContent(lines);
});

test("inspecting a zip shows name shapes only", async () => {
  const z = makeZip({ "Pike_Jordan_100200302_report.pdf": "x", "Quill_Avery_100200301_report.docx": "x" });
  const lines = await inspectFile("o.zip", z);
  expect(lines[0]).toContain("files: 2");
  expect(lines.some((l) => l.includes("Aaaa_Aaaaaa_999999999_aaaaaa.pdf"))).toBe(true);
  assertNoContent(lines);
  expect(lines.some((l) => l.includes("100200302"))).toBe(false);
});

test("inspecting a pdf (as the command line does)", async () => {
  const lines = await inspectFile("sub-b.pdf", packFile("submissions/sub-b.pdf"));
  expect(lines[0]).toContain("type: pdf");
  assertNoContent(lines);
});

// --- Non-ASCII names, style names, damaged files --------------------------------------

test("name shapes mask any script", () => {
  expect(nameShape("García_Élodie_Ōtsuka_12345.docx")).toBe("Aaaaaa_Aaaaaa_Aaaaaa_99999.docx");
  expect(nameShape("Иван Петров.pdf")).toBe("Aaaa Aaaaaa.pdf");
  expect(nameShape("名前 レポート.docx")).toBe("aa aaaa.docx");
  expect(nameShape("report.Pérez")).toBe("aaaaaa.Aaaaa"); // a non-ASCII "extension" is masked too
});

test("docx style names are bucketed", async () => {
  const bytes = docx({ body: para("x", "QuillAveryNotes") + para("y", "Heading1"), extraStyles: [["QuillAveryNotes", "Quill Avery Notes"]] });
  const joined = (await inspectFile("s.docx", bytes)).join("\n");
  expect(joined).not.toContain("Quill");
  expect(joined).toContain("paragraph style kinds: {'other': 1, 'heading': 1}");
});

test.each(["bad.pdf", "bad.docx", "bad.zip"])("a damaged file fails cleanly: %s", async (name) => {
  const error = await inspectFile(name, new TextEncoder().encode("Quill Avery secret content")).catch((e) => e);
  expect(error).toBeInstanceOf(InspectionError);
  expect(error.message).not.toContain("Quill");
  expect(error.message).toContain("damaged");
  expect(error.message).toContain("could not inspect");
});

test("an unsupported type", async () => {
  await expect(inspectFile("x.odt", new Uint8Array())).rejects.toThrow("unsupported file type");
});
