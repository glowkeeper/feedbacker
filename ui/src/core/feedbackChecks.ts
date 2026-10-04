/**
 * Checks that feedback fits its mark (the maintainer's definition of consistent feedback, 2026-10-02), run in code:
 * predictable, free, and explainable to a student or an external examiner. They are flags, not blocks: the educator
 * may keep the text by accepting a flag with a reason, which is recorded on the feedback (and so with its approval).
 *
 * - **Praise above the band:** a word or phrase that belongs to a higher band than the mark's (for example
 *   "excellent" on a lower second). The mark is read as a percentage of the criterion's maximum (the overall mark
 *   as a percentage) and banded on the UK scale. Each band has a list of words that fit it and the bands above; the
 *   workspace may change the lists (`feedback/praise.json`).
 * - **No next step:** none of "Next time", "In future", "In the future" or "Going forward".
 * - **Another mark or level named:** a number given as a mark ("68%", "68/100", "68 out of 100", "a mark of 68",
 *   "68 marks") other than the one awarded, a UK classification other than the mark's, or another level's label.
 *
 * Words are matched whole and case-insensitively; a praise word just after "not", "never" or "n't" isn't flagged.
 */

import * as z from "zod";
import { criterionMax } from "./marks.ts";
import type { AcceptedFlag, Criterion, Feedback } from "./models.ts";
import { pyFormatG } from "./pytext.ts";
import { type Workspace, WorkspaceError } from "./workspace.ts";

export const BANDS = ["first", "upper_second", "lower_second", "third", "fail"] as const;
export type Band = (typeof BANDS)[number];

export const BAND_NAMES: Record<Band, string> = {
  first: "first-class (70 and above)",
  upper_second: "upper second (60–69)",
  lower_second: "lower second (50–59)",
  third: "third (40–49)",
  fail: "fail (below 40)",
};

/** The band of a percentage on the UK scale. */
export function bandOf(percent: number): Band {
  if (percent >= 70) return "first";
  if (percent >= 60) return "upper_second";
  if (percent >= 50) return "lower_second";
  if (percent >= 40) return "third";
  return "fail";
}

/** Words that fit a band and the bands above it: praise that would overstate a lower mark. */
export const PraiseWords = z.strictObject({
  first: z.array(z.string()),
  upper_second: z.array(z.string()),
  lower_second: z.array(z.string()),
  third: z.array(z.string()),
});
export type PraiseWords = z.output<typeof PraiseWords>;

export const DEFAULT_PRAISE: PraiseWords = {
  first: ["excellent", "outstanding", "exceptional", "superb", "exemplary", "excellently", "brilliant", "flawless", "masterful"],
  upper_second: ["very good", "very well", "impressive", "strong", "insightful", "sophisticated", "thorough"],
  lower_second: ["good", "well done", "solid", "sound", "effective"],
  third: ["satisfactory", "competent", "adequate"],
};

export const PRAISE = "feedback/praise.json";

/** The workspace's praise words: the defaults until the educator changes them. */
export async function loadPraise(ws: Workspace): Promise<PraiseWords> {
  if (!(await ws.exists(PRAISE))) return DEFAULT_PRAISE;
  const parsed = PraiseWords.safeParse(await ws.readJson(PRAISE));
  if (!parsed.success) throw new WorkspaceError(`${PRAISE} is not a valid list of praise words`);
  return parsed.data;
}

/** Save the workspace's praise words (trimmed, blanks and repeats left out). */
export async function savePraise(ws: Workspace, words: PraiseWords): Promise<PraiseWords> {
  const clean = Object.fromEntries(
    Object.entries(words).map(([band, list]) => [band, [...new Set((list as string[]).map((w) => w.trim().toLowerCase()).filter(Boolean))]]),
  ) as PraiseWords;
  await ws.writeJson(PRAISE, PraiseWords.parse(clean));
  return clean;
}

