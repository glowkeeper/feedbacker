/**
 * The anonymisation scenario for the browser check, shared by the page
 * (run in Chrome) and the runner (run in Node). Case mappings come partly
 * from the JavaScript engine's Unicode data, so Chrome must agree with Node,
 * which `npm run parity:anonymise` checks against Python.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { AnonymisationRules, apply, detect, PseudonymKey } from "../src/core/index.ts";
import { D, pyCasefold, pyIsAlpha, pyIsCased, pyIsUpper, pyLower, W } from "../src/core/pyre.ts";

const WORD = new RegExp(`^[${W}]$`, "u");
const DIGIT = new RegExp(`^[${D}]$`, "u");

/** One code point's lowercase, "is cased", casefold, and class membership, as text. */
function caseLine(c: number): string {
  const ch = String.fromCodePoint(c);
  const classes = (WORD.test(ch) ? 1 : 0) + (DIGIT.test(ch) ? 2 : 0) + (pyIsUpper(c) ? 4 : 0) + (pyIsAlpha(c) ? 8 : 0);
  return `${pyLower(c)},${pyIsCased(c) ? 1 : 0},${pyCasefold(ch)},${classes}`;
}

/** A digest per block of 4096 code points, so a difference can be found without sending every value. */
export function caseDigests(): string[] {
  const encoder = new TextEncoder();
  const digests: string[] = [];
  for (let block = 0; block < 0x110000; block += 0x1000) {
    const lines: string[] = [];
    for (let c = block; c < block + 0x1000; c++) if (c < 0xd800 || c > 0xdfff) lines.push(caseLine(c));
    digests.push(bytesToHex(sha256(encoder.encode(lines.join(";")))));
  }
  return digests;
}

/** The values for one block, to show where Chrome and Node differ. */
export function caseBlock(block: number): string[] {
  const lines: string[] = [];
  for (let c = block * 0x1000; c < (block + 1) * 0x1000; c++) if (c < 0xd800 || c > 0xdfff) lines.push(`U+${c.toString(16).toUpperCase()} ${caseLine(c)}`);
  return lines;
}

const TEXTS = [
  "Avery Quill wrote this. Quill, Avery agreed. QUILL signed. A quill pen.",
  "İlkay ŞAHIN and ılkay met Sam at Straße GmbH; mail zoë@exämple.co.uk, call +44 (0)20 7946 0123.",
  "🙂🙂 S0000101 and 100200301 at https://example.org/x. then WWW.Example.org, Jo-Jo and Jo Li.",
];

export function runRedactions(): unknown[] {
  return TEXTS.map((text) => {
    const key = PseudonymKey.parse({
      entries: [
        { submission_id: "sub-001", pseudonym: "[STUDENT_A]", external_id: "100200301", names: ["QUILL AVERY", "Jo Li"] },
        { submission_id: "sub-002", pseudonym: "[STUDENT_B]", external_id: "100200302", names: ["ılkay şahin"] },
      ],
    });
    const rules = AnonymisationRules.parse({ names: ["ſam"], organisations: ["STRASSE GMBH"] });
    const [out, redactions] = apply(text, detect(text, key, rules), key);
    return { out, redactions, tokens: key.tokens };
  });
}
