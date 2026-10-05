/**
 * A marking workspace's cohort: every submission it marks, imported from the
 * marking platform's bulk download, and the one way the rest of Feedbacker
 * lists a workspace's submissions, whichever kind of workspace it is.
 *
 * Each file in the download is named by the platform with the student's ID
 * (and name), so the ID is read from the name: Turnitin's
 * "<ID> - <NAME> - <file>" or Canvas's "<name>_[late_]<user ID>_<attachment ID>_<file>".
 * A file whose name doesn't follow either is listed, never guessed at. Every
 * submission gets a stable submission ID and pseudonym; its real ID and file
 * name go only into the pseudonym key. Each file is stored and extracted as an
 * original is (see originals.ts), so everything that reads a submission reads
 * a cohort's as it reads a sample's.
 */

import { ArchiveError, listMembers, type Member } from "./archive.ts";
import { EDUCATOR } from "./assessment.ts";
import { extractWithFigures, ExtractionError, sha256Bytes, sourceFormat } from "./extract.ts";
import { writeFigures } from "./figures.ts";
import { Cohort, Submission, type CohortSubmission } from "./models.ts";
import { ORIGINALS, submissionPath } from "./originals.ts";
import { isExternalId, loadRequest, pseudonymFor } from "./request.ts";
import { nameShape } from "./structure.ts";
import { byExternalId, byPseudonym, withEntries, type KeyEntry, type Workspace, WorkspaceError } from "./workspace.ts";
import { hashSource, type ByteSource } from "./zip.ts";

export const COHORT = "cohort.json";
const SUPPORTED = new Set([".docx", ".pdf"]);

/** One of a workspace's submissions: a moderation's sampled one (with the band it was listed under), or one of a marking cohort's. */
export interface WorkspaceSubmission {
  submission_id: string;
  pseudonym: string;
  listed_band: string | null;
}

const isMarking = (ws: Workspace) => ws.manifest.workspace_type === "marking";

/** Whether the workspace knows its submissions yet: a moderation's request is recorded, or a marking cohort imported. */
export const submissionsKnown = async (ws: Workspace): Promise<boolean> => ws.exists(isMarking(ws) ? COHORT : "request.json");

/**
 * The workspace's submissions, in order: a moderation's sample, or a marking workspace's cohort. Before there are any,
 * it says what to do first; a record that doesn't agree with the pseudonym key is refused.
 */
export async function listSubmissions(ws: Workspace): Promise<WorkspaceSubmission[]> {
  if (!isMarking(ws)) return (await loadRequest(ws)).sample.map((s) => ({ ...s, listed_band: s.listed_band ?? null }));
  return (await loadCohort(ws)).submissions.map((s) => ({ ...s, listed_band: null }));
}

/** What the workspace calls the set its submissions belong to, for messages: "the sample" or "the cohort". */
export const submissionsName = (ws: Workspace) => (isMarking(ws) ? "the cohort" : "the sample");

/** Load the cohort and confirm every pseudonym in it resolves in the key. */
export async function loadCohort(ws: Workspace): Promise<Cohort> {
  if (!(await ws.exists(COHORT))) throw new WorkspaceError("no cohort is imported in this workspace");
  const parsed = Cohort.safeParse(await ws.readJson(COHORT));
  if (!parsed.success) throw new WorkspaceError(`${COHORT} is not a valid record of the cohort`);
  const key = await ws.readKey();
  for (const s of parsed.data.submissions) {
    const entry = byPseudonym(key, s.pseudonym);
    if (!entry || entry.submission_id !== s.submission_id) {
      throw new WorkspaceError(`cohort and pseudonym key are inconsistent for ${s.pseudonym}; the workspace may be damaged`);
    }
  }
  return parsed.data;
}

// The same patterns as the Python core's, with nothing that differs between the two languages' regular expressions.
const TURNITIN = /^([0-9]{4,}) - [^ ].* - ./; // "<ID> - <NAME> - <file>"
const CANVAS = /^[A-Za-z][A-Za-z-]*_(?:late_)?([0-9]{3,})_[0-9]{3,}_./; // "<name>_[late_]<user ID>_<attachment ID>_<file>"

