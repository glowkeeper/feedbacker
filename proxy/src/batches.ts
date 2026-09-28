/**
 * The batches this proxy has sent (#25), kept on disk so their results can be
 * collected after the proxy or the app restarts. A batch can take up to a day.
 *
 * Only what the proxy needs to account for a batch is kept: its id, run,
 * and, for each request, the model, prompt version, the hash of what was
 * sent and the spend reserved for it. No text, no names, no key. Only batches
 * recorded here can be checked or collected, so the app can't reach any
 * other batch the API key's account holds.
 */

import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import * as z from "zod";
import { Refusal } from "./boundary.ts";

/** The provider's batch ids: letters, digits, "_" and "-". */
export const BatchId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);

const BatchItem = z.strictObject({
  custom_id: z.string(),
  model: z.string(),
  prompt_version: z.string(),
  request_sha256: z.string(),
  worst_usd: z.number(),
});
export type BatchItem = z.output<typeof BatchItem>;

const BatchRecord = z.strictObject({
  id: BatchId,
  run_id: z.string(),
  created_at: z.string(),
  items: z.array(BatchItem),
  /** When its results were first collected: its spend is settled and logged once. */
  collected_at: z.string().nullable(),
});
export type BatchRecord = z.output<typeof BatchRecord>;

const File = z.strictObject({ batches: z.array(BatchRecord) });

/** The provider keeps results for 29 days; the record is kept a little longer. */
export const KEEP_DAYS = 30;

export class Batches {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    if (existsSync(path)) chmodSync(path, 0o600);
  }

  #load(): BatchRecord[] {
    if (!existsSync(this.path)) return [];
    const parsed = File.safeParse(JSON.parse(readFileSync(this.path, "utf8")));
    if (!parsed.success) throw new Error(`${this.path} is not a valid batch record; move it aside to start afresh`);
    return parsed.data.batches;
  }

  /** Written whole, then renamed into place, so a crash never leaves a partial record. */
  #save(batches: BatchRecord[]): void {
    const temporary = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ batches }, null, 2) + "\n", { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, this.path);
  }

  /** Throws unless the record can be read and written: checked before a batch is sent. */
  check(): void {
    this.#save(this.#load());
  }

  add(record: BatchRecord): void {
    this.#save([...this.#load().filter((b) => b.id !== record.id), BatchRecord.parse(record)]);
  }

  get(id: string): BatchRecord {
    const batch = this.#load().find((b) => b.id === id);
    if (!batch) throw new Refusal("batch", "no such batch: this proxy didn't send it, or its record has expired");
    return batch;
  }

  markCollected(id: string, now: Date): void {
    this.#save(this.#load().map((b) => (b.id === id ? { ...b, collected_at: now.toISOString() } : b)));
  }

  /** Forget batches older than KEEP_DAYS, whose results the provider no longer holds. */
  prune(now: Date): number {
    const all = this.#load();
    const cutoff = now.getTime() - KEEP_DAYS * 86_400_000;
    const kept = all.filter((b) => Date.parse(b.created_at) >= cutoff);
    if (kept.length !== all.length) this.#save(kept);
    return all.length - kept.length;
  }
}
