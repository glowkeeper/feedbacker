/**
 * What is likely to be wrong in an anonymised text, found so an educator can review a whole set by exception (ADR 0012): look properly at the texts
 * that are flagged, read the rest, and approve the set in one action. A flag says why and never quotes the text, so a flag can't carry what it is there
 * to keep out. Nothing here changes a text or approves one; it is advice, and the approval is still the educator's.
 *
 * A text is flagged when it holds:
 * - what the check before every request would refuse (an email address, a web address, a phone number, a long number): the one thing a pattern
 *   can tell for certain;
 * - capitalised words, in the middle of a sentence, that are neither a name nor a term Feedbacker knows (the rules, the key, the brief, the rubric, a
 *   word that several texts of the cohort share, or an ordinary word: one the text itself uses in lowercase, or that several texts do; in a line that
 *   reads as a heading, one that any text does), when there are several, and far more than the other texts' typical number once there are enough to
 *   compare: they may be names it hasn't been told;
 * - a part of a name that the key or the rules hold (a student's, from a file name, or one added), still in the text, in a form the replacing missed, unless
 *   it is also a word that several texts of the cohort use (a first name such as Will or Rose);
 * - far fewer replacements than the other texts, or none at all (a submission usually names its author, and the others), once there are three submissions
 *   to compare;
 * - an included figure: an image goes to the AI with the text, redaction can't see inside it (ADR 0007), and the list can't show it, so the educator
 *   opens the review and looks at each.
 */

import { BRIEF, BRIEF_ID, loadBrief } from "./brief.ts";
import { describeIdentifiers, identifierMatches } from "./identifiers.ts";
import { listSubmissions, submissionsKnown } from "./cohort.ts";
import { loadRules } from "./anonymise.ts";
import { loadRubric } from "./marking.ts";
import { includedFigures, type Brief, type Submission } from "./models.ts";
import { loadSubmission, submissionPath } from "./originals.ts";
import { pyCasefold } from "./pyre.ts";
import type { Workspace } from "./workspace.ts";

/** How many different unexplained capitalised words make a text worth a closer look, at the least. */
export const NAME_LIKE_WORDS = 3;
/** And, once there are two other texts to compare, more than this many times the median of the others' (a cohort of reports that name many tools has many in every text). */
export const NAME_LIKE_SHARE = 2;
/** A capitalised word in this many different texts is a term the cohort shares (a tool, a method, an author everyone cites), not a name told to no one. */
export const SHARED_TERM = 3;
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
  /** The capitalised words in it that nothing explains, with where they are, for the educator's own screen (never in a reason, a log or a request); null when there are none. */
  unexplained: UnexplainedWords | null;
}

/** A capitalised word that nothing explains, as it is first written, how often it is in this text, and in how many other texts. */
export interface UnexplainedWord {
  word: string;
  count: number;
  alsoIn: number;
  /** Every time it is in the text it is part of a citation (a name before a year or "et al.", or anything in the reference list): public, so not counted toward flagging the text. */
  cited: boolean;
}

export interface UnexplainedWords {
  /** Each distinct word, the most used first. */
  words: UnexplainedWord[];
  /** Where each word that counts is in the anonymised text, as UTF-16 offsets (start, end), in order. */
  spans: [number, number][];
  /** Where each word that is only ever cited is, the same way. */
  citedSpans: [number, number][];
}

/** Words that begin with a capital in English (days, months, their abbreviations, and the like) and are not names: an access date in a reference reads "14 Apr 2024". */
const CALENDAR = (
  "monday tuesday wednesday thursday friday saturday sunday mon tue tues wed thu thur thurs fri sat sun " +
  "january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec"
).split(" ");

const wordsOf = (text: string): string[] => (text.match(/\p{L}[\p{L}'’]*/gu) ?? []).map((w) => pyCasefold(w.replace(/['’]s$/u, "")));

/** Capitalised words in the middle of a sentence (a sentence's first word is capital whatever it is), distinct, as they are folded. */
export function capitalisedMidSentence(text: string): Set<string> {
  return new Set(capitalisedWordSpans(text).map((s) => s.folded));
}

