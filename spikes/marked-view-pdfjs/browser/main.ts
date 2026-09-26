/** Browser entry for the spike: parse a chosen PDF locally and show the result. */

import { GlobalWorkerOptions } from "#pdfjs";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { parseMarkedView, type MarkedView } from "../src/markedView.ts";

GlobalWorkerOptions.workerSrc = workerUrl;

async function run(data: Uint8Array): Promise<{ view: MarkedView; ms: number }> {
  const start = performance.now();
  const view = await parseMarkedView(data);
  return { view, ms: performance.now() - start };
}

const status = document.getElementById("status")!;
const output = document.getElementById("output")!;

document.getElementById("file")!.addEventListener("change", async (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  status.textContent = "Parsing…";
  try {
    const { view, ms } = await run(new Uint8Array(await file.arrayBuffer()));
    status.textContent = `Parsed in ${ms.toFixed(0)} ms, with ${view.warnings.length} warnings.`;
    output.textContent = JSON.stringify(view, null, 2);
  } catch (err) {
    status.textContent = (err as Error).message;
    output.textContent = "";
  }
});

// For the automated browser check (scripts/browser.ts).
Object.assign(window, {
  parseFrom: async (url: string) => run(new Uint8Array(await (await fetch(url)).arrayBuffer())),
});
