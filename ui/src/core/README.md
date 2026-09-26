# Feedbacker core (TypeScript)

This is the browser core from [ADR 0004](../../../docs/decisions/0004-typescript-browser-core-and-local-proxy.md). It has no UI or DOM dependencies and is being ported module by module from `core/` (the Python reference), under parent issue #43. Each module's Python tests are its specification.

## Data contract (#44)

- `models.ts` defines the contract as zod schemas. **It is the source of truth.**
- `npm run contract` generates `contract/feedbacker.schema.json` from those schemas.
- **Conformance with Python.** `contract/conformance.json` lists shared cases, each marked valid or invalid. Both implementations must agree on every case. For valid cases, this core's output must equal the Python reference's, which is recorded in `contract/conformance.expected.json` by `uv run python -m feedbacker_core.contract`. That is how records written by either side stay readable by the other.
- **Offsets count Unicode code points**, as Python does, not UTF-16 units. Use `codePointLength`, never `.length`, for anything stored as an offset.
- **Timestamps** are timezone-aware ISO 8601 strings, normalised to exactly the form Python writes:
  - seconds are always present;
  - the fraction has six digits (truncated) or is omitted if zero;
  - a zero offset is written `Z`.

  Ordering checks use `instant`, a bigint count of microseconds, which is exact at any date.
- **Text that can't be encoded as UTF-8** (a lone surrogate) can't be hashed. `sha256Text` throws, as Python's encoding does, and anonymised text containing it is rejected.
- **`serialiseRecord` validates before it serialises**, so nothing invalid is written. Its output parses to exactly what Python writes.

## Workspace (#46)

- **`workspace.ts`** ports `workspace.py`: the manifest, the pseudonym key (with `tokenFor` and `withEntries`), the same files and layout, and JSON written exactly as Python writes it.
- **`fs.ts`** is the folder as the core sees it: relative paths only, nothing outside the folder. `MemoryFileSystem` serves tests.
- **The browser side lives in `ui/src/platform/`**, outside the core, because it needs browser APIs:
  - `BrowserFileSystem` wraps a File System Access API folder handle;
  - `handleStore.ts` keeps that handle, and only that, in IndexedDB.
- **Creating and opening.** A browser can't see a folder's path or set permissions, so:
  - the local proxy creates or registers a workspace **by path** (`createWorkspace`, `registerWorkspace`);
  - the moderator then picks that folder;
  - `openWorkspace` opens it only if the proxy confirms its registration **and** the folder proves it is the registered one: it must read back, through the picked folder, a one-time value the proxy wrote into the registered folder. So a copy is refused, even while the original is still in place. It returns the registered path for the app to show every time.
  - `openPickedWorkspace` and `openRememberedWorkspace` (in `ui/src/platform/`) make sure the browser has granted read and write access before opening.
  - A relative path, an invalid name or an invalid retention setting is refused before the proxy is asked.
- **Permissions.** After a private write, the core asks the proxy to confirm again, which restores the permissions the browser couldn't set: 700 for folders, 600 for files.
- **Exports** go only into `exports/`, as `<name>.feedbacker-export.<ext>`. There is no "save elsewhere".
- **Deletion** is one action, and needs the workspace's name typed to confirm. It deletes the folder itself (Chromium's `FileSystemHandle.remove()`).
- **Checks:**
  - `npm run interop` checks, against the real Python core, that each side reads what the other writes;
  - `npm run check:browser` runs the workspace (and extraction, below) in Chrome under the proxy's Content Security Policy.

## Extraction, archives and inspection (#47)

- **`extract.ts`** ports `extract.py`:
  - docx and PDF text, with heading, paragraph and table-row blocks;
  - offsets counted in code points, and page numbers for PDFs;
  - the same warnings, image-page rules and failure messages. Document metadata is never read.
- **`pdf/`** is the #41 spike's character and line layer: pdf.js's operator list, rebuilt as pdfminer and pdfplumber would read it. `pdfDocument.ts` opens files and gives metadata keys (never values) and annotation types.
- **`docx.ts`** reads .docx following python-docx 1.2's rules: paragraph text from runs and hyperlinks, heading levels from style names, merged table cells, inline image counts, and headers and footers per section.
  - **Library decision:** the zip and XML are read directly, with **fflate** (inflate) and **saxes** (namespace-aware XML), rather than a docx-to-HTML converter such as mammoth. A converter's output would have to be parsed again, and it loses the table structure the reference keeps.
- **`zip.ts`** reads archives by byte range:
  - listing reads only the end of the file and the central directory;
  - a member is read and inflated only when asked for, and is checked against its CRC-32;
  - names are decoded as Python's zipfile decodes them (UTF-8 when flagged, otherwise code page 437);
  - zip64 is supported, and encrypted members are refused.

  A `ByteSource` is anything readable by range: a browser `File`, or bytes in memory.
- **`archive.ts`** ports `archive.py`: sampled identifiers matched as whole tokens across zips and single files. Problems are described by name shape only.
- **`structure.ts`** ports `structure.py`: structure-only inspection whose lines are formatted exactly as the command line prints them.
- **`pytext.ts`** gives Python's `strip()` and `split()`. Python's whitespace differs from JavaScript's `\s`: it includes `\x1c`–`\x1f` and `\x85`, but not `\ufeff`.
- **In the browser**, `ui/src/platform/pdfWorker.ts` loads pdf.js's worker from the app's own origin, and `fileSource.ts` reads a chosen `File` by byte range. `npm run check:browser` runs extraction, inspection and sample selection in Chrome under the proxy's Content Security Policy, and checks that every result matches the same run in Node.
- **`npm run parity:extraction`** runs `core/` and this core on the same files and compares their extracts, inspection lines and selections in full. The files are the synthetic pack, plus documents made by the Python tests' own helpers with python-docx and reportlab. All 34 checks match exactly (including a page-by-page comparison of rectangle counts on reportlab-drawn shapes), and a deliberate change to the rectangle count is caught.

