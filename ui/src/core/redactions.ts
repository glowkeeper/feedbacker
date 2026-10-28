/**
 * What the current key and rules would still redact in text that was anonymised earlier, found here so a check that says "something now redacts"
 * can say exactly what, and where, as the identifier check does (identifiers.ts): on the educator's own screen only, never sent, never logged.
 *
 * Text is anonymised when it is made, and the key and the rules only grow, so a name added by a later import or a rule added since can make an
 * earlier text incomplete. Most often the match is right and the text is anonymised again; sometimes it is a false positive (a metric such as
 * `mAP@0.5` read as an address) and the educator keeps it, by adding it to the values not to redact.
 */

import { detect, loadRules, updateRules, type AnonymisationRules } from "./anonymise.ts";
import type { IdentifierMatch } from "./identifiers.ts";
import { pyCasefold } from "./pyre.ts";
import { pyStrip } from "./pytext.ts";
import type { PseudonymKey, Workspace } from "./workspace.ts";

/** What kind of text it is in, which says how it is put right: a submission's text is anonymised again (and approved again); a comment is anonymised again; an AI reading is a record of what the AI said and can't be changed; feedback is recorded again. */
export type RedactionField = "text" | "comment" | "reading" | "feedback";

export interface RedactionMatch extends IdentifierMatch {
  field: RedactionField;
  /** Whether the educator may keep it (add it to the values not to redact): something found by a pattern, which can be a false positive. A name, an organisation, a student's ID or a value they asked to redact is not offered. */
  keepable: boolean;
}

/** What each kind of span is, in words. */
const KIND_LABEL: Record<string, string> = {
  STUDENT: "a student's name",
  PERSON: "a name from the rules",
  ORG: "an organisation from the rules",
  ID: "an ID",
  EMAIL: "an email address",
  URL: "a web address",
  PHONE: "a phone number",
};

/** Found by a pattern (so it can be a false positive), not named by the key or the rules. */
const PATTERN_KINDS = new Set(["EMAIL", "URL", "PHONE", "ID"]);

const CONTEXT = 40;

/** Where each text is, and what kind of text it is, for `redactionsIn`. */
export type RedactionSource = [where: string, field: RedactionField, text: string | null | undefined];

/** The values in the key that are students' IDs: never offered to keep. */
const keyIds = (key: PseudonymKey) => new Set(key.entries.flatMap((e) => [e.external_id, e.platform_id]).filter((v): v is string => Boolean(v)).map(pyCasefold));

/** What the key and rules would redact in each text, with where it is; nothing for a text that is complete. */
export function redactionsFound(sources: RedactionSource[], key: PseudonymKey, rules: AnonymisationRules): RedactionMatch[] {
  const ids = keyIds(key);
  const found: RedactionMatch[] = [];
  for (const [where, field, text] of sources) {
    if (!text) continue;
    const points = [...text];
    for (const s of detect(text, key, rules)) {
      const value = points.slice(s.start, s.end).join("");
      found.push({
        kind: KIND_LABEL[s.kind] ?? "a value you asked to redact",
        value,
        before: points.slice(Math.max(0, s.start - CONTEXT), s.start).join("").replace(/\s+/g, " "),
        after: points.slice(s.end, s.end + CONTEXT).join("").replace(/\s+/g, " "),
        where,
        position: points.length ? s.start / points.length : 0,
        field,
        keepable: PATTERN_KINDS.has(s.kind) && !ids.has(pyCasefold(value)),
      });
    }
  }
  return found;
}

/** As `redactionsFound`, with the workspace's own key and rules. */
export async function redactionsIn(ws: Workspace, sources: RedactionSource[]): Promise<RedactionMatch[]> {
  if (!sources.some(([, , text]) => text)) return [];
  return redactionsFound(sources, await ws.readKey(), await loadRules(ws));
}

/** Add what the educator chose to keep to the values not to redact (never one that isn't keepable); how many distinct values that was. */
export async function keepValues(ws: Workspace, matches: RedactionMatch[]): Promise<number> {
  const seen = new Set<string>();
  const values = matches
    .filter((m) => m.keepable)
    .map((m) => pyStrip(m.value))
    .filter((v) => v && !seen.has(pyCasefold(v)) && seen.add(pyCasefold(v)));
  if (!values.length) return 0;
  await updateRules(ws, { ignore: values });
  return values.length;
}

/** Say on an error what was found, for the screen to list: the message names the text and never what was found. */
export function foundOn<T extends Error>(err: T, redactions: RedactionMatch[]): T & { redactions: RedactionMatch[] } {
  return Object.assign(err, { redactions });
}

/** What an error says was found, if it does. */
export const matchesOn = (err: unknown): RedactionMatch[] => (err as { redactions?: RedactionMatch[] } | null)?.redactions ?? [];
