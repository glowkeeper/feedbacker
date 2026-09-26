/**
 * Text and time helpers shared by the contract.
 *
 * Offsets into extracted and anonymised text count Unicode code points, as
 * Python's `len()` and string indices do, not JavaScript's UTF-16 units, so
 * that records written by either implementation mean the same thing.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** SHA-256 of UTF-8 text, as used for approved-text hashes. */
export function sha256Text(text: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(text)));
}

/** The length of `text` in Unicode code points. */
export function codePointLength(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

const ISO = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/i;

/**
 * Microseconds since the epoch for a timezone-aware ISO 8601 timestamp, so
 * ordering checks keep the microsecond precision Python records carry.
 *
 * Returns NaN for anything else. zod runs a record's cross-field checks even
 * when a nested timestamp has already failed its own check, and NaN makes
 * every comparison false, so the field's own error is the one reported.
 */
export function instant(timestamp: string): number {
  const m = ISO.exec(timestamp);
  if (!m) return NaN;
  const [, base, fraction = "", zone] = m;
  const millis = Date.parse(`${base}${zone}`);
  return millis * 1000 + Number(fraction.padEnd(6, "0").slice(0, 6));
}
