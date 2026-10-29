/**
 * What is likely to be wrong in an anonymised text, found so an educator can review a whole set by exception (ADR 0012): look properly at the texts
 * that are flagged, skim the rest, and approve the set in one action. A flag says why and never quotes the text, so a flag can't carry what it is there
 * to keep out. Nothing here changes a text or approves one; it is advice, and the approval is still the educator's.
 *
 * A text is flagged when it holds:
 * - what the check before every request would refuse (an email address, a web address, a phone number, a long number): the one thing a pattern
 *   can tell for certain;
 * - capitalised words, in the middle of a sentence, that are neither a name nor a term Feedbacker knows (the rules, the key, the brief, the rubric),
 *   when there are several: they may be names it hasn't been told;
 * - a part of a name that the key or the rules hold (a student's, from a file name, or one added), still in the text, in a form the replacing missed;
 * - far fewer replacements than the other texts, or none at all (a submission usually names its author, and the others).
 */

import { BRIEF, BRIEF_ID, loadBrief } from "./brief.ts";
import { describeIdentifiers, identifierMatches } from "./identifiers.ts";
import { listSubmissions, submissionsKnown } from "./cohort.ts";
import { loadRules } from "./anonymise.ts";
import { loadRubric } from "./marking.ts";
import type { Brief, Submission } from "./models.ts";
import { loadSubmission, submissionPath } from "./originals.ts";
import { pyCasefold } from "./pyre.ts";
import type { Workspace } from "./workspace.ts";

/** How many different unexplained capitalised words make a text worth a closer look. */
export const NAME_LIKE_WORDS = 3;
/** A text has far fewer replacements than the others when it has less than this share of their median, and the median is at least `FEW_MEDIAN`. */
export const FEW_SHARE = 0.25;
export const FEW_MEDIAN = 4;

export interface TextFlags {
  /** A submission's ID, or "brief". */
  id: string;
  /** What the text is, for a list. */
  label: string;
  /** The SHA-256 of the anonymised text, so what was opened can be told to be this text as it now is. */
  sha256: string;
  /** What was replaced, by kind ("student", "email", …): how many. */
  replaced: Record<string, number>;
  /** Why it is flagged, each saying what and never quoting it; none when it isn't. */
  reasons: string[];
  /** Whether it is approved already (and so not part of a set to approve). */
  approved: boolean;
}

/** Words that begin with a capital in English (days, months, and the like) and are not names. */
const CALENDAR = "monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december".split(" ");

const wordsOf = (text: string): string[] => (text.match(/\p{L}[\p{L}'’]*/gu) ?? []).map((w) => pyCasefold(w.replace(/['’]s$/u, "")));

