/**
 * Text and time helpers shared by the contract, matching the Python reference.
 *
 * Offsets into extracted and anonymised text count Unicode code points, as
 * Python's `len()` and string indices do, not JavaScript's UTF-16 units, so
 * that records written by either implementation mean the same thing.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** False if `text` contains a lone surrogate, which has no UTF-8 encoding. */
export function isWellFormed(text: string): boolean {
  return !LONE_SURROGATE.test(text);
}

/**
 * SHA-256 of UTF-8 text, as used for approved-text hashes. Throws on a lone
 * surrogate, as Python's `str.encode("utf-8")` does, rather than silently
 * hashing a replacement character.
 */
export function sha256Text(text: string): string {
  if (!isWellFormed(text)) throw new Error("text contains a lone surrogate and cannot be encoded as UTF-8");
  return bytesToHex(sha256(new TextEncoder().encode(text)));
}

/** The length of `text` in Unicode code points (a lone surrogate counts as one, as in Python). */
export function codePointLength(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

const ISO = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

/**
 * A timestamp written exactly as the Python reference writes it: seconds
 * always present, a fraction of exactly six digits (truncated, as Python
 * truncates) or none if it is zero, and `Z` for a zero offset. Anything that
 * is not a timestamp is returned unchanged for the format check to reject.
 */
export function normaliseTimestamp(timestamp: string): string {
  const m = ISO.exec(timestamp);
  if (!m) return timestamp;
  const [, date, time, fraction = "", zone] = m;
  const micros = fraction.padEnd(6, "0").slice(0, 6);
  const offset = zone === "Z" || zone.slice(1) === "00:00" ? "Z" : zone;
  return `${date}T${time}${/^0+$/.test(micros) ? "" : `.${micros}`}${offset}`;
}

/**
 * Microseconds since the epoch for a timezone-aware timestamp, as a bigint so
 * that ordering checks are exact at any date.
 *
 * Returns null for anything else. zod runs a record's cross-field checks even
 * when a nested timestamp has already failed its own check; callers skip the
 * comparison, so the field's own error is the one reported.
 */
export function instant(timestamp: string): bigint | null {
  const m = ISO.exec(timestamp);
  if (!m) return null;
  const [, date, time, fraction = "", zone] = m;
  const millis = Date.parse(`${date}T${time}${zone}`);
  if (Number.isNaN(millis)) return null;
  return BigInt(millis) * 1000n + BigInt(fraction.padEnd(6, "0").slice(0, 6));
}
