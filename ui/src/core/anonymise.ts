/**
 * Local, rules-based anonymisation behind a moderator approval gate: a port
 * of `core/src/feedbacker_core/anonymise.py`.
 *
 * Redaction runs on the extracted text of each imported submission, and the
 * brief. It replaces:
 *
 * - sampled students' names (taken from the pseudonym key, including names
 *   derived from Turnitin-style file names "<ID> - <NAME> - ...") with that
 *   student's pseudonym, e.g. [STUDENT_A];
 * - other people's names and organisations the moderator adds, with
 *   [PERSON_n] and [ORG_n];
 * - external IDs and student-number patterns, emails, URLs, and phone
 *   numbers, with [ID_n], [EMAIL_n], [URL_n], and [PHONE_n];
 * - any extra values the moderator marks for redaction.
 *
 * Tokens are stable across the workspace, and the values behind them are kept
 * only in the private pseudonym key. Automated redaction can miss indirect
 * identifiers, so the moderator reviews every submission and approves it
 * explicitly; only approved text may ever be sent to a model (boundary.ts).
 *
 * The patterns are Python's, with its Unicode `\w`, `\d` and `\s` and its
 * IGNORECASE rules (pyre.ts), so both cores redact the same spans with the
 * same tokens. Offsets in the records count code points, as in Python.
 */

import * as z from "zod";
import { BRIEF, BRIEF_ID, loadBrief, saveBrief } from "./brief.ts";
import { AnonymisedText, Approval, Brief, type Actor, type Redaction, Submission } from "./models.ts";
import { loadSubmission, submissionPath } from "./originals.ts";
import { D, pyCasefold, pyEscape, pyIgnoreCase, pyIsAlpha, pyIsUpper, S, W } from "./pyre.ts";
import { pyReprStr, pySplit, pyStrip } from "./pytext.ts";
import { ownerOf } from "./assessment.ts";
import { listSubmissions, submissionsKnown } from "./cohort.ts";
import { sha256Text } from "./text.ts";
import { type PseudonymKey, tokenFor, type Workspace, WorkspaceError } from "./workspace.ts";

export const RULES = "anonymisation/rules.json";
export const ANONYMISER: Actor = { kind: "system", label: "feedbacker anonymise" };
// Python's `re.match(r"^[A-Z]{2,12}$")` also accepts a final newline (its `$`
// matches before one), and then fails when the token "[AB\n_1]" is used.
// Here the kind is refused when the rule is added, or when the rules are read.
const KIND = /^[A-Z]{2,12}$/;

/** The moderator's additions and exceptions. Contains real values: private. */
export const AnonymisationRules = z.strictObject({
  names: z.array(z.string()).default([]).describe("Other people's names."),
  organisations: z.array(z.string()).default([]),
  redact: z.record(z.string(), z.string()).default({}).describe("Extra values to redact, mapped to a token kind."),
  ignore: z.array(z.string()).default([]).describe("Values never to redact (false positives)."),
});
export type AnonymisationRules = z.output<typeof AnonymisationRules>;

/** A candidate redaction. Offsets count code points, as in Python and the records. */
export interface Span {
  start: number;
  end: number;
  kind: string; // e.g. STUDENT, PERSON, ORG, ID, EMAIL, URL, PHONE
  value: string;
  token?: string | null; // a fixed token (e.g. a student's pseudonym)
}

/** An extra detector (e.g. local name recognition): it only adds candidates, which the moderator reviews. */
export type Detector = (text: string) => Span[];

const EMAIL = new RegExp(`[${W}.+-]+@[${W}-]+(?:\\.[${W}-]+)+`, "gu");
const URL = new RegExp(`(?:${pyIgnoreCase("http")}${pyIgnoreCase("s")}?://|${pyIgnoreCase("www")}\\.)[^${S}<>()"']+`, "gu");
const PHONE = new RegExp(`(?<![${W}+])(?:\\+44[${S}]?\\(?0?\\)?|0)[${D}](?:[${S}-]?[${D}]){8,9}(?![${W}])`, "gu");
const STUDENT_NUMBER = new RegExp(`(?<![${W}-])[A-Za-z]{0,2}[${D}]{7,}(?![${W}-])`, "gu");

// --- Names from file names -------------------------------------------------------------

/** '<ID> - QUILL AVERY . - report.docx' -> ['QUILL AVERY'] (Turnitin-style). */
export function namesFromFileName(fileName: string, externalId: string): string[] {
  const prefix = `${externalId} - `;
  if (!fileName.startsWith(prefix)) return [];
  const segment = fileName.slice(prefix.length).split(" - ")[0];
  const words = pySplit(segment).filter((w) => [...w].some((ch) => pyIsAlpha(ch.codePointAt(0)!)));
  return words.length ? [words.join(" ")] : [];
}

