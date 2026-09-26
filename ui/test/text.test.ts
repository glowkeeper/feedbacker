/** Offsets, hashes and timestamps must mean the same as in the Python reference. */

import { expect, test } from "vitest";
import { codePointLength, instant, isWellFormed, normaliseTimestamp, sha256Text } from "../src/core/index.ts";

test("sha256Text hashes UTF-8, as Python's sha256_text does", () => {
  expect(sha256Text("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  // hashlib.sha256("[STUDENT_A] wrote 🙂 this.".encode()).hexdigest()
  expect(sha256Text("[STUDENT_A] wrote 🙂 this.")).toBe(
    "cbd897318e08530a87ca72c926eced67d879deb2a15ece68b0bfd981af267314",
  );
});

test("a lone surrogate can't be hashed, as in Python, rather than being replaced silently", () => {
  expect(isWellFormed("pair 🙂 ok")).toBe(true);
  expect(isWellFormed("bad \uD800 text")).toBe(false);
  expect(isWellFormed("bad \uDC00 text")).toBe(false);
  expect(() => sha256Text("bad \uD800 text")).toThrow("lone surrogate");
});

test("lengths count code points, as Python's len() does", () => {
  const text = "Zoë wrote 🙂 this.";
  expect(codePointLength(text)).toBe(17);
  expect(text.length).toBe(18); // UTF-16 units: why the core must not use .length for offsets
  expect(codePointLength("a\uD800b")).toBe(3); // a lone surrogate counts once, as in Python
});

test("instants are exact to the microsecond at any date", () => {
  expect(instant("2026-01-15T09:20:00.000001Z")! - instant("2026-01-15T09:20:00Z")!).toBe(1n);
  // Beyond 2^53 microseconds (after about 2255) a number would lose this.
  expect(instant("2500-01-01T00:00:00.000001Z")! - instant("2500-01-01T00:00:00Z")!).toBe(1n);
  expect(instant("9999-12-31T23:59:59.999999Z")! > instant("9999-12-31T23:59:59.999998Z")!).toBe(true);
  expect(instant("2026-01-15T10:20:00+01:00")).toBe(instant("2026-01-15T09:20:00Z"));
  expect(instant("2026-01-15T09:20:00")).toBeNull();
});

test.each([
  // Each expected value is what Pydantic writes for the same input.
  ["2026-01-15T09:10:00Z", "2026-01-15T09:10:00Z"],
  ["2026-01-15T09:10:00.000Z", "2026-01-15T09:10:00Z"],
  ["2026-01-15T09:10:00.120Z", "2026-01-15T09:10:00.120000Z"],
  ["2026-01-15T09:10:00.1234567Z", "2026-01-15T09:10:00.123456Z"],
  ["2026-01-15T09:10:00.123456789Z", "2026-01-15T09:10:00.123456Z"],
  ["2026-01-15T09:10:00+00:00", "2026-01-15T09:10:00Z"],
  ["2026-01-15T09:10:00-00:00", "2026-01-15T09:10:00Z"],
  ["2026-01-15T10:10:00+01:00", "2026-01-15T10:10:00+01:00"],
  ["2026-01-15T09:10:00.5+05:30", "2026-01-15T09:10:00.500000+05:30"],
])("timestamp %s is written as Python writes it", (input, output) => {
  expect(normaliseTimestamp(input)).toBe(output);
});
