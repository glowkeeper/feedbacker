/** One version for the app, the proxy and the Python core, and the changelog's latest entry is for it. */

import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { VERSION } from "../src/core/index.ts";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const npm = (folder: string) => {
  const lock = JSON.parse(read(`${folder}/package-lock.json`));
  return [JSON.parse(read(`${folder}/package.json`)).version, lock.version, lock.packages[""].version];
};
const python = () => [
  /^version = "([^"]+)"/m.exec(read("core/pyproject.toml"))?.[1],
  /name = "feedbacker-core"\nversion = "([^"]+)"/.exec(read("core/uv.lock"))?.[1],
];

test("the app, the proxy and the Python core have the same version, in their packages and their lock files", () => {
  expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  const versions = [...npm("ui"), ...npm("proxy"), ...python()];
  expect(versions).toHaveLength(8);
  expect(new Set(versions)).toEqual(new Set([VERSION]));
});

test("the changelog's latest entry is for this version", () => {
  expect(/^## (\S+)/m.exec(read("CHANGELOG.md"))?.[1]).toBe(VERSION);
});
