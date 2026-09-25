# 0002: Python core with a TypeScript UI and one data contract

- **Status:** Accepted
- **Date:** 2026-09-25
- **Issue:** #13

## Context

Stage 0 needs:

- reliable extraction from docx and pdf;
- local anonymisation;
- a provider boundary;
- a review interface that enforces judge-first reveal and is fully usable
  from the keyboard and accessible.

The maintainer chose to use both languages, for these reasons:

- **Document extraction:** Python's libraries (pdfplumber, PyMuPDF,
  python-docx, docling) handle layout, tables, and structure more reliably.
  Extraction errors carry through every later step.
- **Anonymisation:** Python has mature tools for detecting personal data
  (Presidio, spaCy). This is the step where accuracy matters most for safety.
- **Local similarity:** sentence-transformers computes embeddings entirely on
  the moderator's machine. That supports grouping similar answers for
  consistency (#24) without sending anything beyond the model data boundary.
- **Evaluation:** measuring agreement between moderator, original marker, and
  AI readings for the stage gate is straightforward with pandas, scipy, and
  scikit-learn.
- **Interface:** TypeScript suits an accessible, keyboard-driven browser
  interface.

Calling local models (for example through Ollama's HTTP API) is possible from
any language, so it does not favour Python by itself.

## Decision

- **Core (Python):**
  - A local HTTP API bound to `127.0.0.1` covering extraction, anonymisation,
    workspace storage, the provider boundary, and exports.
  - Candidate libraries, confirmed in their own issues:
    - FastAPI and Pydantic for the API;
    - python-docx and pdfplumber for extraction (#15);
    - rule-based redaction, optionally with Presidio or spaCy (#16);
    - the Anthropic Python SDK for the first provider adapter (0003).
  - Dependencies and environments are managed with uv.
- **UI (TypeScript):**
  - A Vite-built browser app served locally that talks only to the core API.
  - The UI framework is chosen in #19. Nothing in the UI calls a model
    provider directly.
- **One data contract:**
  - Pydantic models in the core are the only source of truth for the
    structured representation (#14).
  - They are exported as JSON Schema, and TypeScript types are generated
    from that schema.
  - A check fails if the generated types are out of date, so the UI cannot
    drift from the core.
- **Security boundary:**
  - Only the core holds the API key and the pseudonym key.
  - The core never gives the UI the key, and gives it real identities only
    when the moderator explicitly asks to re-identify.

## Options considered

| Option | Why not chosen |
| --- | --- |
| TypeScript throughout | One language, but weaker libraries for extraction and anonymisation, which are the parts where accuracy matters most for safety. |
| Python throughout, with a server-rendered UI | One toolchain, and a credible fallback. A small single-user tool could use server-rendered pages with a little JavaScript. Not chosen because the judge-first review interface benefits from a richer client, but revisit if the TypeScript UI proves to be overhead during #19. |
| Desktop app (Electron or Tauri) | Packaging overhead not justified for one user. |

## Decision test

1. **Educator authority:** unaffected. Judge-first gating is enforced by the
   core and reflected in the UI.
2. **Explainable behaviour:** one data contract keeps records consistent
   end to end.
3. **Sensitive-data exposure:** keys and re-identification are confined to
   the core.
4. **Institutional control:** the provider stays behind the core's boundary
   (0003).
5. **Moderation and consistency:** unaffected.
6. **Accessible and sustainable:** the browser UI can meet WCAG 2.2 AA. The
   cost is two toolchains, which the generated contract offsets.

## Consequences

- Two toolchains: Python checks (tests, types, linting) and TypeScript checks.
- The contract generation step is part of #14 and runs as a check in CI.
- A single command should start both the core and the UI locally.