/** The student's ID in a file name as the marking platform names it, or null when the name doesn't follow a form Feedbacker knows. */
export function idFromFileName(fileName: string): string | null {
  const id = TURNITIN.exec(fileName)?.[1] ?? CANVAS.exec(fileName)?.[1] ?? null;
  return id !== null && isExternalId(id) ? id : null;
}

export class CohortProblem extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super("cannot import the cohort:\n- " + problems.join("\n- "));
    this.name = "CohortProblem";
    this.problems = problems;
  }
}

export interface CohortImportResult {
  imported: Submission[];
  kept: number; // already imported, and left as they were (not replaced)
  failed: Map<string, string>; // submission_id -> why its file couldn't be imported
  notImported: string[]; // files left out, each described by where it is and its name's shape, never its name
  ignoredCount: number; // the platform's download reports (.txt), never opened
}

/**
 * Import every submission in the bulk download (zips or single files) into a marking workspace's cohort.
 *
 * Importing again adds the new submissions and keeps every pseudonym; a submission already imported is replaced only
 * with `replace`. A file whose name carries no ID Feedbacker can read, an ID found in more than one file, and a file
 * that isn't docx or pdf are listed, not imported. Each submission is imported completely or not at all.
 *
 * On disk: the key first (append-only), then each submission's file and record, as for originals, then the cohort,
 * which lists only submissions whose record is written.
 */
