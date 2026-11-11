/**
 * The patterns that find an email address, a web address, a phone number and a student number for redaction, and the candidates they give. Redaction
 * (anonymise.ts) and the check for what looks like an identifier (identifiers.ts) both need them: a value the rules are told to leave alone is left alone
 * by the candidate that holds it, which is not always the same span as the one the proxy's patterns find (a student number with letters before its digits,
 * an address followed by a bracket).
 */

import { D, pyIgnoreCase, S, W } from "./pyre.ts";

// An address ends in a top-level domain of letters, so technical notation such as mAP@0.5 or AP@50 is not one, and the
// domain ends there: not x@y.co9 or x@y.co.5, of which only a part would otherwise be taken (a full stop that ends a sentence is not part of it).
export const EMAIL = new RegExp(`[${W}.+-]+@[${W}-]+(?:\\.[${W}-]+)*\\.(?:(?![${D}_])[${W}]){2,}(?![${W}-])(?!\\.[${W}-])`, "gu");
export const URL = new RegExp(`(?:${pyIgnoreCase("http")}${pyIgnoreCase("s")}?://|${pyIgnoreCase("www")}\\.)[^${S}<>()"']+`, "gu");
export const PHONE = new RegExp(`(?<![${W}+])(?:\\+44[${S}]?\\(?0?\\)?|0)[${D}](?:[${S}-]?[${D}]){8,9}(?![${W}])`, "gu");
export const STUDENT_NUMBER = new RegExp(`(?<![${W}-])[A-Za-z]{0,2}[${D}]{7,}(?![${W}-])`, "gu");

/** A candidate, with UTF-16 offsets. */
export interface PatternSpan {
  start: number;
  end: number;
  kind: string;
  value: string;
}

/** The candidates of the pattern-based kinds in `text`: an address, a phone number or an email address loses the full stops, commas and the like that end it. */
export function patternSpans(text: string): PatternSpan[] {
  const spans: PatternSpan[] = [];
  for (const [kind, pattern] of [["EMAIL", EMAIL], ["URL", URL], ["PHONE", PHONE]] as const) {
    for (const m of text.matchAll(pattern)) {
      const value = m[0].replace(/[.,;:!?]+$/, "");
      spans.push({ start: m.index, end: m.index + value.length, kind, value });
    }
  }
  for (const m of text.matchAll(STUDENT_NUMBER)) spans.push({ start: m.index, end: m.index + m[0].length, kind: "ID", value: m[0] });
  return spans;
}
