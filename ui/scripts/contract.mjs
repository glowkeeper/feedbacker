// Generate TypeScript types from the core's JSON Schema (ADR 0002).
// `--check` fails if src/contract.ts is out of date.
import { readFile, writeFile } from "node:fs/promises";
import { compile } from "json-schema-to-typescript";

const schemaUrl = new URL("../../contract/feedbacker.schema.json", import.meta.url);
const outUrl = new URL("../src/contract.ts", import.meta.url);

const schema = JSON.parse(await readFile(schemaUrl, "utf8"));
const generated = await compile(schema, "FeedbackerContract", {
  additionalProperties: false,
  bannerComment:
    "/* Generated from contract/feedbacker.schema.json by `npm run contract`. Do not edit by hand. */",
  format: true,
  unreachableDefinitions: true,
});

if (process.argv.includes("--check")) {
  const current = await readFile(outUrl, "utf8").catch(() => "");
  if (current !== generated) {
    console.error("src/contract.ts is out of date; run `npm run contract`");
    process.exit(1);
  }
  console.log("contract types are up to date");
} else {
  await writeFile(outUrl, generated);
  console.log(`wrote ${outUrl.pathname}`);
}
