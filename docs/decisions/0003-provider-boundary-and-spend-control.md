# 0003: Provider boundary, prompt versioning, and spend control

- **Status:** Accepted
- **Date:** 2026-09-25
- **Issue:** #13

## Context

Institutions need control over which providers see their data (see
`docs/PROJECT.md`). The model data boundary in `PRODUCT.md` must be enforced
in code, not only by convention. Stage 0 runs on the moderator's own API key,
so spend must be bounded.

## Decision

- **One provider interface in the core.**
  - Every model call goes through it. Adapters implement it, and nothing
    outside an adapter knows provider specifics.
  - Before any call, the interface checks the input:
    - the text's hash must match a moderator approval record;
    - only fields the model data boundary permits may be included.
  - Anything else is refused and the refusal is recorded.
- **First adapter: the Anthropic API.**
  - Chosen because API inputs are excluded from training by default, and
    because it offers prompt caching and a discounted batch API, which #25
    uses.
  - The model is configurable, and each call records the model identifier
    actually used.
  - The provider's current terms are reviewed before first real use (see
    `docs/data-handling.md`).
- **Prompt versioning.**
  - Prompts are versioned files in the repository and contain no real
    material.
  - Each call records the prompt version and a hash of the rendered prompt
    template.
  - Changing a prompt means a new version, never an in-place edit.
- **Call record.** Each call records:
  - provider and model;
  - prompt version;
  - input hash;
  - token usage (input, output, and cached);
  - timestamp;
  - how the result was produced: live, batch, or cache (#25);
  - errors.
- **Spend control.**
  - The API key is read only from an environment variable or a gitignored
    `.env` file. It is never logged, exported, or recorded.
  - Before a batch run, the core estimates tokens and cost and the moderator
    must confirm.
  - A configurable limit per run halts processing when reached.
  - A monthly spending limit is set in the provider's console as a backstop.
- **No authentication in Stage 0.** The app is local only with no hosted
  endpoint (0001). Hosted use requires #23 first.

## Options considered

| Option | Why not chosen |
| --- | --- |
| OpenRouter | One key for many models, but it adds an intermediary, and retention and training terms vary by model. |
| Local model (Ollama) | Nothing leaves the machine, but evidence-cited readings of long reports would be noticeably weaker. Remains a candidate second adapter. |
| Calling providers from the UI | Would expose the API key and bypass the approval check. Rejected. |

## Decision test

1. **Educator authority:** the model is reached only through an
   approval-gated interface, and outputs are suggestions.
2. **Explainable behaviour:** every call is recorded with prompt version,
   model, and input hash.
3. **Sensitive-data exposure:** the boundary is enforced in code, and the
   provider does not train on inputs.
4. **Institutional control:** the provider is replaceable behind one
   interface.
5. **Moderation and consistency:** versioned prompts make readings comparable
   across a sample.
6. **Accessible and sustainable:** spend is bounded, and cost is visible
   before each run.

## Consequences

- #18 implements the interface and the Anthropic adapter. #25 adds caching,
  batching, and exact-match reuse behind the same interface.
- Tests must prove that unapproved or altered text is refused before any
  network call.
- Adding a provider means a new adapter plus a data-handling review of that
  provider's terms.
