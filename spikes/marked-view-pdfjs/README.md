# Spike: the marked-view parser in TypeScript with pdf.js (#41)

This spike tests the riskiest part of moving Feedbacker's core to a TypeScript browser client (#40). It ports **only** the marked-view parser (`core/src/feedbacker_core/marked_view.py`, #17) to TypeScript with pdf.js, and checks it against the Python parser, which stays the reference and is not changed.

It is self-contained: nothing in `core/` or `ui/` depends on it. If #40 goes ahead, the port issues will move this code into the TypeScript core.

## Result

**Go.** On every synthetic case, the TypeScript parser produces exactly the same result as the Python parser, in Node and in Chrome. That includes selecting the rubric level by relative colour, the step that seemed hardest. No Pyodide fallback is needed for this component.

| Check | Result |
| --- | --- |
| Parity with Python, 5 cases (`npm run parity`) | All pass. The parsed results are identical. Every page's image/text classification, character count, text lines and line colours are identical too (102–103 lines per marked view), with one explained difference (below). |
| The replica's key facts (`npm test`) | ID, word count, grade `60 /100`, general comment, comments 1–3 with tags, pages and positions `0.301, 0.621, 0.451`, rubric total `59.75`, and four criteria with IMPLEMENTATION's selected `2:2 (55)` against its awarded `58`. No warnings. |
| Failing safely | Unreadable input raises `MarkedViewError`; a missing section, marker or distinguishable level becomes the same warning as in Python. A level that is only slightly darker is warned about, not guessed. |
| Real browser (`npm run browser`) | Chrome 153 matches Python on the replica and the Chrome-printed case. It runs under a strict Content Security Policy (`script-src 'self'`, `connect-src 'self'`, no `unsafe-eval` or `unsafe-inline`), with no console errors or policy violations. pdf.js 6 contains no `eval`. |
| Bundle size (`npm run measure`) | App and pdf.js: 431 KB raw, 129 KB gzip, 107 KB brotli. The pdf.js worker: 1,236 KB raw, 367 KB gzip, 300 KB brotli. **About 0.4 MB compressed in total**, against 10–30 MB for Pyodide. |
| Parse time, replica (7 pages) | Chrome: about 65 ms for the first parse, 55–65 ms after that. Node: 54 ms first, 12 ms median. Python (pdfplumber): 65 ms first, 36 ms median. |

Times are from one run on the maintainer's Mac. They're indicative, not benchmarks.

### Parity cases

1. **`replica`**: the committed `fixtures/synthetic/pack-01/marked-view-replica.pdf` (drawn with reportlab).
2. **`text-only`**: a plain text PDF, which produces the four "cannot find" warnings.
3. **`no-selected-level`**: the replica with every level printed in the same grey, so each criterion warns instead of guessing.
4. **`not-a-pdf`**: both parsers fail clearly. Only the library's exception name differs.
5. **`chrome-printed`**: the same layout written as HTML and printed to PDF by Chrome (`scripts/make_browser_case.ts`). Browser-printed PDFs use scaled transforms, positioned glyph runs and embedded subset fonts. That's closer to how real current views are likely produced, and much harder than reportlab's output. It matches exactly.

All cases are fictional. No real material was used.

### The explained difference

pdfminer can't map the replica's bullet glyph to Unicode and writes `(cid:127)`; pdf.js decodes it as `•`. The parser never reads those description lines, so the results are unaffected. It's a difference in pdf.js's favour. The parity check accepts only this pattern and reports each occurrence.

## How it works

pdf.js's text layer (`getTextContent`) gives positions but no colour, and it merges and inserts spaces by its own rules. So the port walks pdf.js's **operator list** instead (`src/page.ts`):
- it tracks the graphics state (current transformation, fill colour) and the text state (font, size, spacing, scaling, rise, text and line matrices);
- it places every glyph using its advance width;
- it records image placements.

That reproduces pdfminer's character boxes. Font descents come from pdf.js's text-layer styles, which match pdfminer's.

`src/text.ts` then reproduces pdfplumber's default word and line grouping (tolerances of 3, chained clustering). `src/markedView.ts` is a line-by-line port of the Python interpretation, with the same regular expressions, thresholds and warnings. The output keeps the Python field names so the two can be compared directly.

## Differences to carry into the port

These don't affect any current case, but the port issues should keep them in view:

- **Colours are 8-bit.** pdf.js reports fill colours as `#rrggbb`. Relative darkness is unaffected, given the 0.1 threshold. Two levels whose colours differ by less than 1/255 would tie, which gives a warning, never a wrong selection.
- **CMYK colours are converted to RGB by pdf.js.** The Python `_darkness` reads the first three CMYK components as RGB and ignores black (K). So a CMYK marked view would probably produce "could not be identified" warnings in Python and correct selections in TypeScript. This is untested; when porting, add a CMYK case and decide which behaviour is intended.
- **Digits are ASCII only.** Python's `\d` and `isdigit` also accept other Unicode digits. That doesn't matter for Turnitin's output.
- **Upright, left-to-right text only**, which is all the layout uses. Rotated pages are not handled.
- **pdf.js decodes image data while building the operator list**, even though only the image's placement is needed. The cost is included in the times above.
- **Node uses pdf.js's legacy build and browsers the modern build.** The `#pdfjs` import in `package.json` selects the right one. Both are tested.

## Running it

Run everything from this directory. Node 24 runs the TypeScript directly.

```sh
npm install
npm test             # unit tests (Node; no Python needed)
npm run typecheck
npm run parity       # Python vs TypeScript on the 5 cases (needs uv and the core env, and Chrome for case 5)
npm run browser      # builds the bundle, serves it with a strict CSP, runs it in headless Chrome
npm run measure      # bundle sizes and parse times
npm run parse -- <file.pdf>   # print a parse as JSON
npx vite browser     # try it by hand: pick a synthetic PDF in the page
```

The browser scripts use playwright-core with a locally installed Chrome or Chromium; set `CHROME_PATH` if it isn't found. Use synthetic files only.
