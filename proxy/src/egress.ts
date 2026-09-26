/**
 * The egress log: one JSON line for every request the proxy forwarded or
 * refused. It proves what left the machine without holding any of it: no
 * text, no names, no key; only the time, run, model, prompt version, request
 * hash, token usage, cost and outcome. Entries older than the retention
 * period are removed at start-up and daily.
 */

import { appendFileSync, chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Usage } from "./pricing.ts";

export interface EgressEntry {
  time: string;
  run_id: string | null;
  model: string | null;
  prompt_version: string | null;
  request_sha256: string | null;
  outcome: string;
  refusal: string | null;
  usage: Usage | null;
  cost_usd: number | null;
}

export class EgressLog {
  readonly path: string;
  readonly retentionDays: number;

  constructor(path: string, retentionDays: number) {
    if (!Number.isInteger(retentionDays) || retentionDays < 1) throw new Error("the retention period must be at least one day");
    this.path = path;
    this.retentionDays = retentionDays;
    this.#lockDown();
  }

  /** Keep the log readable only by its owner, even if its mode was changed while the proxy was stopped. */
  #lockDown(): void {
    if (existsSync(this.path)) chmodSync(this.path, 0o600);
  }

  record(entry: EgressEntry): void {
    appendFileSync(this.path, JSON.stringify(entry) + "\n", { mode: 0o600 });
    chmodSync(this.path, 0o600);
  }

  entries(): EgressEntry[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as EgressEntry);
  }

  /** Drop entries older than the retention period. */
  prune(now: Date): number {
    this.#lockDown();
    const cutoff = now.getTime() - this.retentionDays * 86_400_000;
    const all = this.entries();
    const kept = all.filter((e) => Date.parse(e.time) >= cutoff);
    if (kept.length !== all.length) {
      writeFileSync(this.path, kept.map((e) => JSON.stringify(e) + "\n").join(""), { mode: 0o600 });
      this.#lockDown();
    }
    return all.length - kept.length;
  }
}
