/**
 * The marking platform's download report, read for one thing only: how many
 * files it says failed to download.
 *
 * Bulk downloads come with a small text report ("manifest", as in Turnitin's
 * GradeMark downloads, or "report"). It lists every file in the download, with
 * each student's name and ID (sampled or not), so only the failed count is
 * taken from it: its text is never kept, logged or shown. The report is found
 * inside a zip, or among files chosen loose or as an unzipped folder, so a
 * download keeps its failed-file check however the moderator unpacked it.
 *
 * Only a small .txt whose name says it is the report, and carries no
 * identifier-like number or 'ID - NAME' pattern, is opened. Anything that could
 * be a student's text submission is never opened. (Python also opens any other
 * such root .txt in a zip, e.g. "essay.txt".)
 */

import { D, pyIgnoreCase, S } from "./pyre.ts";
import { pyInt } from "./pytext.ts";
import { hasZipName } from "./archive.ts";
import { listZip, readMember, type ByteSource } from "./zip.ts";

const REPORT_FAILED = new RegExp(`${pyIgnoreCase("failed file count")}[${S}]*:[${S}]*([${D}]+)`, "u");
const REPORT_MAX_BYTES = 16 * 1024;
const IDENTIFIER_LIKE = new RegExp(`[${D}]{5,}`, "u");

/** Whether a file of this name and size at the top of a download is its report. */
export function isDownloadReportName(name: string, size: number): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".txt") &&
    (lower.includes("manifest") || lower.includes("report")) &&
    !name.includes("/") &&
    !name.includes(" - ") &&
    !IDENTIFIER_LIKE.test(name) &&
    size <= REPORT_MAX_BYTES
  );
}

export interface DownloadReports {
  /** A failed-files warning from each report that lists any. */
  warnings: string[];
  /** Whether any report was found, so the moderator is told when the failed-file check couldn't be made. */
  found: boolean;
}

/** Read the failed-file count from each download report among `sources`. */
export async function readDownloadReports(sources: ByteSource[]): Promise<DownloadReports> {
  const warnings: string[] = [];
  let found = false;
  const failed = (bytes: Uint8Array, where: string) => {
    found = true;
    const text = new TextDecoder().decode(bytes); // invalid bytes become U+FFFD
    const m = REPORT_FAILED.exec(text);
    if (m && pyInt(m[1])! > 0n) warnings.push(`${where}its download report lists ${m[1]} failed file(s)`);
  };
  for (const [i, source] of sources.entries()) {
    if (hasZipName(source)) {
      for (const entry of await listZip(source)) {
        if (isDownloadReportName(entry.name, entry.size)) failed(await readMember(source, entry), `source ${i + 1}: `);
      }
    } else if (isDownloadReportName(source.name, source.size)) {
      failed(await source.read(0, source.size), "a download report among the chosen files: ");
    }
  }
  return { warnings, found };
}
