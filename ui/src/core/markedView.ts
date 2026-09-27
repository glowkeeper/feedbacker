/**
 * Parse a marked "current view" PDF (e.g. Turnitin Feedback Studio): a port
 * of `core/src/feedbacker_core/marked_view.py` (#17), moved in from the #41
 * spike (#52).
 *
 * The layout was established by structure-only inspection of a real current
 * view (no content was read):
 *
 * - a header page with "Submission ID: <id>", "File name: ...", "Word count: N";
 * - the report pages, rendered as full-page images; their only text is the
 *   numbers of the comment markers, placed inline beside the commented text;
 * - a feedback section: a "... GRADE ... GENERAL COMMENTS" header, the grade
 *   in a left column with "/<max>" beneath it, and the general comment to
 *   the right; then "PAGE <n>" groups of "Comment <N> | <criterion tag>"
 *   headings, each followed by its text;
 * - rubric pages: "RUBRIC: <name> <total> / <max>", then for each criterion
 *   a header "<NAME> (<weight>%) <score> / <max>", its description, and its
 *   levels "<label> (<points>) <descriptor>". The selected level is printed
 *   in a distinctly darker colour than the others.
 *
 * Parsing relies on those text cues and on relative colour, never on
 * absolute positions or theme colours. Anything that cannot be read is
 * reported as a warning, never guessed. pdf.js's operator list is read as
 * pdfminer and pdfplumber would read it (pdf/), and the patterns use
 * Python's `\d` and `\s` (pyre.ts), so both cores read the same things.
 */

import { ExtractionError, isImagePage } from "./extract.ts";
import { PdfDocument } from "./pdf/pdfDocument.ts";
import type { Char, PageContent } from "./pdf/page.ts";
import { extractTextLines, extractWords, type Line } from "./pdf/text.ts";
import { D, pyIgnoreCase, S } from "./pyre.ts";
import { pyFloat, pyInt, pyRound, pyStrip } from "./pytext.ts";

export interface ParsedComment {
  number: number;
  criterion_label: string | null;
  text: string;
  page: number | null;
  position: number | null;
}

export interface ParsedCriterion {
  name: string;
  weight: number;
  score: number;
  max_points: number;
  raw_score: string; // the score exactly as written, e.g. "68 / 100"
  selected_label: string | null;
  selected_points: number | null;
  levels: number;
}

/** What a marked view says. Field names are the Python parser's. */
export interface MarkedView {
  external_id: string | null;
  word_count: number | null;
  grade: number | null;
  grade_max: number | null;
  raw_grade: string | null; // the grade exactly as written, e.g. "62 /100"
  general_comment: string | null;
  comments: ParsedComment[];
  rubric_total: number | null;
  rubric_max: number | null;
  raw_rubric_total: string | null;
  criteria: ParsedCriterion[];
  warnings: string[];
}

const NUMBER = `[${D}]+(?:\\.[${D}]+)?`;
const SUBMISSION_ID = new RegExp(`^Submission ID:[${S}]*([^${S}]+)`, "u");
const WORD_COUNT = new RegExp(`^Word count:[${S}]*([${D},]+)`, "u");
const GENERAL_HEADER = new RegExp(pyIgnoreCase("GENERAL COMMENTS"), "u");
const PAGE_MARK = new RegExp(`^PAGE[${S}]+([${D}]+)$`, "u");
const COMMENT = new RegExp(`^Comment[${S}]+([${D}]+)(?:[${S}]*\\|[${S}]*(.+?))?[${S}]*$`, "u");
export const RUBRIC_TOTAL = new RegExp(`^RUBRIC:.*?(?<raw>(${NUMBER})[${S}]*\\/[${S}]*(${NUMBER}))[${S}]*$`, "u");
export const CRITERION = new RegExp(`^(.+?)[${S}]*\\((${NUMBER})%\\)[${S}]+(?<raw>(${NUMBER})[${S}]*\\/[${S}]*(${NUMBER}))[${S}]*$`, "u");
const LEVEL = new RegExp(`^(?<label>[^()]{1,24}?[${S}]*\\((?<points>${NUMBER})\\))(?:[${S}]|$)`, "u");
const GRADE = new RegExp(`^${NUMBER}$`, "u");
const GRADE_MAX = new RegExp(`^\\/[${S}]*(${NUMBER})$`, "u");
const MARKER_NUMBER = new RegExp(`^[${D}]+$`, "u");