export interface Flag {
  check: AcceptedFlag["check"];
  detail: string; // what it found: a word, a mark or a level named
  message: string; // the flag in words, as the screen shows it
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A whole word or phrase, any case, with any run of spaces between its words. */
const wordPattern = (phrase: string) => new RegExp(`(?<![\\p{L}\\p{N}])${phrase.trim().split(/\s+/).map(escape).join("\\s+")}(?![\\p{L}\\p{N}])`, "giu");
const NEGATED = /(?:\bnot|\bnever|n't)\s+(?:yet\s+|quite\s+|always\s+|entirely\s+)?$/i;

const NEXT_STEP = /\b(?:next\s+time|in\s+(?:the\s+)?future|going\s+forward)\b/i;

const CLASSIFICATIONS: [Band, RegExp][] = [
  ["first", /(?<![\p{L}\p{N}])(?:first[\s-]class|1st)(?![\p{L}\p{N}])/giu],
  ["upper_second", /(?<![\p{L}\p{N}:])(?:2:1|upper\s+second)(?![\p{L}\p{N}])/giu],
  ["lower_second", /(?<![\p{L}\p{N}:])(?:2:2|lower\s+second)(?![\p{L}\p{N}])/giu],
  ["third", /(?<![\p{L}\p{N}])(?:third[\s-]class|3rd)(?![\p{L}\p{N}])/giu],
];
const MARK_FORMS = [
  /(?<![\p{N}.])(\d+(?:\.\d+)?)\s*(?:%|per\s?cent\b)/giu,
  /(?<![\p{N}.])(\d+(?:\.\d+)?)\s*(?:\/|out\s+of\s+)\s*\d+(?:\.\d+)?/giu,
  /\bmark(?:ed)?\s+(?:of\s+)?(\d+(?:\.\d+)?)\b/giu,
  /(?<![\p{N}.])(\d+(?:\.\d+)?)\s+(?:marks?|points?)\b/giu,
];

/**
 * The flags on one piece of feedback for a mark: `mark` out of `max` (100 for the overall), and, for a criterion,
 * its levels and the level awarded.
 */
export function checkFeedback(text: string, mark: number | null, max: number | null, praise: PraiseWords, levels: { awarded: string | null; others: string[] } = { awarded: null, others: [] }): Flag[] {
  const flags: Flag[] = [];
  const percent = mark !== null && max ? (mark / max) * 100 : null;
  const band = percent === null ? null : bandOf(percent);

  if (band !== null && band !== "first") {
    // Words of every band above the mark's.
    const above = BANDS.slice(0, BANDS.indexOf(band)) as (keyof PraiseWords)[];
    const seen = new Set<string>();
    for (const b of above) {
      for (const phrase of praise[b] ?? []) {
        for (const m of text.matchAll(wordPattern(phrase))) {
          if (NEGATED.test(text.slice(0, m.index))) continue;
          const found = m[0].toLowerCase();
          if (seen.has(found)) continue;
          seen.add(found);
          flags.push({ check: "praise", detail: found, message: `"${m[0]}" is praise for ${BAND_NAMES[b]} work, but the mark is ${BAND_NAMES[band]}` });
        }
      }
    }
  }

  if (!NEXT_STEP.test(text)) flags.push({ check: "next_step", detail: "no next step", message: 'There is no next step: say what to do "Next time".' });

  const named = new Set<string>();
  if (mark !== null) {
    for (const form of MARK_FORMS) {
      for (const m of text.matchAll(form)) {
        const n = Number(m[1]);
        if (Math.abs(n - mark) < 1e-9 || named.has(m[0])) continue;
        named.add(m[0]);
        flags.push({ check: "other_mark", detail: m[0].trim(), message: `It names "${m[0].trim()}", but the mark awarded is ${pyFormatG(mark)}` });
      }
    }
  }
  if (band !== null) {
    for (const [b, pattern] of CLASSIFICATIONS) {
      if (b === band) continue;
      for (const m of text.matchAll(pattern)) {
        if (named.has(m[0].toLowerCase())) continue;
        named.add(m[0].toLowerCase());
        flags.push({ check: "other_mark", detail: m[0], message: `It names "${m[0]}" (${BAND_NAMES[b]}), but the mark is ${BAND_NAMES[band]}` });
      }
    }
  }
  for (const label of levels.others) {
    // Only labels that can't be ordinary words: those with a digit (such as "2:1 (68)").
    if (!/\d/.test(label) || label === levels.awarded) continue;
    for (const m of text.matchAll(wordPattern(label))) {
      if (named.has(m[0].toLowerCase())) continue;
      named.add(m[0].toLowerCase());
      flags.push({ check: "other_mark", detail: m[0], message: `It names the level "${m[0]}", but the level awarded is ${levels.awarded ?? "another"}` });
    }
  }
  return flags;
}

/** The flags on a criterion's feedback, against its level and mark. */
export function checkCriterionFeedback(text: string, c: Criterion, levelId: string, mark: number | null, praise: PraiseWords): Flag[] {
  const awarded = c.levels.find((l) => l.id === levelId)?.label ?? null;
  return checkFeedback(text, mark, criterionMax(c), praise, { awarded, others: c.levels.map((l) => l.label).filter((l) => l !== awarded) });
}

/** A flag the educator hasn't accepted for this text. */
export const unaccepted = (flags: Flag[], feedback: Pick<Feedback, "accepted_flags"> | null) =>
  flags.filter((f) => !(feedback?.accepted_flags ?? []).some((a) => a.check === f.check && a.detail === f.detail));
