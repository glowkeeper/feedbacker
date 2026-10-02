/**
 * What each setup step has recorded (#127), read from the workspace for its screen to show before its form: the
 * moderation request with each sampled submission's real ID, and each sampled submission's original. A record that
 * doesn't load is shown as a problem, never skipped.
 *
 * Real IDs come from the private pseudonym key and are shown on the Request screen only (maintainer decision,
 * 2026-10-02): it is where they are entered, and where the moderator matches pseudonyms to the moderation form. They
 * never leave this computer.
 */

import { byPseudonym, loadRequest, loadSubmission, REQUEST, submissionPath, type ModerationRequest, type SourceFormat, type Workspace } from "../core/index.ts";

export interface SampledRow {
  id: string;
  pseudonym: string;
  band: string | null;
  realId: string | null; // from the pseudonym key; null if the key has none (the workspace may be damaged)
}

export interface RequestRecorded {
  request: ModerationRequest;
  rows: SampledRow[];
}

/** The recorded request and each sampled submission's real ID; null while no request is recorded. */
export async function requestRecorded(ws: Workspace): Promise<RequestRecorded | null> {
  if (!(await ws.exists(REQUEST))) return null;
  const request = await loadRequest(ws);
  const key = await ws.readKey();
  return {
    request,
    rows: request.sample.map((s) => ({ id: s.submission_id, pseudonym: s.pseudonym, band: s.listed_band, realId: byPseudonym(key, s.pseudonym)?.external_id ?? null })),
  };
}

/** The Request form's boxes, as the recorded request fills them, so changing it starts from what is there. */
export interface RequestFormValues {
  sample: { band: string; ids: string }[];
  programme: string;
  module: string;
  roles: string;
  cohort: string;
  groups: "unknown" | "single" | "multiple";
  bands: { label: string; count: string }[];
  note: string;
}

export function requestFormValues({ request, rows }: RequestRecorded): RequestFormValues {
  // A row per band, in the order the bands were first listed; the submissions without a band in a row of their own.
  const byBand = new Map<string, string[]>();
  for (const row of rows) {
    const band = row.band ?? "";
    byBand.set(band, [...(byBand.get(band) ?? []), row.realId ?? ""]);
  }
  const c = request.context;
  return {
    sample: [...byBand].map(([band, ids]) => ({ band, ids: ids.filter(Boolean).join(", ") })),
    programme: c.programme ?? "",
    module: c.module ?? "",
    roles: c.staff_roles.join("\n"),
    cohort: c.cohort_size === null ? "" : String(c.cohort_size),
    groups: c.multiple_groups === null ? "unknown" : c.multiple_groups ? "multiple" : "single",
    bands: c.band_distribution.length ? c.band_distribution.map((b) => ({ label: b.label, count: String(b.count) })) : [{ label: "", count: "" }],
    note: c.sample_note ?? "",
  };
}

export interface OriginalRow {
  id: string;
  pseudonym: string;
  imported: boolean;
  format: SourceFormat | null;
  warnings: string[]; // from extracting its text
  problem: string | null; // its record doesn't load
}

/** Each sampled submission's original: imported or not, its format, and what extracting its text warned of. */
export async function originalsRecorded(ws: Workspace): Promise<OriginalRow[]> {
  if (!(await ws.exists(REQUEST))) return [];
  const request = await loadRequest(ws);
  const out: OriginalRow[] = [];
  for (const s of request.sample) {
    const row: OriginalRow = { id: s.submission_id, pseudonym: s.pseudonym, imported: false, format: null, warnings: [], problem: null };
    if (await ws.exists(submissionPath(s.submission_id))) {
      try {
        const sub = await loadSubmission(ws, s.submission_id);
        row.imported = true;
        row.format = sub.source_format;
        row.warnings = sub.extract?.warnings ?? [];
      } catch (err) {
        row.problem = err instanceof Error ? err.message : String(err);
      }
    }
    out.push(row);
  }
  return out;
}
