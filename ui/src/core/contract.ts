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

/**
 * Validate a record and serialise it as the workspace stores it (two-space
 * indentation, a final newline), so nothing invalid is ever written. The
 * result parses to exactly what the Python reference writes for the same record.
 */
export function serialiseRecord<T extends z.ZodType>(schema: T, record: unknown, what = "record"): string {
  return JSON.stringify(parseRecord(schema, record, what), null, 2) + "\n";
}
