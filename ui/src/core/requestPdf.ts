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
 * out and said (never quoting the file); text that wraps within a cell is not joined to its row, except a student's name wrapped onto a
 * second line (below); and a PDF that is pictures of
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
  /** Where this cell's own last line ends, so a line can be told to continue it (and not the row's other, taller cells). */
  bottom: number;
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
const BAND_LINE = /^\d{1,3}\s*(\+|[-–]\s*\d{1,3})/; // a grade band's line ("70+ 3"), which is a row of its own, not wrapped text
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
      last.bottom = Math.max(last.bottom, w.bottom);
    } else cells.push({ text: w.text, x0: w.x0, x1: w.x1, bottom: w.bottom });
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
  /** Whether a cell's text in the student ID column is really a label of the form (a convener's row, say), so the table has ended there. */
  endsTable(text: string): boolean;
  /** Whether a label's value is the kind a staff name could be taken for (the programme, the module): a row about a person ("Programme Leader") that wrapped could be read as it. */
  isPersonRisk(label: string): boolean;
}

/**
 * A page's tables' headers. A header is the line with "student ID" and the short pieces of text within a few points of it (above it, and below it up to the
 * first line with something in the student ID column, which is a row), joined by the columns they sit in (a piece above or below another
 * in the same columns is one cell's wrapped or centred text).
 */
