/**
 * Generate contract/feedbacker.schema.json from the zod models (ADR 0004).
 *
 *   node scripts/contract.ts           write the schema
 *   node scripts/contract.ts --check   fail if it is out of date
 *
 * Cross-field rules (e.g. judge first, then reveal) live in the models'
 * refinements and are not expressible in JSON Schema; the schema describes
 * the shape of each record.
 */

import { readFile, writeFile } from "node:fs/promises";
import * as z from "zod";
import * as models from "../src/core/models.ts";

const SCHEMA_URL = new URL("../../contract/feedbacker.schema.json", import.meta.url);

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

export function render(): string {
  // Every named model becomes a definition, so shared types are referenced, not repeated.
  const registry = z.registry<{ id: string }>();
  for (const [name, schema] of Object.entries(models)) {
    if (schema instanceof z.ZodType) registry.add(schema, { id: name });
  }
  const { schemas } = z.toJSONSchema(registry, {
    io: "output",
    target: "draft-2020-12",
    uri: (id) => `#/$defs/${id}`,
  });
  const defs = Object.fromEntries(
    Object.entries(schemas).map(([name, { $schema: _, $id: __, ...definition }]) => [name, definition]),
  );
  const document = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://feedbacker.education/contract/${models.SCHEMA_VERSION}`,
    title: "Feedbacker contract",
    description: "Generated from ui/src/core/models.ts by `npm run contract`. Do not edit by hand.",
    $defs: defs,
    oneOf: Object.keys(models.CONTRACT_TYPES).map((name) => ({ $ref: `#/$defs/${name}` })),
  };
  return JSON.stringify(sortKeys(document), null, 2) + "\n";
}

if (import.meta.main) {
  const rendered = render();
  if (process.argv.includes("--check")) {
    const current = await readFile(SCHEMA_URL, "utf8").catch(() => "");
    if (current !== rendered) {
      console.error("contract/feedbacker.schema.json is out of date; run `npm run contract`");
      process.exit(1);
    }
    console.log("contract schema is up to date");
  } else {
    await writeFile(SCHEMA_URL, rendered);
    console.log(`wrote ${SCHEMA_URL.pathname}`);
  }
}
