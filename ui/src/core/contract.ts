/** Validating records against the contract, with readable errors. */

import * as z from "zod";

/** A record that does not satisfy the contract. `issues` lists every problem found. */
export class ContractError extends Error {
  readonly issues: string[];

  constructor(what: string, issues: string[]) {
    super(`invalid ${what}:\n${issues.map((i) => `- ${i}`).join("\n")}`);
    this.name = "ContractError";
    this.issues = issues;
  }
}

function describe(issue: z.core.$ZodIssue): string {
  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

/**
 * Validate `data` and return the record with its defaults filled in, in the
 * same shape the Python reference writes. Throws `ContractError` otherwise.
 */
export function parseRecord<T extends z.ZodType>(schema: T, data: unknown, what = "record"): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) throw new ContractError(what, result.error.issues.map(describe));
  return result.data;
}

/** Serialise a validated record as the workspace stores it. */
export function serialiseRecord(record: unknown): string {
  return JSON.stringify(record, null, 2) + "\n";
}
