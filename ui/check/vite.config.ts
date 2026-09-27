/** The browser checks' pages: the core checks (index.html) and the app (app.html), built with Svelte. */

import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte()],
  build: { rolldownOptions: { input: { index: "index.html", app: "app.html" } } },
});
