/** Messages (#126): each carries its own kind, so none can take an earlier message's. */

import { expect, test } from "vitest";
import { asDone, asFailed, asInfo, done, failed, info } from "../src/app/messages.ts";

test("each message says what kind of outcome it reports", () => {
  expect(done("Saved.")).toEqual({ text: "Saved.", kind: "done" });
  expect(info("Nothing was sent.")).toEqual({ text: "Nothing was sent.", kind: "info" });
  expect(failed("It broke.")).toEqual({ text: "It broke.", kind: "error" });
});

test("a region of one kind has no message while there is no text", () => {
  expect(asDone(null)).toBeNull();
  expect(asInfo(null)).toBeNull();
  expect(asFailed(null)).toBeNull();
  expect(asDone("Recorded.")).toEqual({ text: "Recorded.", kind: "done" });
  expect(asInfo("Sending 1 of 2…")).toEqual({ text: "Sending 1 of 2…", kind: "info" });
  expect(asFailed("No request.")).toEqual({ text: "No request.", kind: "error" });
});
