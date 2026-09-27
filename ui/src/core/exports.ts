/**
 * Every pseudonymous export of the approved record at once (#20): the
 * structured record (JSON) and the summary (Markdown and Word), rendered from
 * one approved record, so the three always describe the same moderation, and
 * written all or nothing: if any write, or making them private, fails, none
 * of the three is left behind.
 */

import { serialiseRecord } from "./contract.ts";
import { writeDocx } from "./docxWriter.ts";
import { ModerationRecord } from "./models.ts";
import { currentApprovedRecord } from "./record.ts";
import { summaryBlocks, toMarkdown } from "./summary.ts";
import { EXPORTS, type Workspace } from "./workspace.ts";

export async function exportApproved(ws: Workspace, now?: Date): Promise<{ paths: string[]; record: ModerationRecord }> {
  const record = await currentApprovedRecord(ws, now); // one snapshot, checked once
  const blocks = summaryBlocks(record);
  const title = blocks[0].kind === "heading" ? blocks[0].text : record.id;
  const files: [string, string, string | Uint8Array][] = [
    [`${record.id}-record`, "json", serialiseRecord(ModerationRecord, record, "moderation record")],
    [`${record.id}-summary`, "md", toMarkdown(blocks)],
    [`${record.id}-summary`, "docx", writeDocx(blocks, title)],
  ];
  const paths: string[] = [];
  try {
    for (const [name, ext, content] of files) paths.push(await ws.writeExport(name, ext, content));
    await ws.secure();
  } catch (err) {
    // Every name, not only those written: a write that failed part-way may have left a file.
    for (const [name, ext] of files) await ws.fs.remove(`${EXPORTS}/${name}.feedbacker-export.${ext}`).catch(() => {});
    await ws.secure().catch(() => {});
    throw err;
  }
  return { paths, record };
}