/** Capitalised words in the middle of a sentence (a sentence's first word is capital whatever it is), distinct, as they are folded. */
export function capitalisedMidSentence(text: string): Set<string> {
  const found = new Set<string>();
  for (const m of text.matchAll(/\p{Lu}\p{Ll}{2,}/gu)) {
    const at = m.index ?? 0;
    // Part of a longer word, a token, or a number.
    const before = text[at - 1];
    if (before !== undefined && /[\p{L}\p{N}_\[]/u.test(before)) continue;
    const after = text[at + m[0].length];
    if (after !== undefined && /[\p{L}\p{N}_\]]/u.test(after)) continue;
    // The first word of a sentence, a line or an item.
    let i = at - 1;
    while (i >= 0 && /[\s"“”‘'(\[*•\-–—]/u.test(text[i])) i--;
    if (i < 0 || /[.!?:;\n\r]/.test(text[i]) || /\p{N}/u.test(text[i]) && /[.)]/.test(text[i + 1] ?? "")) continue;
    found.add(pyCasefold(m[0]));
  }
  return found;
}

/** The parts of the names that the key and the rules hold, of three letters or more, folded, less any the educator said to leave. */
function nameParts(key: { entries: { names: string[] }[] }, rules: { names: string[]; ignore: string[] }): Set<string> {
  const ignore = new Set(rules.ignore.map(pyCasefold));
  const parts = new Set<string>();
  for (const name of [...key.entries.flatMap((e) => e.names), ...rules.names]) {
    for (const part of name.split(/[\s,\-\u2010\u2011]+/u).map((p) => p.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ""))) {
      const folded = pyCasefold(part);
      if ([...folded].length >= 3 && !ignore.has(folded)) parts.add(folded);
    }
  }
  return parts;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const countKinds = (redactions: { reason: string }[]) => {
  const counts: Record<string, number> = {};
  for (const r of redactions) counts[r.reason] = (counts[r.reason] ?? 0) + 1;
  return counts;
};

/** Every anonymised text of the workspace (each submission, and the brief), with what was replaced and why it may need a closer look. */
export async function flagTexts(ws: Workspace): Promise<TextFlags[]> {
  const submissions: Submission[] = [];
  if (await submissionsKnown(ws)) {
    for (const s of await listSubmissions(ws)) {
      if (!(await ws.exists(submissionPath(s.submission_id)))) continue;
      const sub = await loadSubmission(ws, s.submission_id).catch(() => null);
      if (sub?.anonymised) submissions.push(sub);
    }
  }
  const brief: Brief | null = (await ws.exists(BRIEF)) ? await loadBrief(ws).catch(() => null) : null;

  const key = await ws.readKey();
  const rules = await loadRules(ws);
  const rubric = await loadRubric(ws).catch(() => null);
  // What Feedbacker knows, so a capitalised word in it is not a name it hasn't been told: its own rules, key, brief and rubric, and the calendar.
  const known = new Set<string>([
    ...CALENDAR,
    ...wordsOf([...rules.names, ...rules.organisations, ...Object.keys(rules.redact), ...rules.ignore].join(" ")),
    ...wordsOf(key.entries.flatMap((e) => e.names).join(" ")),
    ...(brief ? wordsOf(brief.extract.text) : []),
    ...(rubric ? wordsOf(JSON.stringify(rubric)) : []),
  ]);
  const parts = nameParts(key, rules);

  const counts = submissions.map((s) => s.anonymised!.redactions.length);
  const usual = counts.length >= 3 ? median(counts) : 0;

  const flag = (id: string, label: string, text: string, sha256: string, replaced: Record<string, number>, isSubmission: boolean, count: number, approved: boolean): TextFlags => {
    const reasons: string[] = [];
    const identifiers = identifierMatches(text);
    if (identifiers.length) reasons.push(`something that looks like an identifier is still in it: ${describeIdentifiers(identifiers)}`);
    const unexplained = [...capitalisedMidSentence(text)].filter((w) => !known.has(w));
    if (unexplained.length >= NAME_LIKE_WORDS) reasons.push(`${unexplained.length} different capitalised words that aren't names or terms Feedbacker knows, which may be names it hasn't been told`);
    const left = wordsOf(text).filter((w, i, all) => parts.has(w) && all.indexOf(w) === i);
    if (left.length) reasons.push(`${left.length === 1 ? "a part" : `${left.length} parts`} of a name that Feedbacker holds is still in it, in a form that wasn't replaced`);
    if (isSubmission && (count === 0 || (usual >= FEW_MEDIAN && count < usual * FEW_SHARE))) {
      reasons.push(count === 0 ? "no replacements at all, though a submission usually names someone" : `far fewer replacements than the others (${count}, against ${usual} typically)`);
    }
    return { id, label, sha256, replaced, reasons, approved };
  };

  const out: TextFlags[] = submissions.map((s, i) => flag(s.id, `${s.id} ${s.pseudonym}`, s.anonymised!.text, s.anonymised!.text_sha256, countKinds(s.anonymised!.redactions), true, counts[i], s.approval !== null));
  if (brief?.anonymised) out.push(flag(BRIEF_ID, "The brief", brief.anonymised.text, brief.anonymised.text_sha256, countKinds(brief.anonymised.redactions), false, 0, brief.approval !== null));
  return out;
}

