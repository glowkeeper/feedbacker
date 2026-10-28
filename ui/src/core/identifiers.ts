/**
 * What looks like a direct identifier in text that is about to be sent, found here so the moderator can be told exactly what, and where.
 *
 * The proxy refuses a request whose text matches one of these patterns (proxy/src/boundary.ts: the same patterns, which a test keeps identical), and
 * says only the kind and the count, never the text, so that its refusals and logs can't carry what it is there to keep out. The app has the approved
 * text itself, so it runs the patterns before sending and shows what they found on the moderator's own screen only: never sent, never logged, never in a
 * refusal. The moderator can then add what was found to the anonymisation rules, anonymise and approve again, and plan again.
 */

import { pyStrip } from "./pytext.ts";

/** Direct identifiers that anonymisation replaces with tokens such as [EMAIL_1] or [ID_1]; finding one means something slipped through (or is not one). */
export const IDENTIFIER_PATTERNS: [string, RegExp][] = [
  ["an email address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g],
  ["a web address", /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi],
  ["a phone number", /(?:\+|\b0)(?:[ ().-]*\d){9,14}\b/g],
  // Student and submission IDs; not decimals such as 0.1234567.
  ["a long number (7 or more digits)", /(?<![\d.])\d{7,}(?!\.\d)/g],
];

/** The kind of token anonymisation gives each: [EMAIL_1], [URL_1], [PHONE_1], [ID_1]. */
export const IDENTIFIER_TOKEN_KINDS: Record<string, string> = {
  "an email address": "EMAIL",
  "a web address": "URL",
  "a phone number": "PHONE",
  "a long number (7 or more digits)": "ID",
};

export interface IdentifierMatch {
  /** What it looks like: "a phone number", … */
  kind: string;
  /** Exactly the text that matched. */
  value: string;
  /** A little of the text before and after it, for finding it. */
  before: string;
  after: string;
  /** Which part of what would be sent: "submission", "brief", "rubric", … */
  where: string;
  /** How far through that text it is, from 0 to 1. */
  position: number;
}

/** A phone-shaped match with a decimal point inside is much more likely a row of numbers than a phone number: it is not ticked to be redacted unless the moderator chooses. */
export const redactByDefault = (m: IdentifierMatch): boolean => !(m.kind === "a phone number" && /\d\.\d/.test(m.value));

const CONTEXT = 40;

/** Every match of an identifier pattern in `text`, in the order they come. */
export function identifierMatches(text: string, where = "text"): IdentifierMatch[] {
  const found: IdentifierMatch[] = [];
  for (const [kind, pattern] of IDENTIFIER_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      const at = m.index ?? 0;
      found.push({
        kind,
        value: m[0],
        before: text.slice(Math.max(0, at - CONTEXT), at).replace(/\s+/g, " "),
        after: text.slice(at + m[0].length, at + m[0].length + CONTEXT).replace(/\s+/g, " "),
        where,
        position: text.length ? at / text.length : 0,
      });
    }
  }
  return found.sort((a, b) => a.where.localeCompare(b.where) || a.position - b.position);
}

/** The matches in what a request would send (each block as it is sent: its heading, a blank line, then its text), as the proxy checks it. */
export function identifiersInRequest(request: { blocks: { kind: string; heading: string; text: string }[] }): IdentifierMatch[] {
  return request.blocks.flatMap((b) => identifierMatches(`${b.heading}\n\n${b.text}`, b.kind));
}

/** In words, by kind and count, as the proxy would say it: "a phone number (8 times) and a long number (7 or more digits)". */
export function describeIdentifiers(matches: IdentifierMatch[]): string {
  const counts = IDENTIFIER_PATTERNS.map(([kind]) => [kind, matches.filter((m) => m.kind === kind).length] as const).filter(([, n]) => n > 0);
  return counts.map(([kind, n]) => (n === 1 ? kind : `${kind} (${n} times)`)).join(" and ");
}

/** The distinct texts that matched, for the anonymisation rules. */
export const valuesToRedact = (matches: IdentifierMatch[]): string[] => [...new Set(matches.map((m) => pyStrip(m.value)).filter(Boolean))];
