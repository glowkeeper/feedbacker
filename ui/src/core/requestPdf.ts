/**
 * Rows and columns from a request document that is a PDF.
 *
 * A PDF holds text positioned on a page, not a table, so rows and columns are recovered from where the words sit: words on one line
 * make a row, and a gap wider than a word space starts a new cell. The cohort table is found by its header, which a table may spread over
 * several lines (a tall cell with its text centred): the header's pieces near the line that says "student ID" are joined by the columns
 * they sit in. Each later row's cells are placed in those columns by where they sit, and the table ends where a line is no longer a row
 * of it (it has no student ID, or something that is not one). The same readers then apply as for Word.
 *
 * Nothing is guessed. A cell that sits across two columns, two cells in one column, or a row that doesn't line up with the header is left
 * out and said (never quoting the file); text that wraps within a cell is not joined to its row; and a PDF that is pictures of
 * pages, with no text, is refused (there is no OCR). Staff named in the file are as safe as in Word: the context reader never reads
 * a row about a person, and nothing is kept of the file itself.
 */

import { isImagePage } from "./extract.ts";
import { PdfDocument } from "./pdf/pdfDocument.ts";
import type { PageContent } from "./pdf/page.ts";
import { extractWords, type Word } from "./pdf/text.ts";

/** A PDF with no text to read (pictures of pages): Feedbacker has no OCR. */
export class ScannedPdfError extends Error {
  constructor() {
    super("this PDF is pictures of pages, with no text to read, and Feedbacker has no OCR; choose the Word (docx) version of the request, or enter the request below");
    this.name = "ScannedPdfError";
  }
}

interface Cell {
  text: string;
  x0: number;
  x1: number;
}

interface Line {
  cells: Cell[];
  top: number;
  bottom: number;
}

const TOLERANCE = 3; // as pdfplumber's, for words on one line
const EDGE = 0.08; // the top and bottom of a page, where a running header or footer sits
const HEADER_REACH = 30; // how far from the "student ID" line a header's other pieces may sit, in points
const HEADER_CELL_MAX = 220; // a header's pieces are short: wider text is prose, not a header's
const CONTINUATION = 20; // a line this close below a row, alone in a column, is text wrapped from it
const ID_WORDS = 2; // a student ID is a word or two (one with a space in it is allowed); more is something else

/** Words on one line, top to bottom: words whose tops are chained within a few points. */
function linesOf(words: Word[]): Word[][] {
  const sorted = [...words].sort((a, b) => a.top - b.top || a.x0 - b.x0);
  const lines: Word[][] = [];
  let lastTop = -Infinity;
  for (const w of sorted) {
    if (lines.length && w.top - lastTop <= TOLERANCE) lines[lines.length - 1].push(w);
    else lines.push([w]);
    lastTop = w.top;
  }
  return lines.map((l) => l.sort((a, b) => a.x0 - b.x0));
}

/** A line's cells: a gap wider than a word space (and so as wide as a table's cell padding) starts a new cell. */
function lineOf(words: Word[]): Line {
  const cells: Cell[] = [];
  for (const w of words) {
    const last = cells[cells.length - 1];
    const size = Math.max(...w.chars.map((c) => c.size), 0);
    if (last && w.x0 - last.x1 <= Math.max(5, size * 0.5)) {
      last.text += ` ${w.text}`;
      last.x1 = Math.max(last.x1, w.x1);
    } else cells.push({ text: w.text, x0: w.x0, x1: w.x1 });
  }
  return { cells, top: Math.min(...words.map((w) => w.top)), bottom: Math.max(...words.map((w) => w.bottom)) };
}

const overlap = (a: Cell, b: Cell) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/**
 * A line's cells in a table's columns, by where each sits: the row, or null where it can't be told (a cell across two columns or none,
 * two cells in one column). A line of a single cell that fits no one column is not a row at all.
 */
function place(cells: Cell[], columns: Cell[]): string[] | "not a row" | null {
  const row = columns.map(() => "");
  for (const cell of cells) {
    const overlapping = columns.flatMap((c, i) => (overlap(c, cell) > 0 ? [i] : []));
    if (overlapping.length !== 1 || row[overlapping[0]] !== "") return cells.length === 1 ? "not a row" : null;
    row[overlapping[0]] = cell.text;
  }
  return row;
}

interface Header {
  /** The lines the header is made of. */
  lines: Set<number>;
  columns: Cell[];
  texts: string[];
  id: number;
}

export interface PdfReading {
  /** Whether a cell's text is the one that says "student ID": where a table's header is looked for. */
  isAnchor(text: string): boolean;
  /** Which column of a header row (its texts) is the student ID, or null if it isn't a cohort table's header: the cohort's reader decides, so a PDF is held to the same rules as a Word file. */
  idColumnOf(texts: string[]): number | null;
}

/**
 * A page's tables' headers. A header is the line with "student ID" and the short pieces of text within a few points of it, joined by the
 * columns they sit in (a piece above or below another in the same columns is one cell's wrapped or centred text). A line whose text under
 * the student ID has a digit is a row, not a header.
 */