## Request and originals (#48)

- **`request.ts`** ports `request.py`: the sample's identifiers are checked and trimmed, and so are the counts and staff roles; every problem is reported together. Each identifier gets a stable submission ID and pseudonym, which are never reassigned or reused. External identifiers go only into the pseudonym key, which is written before `request.json`. `loadRequest` checks that every sampled pseudonym resolves in the key.
- **`originals.ts`** ports `originals.py`: the sampled files are taken from bulk downloads (zips and single files), and nothing else is opened. Each file is stored under its submission ID in `sources/originals/`, with its record in `submissions/`. Real file names go only into the key, and only hashes of the downloads are kept (read in 8 MiB chunks by `hashSource`, so a large download is never held whole). Each submission is imported completely or not at all, and a failed replacement leaves the previous file and record intact. `loadSubmission` checks that the stored file still matches its record.
- **Bytes.** The workspace now reads and writes bytes (`readBytes`, `writeBytes`) as well as text. After a batch of private writes, `secure()` asks the proxy to tighten permissions once.
- **Checks:**
  - `npm run interop` also runs `scripts/interop-request.ts`. The same request and downloads are recorded and imported by both cores, with the same clock. Each side then loads the other's workspace, and the requests, keys, submission records, failures and stored files are compared and match exactly.
  - `npm run check:browser` records a request and imports originals through the File System Access API in Chrome.

### Intended differences from the Python models

| Difference | Why |
| --- | --- |
| Built-in validation messages come from zod, not Pydantic, e.g. `Unrecognized key: "final_mark"` rather than "Extra inputs are not permitted". | The rules are the same. Messages for Feedbacker's own rules are identical to Python's. |
| Stricter input: numeric strings are not coerced to numbers, nor `"true"` or `1` to booleans, and timestamps must include seconds. | Pydantic's lax mode accepts these, but neither implementation ever writes them. |
| Records are plain data, not frozen objects. | Treat them as immutable by convention. |
| Whole-number fields accept values only up to 2^53 − 1 (JavaScript's safe-integer limit); Python's are unbounded. | Beyond that limit, JSON numbers lose precision in JavaScript anyway. These fields (offsets, counts, token usage, page numbers) never approach it. |
| Cross-field checks may also run after a nested field has failed its own check. | Only the error list can differ, never whether a record is valid. |
| The two fixture checks on zip timestamps and modified times stay in Python. | They test the Python fixture generator, which stays in Python. |
| A workspace is created at a full path the moderator chooses, not a name under a root folder. The name rules still apply to the last part of the path. | The proxy creates workspaces by path (ADR 0004). |
| The app can delete a workspace in one action. | New. The Python core has no deletion yet; `docs/data-handling.md` asks for one. |
| `tokenFor` compares case-insensitively by upper-casing then lower-casing, which is close to Python's `casefold()` (for example, ß matches SS) but not identical for every script. | JavaScript has no `casefold()`. Revisit with anonymisation (#50) if needed. |
| Archive sources are files the moderator has already chosen, so Python's "source not found" test has no counterpart. | A browser `File` can't be missing. |
| A malformed vertical merge in a docx table (a merged cell with nothing above it) fails as a clear `ExtractionError`. | python-docx raises a bare `ValueError`, which escapes as a crash. |
| `nameShape` treats only decimal digits (`\p{Nd}`) as digits, so rare digit forms such as "²" become "?" rather than "9". | Both still mask them; JavaScript has no exact equivalent of Python's `isdigit()`. |
| A zero-width or zero-height `re` rectangle isn't counted in inspection's `rects`. | pdf.js encodes it as move, line, close rather than a four-sided path, so it can't be told apart from a line. It only affects that diagnostic count. |
| Inspection shows annotation types plainly (`{'Link': 2}`). | pdfminer shows them as `/'Link'`. None of the synthetic files has annotations. |
| The command-line tests for `request` and `import-originals` stay in Python; the counts behind their summaries are tested here. | The TypeScript core has no command line; the app shows results itself. |
| Import stages each submission's file in memory, not in a `sources/.staging` folder, and writes nothing until every submission has been processed. | It gives the same guarantee (nothing existing is touched by a failure) without a temporary folder in the workspace. |
| If writing fails partway through an import, the previous original and record of a replaced submission are kept. An older original in another format is removed only after its replacement and record are written, and a same-named original is restored if its record can't be written. Anything already written is still made private. | Python removes the old file first and can leave a mismatched pair, which `load_submission` detects. This core detects it the same way, but avoids it where it can. |
| An unreadable zip member is reported with this core's error name, e.g. "the selected file could not be read (ZipError)", where Python names its own (`BadZipFile`, `error`). | The error names are implementation details; the message is the same. |
| Timestamps taken from the clock have millisecond precision, not microsecond. | JavaScript's `Date` has no finer precision; the stored format is the same. |
| In an Incognito-style browser context, recalling the folder handle from IndexedDB can fail (it crashed Chrome 153 under automation). | Moderators use a normal profile; in Incognito, pick the folder each time. |
