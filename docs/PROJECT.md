# Project definition

## Purpose

Feedbacker helps higher-education teams operationalise assessment responsibly, consistently, and at scale. It provides a bounded workflow around AI-assisted assessment while keeping academic judgement with educators.

The project is assessment infrastructure, not an autonomous assessor and not simply a feedback-writing interface.

## Product promise

Feedbacker should make an institution's assessment process easier to apply, review, moderate, explain, and improve without obscuring where human judgement ends and AI assistance begins.

## Core capabilities

The emerging product should support:

1. Structured, rubric-led assessment workflows.
2. Transparent capture of criteria, evidence, marks, observations, and feedback.
3. Educator review, editing, and explicit approval of AI-assisted outputs.
4. Consistency checks, marker calibration, and moderation across a cohort.
5. Reproducible records of relevant inputs, transformations, models, prompts, and outputs.
6. Institution-controlled policies for providers, models, data handling, retention, and deployment.
7. Batch operation without removing the educator from consequential decisions.

## Product boundaries

Feedbacker must not:

- assign or release grades autonomously;
- present generated text as verified academic judgement;
- conceal material model involvement or transformations;
- require unnecessary student-identifying information;
- trade traceability, privacy, or accessibility for convenience;
- make unsupported claims of legal, regulatory, or institutional compliance.

## Primary users

- Lecturers, tutors, and assessment teams.
- Module and programme leaders responsible for consistency and moderation.
- Learning technologists and institutional teams governing responsible AI use.

Students are affected stakeholders even where they are not direct users. Their privacy, procedural fairness, and ability to receive useful human-owned feedback remain central.

## Where the project is now

Feedbacker began years ago as a tool to help markers write meaningful, consistent feedback; marking and feedback remain its purpose. This generation's first use case was moderation, because that was the maintainer's first real need for it. Moderation, a local, single-user harness, is built, and its evaluation is in [`moderation-evaluation.md`](moderation-evaluation.md). Marking and feedback is built too, as defined in [`PRODUCT.md`](../PRODUCT.md), and its evaluation is in [`marking-evaluation.md`](marking-evaluation.md): one educator marks a cohort, Feedbacker proposes levels and drafts feedback from the educator's own marks, and the educator approves everything before it is released. Later directions in `PRODUCT.md` are not commitments. The previous implementation is retained only on the `legacy/v1-feedback-generator` branch and must not constrain the replacement architecture.
