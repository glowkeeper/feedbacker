/** The remembered folder the browser reads through: each file read once, and always what was last written. */

import { expect, test } from "vitest";
import { CachingFileSystem, MemoryFileSystem } from "../src/core/index.ts";

/** A folder that counts its reads. */
class Counting extends MemoryFileSystem {
  reads = 0;
  checks = 0;
  override async readText(path: string) {
    this.reads += 1;
    return super.readText(path);
  }
  override async exists(path: string) {
    this.checks += 1;
    return super.exists(path);
  }
}

test("a file read again is not read again, and what is written through it is what is read next", async () => {
  const inner = new Counting({ "a.json": '{"n":1}' });
  const fs = new CachingFileSystem(inner);
  expect(await fs.readText("a.json")).toBe('{"n":1}');
  expect(await fs.readText("a.json")).toBe('{"n":1}');
  expect(inner.reads).toBe(1);
  await fs.writeText("a.json", '{"n":2}');
  expect(await fs.readText("a.json")).toBe('{"n":2}');
  expect(await inner.readText("a.json")).toBe('{"n":2}'); // written through, not only remembered
  await fs.remove("a.json");
  expect(await fs.readText("a.json")).toBeNull();
});

test("whether a path exists is remembered, and changes with a write or a removal, for the folders above it too", async () => {
  const inner = new Counting();
  const fs = new CachingFileSystem(inner);
  expect(await fs.exists("d/x.json")).toBe(false);
  expect(await fs.exists("d/x.json")).toBe(false);
  expect(await fs.exists("d")).toBe(false);
  expect(inner.checks).toBe(2);
  await fs.writeText("d/x.json", "{}");
  expect(await fs.exists("d/x.json")).toBe(true);
  expect(await fs.exists("d")).toBe(true);
  await fs.remove("d/x.json");
  expect(await fs.exists("d/x.json")).toBe(false);
});

test("a read that began before a write doesn't leave the old value remembered", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  class Slow extends MemoryFileSystem {
    override async readText(path: string) {
      const text = await super.readText(path);
      await gate; // the old value is in hand, and the write happens before the read finishes
      return text;
    }
  }
  const fs = new CachingFileSystem(new Slow({ "a.json": "old" }));
  const reading = fs.readText("a.json");
  await Promise.resolve();
  await fs.writeText("a.json", "new");
  release();
  expect(await reading).toBe("old"); // what that read saw
  expect(await fs.readText("a.json")).toBe("new"); // but not what is remembered
});

test("forget() reads again, and large and binary files are not remembered", async () => {
  const inner = new Counting({ "a.json": "1", "big.json": "x".repeat(CachingFileSystem.LIMIT + 1) });
  const fs = new CachingFileSystem(inner);
  await fs.readText("a.json");
  fs.forget();
  await fs.readText("a.json");
  expect(inner.reads).toBe(2);
  inner.reads = 0;
  await fs.readText("big.json");
  await fs.readText("big.json");
  expect(inner.reads).toBe(2);
});