/** Each capitalised word in the middle of a sentence (or, with `includeStarts`, also those that start a sentence, a line or an item), as written, folded, and where it is (UTF-16 offsets). */
export function capitalisedWordSpans(text: string, options: { includeStarts?: boolean } = {}): { word: string; folded: string; start: number; end: number }[] {
  const found: { word: string; folded: string; start: number; end: number }[] = [];
  for (const m of text.matchAll(/\p{Lu}\p{Ll}{2,}/gu)) {
    const at = m.index ?? 0;
    // Part of a longer word, a token, or a number.
    const before = text[at - 1];
    if (before !== undefined && /[\p{L}\p{N}_\[]/u.test(before)) continue;
    const after = text[at + m[0].length];
    if (after !== undefined && /[\p{L}\p{N}_\]]/u.test(after)) continue;
    // The first word of a sentence, a line or an item. A line break is a start in itself: the paragraph under a heading that has no full stop begins a line.
    let i = at - 1;
    while (i >= 0 && /[ \t\u00a0"“”‘'(\[*•\-–—]/u.test(text[i])) i--;
    const marker = /\[\d{1,3}\]$/.test(text.slice(Math.max(0, i - 5), i + 1)); // "[3] First, …": a numbered item starts a sentence
    const starts = i < 0 || /[.!?:;\n\r]/.test(text[i]) || marker || (/\p{N}/u.test(text[i]) && /[.)]/.test(text[i + 1] ?? ""));
    if (starts && !options.includeStarts) continue;
    found.push({ word: m[0], folded: pyCasefold(m[0]), start: at, end: at + m[0].length });
  }
  return found;
}

/**
 * Whether a text has enough unexplained capitalised words to be flagged: at least `NAME_LIKE_WORDS`, and, when there are two others to compare, more
 * than `NAME_LIKE_SHARE` times the median of theirs. Where the others have none (an essay cohort) that is the plain number; where each names many tools it
 * is far above what is usual.
 */
export function manyUnexplained(count: number, others: number[]): boolean {
  if (count < NAME_LIKE_WORDS) return false;
  if (others.length < 2) return true;
  return count > median(others) * NAME_LIKE_SHARE;
}

/**
 * The first run of at least `min` lines in a row (blank lines between them are fine) that each look like `entry`, as offsets from the first's start to the last's
 * end; null if there is none. Entries scattered through prose, with prose between them, are not a run.
 */
function entryRun(text: string, entry: RegExp, min = 3): [number, number] | null {
  let at = 0;
  let run: [number, number][] = [];
  for (const line of text.split("\n")) {
    const from = at;
    at += line.length + 1;
    if (!line.trim()) continue;
    if (entry.test(line)) {
      run.push([from, from + line.length]);
      continue;
    }
    if (run.length >= min) break; // body text resumes: the run is over
    run = [];
  }
  return run.length >= min ? [run[0][0], run[run.length - 1][1]] : null;
}

/**
 * The reference list: from a heading that reads "References" (or "References:", "Bibliography", and the like) to the next appendix heading, or the end; or, with
 * no such heading, a run of at least three numbered entries ("[1] …", "[2] …", as IEEE style has them) or author-date entries ("Smith, A., & Lee, B. (2024). …",
 * as APA and Harvard style have them), one after another with no prose between, and only that run. As offsets, or null.
 */
export function referenceRange(text: string): [number, number] | null {
  const headings = headingLines(text);
  const isReferences = (line: string) => /^(?:\d+[.)]?\s*)?(?:list of )?(?:references?|reference list|bibliography|works cited|sources|citations)\s*:?$/iu.test(line.trim());
  const isAppendix = (line: string) => /^(?:\d+[.)]?\s*)?appendi(?:x|ces)\b/iu.test(line.trim());
  const found = headings.findIndex(([from, to]) => isReferences(text.slice(from, to)));
  if (found >= 0) {
    const start = headings[found][1];
    const after = headings.find(([from, to]) => from > start && isAppendix(text.slice(from, to)));
    return [start, after ? after[0] : text.length];
  }
  const numbered = entryRun(text, /^\[\d{1,3}\][ \t]/u);
  // Author-date entries: a surname, comma, initials, and a year in brackets, all at the line's start.
  const authorDate = entryRun(text, /^\p{Lu}[\p{L}'’\-]+,[ \t]+\p{Lu}\.[^\n]{0,300}?\((?:19|20)\d{2}[a-z]?\)/u);
  return [numbered, authorDate].filter((run): run is [number, number] => run !== null).sort((a, b) => a[0] - b[0])[0] ?? null;
}

/** What can follow a cited author's name: other names and "and", "&", "et al.", then a year ("Pia X et al., 2024", "Smith and Jones (2020)", "Lee, 2019"), or "et al" on its own. */
const NAMES_AFTER = String.raw`(?:[ \t\u00a0]*(?:,|&|and\b|et[ \t]+al\.?|\p{Lu}[\p{L}'’.\-]*)){0,5}`;
const YEAR_AFTER = new RegExp(String.raw`^${NAMES_AFTER}[ \t\u00a0]*[,(]?[ \t\u00a0]*(?:19|20)\d{2}[a-z]?\b`, "u");
const ET_AL_AFTER = new RegExp(String.raw`^${NAMES_AFTER.replace("{0,5}", "{0,3}")}[ \t\u00a0]*,?[ \t\u00a0]*et[ \t]+al\b`, "u");

/** Whether a capitalised word is a cited author, going by where it is: in the reference list, or followed (past other names) by a year or by "et al". */
export function isCited(text: string, span: { start: number; end: number }, references: [number, number] | null): boolean {
  if (references && span.start >= references[0] && span.start < references[1]) return true;
  const after = text.slice(span.end, span.end + 70);
  return YEAR_AFTER.test(after) || ET_AL_AFTER.test(after);
}

/** The words a text uses wholly in lowercase, folded: the cohort's own dictionary, which a capitalised heading or title-cased phrase draws on. */
export function lowercaseWords(text: string): Set<string> {
  const found = new Set<string>();
  for (const m of text.matchAll(/(?<![\p{L}\p{N}_'’\[])\p{Ll}[\p{Ll}'’-]{2,}(?![\p{L}\p{N}_\]])/gu)) found.add(pyCasefold(m[0].replace(/['’]s$/u, "")));
  return found;
}

/** The lines that read as headings or captions: short (ten words or fewer), and not ending as a sentence does (a caption may end with a colon). As offsets (start, end) into the text. */
export function headingLines(text: string): [number, number][] {
  const out: [number, number][] = [];
  let at = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && trimmed.split(/\s+/).length <= 10 && !/[.!?;,]$/.test(trimmed)) out.push([at, at + line.length]);
    at += line.length + 1;
  }
  return out;
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

/**
 * Whether a submission with `count` replacements has none, or far fewer than the others': under a quarter of their median, when that is at least four. It is
 * compared with the others, not with itself among them, and only when there are two others to compare (three submissions in all).
 */
export function farFewer(count: number, others: number[]): boolean {
  if (others.length < 2) return false;
  const usual = median(others);
  return count === 0 || (usual >= FEW_MEDIAN && count < usual * FEW_SHARE);
}

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
  // The cohort's own dictionary: a capitalised word that the text itself uses in lowercase, or that several texts do, is an ordinary word (a heading's "Methodology"),
  // not a name; in a line that reads as a heading, a word that any text uses in lowercase is. A name is never written in lowercase, so it is still counted.
  const lowerIn = submissions.map((s) => lowercaseWords(s.anonymised!.text));
  const lowerInTexts = new Map<string, number>();
  for (const words of lowerIn) for (const w of words) lowerInTexts.set(w, (lowerInTexts.get(w) ?? 0) + 1);
  // A part of a name that is also an ordinary word (a first name such as Will or Rose) turns up in lowercase in many texts: in this many it is a word, not a name left
  // behind. Only lowercase counts: a part left capitalised in three texts is a name the replacing missed three times.
  const partInTexts = new Map<string, number>();
  for (const words of lowerIn) for (const w of words) if (parts.has(w)) partInTexts.set(w, (partInTexts.get(w) ?? 0) + 1);

  const counts = submissions.map((s) => s.anonymised!.redactions.length);
  const ordinary = (folded: string, i: number, inHeading: boolean) => lowerIn[i].has(folded) || (lowerInTexts.get(folded) ?? 0) >= (inHeading ? 1 : SHARED_TERM);
  // Each submission's capitalised words that nothing explains, where they are; and, of those, the distinct words not shared by several texts (terms, not names).
  // A cited author is public (a name before a year, or in the reference list): it is listed for the educator, but doesn't count toward flagging the text.
  type Candidate = { word: string; folded: string; start: number; end: number; cited?: boolean };
  const candidates: Candidate[][] = submissions.map((s, i) => {
    const text = s.anonymised!.text;
    const headings = headingLines(text);
    const references = referenceRange(text);
    const spans = capitalisedWordSpans(text)
      .filter((sp) => !known.has(sp.folded) && !ordinary(sp.folded, i, headings.some(([from, to]) => sp.start >= from && sp.start < to)))
      .map((sp) => ({ ...sp, cited: isCited(text, sp, references) }));
    // An author cited once in this text is the author wherever else the text names them ("(Pemberton)", or "Thornley" on its own): found wherever the citation is,
    // including at the start of a sentence ("Pemberton (2010) studied this."), though only the words in the middle of sentences are counted.
    const authors = new Set(capitalisedWordSpans(text, { includeStarts: true }).filter((sp) => isCited(text, sp, references)).map((sp) => sp.folded));
    return spans.map((sp) => ({ ...sp, cited: authors.has(sp.folded) }));
  });
  const unexplainedIn = candidates.map((spans) => new Set(spans.filter((sp) => !sp.cited).map((sp) => sp.folded)));
  const inTexts = new Map<string, number>();
  for (const words of unexplainedIn) for (const w of words) inTexts.set(w, (inTexts.get(w) ?? 0) + 1);
  const unexplainedCounts = unexplainedIn.map((words) => [...words].filter((w) => (inTexts.get(w) ?? 0) < SHARED_TERM).length);
  /** The words counted for a text, as written, with how often each is in it and in how many other texts, and where they are; null when there are none. */
  const detailOf = (candidateSpans: Candidate[], others: (w: string) => number): UnexplainedWords | null => {
    const spans = candidateSpans.filter((s) => others(s.folded) < SHARED_TERM);
    if (!spans.length) return null;
    const byWord = new Map<string, UnexplainedWord>();
    for (const s of spans) {
      const w = byWord.get(s.folded) ?? { word: s.word, count: 0, alsoIn: Math.max(0, others(s.folded) - 1), cited: true };
      w.count += 1;
      if (!s.cited) w.cited = false; // one place where it isn't a citation, and it counts
      byWord.set(s.folded, w);
    }
    const citedOnly = (s: Candidate) => byWord.get(s.folded)!.cited;
    const at = (s: Candidate) => [s.start, s.end] as [number, number];
    // The words that count first, then the cited ones, each the most used first.
    const words = [...byWord.values()].sort((a, b) => Number(a.cited) - Number(b.cited) || b.count - a.count || a.word.localeCompare(b.word));
    return { words, spans: spans.filter((s) => !citedOnly(s)).map(at), citedSpans: spans.filter(citedOnly).map(at) };
  };

  const flag = (id: string, label: string, text: string, sha256: string, replaced: Record<string, number>, spansOf: Candidate[], own: { count: number; others: number[]; figures: number; unexplained: number; othersUnexplained: number[] } | null, approved: boolean): TextFlags => {
    const reasons: string[] = [];
    const identifiers = identifierMatches(text);
    if (identifiers.length) reasons.push(`something that looks like an identifier is still in it: ${describeIdentifiers(identifiers)}`);
    // A submission's own count is of the words that are not shared across the cohort; the brief, which has no others to compare, is judged by the plain number.
    const unexplained = own ? own.unexplained : new Set(spansOf.map((s) => s.folded)).size;
    if (manyUnexplained(unexplained, own?.othersUnexplained ?? [])) {
      const usual = own && own.othersUnexplained.length >= 2 ? median(own.othersUnexplained) : 0;
      reasons.push(
        usual > 0
          ? `${unexplained} different capitalised words that aren't names or terms Feedbacker knows, far more than the other texts' ${usual}, which may be names it hasn't been told`
          : `${unexplained} different capitalised words that aren't names or terms Feedbacker knows, which may be names it hasn't been told`,
      );
    }
    const left = wordsOf(text).filter((w, i, all) => parts.has(w) && all.indexOf(w) === i && (partInTexts.get(w) ?? 0) < SHARED_TERM);
    if (left.length) reasons.push(`${left.length === 1 ? "a part" : `${left.length} parts`} of a name that Feedbacker holds is still in it, in a form that wasn't replaced`);
    if (own && farFewer(own.count, own.others)) {
      reasons.push(own.count === 0 ? "nothing was replaced: no student name, link, email, phone number or ID was found in it, though a submission usually names someone" : `far fewer replacements than the others (${own.count}, against ${median(own.others)} typically)`);
    }
    if (own && own.figures) reasons.push(`${own.figures === 1 ? "an included figure" : `${own.figures} included figures`}, which are sent with the text and which redaction can't see inside: open the review and look at ${own.figures === 1 ? "it" : "each"}`);
    // For the educator's own screen: which words were counted, and where, so they can be looked at (a submission's are those not shared across the cohort; the brief has no others).
    return { id, label, sha256, replaced, reasons, approved, unexplained: detailOf(spansOf, own ? (w) => inTexts.get(w) ?? 0 : () => 0) };
  };

  const out: TextFlags[] = submissions.map((s, i) => flag(s.id, `${s.id} ${s.pseudonym}`, s.anonymised!.text, s.anonymised!.text_sha256, countKinds(s.anonymised!.redactions), candidates[i], { count: counts[i], others: counts.filter((_, j) => j !== i), figures: includedFigures(s.extract, s.excluded_figures).length, unexplained: unexplainedCounts[i], othersUnexplained: unexplainedCounts.filter((_, j) => j !== i) }, s.approval !== null));
  if (brief?.anonymised) out.push(flag(BRIEF_ID, "The brief", brief.anonymised.text, brief.anonymised.text_sha256, countKinds(brief.anonymised.redactions), capitalisedWordSpans(brief.anonymised.text).filter((s) => !known.has(s.folded)), null, brief.approval !== null));
  return out;
}

