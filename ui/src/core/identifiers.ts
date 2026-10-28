/**
 * What looks like a direct identifier in text that is about to be sent, found here so the moderator can be told exactly what, and where.
 *
 * The proxy refuses a request whose text matches one of these patterns (proxy/src/boundary.ts: the same patterns, which a test keeps identical), and
 * says only the kind and the count, never the text, so that its refusals and logs can't carry what it is there to keep out. The app has the approved
 * text itself, so it runs the patterns before sending and shows what they found on the moderator's own screen only: never sent, never logged, never in a
 * refusal. The moderator can then add what was found to the anonymisation rules, anonymise and approve again, and plan again.
 */

import { pyCasefold } from "./pyre.ts";
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

/** Where a match can be put right by the anonymisation rules: the texts anonymisation makes. A rubric isn't one; it is corrected and imported again. */
export const redactableWhere = (where: string): boolean => ["submission", "brief", "text"].includes(where);

/** For a match that the rules can't put right: what to do about it, in a sentence for the screen, and a clause for the message. */
const ELSEWHERE: Record<string, { note: string; clause: string }> = {
  rubric: { note: "A match in the rubric can't be redacted here, because the rubric is not anonymised: correct it, and import the rubric again.", clause: "a rubric is corrected and imported again" },
  marking: { note: "A match in your marking can't be redacted here: change that comment, and record it again.", clause: "your marking is changed and recorded again" },
  feedback: { note: "A match in your feedback can't be redacted here: change it, and record it again.", clause: "your feedback is changed and recorded again" },
  guide: { note: "A match in the feedback guide can't be redacted here: change it, and save the guide again.", clause: "the guide is changed and saved again" },
};

/** What to do about the matches that the rules can't put right, one sentence for each place they are in. */
export const howToPutRight = (matches: IdentifierMatch[]): string[] => [...new Set(matches.filter((m) => !redactableWhere(m.where)).map((m) => ELSEWHERE[m.where]?.note).filter((n): n is string => Boolean(n)))];

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

/** Why a request can't be sent, and where to go for what was found: the same words wherever a request is planned. */
export function cantBeSent(found: IdentifierMatch[]): string {
  const where = found.map((m) => m.where).filter((w, i, a) => a.indexOf(w) === i);
  const what = where.map((w) => `the ${w} contains ${describeIdentifiers(found.filter((m) => m.where === w))}`).join("; ");
  const elsewhere = [...new Set(found.filter((m) => !redactableWhere(m.where)).map((m) => ELSEWHERE[m.where]?.clause).filter(Boolean))];
  const rules = found.some((m) => redactableWhere(m.where));
  const todo = elsewhere.length ? `${elsewhere.join(", ")}${rules ? ", and the rest can be added to the anonymisation rules" : ""}` : "to add to the anonymisation rules";
  return `can't be sent, because it may identify someone: ${what}. What was found is listed below${elsewhere.length ? "; " : ", "}${todo}`;
}

/** The matches in what a request would send (each block as it is sent: its heading, a blank line, then its text), as the proxy checks it. */
export function identifiersInRequest(request: { blocks: { kind: string; heading: string; text: string }[] }): IdentifierMatch[] {
  return request.blocks.flatMap((b) => identifierMatches(`${b.heading}\n\n${b.text}`, b.kind));
}

/** A request that can't be sent because it may identify someone: what was found, for the screen to list. Nothing was sent. */
export class IdentifiersFound extends Error {
  matches: IdentifierMatch[];
  constructor(matches: IdentifierMatch[]) {
    super(cantBeSent(matches));
    this.name = "IdentifiersFound";
    this.matches = matches;
  }
}

/** In words, by kind and count, as the proxy would say it: "a phone number (8 times) and a long number (7 or more digits)". */
export function describeIdentifiers(matches: IdentifierMatch[]): string {
  const counts = IDENTIFIER_PATTERNS.map(([kind]) => [kind, matches.filter((m) => m.kind === kind).length] as const).filter(([, n]) => n > 0);
  return counts.map(([kind, n]) => (n === 1 ? kind : `${kind} (${n} times)`)).join(" and ");
}

/** The distinct texts that matched (ignoring case, as redaction does), for the anonymisation rules. */
export const valuesToRedact = (matches: IdentifierMatch[]): string[] => {
  const seen = new Set<string>();
  return matches.map((m) => pyStrip(m.value)).filter((v) => v && !seen.has(pyCasefold(v)) && seen.add(pyCasefold(v)));
};
