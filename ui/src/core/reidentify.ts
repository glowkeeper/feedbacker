/**
 * A re-identified copy of the summary (#20), made only on the moderator's
 * explicit request each time, for a moderation form that needs to know which
 * submission is which.
 *
 * It restores the sampled students' external identifiers (e.g. Turnitin
 * submission IDs) from the pseudonym key, in place of their pseudonyms, and
 * nothing else: no names, and no other redacted value (other people's names,
 * emails, organisations stay as their tokens) (maintainer decision,
 * 2026-09-27). It is labelled as containing personal data, written in both
 * summary formats into the workspace's `exports/` only, and deleted with the
 * workspace. The structured record always stays pseudonymous.
 */

import { writeDocx } from "./docxWriter.ts";
import { currentApprovedRecord } from "./record.ts";
import { summaryBlocks, toMarkdown, type Run, type SummaryBlock } from "./summary.ts";
import { type Workspace, WorkspaceError } from "./workspace.ts";

export const REIDENTIFIED_NOTICE =
  "Re-identified copy: this contains personal data, the students' external identifiers (e.g. Turnitin submission IDs). It was made at the moderator's request, is kept only in this workspace, and is deleted with it. Share it only as the moderation requires.";

const PSEUDONYMOUS = "Students appear by pseudonym only.";
const IDENTIFIED = "Students appear by their external identifier (e.g. Turnitin submission ID), restored from the pseudonym key; nothing else is re-identified.";

/** The outline with each pseudonym replaced by its external identifier, titled and labelled as re-identified. */
export function reidentifyBlocks(blocks: SummaryBlock[], ids: Map<string, string>): SummaryBlock[] {
  const text = (t: string) => {
    let out = t.replace(PSEUDONYMOUS, IDENTIFIED);
    for (const [pseudonym, id] of ids) out = out.split(pseudonym).join(id);
    return out;
  };
  const run = (r: Run): Run => (typeof r === "string" ? text(r) : r);
  const mapped = blocks.map((b): SummaryBlock => {
    switch (b.kind) {
      case "heading":
        return { ...b, text: text(b.text) };
      case "paragraph":
        return { ...b, lines: b.lines.map((line) => line.map(run)) };
      case "list":
        return { ...b, items: b.items.map(text) };
      case "table":
        return { ...b, caption: text(b.caption), head: b.head.map(text), rows: b.rows.map((r) => r.map(text)) };
    }
  });
  const [title, ...rest] = mapped;
  const titled: SummaryBlock = title.kind === "heading" ? { ...title, text: `${title.text} (re-identified)` } : title;
  return [titled, { kind: "paragraph", lines: [[REIDENTIFIED_NOTICE]] }, ...rest];
}

/**
 * Write the re-identified summary, as Markdown and as a Word document, from
 * the approved record while the workspace still matches it. `confirmed` must
 * be true: the moderator asks for this each time.
 */
export async function exportReidentifiedSummary(ws: Workspace, options: { confirmed: boolean; now?: Date }): Promise<{ paths: string[] }> {
  if (options.confirmed !== true) {
    throw new WorkspaceError("a re-identified copy restores the students' external identifiers; it is made only when you confirm it");
  }
  const record = await currentApprovedRecord(ws, options.now);
  const key = await ws.readKey();
  const ids = new Map<string, string>();
  for (const s of record.submissions) {
    const entry = key.entries.find((e) => e.submission_id === s.id && e.pseudonym === s.pseudonym);
    if (!entry) throw new WorkspaceError(`the pseudonym key has no identifier for ${s.id} ${s.pseudonym}`);
    ids.set(s.pseudonym, entry.external_id);
  }
  const blocks = reidentifyBlocks(summaryBlocks(record), ids);
  const name = `${record.id}-summary-reidentified`;
  const title = blocks[0].kind === "heading" ? blocks[0].text : name;
  const paths = [await ws.writeExport(name, "md", toMarkdown(blocks)), await ws.writeExport(name, "docx", writeDocx(blocks, title))];
  await ws.secure();
  return { paths };
}
