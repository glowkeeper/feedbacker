/**
 * Choosing a sample from a cohort, by a scheme the moderator picks.
 *
 * Every scheme is a pure, repeatable function of the cohort's rows (their marks) and its options: the same input gives the same
 * sample, and the one scheme with chance in it takes a seed that is recorded. Nothing is chosen for the moderator: a scheme
 * only suggests, and they can change what it picks by hand. Only students who submitted, with a mark that can be used, can be picked.
 */

import type { BandFinding } from "./requestDocument.ts";

/** What fraction of those who submitted to sample, unless the moderator says otherwise: a tenth, rounded up. */
export const DEFAULT_SAMPLE_PERCENT = 10;
/** The lowest mark that passes, for the scheme that always includes every fail (a taught master's, for example, may pass at 50). */
export const DEFAULT_PASS_MARK = 40;
/** How close to a band's boundary a mark is "near" it, in marks, for the boundary scheme. */
export const DEFAULT_BOUNDARY_DISTANCE = 2;

export type Scheme = "spread" | "boundary" | "random" | "changed" | "hand";

export const SCHEMES: { scheme: Scheme; label: string; about: string }[] = [
  {
    scheme: "spread",
    label: "A spread across the bands",
    about: "The highest and lowest marks, then every fail, then the mark nearest each band boundary, then the rest spaced evenly through the marks. It is the usual choice.",
  },
  { scheme: "boundary", label: "Marks near a band boundary", about: "The marks closest to a boundary between bands, where a small difference changes the result." },
  { scheme: "random", label: "At random, from a seed", about: "A random choice that anyone can repeat from the seed, which is recorded." },
  { scheme: "changed", label: "Marks changed by internal moderation", about: "The marks that moved furthest between the initial mark and the agreed mark after the partner's internal moderation." },
  { scheme: "hand", label: "Pick by hand", about: "Nothing is suggested: you tick the students." },
];

/** The sample's size: the percentage of those who submitted, always rounded up, and never more than there are, nor none of a cohort that has any. */
export function sampleSize(submitted: number, percent: number): number {
  if (submitted <= 0 || !(percent > 0)) return 0;
  return Math.min(submitted, Math.max(1, Math.ceil((submitted * percent) / 100 - 1e-9)));
}

/** A student who can be sampled, as the scheme sees them: only a row, and the marks. */
export interface Candidate {
  row: number;
  initial: number | null;
  agreed: number | null;
}

export interface SchemeOptions {
  /** How many to pick. */
  size: number;
  bands?: Pick<BandFinding, "label" | "from" | "to">[];
  passMark?: number;
  distance?: number;
  seed?: string;
}

export interface Suggestion {
  /** The rows suggested, in the order the scheme picked them. */
  rows: number[];
  /** Why fewer than the size were found, or what the scheme couldn't do. */
  notes: string[];
}

const byMarkDescending = (a: Candidate & { initial: number }, b: Candidate & { initial: number }) => b.initial - a.initial || a.row - b.row;
const marked = (candidates: Candidate[]) => candidates.filter((c): c is Candidate & { initial: number } => c.initial !== null);

/** The marks that bands start at, other than zero: the boundaries between one band and the next. */
export const boundariesOf = (bands: SchemeOptions["bands"] = []) => [...new Set(bands.map((b) => b.from).filter((m) => m > 0))].sort((a, b) => b - a);

