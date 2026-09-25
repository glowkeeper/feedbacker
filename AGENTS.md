# Feedbacker Agent Guide

## Project definition

Feedbacker is a workflow, governance, and assessment layer around AI for higher education. It is not merely an AI feedback generator.

Its purpose is to help educators operationalise assessment responsibly, consistently, and at scale. AI assists academic judgement; it does not replace it. Educators remain responsible for marks and for reviewing, editing, and approving feedback before it reaches students.

Product decisions should strengthen:

- rubric-led, repeatable assessment workflows;
- consistency across markers, submissions, and cohorts;
- clear separation between AI assistance and human academic judgement;
- traceable inputs, criteria, marks, prompts, models, and outputs;
- moderation and calibration;
- auditability and institutional quality assurance;
- explicit governance, privacy, and responsible-AI practice;
- institutional control over models, prompts, data handling, and deployment;
- efficient cohort-scale operation without dehumanising feedback.

Do not optimise for autonomous grading or imply that generated feedback is authoritative. Preserve educator control and make consequential AI behaviour visible and reviewable.

## Current repository shape

- `docs/PROJECT.md`: canonical product definition and boundaries.
- `PRODUCT.md`: staged product direction, current stage, and stage gates.
- `docs/ARCHITECTURE.md`: initial architecture principles and decision tests.
- `docs/project-workflow.md`: issue, board, branch, and review practice.
- `docs/data-handling.md`: how Stage 0 handles real assessment material; read before touching extraction, anonymisation, providers, or storage.
- `docs/decisions/`: architecture decision records.
- `core/`: Python core (uv project). `feedbacker_core.models` is the single source of truth for the data contract.
- `contract/`: JSON Schema generated from the core models. Do not edit by hand.
- `ui/`: TypeScript UI package; currently only `src/contract.ts`, generated from the schema.
- `fixtures/synthetic/`: fictional test material only. Never add real material.
- `site/`: dependency-free holding page deployed to GitHub Pages.
- `.github/workflows/deploy.yml`: static GitHub Pages deployment.
- `legacy/v1-feedback-generator`: branch preserving the retired application.

The Stage 0 application is being built issue by issue; the core data contract exists and the UI has not yet been built. Stage 0 runtime decisions are recorded in `docs/decisions/` (local-first file workspace; Python core with a TypeScript UI sharing one generated data contract; one approval-gated provider interface). Build only for the current stage in `PRODUCT.md`; later stages are direction, not committed scope. Do not infer a framework from the retired implementation. Record significant product and architecture decisions before introducing infrastructure.

## Engineering expectations

- Make the smallest coherent change that solves the stated problem.
- Add only architecture justified by a current requirement or documented decision.
- Add or update tests for changed behaviour once executable code exists.
- Treat rubric data, student submissions, marks, moderation records, and generated feedback as sensitive educational data.
- Never commit secrets, API keys, student-identifying data, real submissions, or artifacts containing personal data.
- Keep provider-specific behaviour behind clear boundaries; institutional model choice and deployment control are product requirements.
- Prefer deterministic extraction and structured intermediate representations over repeatedly sending opaque documents to models. The intended direction is `source document -> deterministic extraction -> structured academic representation -> AI`.
- Preserve provenance when transforming rubrics, submissions, marks, or feedback. Avoid silent inference or lossy conversion.
- Fail clearly and safely. Do not fabricate assessment evidence, criteria, marks, citations, or successful processing.
- Make educator review and approval explicit for consequential outputs.
- Maintain accessibility from the first interface onward.
- Update documentation when architecture, data handling, governance, or educator responsibilities change.

## Board-driven work

The [project board](https://github.com/users/glowkeeper/projects/22) drives delivery; `docs/project-workflow.md` defines its statuses, fields, and issue structure.

When asked to select or continue project work:

1. inspect the board and repository state;
2. select autonomously only from Ready;
3. respect priority, dependencies, stages, and existing work in progress;
4. state which issue is being selected and why;
5. keep the issue and board status accurate throughout delivery;
6. work against the issue's acceptance criteria;
7. report what completion unblocks.

Keep work in progress to one issue by default. Do not move consequential work from Backlog to Ready without an explicit maintainer decision. After implementing and verifying a change, present it to the maintainer; do not commit, push, or open a pull request until the maintainer explicitly approves.

## Working safely

- Check `git status` before editing and preserve unrelated user changes.
- Do not modify or remove the legacy branch as part of active development.
- Avoid destructive Git operations unless explicitly requested.
- Do not change governance, privacy, retention, or assessment semantics as incidental refactoring.
- Flag decisions that could affect academic judgement, student data, audit trails, provider routing, or institutional compliance.

## Definition of done

A change is complete when the requested behaviour works, relevant checks pass, documentation is accurate, and educator control, provenance, privacy, accessibility, and auditability have not regressed. Report checks that were run and any checks that could not be run.
