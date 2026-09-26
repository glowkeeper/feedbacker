/** Locate a local Chrome or Chromium for the browser-based scripts. */

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function chromePath(): string {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache).filter((d) => d.startsWith("chromium-")).sort().reverse()) {
      candidates.push(join(cache, dir, "chrome-mac/Chromium.app/Contents/MacOS/Chromium"));
    }
  }
  const found = candidates.find((c) => c && existsSync(c));
  if (!found) throw new Error("no Chrome or Chromium found; set CHROME_PATH");
  return found;
}
