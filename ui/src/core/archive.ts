/**
 * Select sampled submissions from bulk downloads without opening the rest: a
 * port of `core/src/feedbacker_core/archive.py` (#15, #17, #47).
 *
 * A sample can be spread across several sources: a main bulk zip, a zip from a
 * second submission point, split zip parts, or single downloaded files. Each
 * sampled identifier is matched across all of them. A file matches an
 * identifier when the identifier appears in its file name as a whole token.
 * Only names are read to decide: listing reads the zip's central directory,
 * and only the selected members are ever read (`readMember`).
 */

import { nameShape } from "./structure.ts";
import { listZip, readMember, type ByteSource, type ZipEntry } from "./zip.ts";

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveError";
  }
}

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const isZip = (source: ByteSource) => source.name.toLowerCase().endsWith(".zip");

export class Member {
  readonly source: ByteSource;
  /** The member name inside the zip, or the file name. */
  readonly name: string;
  readonly #entry: ZipEntry | null;

  constructor(source: ByteSource, name: string, entry: ZipEntry | null) {
    this.source = source;
    this.name = name;
    this.#entry = entry;
  }

  get isArchive(): boolean {
    return this.#entry !== null;
  }

  get fileName(): string {
    return baseName(this.name);
  }

  get suffix(): string {
    const name = this.fileName;
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(dot).toLowerCase() : "";
  }

  /** Read this member: the only way a member's content is ever read. */
  read(): Promise<Uint8Array> {
    return this.#entry ? readMember(this.source, this.#entry) : this.source.read(0, this.source.size);
  }
}

export class Selection {
  matched = new Map<string, Member>(); // external_id -> member
  unmatchedIds: string[] = [];
  ambiguous = new Map<string, Member[]>();
  ignoredCount = 0; // files not selected; never opened

  /**
   * Describe problems without real file names, which may identify students.
   * `label` names a sampled submission (e.g. by pseudonym); candidates are
   * described by source position and name shape only.
   */
  problems(label: (externalId: string) => string = (id) => id, sources: ByteSource[] = []): string[] {
    const out = this.unmatchedIds.map((id) => `no file found for ${label(id)}`);
    for (const [id, members] of this.ambiguous) {
      const where = members
        .map((m) => {
          const index = sources.indexOf(m.source);
          return `source ${index >= 0 ? index + 1 : "?"} (${nameShape(m.fileName)})`;
        })
        .join(", ");
      out.push(`${label(id)} matches ${members.length} files: ${where}; resolve before importing`);
    }
    return out;
  }
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tokenPattern = (externalId: string) => new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(externalId)}(?![A-Za-z0-9])`);

export async function listMembers(source: ByteSource): Promise<Member[]> {
  if (!isZip(source)) return [new Member(source, source.name, null)];
  let entries: ZipEntry[];
  try {
    entries = await listZip(source);
  } catch (err) {
    throw new ArchiveError(`not a readable zip archive (${nameShape(source.name)}): ${(err as Error).name}`);
  }
  return entries
    .filter((e) => !e.isDirectory && !baseName(e.name).startsWith(".") && !e.name.includes("__MACOSX"))
    .map((e) => new Member(source, e.name, e));
}

export async function selectMembers(sources: ByteSource | ByteSource[], externalIds: string[]): Promise<Selection> {
  const list = Array.isArray(sources) ? sources : [sources];
  const members = (await Promise.all(list.map(listMembers))).flat();
  const selection = new Selection();
  const used = new Set<Member>();
  for (const id of externalIds) {
    const pattern = tokenPattern(id);
    const hits = members.filter((m) => pattern.test(m.fileName));
    if (!hits.length) selection.unmatchedIds.push(id);
    else if (hits.length > 1) selection.ambiguous.set(id, hits);
    else {
      selection.matched.set(id, hits[0]);
      used.add(hits[0]);
    }
  }
  selection.ignoredCount = members.filter((m) => !used.has(m)).length;
  return selection;
}
