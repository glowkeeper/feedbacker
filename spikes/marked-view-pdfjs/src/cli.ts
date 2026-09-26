/** Print the parse of one or more marked-view PDFs as JSON: `node src/cli.ts <pdf>...` */

import { readFileSync } from "node:fs";
import { parseMarkedView } from "./markedView.ts";

const out: Record<string, unknown> = {};
for (const path of process.argv.slice(2)) {
  try {
    out[path] = await parseMarkedView(new Uint8Array(readFileSync(path)));
  } catch (err) {
    out[path] = { error: err instanceof Error ? err.message : String(err) };
  }
}
console.log(JSON.stringify(out, null, 2));
