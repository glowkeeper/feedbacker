# Architecture principles

This document establishes constraints for the replacement system. It is intentionally technology-neutral until requirements justify concrete platform choices.

## 1. Human authority is explicit

Marks and released feedback require an identifiable educator decision. The system should distinguish source material, deterministic transformations, model suggestions, educator edits, and approved outputs.

## 2. Provenance is a first-class concern

Important assessment artifacts should carry enough provenance to explain how an output was produced. Relevant records may include rubric versions, extracted evidence, transformations, prompts, model/provider identifiers, timestamps, edits, and approvals.

## 3. Normalise before inference

Prefer this processing shape:

```text
source document -> deterministic extraction -> structured academic representation -> AI assistance -> educator review
```

Do not repeatedly send opaque source documents when stable, inspectable representations can be produced. Extraction failures and uncertainty must remain visible.

## 4. Providers are replaceable

Model and storage providers should sit behind explicit boundaries. Institutions must be able to understand and control where data goes, which models are allowed, and what is retained.

## 5. Privacy is minimised by design

Collect the least data necessary. Separate identity from assessment content where practical. Define retention, deletion, access, and export behaviour before storing live student work.

## 6. Auditability does not mean indiscriminate retention

Keep records because they support a defined assessment or governance purpose, not because they might someday be useful. Audit trails and deletion obligations must be designed together.

## 7. Cohort scale preserves individual review

Batch processing may reduce repetitive work, but it must not turn suggestion into silent decision. Interfaces should surface exceptions, uncertainty, missing evidence, and changes requiring educator attention.

## 8. Accessibility is architectural

Core workflows must be keyboard-operable, screen-reader comprehensible, and usable without relying on colour alone. Generated documents and exports should also be accessible.

## 9. Assessment data stays with the educator or institution

Feedbacker is never a hosted service that holds assessment data. Sensitive processing runs where the data lives: on the educator's machine or on the institution's own infrastructure. Only approved anonymised text crosses to a model provider, and only through a proxy the educator or institution controls. See [ADR 0004](decisions/0004-typescript-browser-core-and-local-proxy.md).

## Decision test

Before adopting a major component or workflow, ask:

1. Does it preserve educator authority?
2. Can its consequential behaviour be explained and reviewed?
3. Does it reduce or responsibly control sensitive-data exposure?
4. Can an institution govern or replace it?
5. Does it support moderation and cohort-scale consistency?
6. Is it accessible and operationally sustainable?

Significant decisions are captured as architecture decision records under [`docs/decisions/`](decisions/README.md). Stage 0 data handling is defined in [`docs/data-handling.md`](data-handling.md).
