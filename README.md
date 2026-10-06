# Feedbacker

Feedbacker helps educators in higher education use AI to help them mark and moderate coursework against a rubric and brief.

- **Marking and feedback:** mark a whole cohort against the rubric, with the AI's proposed levels if you want them, and write feedback that matches your marks: the AI drafts it from your own marks and comments, Feedbacker checks it against them, and you approve exactly what each student receives.
- **Moderation:** re-mark a sample of already-marked work, compare your judgement with the original marker's and with an AI second reading, and record your verdicts in a moderation record.

**What it never does:** set a mark, release anything you haven't approved, or hold assessment material on a hosted service. It runs on your computer, and sends the AI only what you have approved, when you confirm it: Feedbacker's instructions, the rubric, and the submission's anonymised text and the figures you have reviewed; and, when the AI drafts or suggests an edit to feedback, your own anonymised marks, comments, feedback guide or feedback for that one student. Never the names, IDs or original files. See [how data is handled](docs/data-handling.md#what-may-leave-the-machine).

**Who it is for:** lecturers, tutors and module leaders who mark and moderate; and the learning technologists and data protection officers who decide whether they may.

## Where it stands

Both workflows are built and have been used for real, on the maintainer's own marking and moderation: see the evaluations of [moderation](docs/moderation-evaluation.md) and of [marking and feedback](docs/marking-evaluation.md).

Not yet: an installer (setting it up takes some technical steps, below); team marking and calibration across markers; AI providers other than Anthropic's; marking platforms other than Turnitin and Canvas.

**Known limits:** Chrome or Edge only; one AI provider (Anthropic's Claude, with your own API key); bulk downloads from Turnitin and Canvas; typed `.docx` and `.pdf` work (no OCR); one educator per workspace; marks read against the UK higher-education scale. See [responsible use and known limits](docs/responsible-use.md).

## Before you use it

- [Responsible use and known limits](docs/responsible-use.md): who is responsible for what, and what Feedbacker is not for.
- [For institutions](docs/institutions.md): data protection, the AI provider and governance, in plain language.
- [Accessibility statement](docs/accessibility.md): how Feedbacker is checked against WCAG 2.2 AA, and its known limits.
- [Security policy](SECURITY.md): how to report a vulnerability privately.
- [How data is handled](docs/data-handling.md), in full.

## Getting started

You need Chrome or Edge, [Node.js](https://nodejs.org/) 24, an [Anthropic API key](https://console.anthropic.com/), and a terminal.

```sh
# Get the code, and put your API key in a private file (one line: ANTHROPIC_API_KEY=…)
git clone https://github.com/glowkeeper/feedbacker.git
mkdir -p ~/Feedbacker && touch ~/Feedbacker/.env && chmod 600 ~/Feedbacker/.env
nano ~/Feedbacker/.env        # not echo, so the key stays out of your shell history

# Build the app, then start the local Feedbacker proxy, which serves it
cd feedbacker/ui && npm install && npm run build
cd ../proxy && npm install && npm start
```

The proxy prints "API key: configured" and an address with a session token: open that exact address in Chrome or Edge. Then follow the runbook: [marking a cohort](docs/runbook.md#18-marking-a-cohort), or [a moderation](docs/runbook.md), step by step. Try it first with the synthetic files in [`fixtures/synthetic/`](fixtures/synthetic/).

On macOS and Linux, the proxy refuses to use a key file that others can read (you set its permissions, with `chmod 600` above), and it keeps your workspaces readable only by you. Neither applies on Windows: there, keep the key file and your workspaces somewhere only you can read.

## How it works

Feedbacker is a TypeScript app that runs in your browser, served by a small local program, the Feedbacker proxy, which holds the API key and is the only way anything leaves your computer ([ADR 0004](docs/decisions/0004-typescript-browser-core-and-local-proxy.md)). Your work lives in a workspace: a folder on your computer. A Python core is kept as the reference implementation: its tests specify the app, and parity checks keep the two in step. It is a personal tool first, with an institutional route kept open, and never a hosted service holding assessment data.

- [Project definition](docs/PROJECT.md): what Feedbacker is, and must never do.
- [Product direction](PRODUCT.md): what is built, and what may come next.
- [Architecture principles](docs/ARCHITECTURE.md) and [decision records](docs/decisions/).
- [`proxy/README.md`](proxy/README.md): the proxy's options, API and security.

The website, [feedbacker.education](https://feedbacker.education/), is in `site/` and is deployed to GitHub Pages. The previous feedback-generation application is preserved on the `legacy/v1-feedback-generator` branch.

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
npm run check:site          # the website (site/), against the same WCAG 2.2 AA checks as the app
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

Every pull request, and every push to `main`, runs all of these automatically (`.github/workflows/checks.yml`): the Python core, the proxy, and the app with interop and parity, the browser check and both accessibility audits. Nothing in CI contacts the AI. Tests use only the synthetic fixtures in `fixtures/synthetic/`. Never add real assessment material to the repository (see [data handling](docs/data-handling.md)).

### Checks against the real AI

`ui/scripts/manual-reading.ts` checks the AI reading against the real proxy and AI, end to end, with synthetic material only (the app's own checks use a stand-in proxy). It prints the worst-case estimate, and sends nothing without `--confirm`; the run is capped at $1. With `--marking`, it asks for a marking workspace's proposals and prints the provisional marks; with `--feedback`, it marks two synthetic submissions high and low and drafts their feedback, to compare; with `--suggest`, it records two pieces of feedback that the checks flag and asks the AI to suggest an edit to each; with `--figures`, it sends a synthetic report's approved charts with the proposals:

```sh
cd ui
node scripts/manual-reading.ts "http://127.0.0.1:8765/#token=…"             # the estimate
node scripts/manual-reading.ts "http://127.0.0.1:8765/#token=…" --confirm   # the reading
```

## The Python command line

### A moderation

The Python command line reads and writes the same workspaces as the browser core, and covers every step up to the review (it doesn't record judgements or verdicts). Its `reading run` calls the AI provider directly, with the same key file, rather than through the proxy.

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

### Marking a cohort

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
