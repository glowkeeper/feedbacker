/**
 * Python's `re` semantics that JavaScript's regular expressions don't share,
 * for patterns ported from the reference (anonymisation, #50). Checked
 * against Python for every code point by `npm run parity:anonymise`, and the
 * browser against Node by `npm run check:browser`.
 *
 * - `\w` and `\d` are Unicode-wide in Python (`str.isalnum()` or "_",
 *   `str.isdecimal()`); in JavaScript they are ASCII-only. `\s` is
 *   Unicode-wide in both, but the sets differ (JavaScript's includes U+FEFF
 *   and excludes \x1c-\x1f and \x85), so Python's (`str.isspace()`) is used.
 *   The classes here are Python's own, as ranges from pycase.ts, not the
 *   engine's `\p{…}`: a browser with a newer Unicode version (Chrome 153 has
 *   Unicode 17; Python 3.14 has 16) would otherwise treat newly added
 *   characters as letters where Python doesn't.
 * - IGNORECASE in Python matches a character whose simple lowercase equals
 *   the pattern character's (so "İ" matches "i"), plus a few extra
 *   equivalences such as i and dotless ı; JavaScript's `i` flag uses case
 *   folding instead. `pyIgnoreCase` builds the Python rule explicitly.
 * - `str.casefold()` has no JavaScript equivalent; `pyCasefold` gives it.
 *
 * Case mappings of characters Python knows come from the engine (they are
 * stable across Unicode versions), corrected by pycase.ts; a character
 * unassigned in Python's Unicode version has no case, as in Python.
 */

import { CASED_DIFFERS, EXTRA_CASES, FOLD, LOWER } from "./pycase.ts";
import { WS } from "./pytext.ts";
import { ALPHA_RANGES, classBody, DIGIT_CLASS, member, UNASSIGNED_RANGES, UPPER_RANGES, WORD_RANGES } from "./ranges.ts";

const escape = (c: number) => `\\u{${c.toString(16)}}`;

/** Python's `\w`, `\d` and `\s`, as character-class bodies (use with the `u` flag). */
export const W = classBody(WORD_RANGES);
export const D = DIGIT_CLASS;
export const S = WS;

/** Python's `str.isalpha()` and `str.isupper()` for one character. */
export const pyIsAlpha = (c: number) => member(ALPHA_RANGES, c);
export const pyIsUpper = (c: number) => member(UPPER_RANGES, c);

/** Whether Python's Unicode version assigns the character. */
const assigned = (c: number) => !member(UNASSIGNED_RANGES, c);

/**
 * The engine's one-character mapping, or the character itself if it maps to
 * several, or to a character Python's Unicode version doesn't have (a newer
 * Unicode can add a case partner to an existing letter).
 */
function single(s: string, c: number): number {
  if ([...s].length !== 1) return c;
  const mapped = s.codePointAt(0)!;
  return assigned(mapped) ? mapped : c;
}

/** Python's simple lowercase mapping of one character, as its `re` module uses it. */
export const pyLower = (c: number): number => (assigned(c) ? (LOWER.get(c) ?? single(String.fromCodePoint(c).toLowerCase(), c)) : c);

/** Python's `_sre.unicode_iscased`: whether IGNORECASE treats the character as having case. */
export function pyIsCased(c: number): boolean {
  if (!assigned(c)) return false;
  const computed = pyLower(c) !== c || single(String.fromCodePoint(c).toUpperCase(), c) !== c;
  return CASED_DIFFERS.has(c) ? !computed : computed;
}

/** Python's `str.casefold()`. */
export const pyCasefold = (s: string): string =>
  [...s]
    .map((ch) => {
      const c = ch.codePointAt(0)!;
      if (!assigned(c)) return ch;
      const folded = FOLD.get(c) ?? ch.toLowerCase();
      return [...folded].every((f) => assigned(f.codePointAt(0)!)) ? folded : ch;
    })
    .join("");

/** Every character (other than itself) whose simple lowercase is each character: built once. */
let lowercaseOf: Map<number, number[]> | null = null;
function charactersLowering(to: number): number[] {
  if (!lowercaseOf) {
    lowercaseOf = new Map();
    // No character above U+1FFFF has case (checked against Python by the parity script).
    for (let c = 0; c < 0x20000; c++) {
      if (c >= 0xd800 && c <= 0xdfff) continue;
      const lower = pyLower(c);
      if (lower !== c) lowercaseOf.set(lower, [...(lowercaseOf.get(lower) ?? []), c]);
    }
  }
  return lowercaseOf.get(to) ?? [];
}

/**
 * A regular-expression source (for the `u` flag) matching `literal` as
 * Python's `re.escape(literal)` matches it with IGNORECASE: an uncased
 * character exactly, and a cased one by any character whose simple
 * lowercase is its lowercase or one of Python's extra equivalents.
 */
export function pyIgnoreCase(literal: string): string {
  let out = "";
  for (const ch of literal) {
    const c = ch.codePointAt(0)!;
    if (!pyIsCased(c)) {
      out += escape(c);
      continue;
    }
    const targets = [pyLower(c), ...(EXTRA_CASES.get(pyLower(c)) ?? [])];
    const members = new Set<number>();
    for (const t of targets) {
      if (pyLower(t) === t) members.add(t);
      for (const x of charactersLowering(t)) members.add(x);
    }
    out += `[${[...members].sort((a, b) => a - b).map(escape).join("")}]`;
  }
  return out;
}

/** A literal matched exactly (Python's `re.escape`), for the `u` flag. */
export const pyEscape = (literal: string): string => [...literal].map((ch) => escape(ch.codePointAt(0)!)).join("");
