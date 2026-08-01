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
- `docs/ARCHITECTURE.md`: initial architecture principles and decision tests.
- `site/`: dependency-free holding page deployed to GitHub Pages.
- `.github/workflows/deploy.yml`: static GitHub Pages deployment.
- `legacy/v1-feedback-generator`: branch preserving the retired application.

The replacement application has not yet been selected or scaffolded. Do not infer a framework from the retired implementation. Record significant product and architecture decisions before introducing infrastructure.

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

## Working safely

- Check `git status` before editing and preserve unrelated user changes.
- Do not modify or remove the legacy branch as part of active development.
- Avoid destructive Git operations unless explicitly requested.
- Do not change governance, privacy, retention, or assessment semantics as incidental refactoring.
- Flag decisions that could affect academic judgement, student data, audit trails, provider routing, or institutional compliance.

## Definition of done

A change is complete when the requested behaviour works, relevant checks pass, documentation is accurate, and educator control, provenance, privacy, accessibility, and auditability have not regressed. Report checks that were run and any checks that could not be run.
