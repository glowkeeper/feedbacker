/**
 * What each setup step has recorded, read from the workspace for its screen to show before its form: the
 * moderation request with each sampled submission's real ID, and each sampled submission's original. A record that
 * doesn't load is shown as a problem, never skipped.
 *
 * Real IDs come from the private pseudonym key and are shown on the Request screen only (maintainer decision,
 * 2026-10-02): it is where they are entered, and where the moderator matches pseudonyms to the moderation form. They
 * never leave this computer.
 */

import {
  byPseudonym,
  loadReadings,
  loadRequest,
  loadRubric,
  loadSubmission,
  readingPath,
  readingProblems,
  READINGS,
  REQUEST,
  RUBRIC,
  submissionPath,
  type AISuggestion,
  type ModerationRequest,
  type ProducedBy,
  type SourceFormat,
  type Workspace,
} from "../core/index.ts";

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

export interface ReadingRow {
  id: string;
  pseudonym: string;
  read: boolean;
  model: string | null; // the model that answered, as it reported itself
  promptVersion: string | null;
  at: string | null; // when it was read (ISO)
  producedBy: ProducedBy | null; // live, batch, or reused from an identical earlier request (cache)
  costUsd: number | null; // from the run log; null when not recorded there
  current: boolean;
  why: string | null; // why it needs reading again, or why it can't be read
  nothing: boolean; // the call completed but the model recognised no criteria, so nothing is suggested
}

/** The latest call recorded for a submission (readings/calls/<id>--<time>--<model>.json): what a reading with nothing in it was read by. */
async function latestCall(ws: Workspace, submissionId: string): Promise<AISuggestion["call"] | null> {
  const calls = `${READINGS}/calls`;
  if (!(await ws.exists(calls))) return null;
  const names = (await ws.fs.list(calls))
    .filter((e) => e.kind === "file" && e.name.startsWith(`${submissionId}--`) && e.name.endsWith(".json"))
    .map((e) => e.name)
    .sort(); // the time in the name sorts them
  const last = names.at(-1);
  if (!last) return null;
  const record = (await ws.readJson(`${calls}/${last}`).catch(() => null)) as { call?: AISuggestion["call"] } | null;
  return record?.call ?? null;
}

/** What each run log says each call cost, by request ID (a reading's call carries its request ID). */
async function costs(ws: Workspace): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const runs = `${READINGS}/runs`;
  if (!(await ws.exists(runs))) return out;
  for (const e of await ws.fs.list(runs)) {
    if (e.kind !== "file" || !e.name.endsWith(".json")) continue;
    const log = (await ws.readJson(`${runs}/${e.name}`).catch(() => null)) as { calls?: { request_id?: string | null; cost_usd?: number }[] } | null;
    for (const c of log?.calls ?? []) if (c.request_id && typeof c.cost_usd === "number") out.set(c.request_id, c.cost_usd);
  }
  return out;
}

/**
 * Each sampled submission's AI reading: whether it is read, by which model and prompt version, when, how, what it
 * cost, and whether it is still current (read of the text as approved now, and of the rubric as it is now) or why not.
 */
export async function readingsRecorded(ws: Workspace): Promise<ReadingRow[]> {
  if (!(await ws.exists(REQUEST))) return [];
  const request = await loadRequest(ws);
  const rubric = (await ws.exists(RUBRIC)) ? await loadRubric(ws).catch(() => null) : null;
  const spent = await costs(ws);
  const out: ReadingRow[] = [];
  for (const s of request.sample) {
    const row: ReadingRow = { id: s.submission_id, pseudonym: s.pseudonym, read: false, model: null, promptVersion: null, at: null, producedBy: null, costUsd: null, current: false, why: null, nothing: false };
    out.push(row);
    if (!(await ws.exists(readingPath(s.submission_id)))) continue;
    try {
      const readings = await loadReadings(ws, s.submission_id);
      // A call that completed with no criteria recognised stores an empty reading: it is read (as the steps and the
      // overview count it), with nothing suggested, and what read it is in its call record.
      row.nothing = readings.length === 0;
      const call = readings[0]?.call ?? (await latestCall(ws, s.submission_id));
      row.read = true;
      if (call) {
        row.model = call.model_reported ?? call.model_requested;
        row.promptVersion = call.prompt_version;
        row.at = call.timestamp;
        row.producedBy = call.produced_by;
        row.costUsd = call.produced_by === "cache" ? 0 : call.request_id ? (spent.get(call.request_id) ?? null) : null;
      }
      const sub = (await ws.exists(submissionPath(s.submission_id))) ? await loadSubmission(ws, s.submission_id) : null;
      const [problem] = readingProblems(s.submission_id, readings, sub?.approval?.approved_text_sha256 ?? null, { approvalId: sub?.approval?.id ?? null, rubric });
      row.current = !problem;
      row.why = problem ?? null;
    } catch (err) {
      row.why = err instanceof Error ? err.message : String(err);
    }
  }
  return out;
}
