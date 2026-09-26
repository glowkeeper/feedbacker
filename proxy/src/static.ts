/**
 * Serving the built app. Files come only from the app folder: no path can
 * escape it, and dotfiles are never served. Until the interface exists (#19)
 * the proxy serves a placeholder page, which needs no script or style.
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import type { Context } from "hono";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

export const PLACEHOLDER = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Feedbacker proxy</title></head>
<body>
<main>
<h1>Feedbacker proxy is running</h1>
<p>The Feedbacker app is not installed yet (it arrives with the review screen, #19).</p>
</main>
</body>
</html>
`;

export function serveApp(appDir: string | null) {
  const root = appDir && existsSync(appDir) ? realpathSync(appDir) : null;
  return (c: Context) => {
    if (!root) return c.html(PLACEHOLDER);
    const requested = decodeURIComponent(new URL(c.req.url).pathname);
    const rel = normalize(requested === "/" ? "index.html" : requested.replace(/^\/+/, ""));
    if (rel.startsWith("..") || rel.split(sep).some((part) => part.startsWith("."))) return c.notFound();
    const file = join(root, rel);
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) return c.notFound();
    const real = realpathSync(file);
    if (!real.startsWith(root + sep)) return c.notFound();
    return c.body(readFileSync(real), 200, { "Content-Type": TYPES[extname(real)] ?? "application/octet-stream" });
  };
}
