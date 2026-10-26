/**
 * Import the assessment brief: a port of `core/src/feedbacker_core/brief.py`
 *.
 *
 * The brief is extracted locally with the same extractor as submissions;
 * document metadata is never read. It is then redacted by anonymisation and
 * must be approved by the moderator before the AI reading may use it
 * (boundary.ts).
 */

import { extract, sha256Bytes, sourceFormat } from "./extract.ts";
import { Brief, type BriefRange } from "./models.ts";
import { pyStrip } from "./pytext.ts";
import { ownerOf } from "./assessment.ts";
import type { ByteSource } from "./zip.ts";
import { type Workspace, WorkspaceError } from "./workspace.ts";

export const BRIEF = "brief.json";
export const BRIEF_ID = "brief";

/** The stored source, named by content so old and new can coexist on replacement. */
export const briefSource = (brief: Brief) => `sources/brief-${brief.source_sha256.slice(0, 16)}.${brief.source_format}`;

/** Load the brief and confirm its stored source file still matches the record. */
export async function loadBrief(ws: Workspace): Promise<Brief> {
  if (!(await ws.exists(BRIEF))) throw new WorkspaceError("no brief has been imported");
  const parsed = Brief.safeParse(await ws.readJson(BRIEF));
  if (!parsed.success) throw new WorkspaceError(`${BRIEF} is not a valid brief`);
  const stored = await ws.readBytes(briefSource(parsed.data));
  if (!stored || sha256Bytes(stored) !== parsed.data.source_sha256) {
    throw new WorkspaceError("the brief's stored source file is missing or does not match the record; import it again");
  }
  return parsed.data;
}

export async function saveBrief(ws: Workspace, brief: Brief): Promise<void> {
  await ws.writeJson(BRIEF, Brief.parse(brief), { private: true });
}

const failed = (err: unknown) =>
  new WorkspaceError(`the brief could not be imported (${(err as Error).name}); any previously imported brief is unchanged`);

/**
 * Import (or replace) the brief, complete-or-nothing.
 *
 * The file is read and extracted in memory; an unsupported or unsuitable file
 * fails with an ExtractionError and nothing is written. The new source is
 * stored under a content-addressed name beside the old one, then the record
 * is written; that write is the switch-over. Only after it succeeds are older
 * sources removed, so a failure at any point leaves the previous record and
 * its source intact.
 */
export async function importBrief(ws: Workspace, source: ByteSource, options: { replace?: boolean; now?: Date } = {}): Promise<Brief> {
  if ((await ws.exists(BRIEF)) && !options.replace) {
    throw new WorkspaceError("a brief is already imported; use replace to import again");
  }
  const format = sourceFormat(source.name); // an ExtractionError for unsupported types
  let bytes: Uint8Array;
  try {
    bytes = await source.read(0, source.size);
  } catch (err) {
    throw failed(err);
  }
  const now = options.now ?? new Date();
  const extracted = await extract(source.name, bytes, now); // fails clearly; nothing is kept
  const digest = sha256Bytes(bytes);
  const brief = Brief.parse({
    source_format: format,
    source_sha256: digest,
    extract: extracted,
    provenance: {
      source: `file:sha256:${digest}`,
      transformation: "imported",
      actor: ownerOf(ws),
      timestamp: now.toISOString(),
      input_hashes: [digest],
    },
  });
  const final = briefSource(brief);
  const others = (await ws.exists("sources")) ? (await ws.fs.list("sources")).filter((e) => e.kind === "file" && /^brief-.*\./.test(e.name)) : [];
  const existed = others.some((e) => `sources/${e.name}` === final);
  try {
    await ws.writeBytes(final, bytes); // beside any previous source; nothing is removed yet
    // The switch-over. Written without the proxy's confirmation, which follows
    // separately, so a failure here really does leave the previous brief.
    await ws.writeJson(BRIEF, brief);
  } catch (err) {
    if (!existed) await ws.fs.remove(final).catch(() => {}); // don't leave the unused new source behind
    await ws.secure().catch(() => {});
    throw failed(err);
  }
  // The new brief is in place. An old source that can't be removed is only
  // left over (the record names its own), and the next import removes it.
  for (const old of others) if (`sources/${old.name}` !== final) await ws.fs.remove(`sources/${old.name}`).catch(() => {});
  await ws.secure(); // private; if the workspace can't be confirmed, that is the error reported
  return brief;
}

// --- Which part of the brief applies ------------------------------------------------------------------------------------

/**
 * A brief can describe several assessments, with the module's weightings, outcomes and rules around them. Only the parts the
 * moderator chooses for this assessment are anonymised, approved and sent. Offsets count code points, as the extract's blocks do.
 */

/** A section of the brief: a heading and what follows it, up to the next heading of the same or a higher rank. */
export interface BriefSection {
  title: string;
  level: number;
  start: number;
  end: number;
  words: number;
}

const isSpace = (ch: string) => /\s/u.test(ch);

/** The brief's sections, by its headings, in order. A brief with no headings has none (a range of its text can still be chosen). */
export function briefSections(brief: Brief): BriefSection[] {
  const points = Array.from(brief.extract.text);
  const headings = brief.extract.blocks.filter((b) => b.kind === "heading");
  return headings.map((h, i) => {
    const level = h.level ?? 1;
    const next = headings.slice(i + 1).find((n) => (n.level ?? 1) <= level);
    let end = next ? next.start : points.length;
    while (end > h.start && isSpace(points[end - 1])) end--;
    const words = points.slice(h.start, end).join("").split(/\s+/u).filter(Boolean).length;
    return { title: points.slice(h.start, h.end).join("").trim(), level, start: h.start, end, words };
  });
}

/** Ranges in order, with any that touch or overlap joined, and empty ones dropped. */
export function normaliseRanges(ranges: BriefRange[]): BriefRange[] {
  const out: BriefRange[] = [];
  for (const r of [...ranges].filter((r) => r.end > r.start).sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = out.at(-1);
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** The text of the brief this assessment uses: the parts chosen, each trimmed and set apart by a blank line, or all of it. */
export function briefText(brief: Brief): string {
  if (!brief.selection) return brief.extract.text;
  const points = Array.from(brief.extract.text);
  return brief.selection
    .map((r) => pyStrip(points.slice(r.start, r.end).join("")))
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Choose the parts of the brief this assessment uses (null: all of it). A different choice means different text, so the brief's
 * anonymised text and its approval go until it is anonymised and approved again; the same choice changes nothing.
 */
export async function setBriefSelection(ws: Workspace, ranges: BriefRange[] | null): Promise<Brief> {
  const brief = await loadBrief(ws);
  const length = Array.from(brief.extract.text).length;
  let selection = ranges === null ? null : normaliseRanges(ranges);
  if (selection && !selection.length) throw new WorkspaceError("choose at least one part of the brief, or use all of it");
  if (selection && selection.length === 1 && selection[0].start === 0 && selection[0].end === length) selection = null; // exactly all of it: a longer range is not, and is refused below
  if (JSON.stringify(selection) === JSON.stringify(brief.selection)) return brief;
  const changed = Brief.parse({ ...brief, selection, anonymised: null, approval: null });
  await saveBrief(ws, changed);
  return changed;
}
