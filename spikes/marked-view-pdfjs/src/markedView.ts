/**
 * Parse a marked "current view" PDF (e.g. Turnitin Feedback Studio): a port
 * of `core/src/feedbacker_core/marked_view.py` (#17) to TypeScript and pdf.js,
 * for the #41 spike. The layout, cues and warnings are the Python parser's;
 * see its module docstring. Output fields keep the Python names so the two
 * can be compared directly.
 *
 * Parsing relies on text cues and on relative colour, never on absolute
 * positions or theme colours. Anything that cannot be read is reported as a
 * warning, never guessed.
 */

import { getDocument } from "#pdfjs";
import { readPage, type Char, type PageContent } from "./page.ts";
import { extractTextLines, extractWords, type Line } from "./text.ts";

export class MarkedViewError extends Error {}

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
  raw_score: string;
  selected_label: string | null;
  selected_points: number | null;
  levels: number;
}

export interface MarkedView {
  external_id: string | null;
  word_count: number | null;
  grade: number | null;
  grade_max: number | null;
  raw_grade: string | null;
  general_comment: string | null;
  comments: ParsedComment[];
  rubric_total: number | null;
  rubric_max: number | null;
  raw_rubric_total: string | null;
  criteria: ParsedCriterion[];
  warnings: string[];
}

const SUBMISSION_ID = /^Submission ID:\s*(\S+)/;
const WORD_COUNT = /^Word count:\s*([\d,]+)/;
const GENERAL_HEADER = /GENERAL COMMENTS/i;
const PAGE_MARK = /^PAGE\s+(\d+)$/;
const COMMENT = /^Comment\s+(\d+)(?:\s*\|\s*(.+?))?\s*$/;
export const RUBRIC_TOTAL = /^RUBRIC:.*?(?<raw>(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?))\s*$/;
export const CRITERION = /^(.+?)\s*\((\d+(?:\.\d+)?)%\)\s+(?<raw>(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?))\s*$/;
const LEVEL = /^(?<label>[^()]{1,24}?\s*\((?<points>\d+(?:\.\d+)?)\))(?:\s|$)/;
const GRADE = /^\d+(?:\.\d+)?$/;
const GRADE_MAX = /^\/\s*(\d+(?:\.\d+)?)$/;

// The image-page test from `extract.py`.
const IMAGE_PAGE_MAX_CHARS = 40;
const IMAGE_PAGE_MIN_COVERAGE = 0.6;

type PageLine = Line & { page_width: number };
type Markers = Map<number, [number, number]>;

/** Python's `round(x, 3)` for values that are not exact binary ties. */
const round3 = (x: number) => Number(x.toFixed(3));

function isImagePage(page: PageContent): boolean {
  if (page.chars.length > IMAGE_PAGE_MAX_CHARS || page.images.length === 0) return false;
  const area = page.width * page.height || 1;
  const largest = Math.max(...page.images.map((im) => (im.x1 - im.x0) * (im.bottom - im.top)));
  return largest / area >= IMAGE_PAGE_MIN_COVERAGE;
}

