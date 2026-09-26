/**
 * Import sampled original files from bulk downloads and extract their text: a
 * port of `core/src/feedbacker_core/originals.py` (#15, #48).
 *
 * A sample may be spread across several sources (a main zip, a zip from a
 * late-submission point, single files). Only the sampled submissions are
 * taken; other students' files are never opened. Bulk downloads are never
 * copied into the workspace: only each selected file is stored, under its
 * pseudonymous submission ID, and only hashes of the downloads are recorded.
 * Real file names go only into the pseudonym key. Each submission is imported
 * completely or not at all, and failures are listed.
 *
 * Python stages each file in a `.staging` folder so that nothing existing is
 * touched until a submission has succeeded; here the staged bytes are held
 * in memory and written only after every submission has been processed,
 * which gives the same guarantee without a staging folder in the workspace.
 */

import { ArchiveError, selectMembers } from "./archive.ts";
import { extract, ExtractionError, sha256Bytes, sourceFormat } from "./extract.ts";
import { Submission } from "./models.ts";
import { loadRequest, MODERATOR } from "./request.ts";
import { byPseudonym, withEntries, type KeyEntry, type PseudonymKey, type Workspace, WorkspaceError } from "./workspace.ts";
import { hashSource, type ByteSource } from "./zip.ts";

export const SOURCES = "sources";
export const SUBMISSIONS = "submissions";
const ORIGINALS = `${SOURCES}/originals`;
const SUPPORTED = new Set([".docx", ".pdf"]);

export class ImportProblem extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super("cannot import originals:\n- " + problems.join("\n- "));
    this.name = "ImportProblem";
    this.problems = problems;
  }
}

export interface ImportResult {
  imported: Submission[];
  failed: Map<string, string>; // submission_id -> reason
  ignoredCount: number;
}

export const submissionPath = (submissionId: string) => `${SUBMISSIONS}/${submissionId}.json`;

