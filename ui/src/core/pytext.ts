/**
 * Python's whitespace, for `strip()` and `split()` ported from the reference.
 * It differs from JavaScript's `\s`: Python also counts \x1c-\x1f and \x85,
 * and doesn't count ﻿.
 */

const WS = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const EDGES = new RegExp(`^[${WS}]+|[${WS}]+$`, "g");
const RUNS = new RegExp(`[${WS}]+`);

/** Python's `str.strip()`. */
export const pyStrip = (s: string) => s.replace(EDGES, "");

/** Python's `str.split()` with no arguments. */
export const pySplit = (s: string) => pyStrip(s).split(RUNS).filter((w) => w !== "");
