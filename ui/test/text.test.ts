/** Offsets, hashes and timestamps must mean the same as in the Python reference. */

import { expect, test } from "vitest";
import { codePointLength, instant, sha256Text } from "../src/core/index.ts";

test("sha256Text hashes UTF-8, as Python's sha256_text does", () => {
  expect(sha256Text("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  // hashlib.sha256("[STUDENT_A] wrote 🙂 this.".encode()).hexdigest()
  expect(sha256Text("[STUDENT_A] wrote 🙂 this.")).toBe(
    "cbd897318e08530a87ca72c926eced67d879deb2a15ece68b0bfd981af267314",
  );
});

test("lengths count code points, as Python's len() does", () => {
  const text = "Zoë wrote 🙂 this.";
  expect(codePointLength(text)).toBe(17);
  expect(text.length).toBe(18); // UTF-16 units: why the core must not use .length for offsets
});

test("instants keep microseconds and honour offsets", () => {
  expect(instant("2026-01-15T09:20:00.000001Z") - instant("2026-01-15T09:20:00Z")).toBe(1);
  expect(instant("2026-01-15T10:20:00+01:00")).toBe(instant("2026-01-15T09:20:00Z"));
  expect(instant("2026-01-15T09:20:00")).toBeNaN();
});