export async function importCohort(
  ws: Workspace,
  sources: ByteSource | ByteSource[],
  options: { replace?: boolean; now?: Date } = {},
): Promise<CohortImportResult> {
  if (!isMarking(ws)) throw new WorkspaceError("only a marking workspace has a cohort; a moderation imports its sample's original files");
  const list = Array.isArray(sources) ? sources : [sources];
  let members: Member[];
  try {
    members = (await Promise.all(list.map(listMembers))).flat();
  } catch (err) {
    if (err instanceof ArchiveError) throw new CohortProblem([err.message]);
    throw err;
  }
  const where = (m: Member) => `source ${list.indexOf(m.source) + 1} (${nameShape(m.fileName)})`;

  const result: CohortImportResult = { imported: [], kept: 0, failed: new Map(), notImported: [], ignoredCount: 0 };
  const byId = new Map<string, Member[]>();
  for (const m of members) {
    const id = idFromFileName(m.fileName);
    if (id === null) {
      if (m.suffix === ".txt") result.ignoredCount++; // the platform's report on the download
      else result.notImported.push(`${where(m)}: its name doesn't carry an ID Feedbacker can read`);
      continue;
    }
    byId.set(id, [...(byId.get(id) ?? []), m]);
  }
  const chosen: [string, Member][] = [];
  for (const [id, found] of byId) {
    if (found.length > 1) result.notImported.push(`${found.length} files carry the same ID: ${found.map(where).join(", ")}; keep one and import again`);
    else if (!SUPPORTED.has(found[0].suffix)) result.notImported.push(`${where(found[0])}: not docx or pdf; Feedbacker imports typed docx and pdf only`);
    else chosen.push([id, found[0]]);
  }

  const key = await ws.readKey();
  const cohort = (await ws.exists(COHORT)) ? await loadCohort(ws) : null;
  const inCohort = new Set(cohort?.submissions.map((s) => s.submission_id) ?? []);
  const entries: KeyEntry[] = [...key.entries];
  const now = options.now ?? new Date();
  const sourceHashes = new Map<ByteSource, string>();
  const staged: { submission: Submission; bytes: Uint8Array; figures: Map<string, Uint8Array>; path: string }[] = [];

  for (const [id, member] of chosen) {
    let entry = byExternalId(key, id);
    if (entry && inCohort.has(entry.submission_id) && (await ws.exists(submissionPath(entry.submission_id))) && !options.replace) {
      result.kept++;
      continue;
    }
    if (!entry) {
      entry = { submission_id: `sub-${String(entries.length + 1).padStart(3, "0")}`, pseudonym: pseudonymFor(entries.length), external_id: id, names: [], source_files: {} };
      entries.push(entry);
    }
    const fileName = `${entry.submission_id}${member.suffix}`;
    let bytes: Uint8Array;
    let extracted;
    let figures: Map<string, Uint8Array>;
    try {
      bytes = await member.read();
      ({ extract: extracted, figures } = await extractWithFigures(fileName, bytes, now));
    } catch (err) {
      if (err instanceof ExtractionError) result.failed.set(entry.submission_id, err.message);
      else result.failed.set(entry.submission_id, `the file could not be read (${(err as Error).name})`);
      continue;
    }
    if (!sourceHashes.has(member.source)) sourceHashes.set(member.source, await hashSource(member.source));
    const sourceHash = sourceHashes.get(member.source)!;
    const digest = sha256Bytes(bytes);
    const submission = Submission.parse({
      id: entry.submission_id,
      pseudonym: entry.pseudonym,
      source_kind: "original",
      source_format: sourceFormat(fileName),
      source_sha256: digest,
      extract: extracted,
      provenance: {
        source: `${member.isArchive ? "archive" : "file"}:sha256:${sourceHash}`,
        transformation: "imported",
        actor: EDUCATOR,
        timestamp: now.toISOString(),
        input_hashes: [...new Set([sourceHash, digest])].sort(),
      },
    });
    const mapped = entry;
    entries[entries.findIndex((e) => e.pseudonym === mapped.pseudonym)] = { ...mapped, source_files: { ...mapped.source_files, original: member.fileName } };
    staged.push({ submission, bytes, figures, path: `${ORIGINALS}/${fileName}` });
    result.imported.push(submission);
  }
  if (!staged.length) {
    if (entries.length !== key.entries.length) await ws.writeKey(withEntries(key, entries)); // pseudonyms stay reserved for a later try
    if (!result.kept && !result.failed.size && !cohort) {
      throw new CohortProblem(result.notImported.length ? result.notImported : ["the download holds no submissions"]);
    }
    return result;
  }

  // Key first (it only gains information); then each submission's file and record, as originals are written; then the cohort.
  await ws.writeKey(withEntries(key, entries));
  const present = (await ws.exists(ORIGINALS)) ? await ws.fs.list(ORIGINALS) : [];
  const added: CohortSubmission[] = [];
  let failure: unknown = null;
  try {
    for (const { submission, bytes, figures, path } of staged) {
      const previous = await ws.readBytes(path);
      await ws.writeBytes(path, bytes);
      try {
        await ws.writeJson(submissionPath(submission.id), submission);
      } catch (err) {
        await (previous ? ws.writeBytes(path, previous) : ws.fs.remove(path)).catch(() => {});
        throw err;
      }
      await writeFigures(ws, submission.id, submission.extract!, figures); // checked against the record's hashes when read
      for (const old of present) {
        const oldPath = `${ORIGINALS}/${old.name}`;
        if (old.kind === "file" && old.name.startsWith(`${submission.id}.`) && oldPath !== path) await ws.fs.remove(oldPath);
      }
      if (!inCohort.has(submission.id)) added.push({ submission_id: submission.id, pseudonym: submission.pseudonym });
    }
  } catch (err) {
    failure = err;
  }
  // The cohort lists every submission whose record is written, even when a later one failed.
  if (added.length) {
    const order = new Map(entries.map((e, i) => [e.submission_id, i]));
    const submissions = [...(cohort?.submissions ?? []), ...added].sort((a, b) => order.get(a.submission_id)! - order.get(b.submission_id)!);
    const record = Cohort.parse({ submissions, provenance: { source: "bulk download", transformation: "imported", actor: EDUCATOR, timestamp: now.toISOString() } });
    await ws.writeJson(COHORT, record).catch((err) => (failure ??= err));
  }
  // Whatever was written is made private, whether or not everything was.
  await ws.secure().catch((err) => (failure ??= err));
  if (failure) throw failure;
  return result;
}