// --- Detection -------------------------------------------------------------------------

/** Whole-name patterns (any case, either order) and single-part patterns. */
function namePatterns(name: string): [RegExp[], RegExp[]] {
  // Initials (one letter) are not matched alone; every longer part is,
  // including short names such as "Jo" or "Li".
  const parts = pyStrip(name)
    .split(new RegExp(`[${S}]+`, "u"))
    .filter((p) => [...p].length >= 2);
  if (!parts.length) return [[], []];
  const orders = [parts, [...parts].reverse()].filter((o, i, all) => i === 0 || o.join("\0") !== all[0].join("\0"));
  const whole = orders
    .filter((o) => o.length > 1)
    .map((o) => new RegExp(`(?<![${W}])${o.map(pyIgnoreCase).join(`[${S},]+`)}(?![${W}])`, "gu"));
  // Single parts are matched case-insensitively; detect() keeps only matches
  // that start with a capital, so ordinary words matching a surname survive.
  const single = parts.map((p) => new RegExp(`(?<![${W}])${pyIgnoreCase(p)}(?![${W}])`, "gu"));
  return [whole, single];
}

/** Code-point offsets for UTF-16 ones, and back, for one text. */
function offsets(text: string) {
  const toPoint = new Int32Array(text.length + 1);
  const toUnit: number[] = [];
  let point = 0;
  for (let unit = 0; unit < text.length; ) {
    toUnit.push(unit);
    const width = text.codePointAt(unit)! > 0xffff ? 2 : 1;
    toPoint[unit] = point;
    if (width === 2) toPoint[unit + 1] = point;
    unit += width;
    point++;
  }
  toPoint[text.length] = point;
  toUnit.push(text.length);
  return { point: (unit: number) => toPoint[unit], unit: (p: number) => toUnit[p] };
}

/**
 * Candidate spans, resolved to non-overlapping ones (earlier, then longer,
 * first). Offsets count code points.
 */
export function detect(text: string, key: PseudonymKey, rules: AnonymisationRules, extra: Detector[] = []): Span[] {
  const at = offsets(text);
  const spans: Span[] = []; // UTF-16 offsets until the end
  const all = (pattern: RegExp, kind: string, token: string | null = null, keep: (m: string) => boolean = () => true) => {
    for (const m of text.matchAll(pattern)) {
      if (keep(m[0])) spans.push({ start: m.index, end: m.index + m[0].length, kind, value: m[0], token });
    }
  };
  const names = (name: string, kind: string, token: string | null) => {
    const [whole, single] = namePatterns(name);
    for (const pattern of whole) all(pattern, kind, token);
    for (const pattern of single) all(pattern, kind, token, (m) => pyIsUpper(m.codePointAt(0)!));
  };

  for (const entry of key.entries) {
    for (const name of entry.names) names(name, "STUDENT", entry.pseudonym);
    if (entry.external_id) all(new RegExp(`(?<![${W}-])${pyEscape(entry.external_id)}(?![${W}-])`, "gu"), "ID");
  }
  for (const name of rules.names) names(name, "PERSON", null);
  for (const org of rules.organisations) all(new RegExp(`(?<![${W}])${pyIgnoreCase(org)}(?![${W}])`, "gu"), "ORG");
  for (const [value, kind] of Object.entries(rules.redact)) all(new RegExp(pyIgnoreCase(value), "gu"), kind);
  for (const [kind, pattern] of [["EMAIL", EMAIL], ["URL", URL], ["PHONE", PHONE]] as const) {
    for (const m of text.matchAll(pattern)) {
      const value = m[0].replace(/[.,;:!?]+$/, "");
      spans.push({ start: m.index, end: m.index + value.length, kind, value, token: null });
    }
  }
  all(STUDENT_NUMBER, "ID");
  for (const detector of extra) {
    for (const s of detector(text)) spans.push({ ...s, start: at.unit(s.start), end: at.unit(s.end) });
  }

  const ignored = new Set(rules.ignore.map(pyCasefold));
  return resolve(spans.filter((s) => !ignored.has(pyCasefold(s.value)))).map((s) => ({ ...s, start: at.point(s.start), end: at.point(s.end) }));
}

/** Keep non-overlapping spans, preferring earlier then longer ones. */
function resolve(spans: Span[]): Span[] {
  const chosen: Span[] = [];
  let end = -1;
  for (const s of [...spans].sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))) {
    if (s.start >= end) {
      chosen.push(s);
      end = s.end;
    }
  }
  return chosen;
}