/** Import the sampled originals found across `sources` (zips or single files). */
export async function importOriginals(
  ws: Workspace,
  sources: ByteSource | ByteSource[],
  options: { replace?: boolean; now?: Date } = {},
): Promise<ImportResult> {
  const list = Array.isArray(sources) ? sources : [sources];
  const request = await loadRequest(ws);
  const key = await ws.readKey();
  const sampled = request.sample.map((s) => [s, byPseudonym(key, s.pseudonym)!] as const); // loadRequest guarantees these resolve

  const existing: string[] = [];
  for (const [s] of sampled) if (await ws.exists(submissionPath(s.submission_id))) existing.push(s.submission_id);
  if (existing.length && !options.replace) {
    throw new WorkspaceError(`submissions already imported (${existing.join(", ")}); use replace to import again`);
  }

  let selection;
  try {
    selection = await selectMembers(list, sampled.map(([, e]) => e.external_id));
  } catch (err) {
    if (err instanceof ArchiveError) throw new ImportProblem([err.message]);
    throw err;
  }
  const labels = new Map(sampled.map(([s, e]) => [e.external_id, `${s.pseudonym} (${s.submission_id})`]));
  const problems = selection.problems((id) => labels.get(id)!, list);
  for (const [externalId, member] of selection.matched) {
    if (!SUPPORTED.has(member.suffix)) {
      problems.push(`file for ${labels.get(externalId)} is not docx or pdf; Stage 0 imports typed docx and pdf only`);
    }
  }
  if (problems.length) throw new ImportProblem(problems);

  const now = options.now ?? new Date();
  const sourceHashes = new Map<ByteSource, string>();
  for (const member of selection.matched.values()) {
    if (!sourceHashes.has(member.source)) sourceHashes.set(member.source, await hashSource(member.source));
  }

  const result: ImportResult = { imported: [], failed: new Map(), ignoredCount: selection.ignoredCount };
  const newEntries: KeyEntry[] = [];
  const staged: { submission: Submission; bytes: Uint8Array; path: string }[] = [];
  for (const [s, entry] of sampled) {
    const member = selection.matched.get(entry.external_id)!;
    const fileName = `${s.submission_id}${member.suffix}`;
    // Nothing existing is touched until every submission has been processed, so
    // a failed replacement leaves the previous file and record intact.
    let bytes: Uint8Array;
    try {
      bytes = await member.read();
    } catch (err) {
      result.failed.set(s.submission_id, `the selected file could not be read (${(err as Error).name})`);
      newEntries.push(entry);
      continue;
    }
    const digest = sha256Bytes(bytes);
    const sourceHash = sourceHashes.get(member.source)!;
    let extracted;
    try {
      extracted = await extract(fileName, bytes, now);
    } catch (err) {
      if (!(err instanceof ExtractionError)) throw err;
      result.failed.set(s.submission_id, err.message);
      newEntries.push(entry);
      continue;
    }
    const submission = Submission.parse({
      id: s.submission_id,
      pseudonym: s.pseudonym,
      source_kind: "original",
      source_format: sourceFormat(fileName),
      source_sha256: digest,
      extract: extracted,
      provenance: {
        source: `${member.isArchive ? "archive" : "file"}:sha256:${sourceHash}`,
        transformation: "imported",
        actor: MODERATOR,
        timestamp: now.toISOString(),
        input_hashes: [...new Set([sourceHash, digest])].sort(),
      },
    });
    newEntries.push({ ...entry, source_files: { ...entry.source_files, original: member.fileName } });
    staged.push({ submission, bytes, path: `${ORIGINALS}/${fileName}` });
    result.imported.push(submission);
  }

  // Key first (it only gains information); then, per submission, the source
  // file and its record. Each write is atomic, and they are ordered so that
  // either the previous pair or the new one is always complete: an older
  // original in another format is removed only once its replacement and
  // record are written, and a same-named original is restored if its record
  // can't be written. loadSubmission detects any mismatch that remains.
  const sampledPseudonyms = new Set(sampled.map(([s]) => s.pseudonym));
  const untouched = key.entries.filter((e) => !sampledPseudonyms.has(e.pseudonym));
  await ws.writeKey(withEntries(key, inKeyOrder(key, [...untouched, ...newEntries])));
  const present = (await ws.exists(ORIGINALS)) ? await ws.fs.list(ORIGINALS) : [];
  let written = false;
  try {
    for (const { submission, bytes, path } of staged) {
      const previous = await ws.readBytes(path);
      written = true;
      await ws.writeBytes(path, bytes);
      try {
        await ws.writeJson(submissionPath(submission.id), submission);
      } catch (err) {
        await (previous ? ws.writeBytes(path, previous) : ws.fs.remove(path)).catch(() => {});
        throw err;
      }
      for (const old of present) {
        const oldPath = `${ORIGINALS}/${old.name}`;
        if (old.kind === "file" && old.name.startsWith(`${submission.id}.`) && oldPath !== path) await ws.fs.remove(oldPath);
      }
    }
  } catch (err) {
    // Whatever was written before the failure is still made private.
    if (written) await ws.secure().catch(() => {});
    throw err;
  }
  if (written) await ws.secure(); // stored originals and records are private
  return result;
}

function inKeyOrder(key: PseudonymKey, entries: KeyEntry[]): KeyEntry[] {
  const order = new Map(key.entries.map((e, i) => [e.pseudonym, i]));
  return [...entries].sort((a, b) => order.get(a.pseudonym)! - order.get(b.pseudonym)!);
}

/** Load a submission and confirm its stored source file still matches the record. */
export async function loadSubmission(ws: Workspace, submissionId: string): Promise<Submission> {
  const path = submissionPath(submissionId);
  if (!(await ws.exists(path))) throw new WorkspaceError(`submission ${submissionId} has not been imported`);
  const parsed = Submission.safeParse(await ws.readJson(path));
  if (!parsed.success) throw new WorkspaceError(`submission ${submissionId}: its record is not valid`);
  const stored = await ws.readBytes(`${ORIGINALS}/${submissionId}.${parsed.data.source_format}`);
  if (!stored || sha256Bytes(stored) !== parsed.data.source_sha256) {
    throw new WorkspaceError(
      `submission ${submissionId}: its stored source file is missing or does not match ` +
        "the record; the workspace may be damaged, so import it again",
    );
  }
  return parsed.data;
}
