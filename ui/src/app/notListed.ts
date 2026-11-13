/**
 * What the lists that act on many submissions at once say about the submissions they leave out, in words: grouped by why, with what it means and, where
 * there is something to do, what to do. A submission left out is usually nothing wrong (it is done already, or it is not ready), so the groups that need
 * nothing of the educator are said quietly, and only the ones that do are set apart and name the submissions.
 */

import type { NotListed, NotListedKind, NotTaken, NotTakenKind } from "../core/index.ts";

export interface NotListedGroup {
  kind: string;
  text: string;
  /** Whether there is something for the educator to do about these, so they are named and set apart. */
  needsYou: boolean;
  labels: string[];
  /** Where each submission's own reason matters (a proposal that can't be read: why), by label. */
  details: Record<string, string>;
}

const many = (n: number, one: string, more: string) => (n === 1 ? one : more);

const DRAFTS: Record<NotListedKind, { needsYou: boolean; say: (n: number) => string }> = {
  recorded: { needsYou: false, say: (n) => `${n} ${many(n, "already has its", "already have their")} feedback recorded.` },
  "no-draft": { needsYou: false, say: (n) => `${n} ${many(n, "has", "have")} no draft yet. Plan the drafts above to get ${many(n, "one", "one for each")}, or write the feedback yourself.` },
  "not-marked": { needsYou: false, say: (n) => `${n} ${many(n, "is", "are")} not fully marked yet, so there is nothing to draft or record.` },
  stale: { needsYou: true, say: (n) => `${n} ${many(n, "has drafts", "have drafts")} made from marking you have since changed. Plan the drafts again for ${many(n, "it", "them")}.` },
  held: { needsYou: true, say: (n) => `${n} ${many(n, "has", "have")} every draft held back because a check flags it. Open each, read it, and record it yourself; the reasons are under Checks across the cohort.` },
};

const PROPOSALS: Record<NotTakenKind, { needsYou: boolean; say: (n: number) => string }> = {
  marked: { needsYou: false, say: (n) => `${n} ${many(n, "is", "are")} marked already, so there is nothing to take.` },
  blind: { needsYou: false, say: (n) => `${n} ${many(n, "is", "are")} being marked blind, so ${many(n, "its", "their")} proposals are not shown until you have marked ${many(n, "it", "them")}.` },
  "not-approved": { needsYou: false, say: (n) => `${n} ${many(n, "has", "have")} no approved text yet, so the AI has not read ${many(n, "it", "them")}.` },
  "no-proposal": { needsYou: false, say: (n) => `${n} ${many(n, "has", "have")} no AI proposal yet. Ask for the AI's proposals first, on AI proposals.` },
  "little-evidence": { needsYou: true, say: (n) => `${n} ${many(n, "submission gave", "submissions gave")} the AI too little evidence to propose any level (this can happen when a submission is mostly figures that were left out). Mark ${many(n, "it", "them")} yourself.` },
  "no-levels": { needsYou: true, say: (n) => `The AI proposed no level for any criterion of ${n} ${many(n, "submission", "submissions")}. Mark ${many(n, "it", "them")} yourself.` },
  "out-of-date": { needsYou: true, say: (n) => `${n} ${many(n, "has a proposal that is", "have proposals that are")} out of date (the text, the rubric or the figures changed since). Ask for ${many(n, "it", "them")} again first.` },
  unreadable: { needsYou: true, say: (n) => `${n} ${many(n, "has a proposal that", "have proposals that")} can't be read.` },
};

function group<K extends string>(items: { label: string; kind: K; why: string }[], table: Record<K, { needsYou: boolean; say: (n: number) => string }>, order: K[]): NotListedGroup[] {
  return order.flatMap((kind) => {
    const these = items.filter((i) => i.kind === kind);
    if (!these.length) return [];
    return [{ kind, text: table[kind].say(these.length), needsYou: table[kind].needsYou, labels: these.map((i) => i.label), details: kind === "unreadable" ? Object.fromEntries(these.map((i) => [i.label, i.why])) : {} }];
  });
}

/** The submissions with nothing to record in a set, grouped by why: what needs the educator last, so the quiet ones come first. */
export const draftGroups = (items: NotListed[]) => group(items, DRAFTS, ["recorded", "no-draft", "not-marked", "stale", "held"]);

/** The submissions whose proposals can't be taken in a set, grouped by why. */
export const proposalGroups = (items: NotTaken[]) => group(items, PROPOSALS, ["marked", "blind", "not-approved", "no-proposal", "little-evidence", "no-levels", "out-of-date", "unreadable"]);