/** Replace each span with its token (allocating new tokens in `key`). Offsets count code points. */
export function apply(text: string, spans: Span[], key: PseudonymKey): [string, Redaction[]] {
  const points = [...text];
  const out: string[] = [];
  const redactions: Redaction[] = [];
  let cursor = 0;
  for (const s of spans) {
    const token = s.token || tokenFor(key, s.kind, canonical(s));
    out.push(points.slice(cursor, s.start).join(""), token);
    redactions.push({ start: s.start, end: s.end, replacement: token, reason: s.kind.toLowerCase() });
    cursor = s.end;
  }
  out.push(points.slice(cursor).join(""));
  return [out.join(""), redactions];
}

// Emails and IDs are case-insensitive identities; keep the value as written otherwise.
const canonical = (span: Span) => pySplit(span.value).join(" ");

// --- Workspace operations -----------------------------------------------------------------

export async function loadRules(ws: Workspace): Promise<AnonymisationRules> {
  if (!(await ws.exists(RULES))) return AnonymisationRules.parse({});
  const parsed = AnonymisationRules.safeParse(await ws.readJson(RULES));
  if (!parsed.success) throw new WorkspaceError(`${RULES} is not valid`);
  // An empty value would match everywhere; Python then fails with a validation error.
  if (Object.hasOwn(parsed.data.redact, "")) throw new WorkspaceError(`${RULES}: a value to redact is empty; remove it`);
  for (const kind of Object.values(parsed.data.redact)) {
    if (!KIND.test(kind)) throw new WorkspaceError(`${RULES}: redaction kind '${kind}' must be 2–12 capital letters`);
  }
  return parsed.data;
}

export interface RuleAdditions {
  names?: string[];
  organisations?: string[];
  redact?: Record<string, string>;
  ignore?: string[];
}

/** Add to the moderator's rules (existing values are kept; case-insensitive duplicates are skipped). */
export async function updateRules(ws: Workspace, additions: RuleAdditions = {}): Promise<AnonymisationRules> {
  const rules = await loadRules(ws);
  for (const kind of Object.values(additions.redact ?? {})) {
    if (!KIND.test(kind)) throw new WorkspaceError(`redaction kind '${kind}' must be 2–12 capital letters`);
  }
  const merged = (existing: string[], added: string[] = []) => {
    const seen = new Set(existing.map(pyCasefold));
    return [...existing, ...added.map(pyStrip).filter((v) => v && !seen.has(pyCasefold(v)))];
  };
  const redact = { ...rules.redact };
  for (const [k, v] of Object.entries(additions.redact ?? {})) if (pyStrip(k)) redact[pyStrip(k)] = v;
  const updated = AnonymisationRules.parse({
    names: merged(rules.names, additions.names),
    organisations: merged(rules.organisations, additions.organisations),
    redact,
    ignore: merged(rules.ignore, additions.ignore),
  });
  await ws.writeJson(RULES, updated, { private: true });
  return updated;
}

export interface AnonymiseResult {
  /** Redactions by kind, per submission ID (and "brief"). */
  counts: Record<string, Record<string, number>>;
  approvalKept: Record<string, boolean>;
}

function redact(text: string, sourceSha256: string, key: PseudonymKey, rules: AnonymisationRules, extra: Detector[], timestamp: string): AnonymisedText {
  const [redacted, redactions] = apply(text, detect(text, key, rules, extra), key);
  return AnonymisedText.parse({
    text: redacted,
    text_sha256: sha256Text(redacted),
    redactions,
    provenance: {
      source: `extract:sha256:${sourceSha256}`,
      transformation: "anonymised",
      actor: ANONYMISER,
      timestamp,
      input_hashes: [sourceSha256],
    },
  });
}

const countKinds = (anonymised: AnonymisedText) => {
  const counts: Record<string, number> = {};
  for (const r of anonymised.redactions) counts[r.reason] = (counts[r.reason] ?? 0) + 1;
  return counts;
};

/**
 * Redact every imported submission and the brief. An approval survives only
 * if its text is unchanged.
 */
