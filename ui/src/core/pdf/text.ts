/**
 * Words and text lines from positioned characters (from the #41 spike), following pdfplumber's
 * defaults (`extract_words` and `extract_text_lines` with x and y tolerances
 * of 3 and no layout), so that the parser sees the same lines as the Python
 * implementation.
 */

import type { Char } from "./page.ts";

const TOLERANCE = 3;
const LIGATURES: Record<string, string> = {
  "ﬀ": "ff",
  "ﬃ": "ffi",
  "ﬄ": "ffl",
  "ﬁ": "fi",
  "ﬂ": "fl",
  "ﬆ": "st",
  "ﬅ": "st",
};

export interface Word {
  text: string;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  chars: Char[];
}

export interface Line {
  text: string;
  chars: Char[];
  top: number;
  bottom: number;
}

/** pdfplumber's `cluster_objects`: chain values within `tolerance`. */
function cluster<T>(items: T[], key: (item: T) => number, preserveOrder = false): T[][] {
  const values = [...new Set(items.map(key))].sort((a, b) => a - b);
  const index = new Map<number, number>();
  let group = 0;
  values.forEach((v, i) => {
    if (i > 0 && v > values[i - 1] + TOLERANCE) group++;
    index.set(v, group);
  });
  const tagged = items.map((item) => ({ item, group: index.get(key(item))! }));
  if (!preserveOrder) tagged.sort((a, b) => a.group - b.group); // stable
  const out: T[][] = [];
  let last: number | undefined;
  for (const { item, group: g } of tagged) {
    if (g !== last) out.push([]);
    out[out.length - 1].push(item);
    last = g;
  }
  return out;
}

function beginsNewWord(prev: Char, curr: Char): boolean {
  return curr.x0 < prev.x0 || curr.x0 > prev.x1 + TOLERANCE || Math.abs(curr.top - prev.top) > TOLERANCE;
}

function toWord(chars: Char[]): Word {
  return {
    text: chars.map((c) => c.text).join(""),
    x0: Math.min(...chars.map((c) => c.x0)),
    x1: Math.max(...chars.map((c) => c.x1)),
    top: Math.min(...chars.map((c) => c.top)),
    bottom: Math.max(...chars.map((c) => c.bottom)),
    chars,
  };
}

/** Upright, left-to-right text only; the marked views contain nothing else. */
export function extractWords(chars: Char[]): Word[] {
  const words: Word[] = [];
  let i = 0;
  while (i < chars.length) {
    // pdfplumber groups consecutive characters by uprightness first.
    let j = i;
    while (j < chars.length && chars[j].upright === chars[i].upright) j++;
    for (const line of cluster(chars.slice(i, j), (c) => c.top)) {
      line.sort((a, b) => a.x0 - b.x0);
      let current: Char[] = [];
      for (const c of line) {
        if (/^\s+$/.test(c.text)) {
          if (current.length) words.push(toWord(current));
          current = [];
        } else if (current.length && beginsNewWord(current[current.length - 1], c)) {
          words.push(toWord(current));
          current = [c];
        } else {
          current.push(c);
        }
      }
      if (current.length) words.push(toWord(current));
    }
    i = j;
  }
  return words;
}

export function extractTextLines(chars: Char[]): Line[] {
  const lines: Line[] = [];
  for (const group of cluster(extractWords(chars), (w) => w.top, true)) {
    const text = group
      .map((w) => w.chars.map((c) => LIGATURES[c.text] ?? c.text).join(""))
      .join(" ")
      .trim();
    if (text) {
      lines.push({
        text,
        chars: group.flatMap((w) => w.chars),
        top: Math.min(...group.map((w) => w.top)),
        bottom: Math.max(...group.map((w) => w.bottom)),
      });
    }
  }
  return lines;
}
