/**
 * Runs and their spend limits (ADR 0003). The app confirms a worst-case
 * estimate with the moderator, then opens a run with that estimate and a
 * limit; the estimate may be above the limit, and the run stops there. Before each request the proxy reserves the request's worst case, so
 * even concurrent requests can't take a run past its limit; afterwards the
 * reservation is replaced by the actual cost.
 */

import { randomBytes } from "node:crypto";
import { Refusal } from "./boundary.ts";

export interface Run {
  id: string;
  limit_usd: number;
  estimate_usd: number;
  spent_usd: number;
  reserved_usd: number;
  opened_at: string;
}

export class Runs {
  readonly #runs = new Map<string, Run>();
  readonly maxLimitUsd: number;

  constructor(maxLimitUsd: number) {
    this.maxLimitUsd = maxLimitUsd;
  }

  open(limitUsd: number, estimateUsd: number, now: Date): Run {
    if (!(limitUsd > 0)) throw new Refusal("run", "the spend limit must be greater than 0");
    if (limitUsd > this.maxLimitUsd) {
      throw new Refusal("run", `the spend limit is above this proxy's maximum of $${this.maxLimitUsd} a run (see --max-run-usd)`);
    }
    // The estimate is a worst case (every call at its maximum output, with a
    // fallback), so it may be above the limit: the run then stops at the limit,
    // as the Python reading does (decided 2026-09-27). It must be a real amount.
    if (!(estimateUsd >= 0) || !Number.isFinite(estimateUsd)) {
      throw new Refusal("run", `the confirmed estimate must be a non-negative amount (got ${estimateUsd})`);
    }
    const run: Run = {
      id: `run-${randomBytes(9).toString("base64url")}`,
      limit_usd: limitUsd,
      estimate_usd: estimateUsd,
      spent_usd: 0,
      reserved_usd: 0,
      opened_at: now.toISOString(),
    };
    this.#runs.set(run.id, run);
    return run;
  }

  get(id: string): Run {
    const run = this.#runs.get(id);
    if (!run) throw new Refusal("run", "no such run; open a run with a confirmed estimate first");
    return run;
  }

  /** The run, or null if this proxy doesn't know it (it was opened before a restart). */
  find(id: string): Run | null {
    return this.#runs.get(id) ?? null;
  }

  /** Hold back the request's worst case, or refuse if the limit would be exceeded. */
  reserve(run: Run, worstCaseUsd: number): void {
    if (run.spent_usd + run.reserved_usd + worstCaseUsd > run.limit_usd) {
      throw new Refusal(
        "spend",
        `the $${run.limit_usd} spend limit would be exceeded ($${run.spent_usd.toFixed(4)} spent, ` +
          `this request could cost up to $${worstCaseUsd.toFixed(4)})`,
      );
    }
    run.reserved_usd += worstCaseUsd;
  }

  settle(run: Run, worstCaseUsd: number, actualUsd: number): void {
    run.reserved_usd = Math.max(0, run.reserved_usd - worstCaseUsd);
    run.spent_usd += actualUsd;
  }
}
