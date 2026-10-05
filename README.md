# Feedbacker

Feedbacker is being rebuilt as a workflow, governance, and assessment layer around AI for higher education.

The project helps educators operationalise assessment responsibly, consistently, and at scale. It does not seek to automate academic judgement. Educators remain responsible for marks and for reviewing, editing, and approving feedback before release.

## New direction

Feedbacker's focus is shifting from generating feedback to providing dependable assessment infrastructure:

- rubric-led and repeatable workflows;
- consistency across markers, submissions, and cohorts;
- traceable assessment inputs, decisions, and outputs;
- moderation and calibration support;
- auditability and institutional quality assurance;
- explicit privacy, governance, and responsible-AI controls;
- institutional control over models, prompts, data, and deployment;
- efficient cohort-scale operation with educators firmly in control.

See [the project definition](docs/PROJECT.md), [the product direction](PRODUCT.md), and [architecture principles](docs/ARCHITECTURE.md) for the current foundation.

## Project status

The previous feedback-generation application has been retired from the active branch and preserved in `legacy/v1-feedback-generator`. The replacement is being built a piece at a time. Feedbacker's purpose is still marking and feedback; this generation's first use case was moderation, because that was the maintainer's first real need for it. Moderation, a local harness in which a moderator re-marks an anonymised sample against a rubric and compares their judgement with the original marker's and with an AI second reading, is built ([evaluation](docs/moderation-evaluation.md)). Marking and feedback is built too: one educator marks a whole cohort, with the AI's proposed levels if they want them, and Feedbacker drafts feedback from the educator's own marks, checks it against them, and exports what the educator approves to paste into Turnitin or Canvas. It too has been used for real ([evaluation](docs/marking-evaluation.md)).

Feedbacker is a TypeScript app that runs in the educator's browser and is served by a local Feedbacker proxy holding the API key ([ADR 0004](docs/decisions/0004-typescript-browser-core-and-local-proxy.md)). Feedbacker is a personal tool first, with an institutional route kept open, and never a hosted service holding assessment data.

- **The browser core is ported**: `ui/src/core/` does everything the Python command line does, including the moderation request, the imports, anonymisation and approval, and the AI reading, through the proxy. It reads and writes the same workspaces.
- **The app** runs a whole moderation, from setup through review to an approved, exported record, and a whole marking of a cohort, from importing the submissions to approved, exported feedback. It can be used entirely from the keyboard, and is checked against WCAG 2.2 AA. The Python command line (below) remains for the steps it covers.
- **The Python core (`core/`) is now the reference implementation.** Its tests specify the TypeScript core, and parity and interoperability checks keep the two in step.

