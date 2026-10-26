/**
 * Find sampled students' files by name, for a request whose IDs aren't the
 * ones in the downloads' file names.
 *
 * A request may list the institution's own student IDs and names, while the
 * marking platform names its files `<submission ID> - <NAME> - <file>`. No ID
 * on the request is then in any file name. Names are weaker than IDs (reordered,
 * abbreviated, shared), so a name matches only when it is the same set of name
 * parts, whatever the case, punctuation or order, and only one file qualifies.
 * Everything else is left for the moderator to pick by hand, and nothing is
 * recorded until they confirm: a file is never taken for a student by a guess.
 *
 * A confirmed match records the file's platform ID in the pseudonym key, and
 * from then on the originals and the marked views are both found by it, as the
 * marked views' file names carry the same ID. Only file names are read here.
 */

import { listMembers, nameHasId, type Member } from "./archive.ts";
import { loadRequest } from "./request.ts";
import { matchId, withEntries, type KeyEntry, type Workspace, WorkspaceError } from "./workspace.ts";
import type { ByteSource } from "./zip.ts";

const TURNITIN = /^([0-9]{4,}) - ([^ ].*?) - ./; // "<ID> - <NAME> - <file>"

/** The marking platform's ID in a Turnitin-style file name, or null. */
export const platformIdOfFileName = (fileName: string): string | null => TURNITIN.exec(fileName)?.[1] ?? null;

/** The name part of a Turnitin-style file name, or null. */
const nameOfFileName = (fileName: string): string | null => TURNITIN.exec(fileName)?.[2] ?? null;

/**
 * A name as a comparable key: its parts, without case, accents or punctuation, in alphabetical order, so
 * "Avery, Quill", "QUILL AVERY ." and "Quill Avery" are one name. An empty key (no letters) matches nothing.
 */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{Nd}]+/u)
    .filter(Boolean)
    .sort()
    .join(" ");
}

export type MatchStatus = "matched" | "none" | "several" | "no-name";

/** One sampled student whose ID is in no file name, and what a name match found for them. */
export interface Proposal {
  pseudonym: string;
  submission_id: string;
  /** The name as the request gave it (real; shown only where real IDs are). */
  formName: string | null;
  status: MatchStatus;
  /** The file the name matched, when exactly one did. */
  file: string | null;
}

export interface FreeFile {
  fileName: string;
  platformId: string;
}

export interface Proposals {
  proposals: Proposal[];
  /** Files with a platform ID that no student has been matched to, for picking by hand. */
  free: FreeFile[];
}

const SKIPPED = new Set([".txt"]);

/**
 * Propose matches for the sampled students whose ID (the platform's, once known, else the request's) is in no file
 * name among `sources`. Only names are read, never a file's content.
 */
export async function proposeMatches(ws: Workspace, sources: ByteSource[]): Promise<Proposals> {
  const request = await loadRequest(ws);
  const key = await ws.readKey();
  const members: Member[] = (await Promise.all(sources.map(listMembers))).flat().filter((m) => !SKIPPED.has(m.suffix));
  const candidates = members.flatMap((m) => {
    const platformId = platformIdOfFileName(m.fileName);
    const name = nameOfFileName(m.fileName);
    return platformId && name ? [{ fileName: m.fileName, platformId, key: nameKey(name) }] : [];
  });

  const students = request.sample.flatMap((s) => {
    const entry = key.entries.find((e) => e.pseudonym === s.pseudonym);
    return entry ? [{ s, entry }] : [];
  });
  const lost = students.filter(({ entry }) => !members.some((m) => nameHasId(m.fileName, matchId(entry))));

  const proposals: Proposal[] = lost.map(({ s, entry }) => {
    const keys = new Set(entry.names.map(nameKey).filter(Boolean));
    const base = { pseudonym: s.pseudonym, submission_id: s.submission_id, formName: entry.names[0] ?? null };
    if (!keys.size) return { ...base, status: "no-name", file: null };
    const hits = [...new Map(candidates.filter((c) => keys.has(c.key)).map((c) => [c.platformId, c])).values()];
    if (hits.length === 1) return { ...base, status: "matched", file: hits[0].fileName };
    return { ...base, status: hits.length ? "several" : "none", file: null };
  });

  // A file two students both matched is nobody's: both are left for the moderator.
  const claims = new Map<string, number>();
  for (const p of proposals) if (p.file) claims.set(p.file, (claims.get(p.file) ?? 0) + 1);
  for (const p of proposals) {
    if (p.file && claims.get(p.file)! > 1) Object.assign(p, { status: "several", file: null });
  }

  // Files a student is already found by (their ID is in the name), or has just been matched to, aren't free.
  const taken = new Set(proposals.flatMap((p) => (p.file ? [p.file] : [])));
  for (const { entry } of students) for (const m of members) if (nameHasId(m.fileName, matchId(entry))) taken.add(m.fileName);
  const free = [...new Map(candidates.filter((c) => !taken.has(c.fileName)).map((c) => [c.platformId, { fileName: c.fileName, platformId: c.platformId }])).values()];
  return { proposals, free };
}

/** A match the moderator confirmed: a student, and the file they say is theirs. */
export interface ConfirmedMatch {
  pseudonym: string;
  fileName: string;
}

/**
 * Record the matches the moderator confirmed: each file's platform ID goes into the key. All or nothing: a file whose
 * name has no platform ID, an ID already recorded for someone else, or a student already matched to another ID
 * (unless `replace`) refuses the lot.
 */
export async function confirmMatches(ws: Workspace, matches: ConfirmedMatch[], options: { replace?: boolean } = {}): Promise<void> {
  const request = await loadRequest(ws);
  const key = await ws.readKey();
  const problems: string[] = [];
  const sampled = new Set(request.sample.map((s) => s.pseudonym));
  const entries = new Map<string, KeyEntry>(key.entries.map((e) => [e.pseudonym, e]));
  const chosen = new Map<string, string>(); // pseudonym -> platform ID
  for (const { pseudonym, fileName } of matches) {
    const label = `${pseudonym}`;
    const entry = entries.get(pseudonym);
    const platformId = platformIdOfFileName(fileName);
    if (!entry || !sampled.has(pseudonym)) problems.push(`${label} is not a sampled student`);
    else if (!platformId) problems.push(`the file chosen for ${label} has no marking-platform ID in its name, so it can't be matched`);
    else if (entry.platform_id && entry.platform_id !== platformId && !options.replace) {
      problems.push(`${label} is already matched to another ID; replace the match to change it`);
    } else chosen.set(pseudonym, platformId);
  }
  const owners = new Map<string, string>(); // platform ID -> pseudonym, among the chosen
  for (const [pseudonym, id] of chosen) {
    if (owners.has(id)) problems.push(`${pseudonym} and ${owners.get(id)} were matched to the same file`);
    owners.set(id, pseudonym);
    const other = key.entries.find((e) => e.pseudonym !== pseudonym && (e.platform_id === id || e.external_id === id));
    if (other && !chosen.has(other.pseudonym)) problems.push(`the ID in the file chosen for ${pseudonym} already belongs to ${other.pseudonym}`);
  }
  if (problems.length) throw new WorkspaceError("cannot record the matches:\n- " + problems.join("\n- "));
  await ws.writeKey(withEntries(key, key.entries.map((e) => (chosen.has(e.pseudonym) ? { ...e, platform_id: chosen.get(e.pseudonym)! } : e))));
}