/** Lower luminance = darker. Averaged over a line's visible characters. */
function darkness(chars: Char[]): number {
  const values = chars
    .filter((c) => c.text.trim() && c.colour)
    .map((c) => 0.2126 * c.colour![0] + 0.7152 * c.colour![1] + 0.0722 * c.colour![2]);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

export async function parseMarkedView(data: Uint8Array): Promise<MarkedView> {
  const view: MarkedView = {
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
  };
  let read: Awaited<ReturnType<typeof readPages>>;
  // pdf.js takes ownership of the buffer it is given, so pass a copy.
  const task = getDocument({ data: data.slice(), verbosity: 0 });
  try {
    const pdf = await task.promise;
    read = await readPages(pdf);
  } catch (err) {
    const name = err instanceof Error ? err.name : typeof err;
    throw new MarkedViewError(`the marked view could not be read (${name})`, { cause: err });
  } finally {
    await task.destroy();
  }
  return interpret(view, ...read);
}

async function readPages(pdf: { numPages: number; getPage(n: number): Promise<any> }) {
  let reportPage = 0;
  const markers: Markers = new Map();
  const lines: PageLine[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await readPage(await pdf.getPage(n));
    if (isImagePage(page)) {
      reportPage++;
      // Report pages carry no text except the comment-marker numbers.
      for (const w of extractWords(page.chars)) {
        if (/^[0-9]+$/.test(w.text)) {
          const centre = (w.top + w.bottom) / 2 / page.height;
          const number = parseInt(w.text, 10);
          if (!markers.has(number)) markers.set(number, [reportPage, round3(centre)]);
        }
      }
      continue;
    }
    for (const line of extractTextLines(page.chars)) lines.push({ ...line, page_width: page.width });
  }
  return [reportPage, markers, lines] as const;
}

function interpret(view: MarkedView, reportPage: number, markers: Markers, lines: readonly PageLine[]): MarkedView {
  if (reportPage === 0) view.warnings.push("no image-rendered report pages found; is this a marked view?");

  parseHeader(lines, view);
  const feedbackStart = lines.findIndex((ln) => GENERAL_HEADER.test(ln.text));
  const rubricStart = lines.findIndex((ln) => RUBRIC_TOTAL.test(ln.text));
  if (feedbackStart < 0) {
    view.warnings.push("no grade and general comments section found");
  } else {
    parseFeedback(lines.slice(feedbackStart + 1, rubricStart >= 0 ? rubricStart : lines.length), view);
  }
  if (rubricStart < 0) view.warnings.push("no rubric section found");
  else parseRubric(lines.slice(rubricStart), view);

  for (const c of view.comments) {
    const marker = markers.get(c.number);
    if (!marker) {
      view.warnings.push(
        `comment ${c.number}: its marker was not found on the report pages, so its position is unknown`,
      );
      continue;
    }
    const [page, position] = marker;
    if (c.page !== null && c.page !== page) {
      view.warnings.push(`comment ${c.number}: listed under page ${c.page} but its marker is on page ${page}`);
    }
    c.page = c.page || page;
    c.position = position;
  }
  return view;
}

function parseHeader(lines: readonly PageLine[], view: MarkedView): void {
  for (const ln of lines.slice(0, 20)) {
    const text = ln.text.trim();
    let m: RegExpMatchArray | null;
    if ((m = text.match(SUBMISSION_ID)) && view.external_id === null) view.external_id = m[1];
    else if ((m = text.match(WORD_COUNT)) && view.word_count === null) view.word_count = parseInt(m[1].replaceAll(",", ""), 10);
  }
  if (view.external_id === null) view.warnings.push("no Submission ID found in the header");
}

function parseFeedback(lines: readonly PageLine[], view: MarkedView): void {
  const general: string[] = [];
  const gradeWords: string[] = [];
  let current: ParsedComment | null = null;
  let page: number | null = null;
  let inComments = false;
  for (const ln of lines) {
    const text = ln.text.trim();
    let m: RegExpMatchArray | null;
    if ((m = text.match(PAGE_MARK))) {
      inComments = true;
      page = parseInt(m[1], 10);
      continue;
    }
    if ((m = text.match(COMMENT))) {
      inComments = true;
      current = { number: parseInt(m[1], 10), criterion_label: m[2] ?? null, text: "", page, position: null };
      view.comments.push(current);
      continue;
    }
    if (!inComments) {
      // Grade column on the left, general comment to the right.
      const left = ln.page_width * 0.3;
      const words = gapWords(ln);
      for (const w of words) {
        let g: RegExpMatchArray | null;
        if (w.x0 < left && GRADE.test(w.text) && view.grade === null) {
          view.grade = parseFloat(w.text);
          gradeWords.push(w.text);
        } else if (w.x0 < left && (g = w.text.match(GRADE_MAX))) {
          view.grade_max = parseFloat(g[1]);
          gradeWords.push(w.text);
        }
      }
      const rest = words.filter((w) => w.x0 >= left).map((w) => w.text).join(" ");
      if (rest) general.push(rest);
      continue;
    }
    if (current && text && text !== "-") current.text = `${current.text} ${text}`.trim();
  }
  view.general_comment = general.join(" ").trim() || null;
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
    if (!ch.text.trim()) {
      current = previous = null;
      continue;
    }
    const gap = previous ? ch.x0 - previous.x1 : 0;
    if (current === null || gap > Math.max(1, 0.25 * previous!.size)) {
      current = { text: ch.text, x0: ch.x0 };
      words.push(current);
    } else {
      current.text += ch.text;
    }
    previous = ch;
  }
  return words;
}

function parseRubric(lines: readonly PageLine[], view: MarkedView): void {
  const total = lines[0].text.trim().match(RUBRIC_TOTAL);
  if (total) {
    view.rubric_total = parseFloat(total[2]);
    view.rubric_max = parseFloat(total[3]);
    view.raw_rubric_total = total.groups!.raw;
  }
  const levelLines: [PageLine, RegExpMatchArray][][] = [];
  for (const ln of lines.slice(1)) {
    const text = ln.text.trim();
    let m: RegExpMatchArray | null;
    if ((m = text.match(CRITERION))) {
      view.criteria.push({
        name: m[1].trim(),
        weight: parseFloat(m[2]),
        score: parseFloat(m[4]),
        max_points: parseFloat(m[5]),
        raw_score: m.groups!.raw,
        selected_label: null,
        selected_points: null,
        levels: 0,
      });
      levelLines.push([]);
    } else if (view.criteria.length && (m = text.match(LEVEL))) {
      levelLines[levelLines.length - 1].push([ln, m]);
    }
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
    criterion.selected_label = m.groups!.label.trim();
    criterion.selected_points = parseFloat(m.groups!.points);
  });
}

/** Each page's classification and text lines, to compare the text layer with pdfplumber's. */
export async function readLayout(data: Uint8Array) {
  const task = getDocument({ data: data.slice(), verbosity: 0 });
  try {
    const pdf = await task.promise;
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await readPage(await pdf.getPage(n));
      pages.push({
        image: isImagePage(page),
        chars: page.chars.length,
        lines: extractTextLines(page.chars).map((ln) => [ln.text, Number(darkness(ln.chars).toFixed(2))]),
      });
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