export async function anonymiseWorkspace(ws: Workspace, options: { extra?: Detector[]; now?: Date } = {}): Promise<AnonymiseResult> {
  const extra = options.extra ?? [];
  // Whatever there is: the brief can be anonymised before any submissions are known.
  const submissions = (await submissionsKnown(ws)) ? await listSubmissions(ws) : [];
  const key = await ws.readKey();
  // Derive students' names from their original file names (append-only).
  key.entries = key.entries.map((entry) => {
    const derived = namesFromFileName(entry.source_files.original ?? "", entry.external_id);
    const known = new Set(entry.names.map(pyCasefold));
    const added = derived.filter((n) => !known.has(pyCasefold(n)));
    return added.length ? { ...entry, names: [...entry.names, ...added] } : entry;
  });
  const rules = await loadRules(ws);
  const timestamp = (options.now ?? new Date()).toISOString();

  const updated: Submission[] = [];
  const result: AnonymiseResult = { counts: {}, approvalKept: {} };
  for (const s of submissions) {
    if (!(await ws.exists(submissionPath(s.submission_id)))) continue;
    const sub = await loadSubmission(ws, s.submission_id);
    const anonymised = redact(sub.extract!.text, sub.source_sha256, key, rules, extra, timestamp);
    const keep = sub.approval !== null && sub.approval.approved_text_sha256 === anonymised.text_sha256;
    updated.push(Submission.parse({ ...sub, anonymised, approval: keep ? sub.approval : null })); // re-check invariants
    result.counts[s.submission_id] = countKinds(anonymised);
    result.approvalKept[s.submission_id] = keep;
  }

  let brief: Brief | null = (await ws.exists(BRIEF)) ? await loadBrief(ws) : null;
  if (brief) {
    const anonymised = redact(brief.extract.text, brief.source_sha256, key, rules, extra, timestamp);
    const keep = brief.approval !== null && brief.approval.approved_text_sha256 === anonymised.text_sha256;
    brief = Brief.parse({ ...brief, anonymised, approval: keep ? brief.approval : null });
    result.counts[BRIEF_ID] = countKinds(anonymised);
    result.approvalKept[BRIEF_ID] = keep;
  }

  if (!updated.length && !brief) throw new WorkspaceError("nothing to anonymise; import originals (or the brief) first");

  // Key first (append-only), then the records, which reference its tokens.
  await ws.writeKey(key);
  try {
    for (const sub of updated) await ws.writeJson(submissionPath(sub.id), sub);
    if (brief) await saveBrief(ws, brief); // private: this also tightens the records above
    else await ws.secure(); // the records are private
  } catch (err) {
    await ws.secure().catch(() => {}); // whatever was written is still made private
    throw err;
  }
  return result;
}

type Anonymisable = Submission | Brief;

/** A submission, or the brief when `recordId` is "brief". */
const load = (ws: Workspace, recordId: string): Promise<Anonymisable> => (recordId === BRIEF_ID ? loadBrief(ws) : loadSubmission(ws, recordId));

async function save(ws: Workspace, recordId: string, record: Anonymisable): Promise<void> {
  if (recordId === BRIEF_ID) await saveBrief(ws, record as Brief);
  else await ws.writeJson(submissionPath(recordId), Submission.parse(record), { private: true });
}

/** Record the moderator's explicit approval of a submission's (or the brief's) current anonymised text. */
export async function approve(ws: Workspace, recordId: string, now?: Date): Promise<Approval> {
  const record = await load(ws, recordId);
  if (!record.anonymised) throw new WorkspaceError(`${recordId} has not been anonymised; run anonymise first`);
  const approval = Approval.parse({
    id: `appr-${recordId}-${record.anonymised.text_sha256.slice(0, 12)}`,
    approved_text_sha256: record.anonymised.text_sha256,
    approved_by: ownerOf(ws),
    approved_at: (now ?? new Date()).toISOString(),
  });
  await save(ws, recordId, { ...record, approval });
  return approval;
}

/** Anonymised text, and optionally each redaction's original value (for local review only). */
export async function reviewLines(ws: Workspace, recordId: string, withValues: boolean): Promise<string[]> {
  const record = await load(ws, recordId);
  if (!record.anonymised || !record.extract) throw new WorkspaceError(`${recordId} has not been anonymised; run anonymise first`);
  const status = record.approval ? "APPROVED" : "NOT APPROVED";
  const label = record.kind === "brief" ? "brief" : `${record.id} ${record.pseudonym}`;
  const lines = [`${label}: ${record.anonymised.redactions.length} redactions; ${status}`];
  if (withValues) {
    lines.push("!! The list below shows REAL VALUES for your review. Do not share or paste it anywhere.");
    const points = [...record.extract.text];
    for (const r of record.anonymised.redactions) {
      const original = points.slice(r.start, r.end).join("");
      const padded = r.replacement + " ".repeat(Math.max(0, 14 - [...r.replacement].length));
      lines.push(`  ${padded} <- ${pyReprStr(original)} (${r.reason})`);
    }
  }
  lines.push("", record.anonymised.text);
  return lines;
}

/**
 * How many values the current pseudonym key and rules would still redact in
 * text that is already anonymised: 0 when its anonymisation is complete. The
 * key and the rules only grow (a later import can add a name; the moderator
 * can add a rule), and anonymising anonymised text finds only what is newly
 * covered, so this tells whether a text made earlier is still complete.
 */
export const stillToRedact = (text: string | null, key: PseudonymKey, rules: AnonymisationRules) => (text ? detect(text, key, rules).length : 0);

/** As `stillToRedact`, with the workspace's own key and rules. */
export async function incompleteIn(ws: Workspace, text: string | null): Promise<boolean> {
  if (!text) return false;
  return stillToRedact(text, await ws.readKey(), await loadRules(ws)) > 0;
}
