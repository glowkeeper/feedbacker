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

The holding page for [feedbacker.education](https://feedbacker.education/) lives in `site/` and is deployed to GitHub Pages.

## Development

Requires [uv](https://docs.astral.sh/uv/) and Node.js 24.

```sh
# Python core: tests, lint, format
cd core
uv run pytest
uv run ruff check . && uv run ruff format --check .

# Data contract: after changing core/src/feedbacker_core/models.py,
# regenerate the schema and the TypeScript types, then commit both
uv run python -m feedbacker_core.contract
cd ../ui && npm install && npm run contract

# Check that the generated contract is current
cd ../core && uv run python -m feedbacker_core.contract --check
cd ../ui && npm run contract:check && npm run typecheck
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
```

## Contributing

Read [AGENTS.md](AGENTS.md) before making changes. Product and technical proposals should preserve educator control, traceability, privacy, accessibility, and responsible assessment practice.

## Maintainer

[Steve Huckle](https://huckle.studio/)

## Licence

[CC0 1.0 Universal](LICENSE)
