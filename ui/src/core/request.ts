/**
 * Record a moderation request: module context and the sampled submissions.
 * A port of `core/src/feedbacker_core/request.py` (#27, #48).
 *
 * External identifiers (e.g. Turnitin submission IDs) are validated, assigned
 * pseudonymous submission IDs and pseudonyms, and stored only in the pseudonym
 * key. The request record itself is pseudonymous.
 */

import { ModerationRequest, type Actor, type BandCount } from "./models.ts";
import { pyStrip } from "./pytext.ts";
import { byExternalId, byPseudonym, REQUEST, withEntries, type KeyEntry, type Workspace, WorkspaceError } from "./workspace.ts";

const EXTERNAL_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/;
export const MODERATOR: Actor = { kind: "moderator", label: "moderator" };

/** The moderation request is invalid. `problems` lists every issue found. */
export class RequestError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super("invalid moderation request:\n- " + problems.join("\n- "));
    this.name = "RequestError";
    this.problems = problems;
  }
}

export interface SampleEntry {
  external_id: string;
  band?: string | null;
}

/** 0 -> [STUDENT_A], 25 -> [STUDENT_Z], 26 -> [STUDENT_AA], ... */
export function pseudonymFor(index: number): string {
  let letters = "";
  let n = index + 1;
  while (n) {
    const rem = (n - 1) % 26;
    n = Math.floor((n - 1) / 26);
    letters = String.fromCharCode(65 + rem) + letters;
  }
  return `[STUDENT_${letters}]`;
}

/** Trimmed valid entries, and every problem found. */
export function checkSample(entries: SampleEntry[]): [SampleEntry[], string[]] {
  const problems: string[] = [];
  const cleaned: SampleEntry[] = [];
  const seen = new Map<string, number>();
  if (!entries.length) problems.push("the sample is empty");
  entries.forEach((entry, i) => {
    const position = i + 1;
    const externalId = pyStrip(entry.external_id);
    const band = entry.band ? pyStrip(entry.band) : null;
    if (!externalId) {
      problems.push(`entry ${position}: identifier is empty`);
      return;
    }
    if (!EXTERNAL_ID.test(externalId)) {
      problems.push(
        `entry ${position}: identifier '${externalId}' is malformed; use letters, ` +
          "digits, '.', '_' or '-', starting and ending with a letter or digit",
      );
      return;
    }
    if (seen.has(externalId)) {
      problems.push(`entry ${position}: identifier '${externalId}' duplicates entry ${seen.get(externalId)}`);
      return;
    }
    seen.set(externalId, position);
    cleaned.push({ external_id: externalId, band: band || null });
  });
  return [cleaned, problems];
}

export function checkCounts(sampleSize: number, cohortSize: number | null, bands: BandCount[]): string[] {
  const problems: string[] = [];
  if (cohortSize !== null && cohortSize < sampleSize) {
    problems.push(`cohort size ${cohortSize} is smaller than the sample of ${sampleSize}`);
  }
  if (cohortSize !== null && bands.length) {
    const total = bands.reduce((n, b) => n + b.count, 0);
    if (total > cohortSize) problems.push(`band distribution totals ${total}, more than the cohort size ${cohortSize}`);
  }
  return problems;
}

const blankToNull = (value: string | null | undefined) => (value ? pyStrip(value) || null : null);

export interface RequestOptions {
  programme?: string | null;
  module?: string | null;
  staff_roles?: string[];
  cohort_size?: number | null;
  multiple_groups?: boolean | null;
  band_distribution?: BandCount[];
  sample_note?: string | null;
  replace?: boolean;
  now?: Date;
}

/**
 * Validate and store the request; external IDs go only into the pseudonym key.
 *
 * Pseudonyms are stable. An identifier already in the key keeps its
 * pseudonym, and new identifiers get the next unused one; pseudonyms are
 * never reassigned or reused, even on replacement.
 *
 * Consistency on disk: the key is append-only and is written before the
 * request. If writing stops between the two, the key holds at worst an unused
 * entry, and the recorded request always resolves against it.
 */
export async function recordRequest(ws: Workspace, sample: SampleEntry[], options: RequestOptions = {}): Promise<ModerationRequest> {
  if ((await ws.exists(REQUEST)) && !options.replace) {
    throw new WorkspaceError("a moderation request is already recorded; use replace to record it again");
  }
  const bands = options.band_distribution ?? [];
  const cohortSize = options.cohort_size ?? null;
  const [entries, problems] = checkSample(sample);
  problems.push(...checkCounts(entries.length, cohortSize, bands));
  const roles = (options.staff_roles ?? []).map(pyStrip);
  if (roles.some((r) => !r)) problems.push("staff roles must not be empty");
  if (problems.length) throw new RequestError(problems);

  const provenance = {
    source: "manual entry",
    transformation: "entered" as const,
    actor: MODERATOR,
    timestamp: (options.now ?? new Date()).toISOString(),
  };

  const key = await ws.readKey();
  const newEntries: KeyEntry[] = [...key.entries];
  let nextIndex = newEntries.length;
  const sampled = entries.map((entry) => {
    let mapped = byExternalId(key, entry.external_id);
    if (!mapped) {
      mapped = {
        submission_id: `sub-${String(nextIndex + 1).padStart(3, "0")}`,
        pseudonym: pseudonymFor(nextIndex),
        external_id: entry.external_id,
        names: [],
        source_files: {},
      };
      newEntries.push(mapped);
      nextIndex++;
    }
    return { submission_id: mapped.submission_id, pseudonym: mapped.pseudonym, listed_band: entry.band ?? null };
  });

  const request = ModerationRequest.parse({
    context: {
      programme: blankToNull(options.programme),
      module: blankToNull(options.module),
      staff_roles: roles,
      cohort_size: cohortSize,
      multiple_groups: options.multiple_groups ?? null,
      band_distribution: bands,
      sample_note: blankToNull(options.sample_note),
      provenance,
    },
    sample: sampled,
    provenance,
  });
  if (newEntries.length !== key.entries.length) await ws.writeKey(withEntries(key, newEntries));
  await ws.writeJson(REQUEST, request);
  return request;
}

/** Load the request and confirm every sampled pseudonym resolves in the key. */
export async function loadRequest(ws: Workspace): Promise<ModerationRequest> {
  if (!(await ws.exists(REQUEST))) throw new WorkspaceError("no moderation request is recorded in this workspace");
  const parsed = ModerationRequest.safeParse(await ws.readJson(REQUEST));
  if (!parsed.success) throw new WorkspaceError(`${REQUEST} is not a valid moderation request`);
  const key = await ws.readKey();
  for (const s of parsed.data.sample) {
    const entry = byPseudonym(key, s.pseudonym);
    if (!entry || entry.submission_id !== s.submission_id) {
      throw new WorkspaceError(`request and pseudonym key are inconsistent for ${s.pseudonym}; the workspace may be damaged`);
    }
  }
  return parsed.data;
}