function headersOf(lines: Line[], reading: PdfReading): Map<number, Header> {
  const found = new Map<number, Header>();
  const taken = new Set<number>();
  lines.forEach((anchor, a) => {
    const at = anchor.cells.find((c) => reading.isAnchor(c.text) && !/\d/.test(c.text));
    if (!at || taken.has(a)) return;
    const member = (l: Line) =>
      l.top >= anchor.top - HEADER_REACH &&
      l.bottom <= anchor.bottom + HEADER_REACH &&
      l.cells.every((c) => c.x1 - c.x0 <= HEADER_CELL_MAX) &&
      !l.cells.some((c) => overlap(c, at) > 0 && /\d/.test(c.text)); // a row of the table, not its header
    const members = lines.flatMap((l, i) => (i === a || (!taken.has(i) && member(l)) ? [i] : []));
    // The pieces, joined by the columns they sit in: a piece that overlaps an earlier one's columns is part of the same cell.
    const pieces = members.flatMap((i) => lines[i].cells.map((c) => ({ ...c, top: lines[i].top }))).sort((x, y) => x.x0 - y.x0 || x.top - y.top);
    const columns: (Cell & { parts: { top: number; text: string }[] })[] = [];
    for (const p of pieces) {
      const last = columns[columns.length - 1];
      if (last && p.x0 < last.x1) {
        last.x1 = Math.max(last.x1, p.x1);
        last.parts.push({ top: p.top, text: p.text });
      } else columns.push({ text: "", x0: p.x0, x1: p.x1, parts: [{ top: p.top, text: p.text }] });
    }
    const texts = columns.map((c) => c.parts.sort((x, y) => x.top - y.top).map((x) => x.text).join(" "));
    const id = reading.idColumnOf(texts);
    if (id === null) return;
    for (const i of members) taken.add(i);
    found.set(Math.min(...members), { lines: new Set(members), columns, texts, id });
  });
  return found;
}

export interface PdfTables {
  /** The text outside the cohort tables, a row per line (its cells), a table per page. */
  outside: string[][][];
  /** Each cohort table, header row first, a cell per column. */
  tables: string[][][];
  /** What couldn't be read, never quoting the file. */
  flags: string[];
}

/** Read a PDF's text into tables. */
export async function readPdfTables(bytes: Uint8Array, reading: PdfReading): Promise<PdfTables> {
  const pdf = await PdfDocument.open(bytes);
  try {
    const pages: PageContent[] = [];
    for (let n = 1; n <= pdf.pageCount; n++) pages.push(await pdf.page(n));
    if (!pages.some((p) => p.chars.length > 0) || pages.every((p) => isImagePage(p) || p.chars.length === 0)) throw new ScannedPdfError();
    const flags: string[] = [];
    const outside: string[][][] = [];
    const tables: string[][][] = [];
    let active: { columns: Cell[]; id: number; rows: string[][]; last: { page: number; bottom: number } | null } | null = null;
    let unplaced = 0;
    let alone = 0;
    const pagesWithUnplaced = new Set<number>();
    for (const [index, page] of pages.entries()) {
      const pageNumber = index + 1;
      const rest: string[][] = [];
      outside.push(rest);
      if (isImagePage(page)) flags.push(`page ${pageNumber} is a picture, so its text wasn't read`);
      const lines = linesOf(extractWords(page.chars)).map(lineOf);
      const headers = headersOf(lines, reading);
      const inHeader = new Set([...headers.values()].flatMap((h) => [...h.lines]));
      for (const [i, line] of lines.entries()) {
        const header = headers.get(i);
        if (header) {
          const rows = [header.texts];
          tables.push(rows);
          active = { columns: header.columns, id: header.id, rows, last: null };
          continue;
        }
        if (inHeader.has(i)) continue;
        const texts = line.cells.map((c) => c.text);
        const end = () => {
          active = null;
          rest.push(texts);
        };
        if (!active) {
          rest.push(texts);
          continue;
        }
        const edge = line.top < page.height * EDGE || line.bottom > page.height * (1 - EDGE);
        const placed = place(line.cells, active.columns);
        if (placed === "not a row") {
          // A running header or footer at the page's edge doesn't end the table; other text that isn't a row does.
          if (!edge) end();
          continue;
        }
        const idCell = line.cells.find((c) => overlap(c, active!.columns[active!.id]) > 0);
        if (placed === null) {
          // Cells that can't be told apart: a row of the table (it has a student ID) is said; anything else is where the table ends.
          if (idCell && wordCount(idCell.text) <= ID_WORDS) {
            unplaced++;
            pagesWithUnplaced.add(pageNumber);
          } else if (!edge) end();
          continue;
        }
        const idText = placed[active.id];
        const near = active.last !== null && active.last.page === pageNumber && line.top - active.last.bottom < CONTINUATION;
        if (!idText) {
          // Text that wrapped from a cell above sits alone, close below its row: it is not joined to it, and the moderator is told.
          if (placed.filter(Boolean).length === 1 && near) alone++;
          else if (!edge) end();
          continue;
        }
        if (wordCount(idText) > ID_WORDS) {
          if (!edge) end();
          continue;
        }
        active.rows.push(placed);
        active.last = { page: pageNumber, bottom: line.bottom };
      }
    }
    if (unplaced) {
      flags.push(
        `${unplaced} line(s) on page ${[...pagesWithUnplaced].join(", ")} couldn't be placed in the table's columns (a cell across two columns, text that wraps between cells, or a different layout), so they were left out`,
      );
    }
    if (alone) flags.push(`${alone} line(s) in the table of students sit alone in one column (text that wrapped from the cell above), so they were left out and not joined to a row`);
    return { outside: outside.filter((rows) => rows.length), tables, flags };
  } finally {
    await pdf.close();
  }
}