type PageLine = Line & { page_width: number };
type Markers = Map<number, [number, number]>;
/** How pages are read: replaceable in tests, as the Python tests replace `_read_pages`. */
export type PageReader = (pdf: PdfDocument) => Promise<[number, Markers, PageLine[]]>;

const float = (s: string) => pyFloat(s)!; // the patterns only match numbers
const int = (s: string) => Number(pyInt(s)!);

/**
 * Lower luminance = darker, averaged over a line's visible characters. pdf.js
 * gives every fill as RGB (it converts grey and CMYK), so the selected level
 * is found by true darkness whatever the colour space (decided 2026-09-26).
 */
export function darkness(chars: Char[]): number {
  const values = chars.filter((c) => pyStrip(c.text) && c.colour).map((c) => 0.2126 * c.colour![0] + 0.7152 * c.colour![1] + 0.0722 * c.colour![2]);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

const emptyView = (): MarkedView => ({
  external_id: null,
  word_count: null,
  grade: null,
  grade_max: null,
  raw_grade: null,
  general_comment: null,
  comments: [],
  rubric_total: null,
  rubric_max: null,
  raw_rubric_total: null,
  criteria: [],
  warnings: [],
});

/** Collect marker positions from image pages and text lines from the rest. */
export const readPages: PageReader = async (pdf) => {
  let reportPage = 0;
  const markers: Markers = new Map();
  const lines: PageLine[] = [];
  for (let n = 1; n <= pdf.pageCount; n++) {
    const page: PageContent = await pdf.page(n);
    if (isImagePage(page)) {
      reportPage++;
      // Report pages carry no text except the comment-marker numbers.
      for (const w of extractWords(page.chars)) {
        if (MARKER_NUMBER.test(w.text)) {
          const centre = (w.top + w.bottom) / 2 / page.height;
          if (!markers.has(int(w.text))) markers.set(int(w.text), [reportPage, pyRound(centre, 3)]);
        }
      }
      continue;
    }
    for (const line of extractTextLines(page.chars)) lines.push({ ...line, page_width: page.width });
  }
  return [reportPage, markers, lines];
};

export async function parseMarkedView(bytes: Uint8Array, pageReader: PageReader = readPages): Promise<MarkedView> {
  let pdf: PdfDocument;
  try {
    pdf = await PdfDocument.open(bytes);
  } catch (err) {
    throw new ExtractionError(`the marked view could not be read (${(err as Error).name})`);
  }
  let read: [number, Markers, PageLine[]];
  try {
    read = await pageReader(pdf);
  } catch (err) {
    // pdf.js raises assorted errors on damaged pages
    throw new ExtractionError(`the marked view could not be read (${(err as Error).name})`);
  } finally {
    await pdf.close();
  }
  return interpret(emptyView(), ...read);
}

function interpret(view: MarkedView, reportPage: number, markers: Markers, lines: PageLine[]): MarkedView {
  if (reportPage === 0) view.warnings.push("no image-rendered report pages found; is this a marked view?");
  parseHeader(lines, view);
  const feedbackStart = lines.findIndex((ln) => GENERAL_HEADER.test(ln.text));
  const rubricStart = lines.findIndex((ln) => RUBRIC_TOTAL.test(ln.text));
  if (feedbackStart < 0) view.warnings.push("no grade and general comments section found");
  else parseFeedback(lines.slice(feedbackStart + 1, rubricStart >= 0 ? rubricStart : lines.length), view);
  if (rubricStart < 0) view.warnings.push("no rubric section found");
  else parseRubric(lines.slice(rubricStart), view);

  for (const c of view.comments) {
    const marker = markers.get(c.number);
    if (!marker) {
      view.warnings.push(`comment ${c.number}: its marker was not found on the report pages, so its position is unknown`);
      continue;
    }
    const [page, position] = marker;
    if (c.page !== null && c.page !== page) view.warnings.push(`comment ${c.number}: listed under page ${c.page} but its marker is on page ${page}`);
    c.page = c.page || page;
    c.position = position;
  }
  return view;
}

function parseHeader(lines: PageLine[], view: MarkedView): void {
  for (const ln of lines.slice(0, 20)) {
    const text = pyStrip(ln.text);
    let m: RegExpExecArray | null;
    if ((m = SUBMISSION_ID.exec(text)) && view.external_id === null) view.external_id = m[1];
    else if ((m = WORD_COUNT.exec(text)) && view.word_count === null) view.word_count = int(m[1].replaceAll(",", ""));
  }
  if (view.external_id === null) view.warnings.push("no Submission ID found in the header");
}

function parseFeedback(lines: PageLine[], view: MarkedView): void {
  const general: string[] = [];
  const gradeWords: string[] = [];
  let current: ParsedComment | null = null;
  let page: number | null = null;
  let inComments = false;
  for (const ln of lines) {
    const text = pyStrip(ln.text);
    let m: RegExpExecArray | null;
    if ((m = PAGE_MARK.exec(text))) {
      inComments = true;
      page = int(m[1]);
      continue;
    }
    if ((m = COMMENT.exec(text))) {
      inComments = true;
      current = { number: int(m[1]), criterion_label: m[2] ?? null, text: "", page, position: null };
      view.comments.push(current);
      continue;
    }
    if (!inComments) {
      // Grade column on the left, general comment to the right.
      const left = ln.page_width * 0.3;
      const words = gapWords(ln);
      for (const w of words) {
        let g: RegExpExecArray | null;
        if (w.x0 < left && GRADE.test(w.text) && view.grade === null) {
          view.grade = float(w.text);
          gradeWords.push(w.text);
        } else if (w.x0 < left && (g = GRADE_MAX.exec(w.text))) {
          view.grade_max = float(g[1]);
          gradeWords.push(w.text);
        }
      }
      const rest = words.filter((w) => w.x0 >= left).map((w) => w.text).join(" ");
      if (rest) general.push(rest);
      continue;
    }
    if (current && text && text !== "-") current.text = pyStrip(`${current.text} ${text}`);
  }
  view.general_comment = pyStrip(general.join(" ")) || null;
  view.raw_grade = gradeWords.join(" ") || null;
  if (view.grade === null) view.warnings.push("no overall grade found");
  for (const c of view.comments) if (!c.text) view.warnings.push(`comment ${c.number} has no text`);
}

/**
 * Split a line into words by the gaps between characters. Some PDFs contain
 * no space characters at all, so a gap wider than a quarter of the character
 * size starts a new word. Words keep their left position.
 */
function gapWords(line: Line): { text: string; x0: number }[] {
  const words: { text: string; x0: number }[] = [];
  let current: { text: string; x0: number } | null = null;
  let previous: Char | null = null;
  for (const ch of line.chars) {
    if (!pyStrip(ch.text)) {
      current = previous = null;
      continue;
    }
    const gap = previous ? ch.x0 - previous.x1 : 0;
    if (current === null || gap > Math.max(1, 0.25 * previous!.size)) {
      current = { text: ch.text, x0: ch.x0 };
      words.push(current);
    } else current.text += ch.text;
    previous = ch;
  }
  return words;
}

function parseRubric(lines: PageLine[], view: MarkedView): void {
  const total = RUBRIC_TOTAL.exec(pyStrip(lines[0].text));
  if (total) {
    view.rubric_total = float(total[2]);
    view.rubric_max = float(total[3]);
    view.raw_rubric_total = total.groups!.raw;
  }
  const levelLines: [PageLine, RegExpExecArray][][] = [];
  for (const ln of lines.slice(1)) {
    const text = pyStrip(ln.text);
    let m: RegExpExecArray | null;
    if ((m = CRITERION.exec(text))) {
      view.criteria.push({
        name: pyStrip(m[1]),
        weight: float(m[2]),
        score: float(m[4]),
        max_points: float(m[5]),
        raw_score: m.groups!.raw,
        selected_label: null,
        selected_points: null,
        levels: 0,
      });
      levelLines.push([]);
    } else if (view.criteria.length && (m = LEVEL.exec(text))) levelLines.at(-1)!.push([ln, m]);
  }
  view.criteria.forEach((criterion, i) => {
    const levels = levelLines[i];
    criterion.levels = levels.length;
    if (!levels.length) {
      view.warnings.push(`criterion '${criterion.name}': no levels found`);
      return;
    }
    const dark = levels.map(([ln]) => darkness(ln.chars));
    const darkest = Math.min(...dark);
    const typical = [...dark].sort((a, b) => a - b)[Math.floor(dark.length / 2)];
    const chosen = dark.flatMap((d, j) => (d === darkest ? [j] : []));
    if (chosen.length !== 1 || typical - darkest < 0.1) {
      view.warnings.push(`criterion '${criterion.name}': the selected level could not be identified`);
      return;
    }
    const [, m] = levels[chosen[0]];
    criterion.selected_label = pyStrip(m.groups!.label);
    criterion.selected_points = float(m.groups!.points);
  });
}
