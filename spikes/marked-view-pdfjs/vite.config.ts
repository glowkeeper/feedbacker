import { defineConfig } from "vite";

export default defineConfig({
  root: "browser",
  base: "./",
  build: { outDir: "../dist", emptyOutDir: true, target: "es2023" },
});