The holding page for [feedbacker.education](https://feedbacker.education/) lives in `site/` and is deployed to GitHub Pages.

## Development

Requires [uv](https://docs.astral.sh/uv/) and Node.js 24.

```sh
# Python core: tests, lint, format
cd core
uv run pytest
uv run ruff check . && uv run ruff format --check .

# TypeScript core: tests, typecheck; the workspace, requests, imported
# originals, rubrics, anonymisation, the brief, marking and the AI reading
# checked against the Python core (both directions) and in Chrome under the
# proxy's CSP
cd ../ui
npm install
npm test && npm run typecheck
(cd tools/svelte-check && npm install) && npm run check:svelte   # the app's Svelte components (svelte-check needs TypeScript 6, kept apart)
npm run interop && npm run check:browser
npm run parity:extraction   # extraction, inspection and selection vs the Python core
npm run parity:rubric       # rubric import (CSV, JSON, xlsx and docx grids) vs the Python core
npm run parity:anonymise    # redaction, case rules and character classes vs the Python core
npm run parity:marking      # marked-view parsing (six cases, one printed by Chrome) vs the Python core
npm run pycase              # regenerate src/core/pycase.ts from Python (after a Python upgrade)

# Data contract (ADR 0004): the zod models in ui/src/core/models.ts own it.
# After changing them, regenerate the schema; after changing either the zod
# or the Python models, or contract/conformance.json, refresh the Python
# reference outputs. Commit what changes.
npm run contract
cd ../core && uv run python -m feedbacker_core.contract

# Check that both are current and agree
uv run python -m feedbacker_core.contract --check
cd ../ui && npm run contract:check

# The local proxy: tests, typecheck (see proxy/README.md to run it)
cd ../proxy
npm install
npm test && npm run typecheck
```

Tests use only the synthetic fixtures in `fixtures/synthetic/`. Never add real assessment material to the repository (see [data handling](docs/data-handling.md)).

## Running the proxy

In the browser app, the proxy is the only way anything leaves the machine, and the only holder of the API key. (The Python command line's `reading run` still calls the provider directly, reading the same key file, until the app replaces it.) Put the key in a private file once, then start it:

```sh
mkdir -p ~/Feedbacker && touch ~/Feedbacker/.env && chmod 600 ~/Feedbacker/.env
nano ~/Feedbacker/.env        # one line: ANTHROPIC_API_KEY=…  (not echo, so it stays out of shell history)

cd proxy
npm install
npm start                     # prints "API key: configured" and an address with a session token
```

**The app** is served by the proxy. Build it once (and after each update), then start the proxy and open the address it prints:

```sh
cd ui && npm run build        # into ui/dist, which the proxy serves
cd ../proxy && npm start
```

Its start page asks what you would like to do: start a **marking** or a **moderation** workspace, or carry on with one. A moderation workspace shows the moderation's overview, and sets up a moderation: the request, the originals, the rubric (a grid is previewed before it is saved) and the brief; then anonymisation, with a review of each text (real values only on request) and approval; the original marking (import, check and confirm, or enter by hand); and the AI reading (plan, confirm the estimate, send). Then the review: in open review, each sampled submission's approved text is shown with the brief, every marker's marks and comments, and the AI reading, and you record your own level for each criterion of the rubric, with an optional comment. You may instead review a submission blind: the original marking and the AI reading stay hidden (on the marking screen too) until you have judged every criterion and reveal them, and you may then revise, with both judgements kept. Once the marking is shown, a comparison sets your level beside each marker's mark and the AI suggestion, saying each difference in words and flagging a marker's level label that doesn't fit their score; and you record a verdict on the marking (agree, generous, harsh or inconsistent), with an optional suggested mark and comment. A comment may be started from the AI reading's draft, and is then recorded as derived from it. The overview shows agreement across the sample, by submission and by criterion. Finally, on the Export step, you approve the moderation record, with an overall comment, once everything is complete and current (it lists anything that isn't), and export it into the workspace's `exports/` folder: the structured record (JSON) with the full provenance, and a readable summary (Markdown and Word) with a section ready to copy into a moderation form. Everything exported is pseudonymous; a re-identified copy of the summary, with each student's Turnitin ID in place of their pseudonym and nothing else restored, is made only when you confirm it, each time.

A marking workspace holds one educator's marking of a whole cohort. You record the assessment's details, the rubric and the brief, then import every submission from the marking platform's bulk download (each student's ID is read from the file's name, and kept only in the private pseudonym key), and anonymise, review and approve them. Optionally, the AI proposes a level for each criterion, with its reasons, quoted evidence and a draft comment, and Feedbacker works out a provisional mark from those levels; the AI never gives a mark. On **Marking**, you choose for each submission whether to see the proposals while you mark or to mark blind, then record a level, a mark and a comment for each criterion and an overall mark. On **Feedback**, you can write a feedback guide for the assessment (what each level typically needs to hear), sent with every draft once you approve it; the AI drafts feedback from your own marks and comments (never another student's material), shown exactly as it will be sent before you confirm; and you adapt each draft, or write your own, and record it. Each piece of feedback is checked against its mark in Feedbacker (praise above the mark's band, no "Next time" step, another mark or level named, an anonymised value the student would see, text that ends mid-sentence), and flags can be accepted with a reason and never block approval; the cohort's feedback can be compared side by side by level, with outliers flagged. On **Export**, you read exactly what each student will receive and approve it; any later change clears the approval. Then copy each student's mark and feedback to paste into the platform, or export them all (each student's feedback, a marks table and the structured record), pseudonymous; a re-identified copy, with each student's platform ID, is made only when you confirm it, as in moderation.

`ui/scripts/manual-reading.ts` checks the AI reading against the real proxy and model, end to end, with synthetic material only (the app's own checks use a stand-in proxy). It prints the worst-case estimate, and sends nothing without `--confirm`; the run is capped at $1. With `--marking`, it asks for a marking workspace's proposals and prints the provisional marks; with `--feedback`, it marks two synthetic submissions high and low and drafts their feedback, to compare:

```sh
cd ui
node scripts/manual-reading.ts "http://127.0.0.1:8765/#token=…"             # the estimate
node scripts/manual-reading.ts "http://127.0.0.1:8765/#token=…" --confirm   # the reading
```

The permission safeguards (the key file and workspaces at 600 and 700) are POSIX, so they hold on macOS and Linux but not on Windows. See [`proxy/README.md`](proxy/README.md) for the proxy's options, API and security.

## Running a moderation

**To run a real moderation with the app, follow the [moderator runbook](docs/runbook.md)**, from the moderation request to returning the form and deleting the material afterwards.

The Python command line reads and writes the same workspaces as the browser core, and covers every step up to the review (it doesn't record judgements or verdicts):

```sh
cd core

# Create a moderation workspace (default: ~/Feedbacker/workspaces/<name>).
# It is refused inside any git repository.
uv run feedbacker workspace create <name> [--retention-days 90] [--retention-source "provider terms"]

# Record the moderation request: sampled IDs (optionally by the band they were
# listed under), cohort size, and band distribution.
uv run feedbacker request record ~/Feedbacker/workspaces/<name> \
  --sample "60-69:<id>,<id>" --sample "50-59:<id>" \
  --programme "<programme>" --module "<module>" --staff-role "module convener" \\
  --cohort-size 3 --single-group --band 60-69=2 --band 50-59=1

# Show the recorded request. It is pseudonymous: external IDs stay in the private key.
uv run feedbacker request show ~/Feedbacker/workspaces/<name>

# Look at an unfamiliar file or zip safely. This prints structure only: no text,
# no metadata values, and archive file names as shapes.
uv run feedbacker inspect <file.pdf|file.docx|archive.zip>

# Import the sampled students' original files. Give every source the sample is
# spread across: bulk zips (e.g. main and late submission points) and/or
# single files. Other students' files are never opened, and bulk downloads are
# not copied into the workspace.
uv run feedbacker originals import ~/Feedbacker/workspaces/<name> <main.zip> [<late.zip> <file.docx> ...]

# Import the assessment brief. It is redacted and approved like a submission
# (use "brief" as the ID); the AI reading only ever sees the approved brief.
uv run feedbacker brief import ~/Feedbacker/workspaces/<name> <brief.pdf|brief.docx>

# Anonymise every imported submission (and the brief). Students' names come from the private
# key (including Turnitin-style file names). Add other people, organisations,
# and values the rules miss; --ignore keeps a false positive.
uv run feedbacker anonymise run ~/Feedbacker/workspaces/<name> \
  --name "<other person>" --org "<employer>" --redact "<username>=USERNAME" --ignore "<value>"

# Review each submission (--with-values lists the real values: never share that output),
# then approve it. Only approved text can ever be sent to a model.
uv run feedbacker anonymise show ~/Feedbacker/workspaces/<name> sub-001 [--with-values]
uv run feedbacker anonymise approve ~/Feedbacker/workspaces/<name> sub-001 sub-002 brief

# AI second reading (suggestions, never marks). Needs an Anthropic API key in
# ANTHROPIC_API_KEY or ~/Feedbacker/.env (mode 600), the source rubric, and
# approved submissions (and brief). Without --confirm it only shows the estimate.
uv run feedbacker reading run ~/Feedbacker/workspaces/<name> [sub-001 ...] \
  [--model claude-sonnet-5] [--limit 5] [--no-fallback] [--no-brief] [--replace]
uv run feedbacker reading run ~/Feedbacker/workspaces/<name> --confirm
uv run feedbacker reading show ~/Feedbacker/workspaces/<name> sub-001

# Import the original marker's marking from the marked views (e.g. Turnitin
# "GradeMark files" bulk zips). Needs the source rubric first. Marker criterion
# names that do not match the source rubric are listed; map them once with
# --criterion (remembered for later imports).
uv run feedbacker marking import ~/Feedbacker/workspaces/<name> <grademark_1.zip> [<late.zip> ...] \
  [--criterion "ANALYTICAL=<source-criterion-id>" ...] [--replace]
uv run feedbacker marking show ~/Feedbacker/workspaces/<name> sub-001
uv run feedbacker marking confirm ~/Feedbacker/workspaces/<name> sub-001 sub-002
# Enter or correct marking by hand (the previous version is kept in marking/history/)
uv run feedbacker marking enter ~/Feedbacker/workspaces/<name> sub-001 --overall 62 \
  --criterion <source-criterion-id>=68 [--marker "second marker"]

# Import the rubric. CSV and JSON are written directly. Grid rubrics (xlsx, or a
# docx table with criteria down the side and "Label (points)" levels across the
# top) are previewed first, then written with --confirm. See
# core/src/feedbacker_core/rubric_import.py for the formats.
uv run feedbacker rubric import ~/Feedbacker/workspaces/<name> <rubric.xlsx> \
  --title "<title>" --weight <criterion-id>=25
uv run feedbacker rubric import ~/Feedbacker/workspaces/<name> <rubric.xlsx> --title "<title>" --confirm
```

## Marking a cohort

**To mark a cohort with the app, follow [section 18 of the runbook](docs/runbook.md#18-marking-a-cohort)**, from starting a marking workspace and importing the platform's bulk download to approving each student's feedback and pasting it into the platform.

The Python command line covers a marking workspace's setup: creating it, importing the cohort, anonymising and approving the submissions, and the AI's proposals. Marking, feedback and export are in the app only.

```sh
cd core
uv run feedbacker workspace create <name> --type marking
# Every submission in the platform's bulk download (zips and/or single files, named as the platform names them).
uv run feedbacker cohort import ~/Feedbacker/workspaces/<name> <download_1.zip> [<late.zip> ...] [--replace]
```

## Contributing

Read [AGENTS.md](AGENTS.md) before making changes. Product and technical proposals should preserve educator control, traceability, privacy, accessibility, and responsible assessment practice.

## Maintainer

[Steve Huckle](https://huckle.studio/)

## Licence

[CC0 1.0 Universal](LICENSE)
