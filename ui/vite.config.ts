/**
 * The Feedbacker app (#19): Svelte and TypeScript, built into `dist/`, which
 * the local proxy serves under its strict Content Security Policy. Svelte
 * compiles to plain JavaScript (no eval), and styles go into CSS files (the
 * CSP allows no inline styles).
 */

import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte()],
  build: { outDir: "dist", emptyOutDir: true },
});
