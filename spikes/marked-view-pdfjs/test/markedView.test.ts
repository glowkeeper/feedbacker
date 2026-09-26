/** The Python parser's tests for #17, ported for the TypeScript spike (#41). */

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { CRITERION, MarkedViewError, parseMarkedView, RUBRIC_TOTAL } from "../src/markedView.ts";
import { textPdf, type TextLine } from "./pdf.ts";

const REPLICA = new Uint8Array(readFileSync(new URL("../../../fixtures/synthetic/pack-01/marked-view-replica.pdf", import.meta.url)));
const BLACK: [number, number, number] = [0, 0, 0];
const GREY: [number, number, number] = [0.6, 0.6, 0.6];

describe("parsing the observed layout", () => {
  test("parses the replica", async () => {
    const v = await parseMarkedView(REPLICA);
    expect([v.external_id, v.word_count, v.grade, v.grade_max]).toEqual(["100200302", 1805, 60, 100]);
    expect(v.raw_grade).toBe("60 /100");
    expect(v.rubric_total).toBe(59.75);
    expect(v.raw_rubric_total).toBe("59.75 / 100");
    expect(v.warnings).toEqual([]);
    expect(v.general_comment).toBe(
      "Strengths: Jordan built a working planner with clear screens. " +
        "Weaknesses: the timetable bug remains and testing is informal. " +
        "Contact j.pike@example.com if anything is unclear.",
    );
    expect(v.comments.map((c) => [c.number, c.criterion_label, c.page])).toEqual([
      [1, "Requirements", 1],
      [2, "Testing", 2],
      [3, null, 3],
    ]);
    expect(v.comments.map((c) => c.position)).toEqual([0.301, 0.621, 0.451]);
    expect(v.criteria.map((c) => [c.name, c.weight, c.score, c.selected_label])).toEqual([
      ["REQUIREMENTS", 25, 68, "2:1 (68)"],
      ["IMPLEMENTATION", 25, 58, "2:2 (55)"], // the selected level disagrees with the score
      ["TESTING", 25, 58, "2:2 (58)"],
      ["PROFESSIONALISM", 25, 55, "2:2 (55)"],
    ]);
    expect(v.criteria.every((c) => c.levels === 8)).toBe(true);
  });

  test("reports what it cannot find", async () => {
    const v = await parseMarkedView(textPdf([[{ text: "Just some text.", y: 780 }]]));
    expect(v.warnings).toEqual([
      "no image-rendered report pages found; is this a marked view?",
      "no Submission ID found in the header",
      "no grade and general comments section found",
      "no rubric section found",
    ]);
  });

  test("fails clearly on unreadable input", async () => {
    await expect(parseMarkedView(new TextEncoder().encode("This is not a PDF.\n"))).rejects.toThrow(
      new MarkedViewError("the marked view could not be read (InvalidPDFException)"),
    );
  });

  test("warns about comments whose markers are missing", async () => {
    const v = await parseMarkedView(
      textPdf([
        [
          { text: "FINAL GRADE GENERAL COMMENTS", x: 32, y: 760 },
          { text: "PAGE 1", x: 32, y: 700 },
          { text: "Comment 1 | Testing", x: 68, y: 684 },
          { text: "Some testing evident.", x: 68, y: 656 },
          { text: "Comment 2", x: 68, y: 620 },
        ],
      ]),
    );
    expect(v.comments.map((c) => [c.number, c.criterion_label, c.text, c.page, c.position])).toEqual([
      [1, "Testing", "Some testing evident.", 1, null],
      [2, null, "", 1, null],
    ]);
    expect(v.warnings).toContain("no overall grade found");
    expect(v.warnings).toContain("comment 2 has no text");
    expect(v.warnings).toContain(
      "comment 1: its marker was not found on the report pages, so its position is unknown",
    );
  });
});

describe("selected rubric levels", () => {
  const rubric = (selected: number | null, near = false): TextLine[] => {
    const lines: TextLine[] = [
      { text: "RUBRIC: X-1 61.55/100", y: 800, rgb: BLACK },
      { text: "ANALYTICAL (20%) 58/100", y: 780 },
    ];
    [70, 58, 45].forEach((points, i) => {
      const colour = points === selected ? (near ? [0.55, 0.55, 0.55] as typeof GREY : BLACK) : GREY;
      lines.push({ text: `Band ${i} (${points}) A fictional descriptor.`, y: 760 - i * 20, rgb: colour });
    });
    return lines;
  };

  test("the distinctly darkest level is selected", async () => {
    const [c] = (await parseMarkedView(textPdf([rubric(58)]))).criteria;
    expect([c.name, c.weight, c.score, c.max_points, c.raw_score]).toEqual(["ANALYTICAL", 20, 58, 100, "58/100"]);
    expect([c.selected_label, c.selected_points, c.levels]).toEqual(["Band 1 (58)", 58, 3]);
  });

  test("the selected level is found when colours are CMYK", async () => {
    const lines = rubric(58).map((line) => {
      const k = line.rgb === GREY ? 0.4 : line.rgb === BLACK ? 1 : 0.8;
      return `0 0 0 ${k} k BT /F1 10 Tf 60 ${line.y} Td (${line.text}) Tj ET`;
    });
    const v = await parseMarkedView(textPdf([lines]));
    expect([v.criteria[0].selected_label, v.criteria[0].selected_points]).toEqual(["Band 1 (58)", 58]);
    expect(v.warnings.filter((w) => w.includes("selected level"))).toEqual([]);
  });

  test.each([
    ["no level is darker", rubric(null)],
    ["a level is only slightly darker", rubric(58, true)],
  ])("warns rather than guesses when %s", async (_, lines) => {
    const v = await parseMarkedView(textPdf([lines]));
    expect(v.criteria[0].selected_label).toBeNull();
    expect(v.warnings).toContain("criterion 'ANALYTICAL': the selected level could not be identified");
  });
});

test("raw scores keep their written form", () => {
  expect("ANALYTICAL (20%) 58/100".match(CRITERION)!.groups!.raw).toBe("58/100");
  expect("ANALYTICAL (20%) 58.0 /  100".match(CRITERION)!.groups!.raw).toBe("58.0 /  100");
  expect("RUBRIC: X-1 61.55/100".match(RUBRIC_TOTAL)!.groups!.raw).toBe("61.55/100");
});