/** A small, well-known seeded generator, so a seed always gives the same sequence. */
function random(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (Math.imul(h ^ (h >>> 16), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Add rows not yet taken, in order, until there are `size`. */
function take(chosen: number[], more: number[], size: number) {
  for (const r of more) if (chosen.length < size && !chosen.includes(r)) chosen.push(r);
}

/** What `scheme` suggests from the candidates. "hand" suggests nothing. */
export function suggest(scheme: Scheme, candidates: Candidate[], options: SchemeOptions): Suggestion {
  const size = Math.min(options.size, candidates.length);
  const notes: string[] = [];
  const chosen: number[] = [];
  if (scheme === "hand" || size <= 0) return { rows: [], notes };
  const withMarks = marked(candidates).sort(byMarkDescending);

  if (scheme === "spread") {
    if (!withMarks.length) return { rows: [], notes: ["None of the students has a mark to spread the sample across."] };
    take(chosen, [withMarks[0].row, withMarks.at(-1)!.row], size); // the highest and lowest
    const passMark = options.passMark ?? DEFAULT_PASS_MARK;
    const fails = withMarks.filter((c) => c.initial < passMark).sort((a, b) => a.initial - b.initial || a.row - b.row);
    take(chosen, fails.map((c) => c.row), size);
    if (fails.some((c) => !chosen.includes(c.row))) notes.push(`${fails.length} student(s) failed (below ${passMark}), and the sample has room for only some of them.`);
    for (const boundary of boundariesOf(options.bands)) {
      const nearest = [...withMarks].sort((a, b) => Math.abs(a.initial - boundary) - Math.abs(b.initial - boundary) || a.row - b.row)[0];
      take(chosen, [nearest.row], size);
    }
    // The rest spaced evenly through the marks, from the highest to the lowest.
    const slots = size - chosen.length;
    if (slots > 0) {
      const rest = withMarks.filter((c) => !chosen.includes(c.row));
      const picks = Array.from({ length: Math.min(slots, rest.length) }, (_, i) => rest[Math.floor(((i + 0.5) * rest.length) / Math.min(slots, rest.length))].row);
      take(chosen, picks, size);
    }
    if (withMarks.length < candidates.length) notes.push(`${candidates.length - withMarks.length} student(s) have no mark, so they can't be placed in the spread.`);
  } else if (scheme === "boundary") {
    const boundaries = boundariesOf(options.bands);
    if (!boundaries.length) return { rows: [], notes: ["The request's band labels couldn't be read, so there are no boundaries to be near."] };
    const distance = options.distance ?? DEFAULT_BOUNDARY_DISTANCE;
    const near = withMarks
      .map((c) => ({ row: c.row, gap: Math.min(...boundaries.map((b) => Math.abs(c.initial - b))) }))
      .filter((c) => c.gap <= distance)
      .sort((a, b) => a.gap - b.gap || a.row - b.row);
    take(chosen, near.map((c) => c.row), size);
    if (near.length < size) notes.push(`Only ${near.length} student(s) have a mark within ${distance} of a band boundary, fewer than the ${size} wanted.`);
  } else if (scheme === "random") {
    const next = random(options.seed ?? "");
    const rows = candidates.map((c) => c.row).sort((a, b) => a - b);
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }
    take(chosen, rows, size);
  } else if (scheme === "changed") {
    const moved = candidates
      .flatMap((c) => (c.initial !== null && c.agreed !== null && c.agreed !== c.initial ? [{ row: c.row, change: Math.abs(c.agreed - c.initial) }] : []))
      .sort((a, b) => b.change - a.change || a.row - b.row);
    take(chosen, moved.map((c) => c.row), size);
    if (moved.length < size) notes.push(`Only ${moved.length} student(s) have a mark that was changed, fewer than the ${size} wanted.`);
  }
  return { rows: chosen, notes };
}

/** How the sample was chosen, in words, for the request's note and the summary. */
export function describeSample(options: { scheme: Scheme; percent: number; submitted: number; size: number; seed?: string; passMark?: number; distance?: number }): string {
  const base = `${options.percent}% of the ${options.submitted} who submitted (${options.size}), rounded up`;
  const how: Record<Scheme, string> = {
    spread: `chosen as a spread across the bands (the highest and lowest marks, every fail below ${options.passMark ?? DEFAULT_PASS_MARK}, the marks nearest each band boundary, and the rest spaced evenly)`,
    boundary: `chosen as the marks within ${options.distance ?? DEFAULT_BOUNDARY_DISTANCE} of a band boundary`,
    random: `chosen at random from the seed ${options.seed ?? ""}`,
    changed: "chosen as the marks that moved furthest in internal moderation",
    hand: "chosen by hand",
  };
  return `${base}, ${how[options.scheme]}`;
}
