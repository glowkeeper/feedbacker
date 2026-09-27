/**
 * Character ranges from pycase.ts, decoded: Python's own character classes,
 * so they don't change with the browser's Unicode version.
 */

import { ALPHA, DIGIT, UNASSIGNED, UPPER, WORD } from "./pycase.ts";

/** Decode ranges ("gap.length" in base 36) into [start, end, start, end, ...]. */
function decode(encoded: string): Uint32Array {
  const parts = encoded.split(",");
  const out = new Uint32Array(parts.length * 2);
  let previous = -1;
  parts.forEach((part, i) => {
    const [gap, length] = part.split(".").map((n) => parseInt(n, 36));
    out[2 * i] = previous + 1 + gap;
    out[2 * i + 1] = previous = out[2 * i] + length;
  });
  return out;
}

/** The range containing `c` (its index), or -1. */
export function rangeOf(ranges: Uint32Array, c: number): number {
  let lo = 0;
  let hi = ranges.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (c < ranges[2 * mid]) hi = mid - 1;
    else if (c > ranges[2 * mid + 1]) lo = mid + 1;
    else return mid;
  }
  return -1;
}

export const member = (ranges: Uint32Array, c: number) => rangeOf(ranges, c) >= 0;

const escape = (c: number) => `\\u{${c.toString(16)}}`;

/** A character-class body for the `u` flag. */
export function classBody(ranges: Uint32Array): string {
  let body = "";
  for (let i = 0; i < ranges.length; i += 2) body += ranges[i] === ranges[i + 1] ? escape(ranges[i]) : `${escape(ranges[i])}-${escape(ranges[i + 1])}`;
  return body;
}

/** Python's `\w` (`isalnum()` or "_"), `\d` (`isdecimal()`), `isalpha()`, `isupper()`, and unassigned characters. */
export const [WORD_RANGES, DIGIT_RANGES, ALPHA_RANGES, UPPER_RANGES, UNASSIGNED_RANGES] = [WORD, DIGIT, ALPHA, UPPER, UNASSIGNED].map(decode);

/** Python's `\d`, as a character-class body. */
export const DIGIT_CLASS = classBody(DIGIT_RANGES);
