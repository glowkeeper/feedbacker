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
- `PRODUCT.md`: product direction: what is built, what is being built, and what must be shown before moving on.
- `docs/ARCHITECTURE.md`: initial architecture principles and decision tests.
- `docs/project-workflow.md`: issue, board, branch, and review practice.
- `docs/data-handling.md`: how Feedbacker handles real assessment material; read before touching extraction, anonymisation, providers, or storage.
- `docs/runbook.md`: how to run a real moderation with the app, step by step.
- `docs/moderation-evaluation.md`: the evaluation of moderation from real use.
- `docs/decisions/`: architecture decision records.
- `core/`: Python core (uv project): the reference implementation, whose tests specify the TypeScript port, plus the command line used while the port is in progress. `feedbacker_core.models` is the reference for the data contract and must agree with `contract/conformance.json`.
- `contract/`: `feedbacker.schema.json`, generated from the TypeScript models (do not edit by hand); `conformance.json`, the shared cases both implementations must agree on; and `conformance.expected.json`, the Python reference's outputs (generated).
- `ui/`: TypeScript package. `src/core/` is the browser core (no UI or DOM dependencies); its `models.ts` is the source of truth for the data contract (ADR 0004). `src/platform/` holds the browser-only adapters (the File System Access API, and IndexedDB for the folder handle).
- `proxy/`: the local Feedbacker proxy (ADR 0004): holds the API key, is the only egress point, keeps the egress log, and creates and registers workspaces. See `proxy/README.md`.
- `fixtures/synthetic/`: fictional test material only. Never add real material.
- `spikes/` (when present): time-boxed, self-contained experiments that record their results. Nothing else depends on them. When a spike's code moves into the product, the spike is removed and its results are kept in that pull request.
- `site/`: dependency-free holding page deployed to GitHub Pages.
- `.github/workflows/deploy.yml`: static GitHub Pages deployment.
- `legacy/v1-feedback-generator`: branch preserving the retired application.

Feedbacker's purpose is marking and feedback: it began years ago as a tool to help markers write meaningful, consistent feedback (`legacy/v1-feedback-generator`). This generation's first use case was moderation, because that was the maintainer's first real need for it; moderation is built (`docs/moderation-evaluation.md`), and the Python core remains the reference whose tests specify the TypeScript browser app. Marking and feedback is built too (`docs/marking-evaluation.md`). **Calibration is next**: where it sits is being decided. The runtime decisions are recorded in `docs/decisions/`:

- a local-first workspace that is a plain folder of files (0001, amended by 0004);
- a TypeScript core running in the browser, served by a local thin Feedbacker proxy that holds the API key and is the only egress point (0004, superseding 0002);
- one approval-gated provider interface (0003);
- model cost reduction: prompt caching, batches and exact-match reuse, never reuse across submissions (0005);
- what the AI may be sent when drafting feedback: the educator's own final marks and comments for that one submission, anonymised and approved; a reading that suggests levels is never sent anyone's marks (0006);
- sending a submission's figures to the AI: only those the educator has reviewed and chosen (0007);
- the browser app's workspaces made by name in one workspaces folder, and a home screen listing them; the proxy reads only their manifests (0008).

Feedbacker is a personal tool first with an institutional route kept open, and never a hosted service holding assessment data (`PRODUCT.md`). Build only what `PRODUCT.md` says is being built now; later directions are not committed scope. Do not infer a framework from the retired implementation. Record significant product and architecture decisions before introducing infrastructure.

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
- Maintain accessibility from the first interface onward: interfaces and generated documents meet WCAG 2.2 AA (see `docs/ARCHITECTURE.md`).
- Update documentation when architecture, data handling, governance, or educator responsibilities change.

## Board-driven work

The [project board](https://github.com/users/glowkeeper/projects/22) drives delivery; `docs/project-workflow.md` defines its statuses, fields, and issue structure.

When asked to select or continue project work:

1. inspect the board and repository state;
2. select autonomously only from Ready;
3. respect priority, dependencies, what is being built now, and existing work in progress;
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
