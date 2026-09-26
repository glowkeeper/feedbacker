/**
 * Measurements for #41: the browser bundle's size, and parse times for the
 * TypeScript port in Node against the Python parser on the replica.
 *
 * `node scripts/measure.ts`
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { parseMarkedView } from "../src/markedView.ts";

const REPLICA = "../../fixtures/synthetic/pack-01/marked-view-replica.pdf";
const RUNS = 20;
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

execFileSync("npx", ["vite", "build", "--logLevel", "error"], { stdio: "inherit" });
console.log("Browser bundle (dist/assets):");
for (const file of readdirSync("dist/assets")) {
  const body = readFileSync(join("dist/assets", file));
  console.log(`  ${file}: ${kb(body.length)} raw, ${kb(gzipSync(body).length)} gzip, ${kb(brotliCompressSync(body).length)} brotli`);
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const data = new Uint8Array(readFileSync(REPLICA));
const times: number[] = [];
for (let i = 0; i < RUNS; i++) {
  const start = performance.now();
  await parseMarkedView(data);
  times.push(performance.now() - start);
}
console.log(`TypeScript (Node ${process.version}): first ${times[0].toFixed(0)} ms, median ${median(times).toFixed(0)} ms over ${RUNS} runs`);

const python = execFileSync(
  "uv",
  [
    "run", "--quiet", "--project", "../../core", "python", "-c",
    `import time, statistics
from pathlib import Path
from feedbacker_core.marked_view import parse_marked_view
times = []
for _ in range(${RUNS}):
    t = time.perf_counter(); parse_marked_view(Path("${REPLICA}")); times.append((time.perf_counter() - t) * 1000)
print(f"first {times[0]:.0f} ms, median {statistics.median(times):.0f} ms over ${RUNS} runs")`,
  ],
  { encoding: "utf8" },
).trim();
console.log(`Python (pdfplumber): ${python}`);