function headersOf(lines: Line[], reading: PdfReading): Map<number, Header> {
  const found = new Map<number, Header>();
  const taken = new Set<number>();
  lines.forEach((anchor, a) => {
    const at = anchor.cells.find((c) => reading.isAnchor(c.text));
    if (!at || taken.has(a)) return;
    const fragment = (l: Line) => l.cells.every((c) => c.x1 - c.x0 <= HEADER_CELL_MAX && !BAND_LINE.test(c.text)); // a grade band's line is context, not a header's
    // Above the "student ID" line, short pieces within reach are the header's. Below it, pieces are too, until the first line with something in the student ID column: that is a row.
    const members = [a];
    for (let i = a - 1; i >= 0 && lines[i].top >= anchor.top - HEADER_REACH; i--) if (!taken.has(i) && fragment(lines[i])) members.push(i);
    for (let i = a + 1; i < lines.length && lines[i].bottom <= anchor.bottom + HEADER_REACH; i++) {
      if (lines[i].cells.some((c) => overlap(c, at) > 0)) break;
      if (!taken.has(i) && fragment(lines[i])) members.push(i);
    }
    // The pieces, joined by the columns they sit in: a piece that overlaps an earlier one's columns is part of the same cell.
    const pieces = members.flatMap((i) => lines[i].cells.map((c) => ({ ...c, top: lines[i].top }))).sort((x, y) => x.x0 - y.x0 || x.top - y.top);
    const columns: (Cell & { parts: { top: number; text: string }[] })[] = [];
    for (const p of pieces) {
      const last = columns[columns.length - 1];
      if (last && p.x0 < last.x1) {
        last.x1 = Math.max(last.x1, p.x1);
        last.parts.push({ top: p.top, text: p.text });
      } else columns.push({ text: "", x0: p.x0, x1: p.x1, bottom: p.bottom, parts: [{ top: p.top, text: p.text }] });
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

/**
 * The text outside the tables, a row per line. Whether a line of a single cell just below a row's label is that label wrapped (a row about
 * a person, "Programme Leader", whose "Leader" wrapped onto a second line, with the person's name beside "Programme") or the start of the next
 * row (whose value sits lower) can't be told from where the text is. So a row whose value could be a staff name (the programme, the module)
 * and that has such a line under its label is left unread, and said, rather than risk reading a name as a programme. A line of a single cell
 * under a row's value (not its label), close below the value's own last line, is the value wrapped, and is joined to it.
 */
function rowsOutside(lines: Line[], reading: PdfReading): { rows: string[][]; ambiguous: number } {
  const out: Cell[][] = [];
  let ambiguous = 0;
  for (const line of lines) {
    const previous = out[out.length - 1];
    if (previous && previous.length >= 2 && line.cells.length === 1 && !BAND_LINE.test(line.cells[0].text)) {
      const under = previous.filter((c) => overlap(c, line.cells[0]) > 0);
      if (under.length === 1 && line.top - under[0].bottom < CONTINUATION) {
        if (under[0] !== previous[0]) {
          under[0].text += ` ${line.cells[0].text}`; // the value wrapped
          under[0].bottom = line.bottom;
          continue;
        }
        if (reading.isPersonRisk(previous[0].text)) {
          out.pop();
          ambiguous++;
        }
      }
    }
    out.push(line.cells.map((c) => ({ ...c })));
  }
  return { rows: out.map((cells) => cells.map((c) => c.text)), ambiguous };
}

/** Whether a line has a cell that could be a student ID (a digit in it, a word or two), wherever it sits. */
const hasIdLike = (cells: Cell[]) => cells.some((c) => /\d/.test(c.text) && wordCount(c.text) <= ID_WORDS);

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
    let active: { columns: Cell[]; id: number; name: number; rows: string[][]; last: { page: number; bottom: number } | null } | null = null;
    let unplaced = 0;
    let alone = 0;
    let joined = 0;
    let ambiguous = 0;
    const pagesWithUnplaced = new Set<number>();
    for (const [index, page] of pages.entries()) {
      const pageNumber = index + 1;
      const rest: Line[] = [];
      if (isImagePage(page)) flags.push(`page ${pageNumber} is a picture, so its text wasn't read`);
      const lines = linesOf(extractWords(page.chars)).map(lineOf);
      const headers = headersOf(lines, reading);
      const inHeader = new Set([...headers.values()].flatMap((h) => [...h.lines]));
      for (const [i, line] of lines.entries()) {
        const header = headers.get(i);
        if (header) {
          const rows = [header.texts];
          tables.push(rows);
          active = { columns: header.columns, id: header.id, name: header.texts.findIndex((t, c) => c !== header.id && /\bname\b/i.test(t)), rows, last: null };
          continue;
        }
        if (inHeader.has(i)) continue;
        const end = () => {
          active = null;
          rest.push(line);
        };
        if (!active) {
          rest.push(line);
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
        if (idCell && reading.endsTable(idCell.text)) {
          end(); // a row about the module or a person (a convener's), not a student's
          continue;
        }
        if (placed === null) {
          // Cells that can't be told apart. If the line has a student ID (where the table says, or anywhere: the layout may have moved
          // on a new page) it is a row that couldn't be placed, and is said; anything else is where the table ends.
          if ((idCell && wordCount(idCell.text) <= ID_WORDS) || (!idCell && hasIdLike(line.cells))) {
            unplaced++;
            pagesWithUnplaced.add(pageNumber);
          } else if (!edge) end();
          continue;
        }
        const idText = placed[active.id];
        const filled = placed.filter(Boolean).length;
        const near = active.last !== null && active.last.page === pageNumber && line.top - active.last.bottom < CONTINUATION;
        if (!idText) {
          if (filled === 1 && near) {
            // Text that wrapped from a cell above. A student's name that wrapped onto a second line, in the table's name column, with a student ID in the row above,
            // is joined to the name, and said, when nothing else could claim it: it sits closer to that row than to the next line (a cell whose text is centred
            // puts the name's first line above its own row's ID, as close to the row before as to its own). Any other wrapped text is left out, and said.
            const above = active.rows.at(-1)!;
            const gapAbove = line.top - active.last!.bottom;
            const next = lines[i + 1];
            const claimed = next !== undefined && next.top - line.bottom <= gapAbove + TOLERANCE;
            if (active.name >= 0 && placed[active.name] && above[active.id] && above[active.name] && !claimed) {
              above[active.name] = `${above[active.name]} ${placed[active.name]}`;
              active.last = { page: pageNumber, bottom: line.bottom };
              joined++;
            } else alone++;
          } else if (filled >= 2) {
            // A row with no student ID, or two cells that both wrapped: the reader of the cohort says it was left out, row by row; the table goes on.
            active.rows.push(placed);
          } else if (!edge) end();
          continue;
        }
        if (wordCount(idText) > ID_WORDS) {
          if (!edge) end();
          continue;
        }
        active.rows.push(placed);
        active.last = { page: pageNumber, bottom: line.bottom };
      }
      const kept = rowsOutside(rest, reading);
      outside.push(kept.rows);
      ambiguous += kept.ambiguous;
    }
    if (unplaced) {
      flags.push(
        `${unplaced} line(s) on page ${[...pagesWithUnplaced].join(", ")} couldn't be placed in the table's columns (a cell across two columns, text that wraps between cells, or a different layout), so they were left out`,
      );
    }
    if (joined) flags.push(`${joined} line(s) in the table of students were a name wrapped onto a second line, and were joined to the name above it; check the names in the sample`);
    if (alone) flags.push(`${alone} line(s) in the table of students sit alone in one column (text that wrapped from the cell above), so they were left out and not joined to a row`);
    if (ambiguous) flags.push(`${ambiguous} row(s) of the form's context (the programme or module) have a line wrapped beneath their label, which could be a row about a person, so they were left unread; enter them below if they weren't`);
    return { outside: outside.filter((rows) => rows.length), tables, flags };
  } finally {
    await pdf.close();
  }
}
