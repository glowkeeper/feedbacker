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

See [the project definition](docs/PROJECT.md), [the staged product direction](PRODUCT.md), and [architecture principles](docs/ARCHITECTURE.md) for the current foundation.

## Project status

The previous feedback-generation application has been retired from the active branch and preserved in `legacy/v1-feedback-generator`. The replacement is being built in stages, starting with Stage 0: a local moderation harness in which a moderator re-marks an anonymised sample against a rubric before comparing their judgement with the original marker's and with an AI second reading.

Stage 0 currently runs as a Python command line. It is being ported to a TypeScript app that runs in the moderator's browser and is served by a local Feedbacker proxy holding the API key ([ADR 0004](docs/decisions/0004-typescript-browser-core-and-local-proxy.md)). Feedbacker is a personal tool first, with an institutional route kept open, and never a hosted service holding assessment data.

The holding page for [feedbacker.education](https://feedbacker.education/) lives in `site/` and is deployed to GitHub Pages.

## Development

Requires [uv](https://docs.astral.sh/uv/) and Node.js 24.

```sh
# Python core: tests, lint, format
cd core
uv run pytest
uv run ruff check . && uv run ruff format --check .

# TypeScript core: tests, typecheck; the workspace checked against the
# Python core (both directions) and in Chrome under the proxy's CSP
cd ../ui
npm install
npm test && npm run typecheck
npm run interop && npm run check:browser
npm run parity:extraction   # extraction, inspection and selection vs the Python core

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

## Using Stage 0

Stage 0 is being built issue by issue. What works so far:

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

## Contributing

Read [AGENTS.md](AGENTS.md) before making changes. Product and technical proposals should preserve educator control, traceability, privacy, accessibility, and responsible assessment practice.

## Maintainer

[Steve Huckle](https://huckle.studio/)

## Licence

[CC0 1.0 Universal](LICENSE)
