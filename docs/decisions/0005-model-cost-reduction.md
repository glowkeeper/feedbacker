# 0005: Reducing model cost: prompt caching, batching, and exact-match reuse

- **Status:** Accepted
- **Date:** 2026-09-28

## Context

Every AI reading sends the same instructions, source rubric and brief, then one submission. Readings are prepared in advance of the review, so they needn't come back at once, and a moderator may plan a reading again when nothing has changed. The cost in moderation is small (cents a submission), but it grows with the sample, the rubric and the brief, and marking covers whole cohorts.

An earlier analysis listed five ways to reduce it, from safest to riskiest:

1. provider prompt caching of the shared prefix;
2. the provider's discounted batch API;
3. reuse of a stored reading when everything sent is identical;
4. local similarity, to help the educator check consistency, with nothing reused;
5. reusing results across similar submissions.

The maintainer adopted options 1–3 for moderation, and so for every reading.

## Decision

**Prompt caching**. The prefix every reading shares (the instructions, the rubric and the approved brief) comes first, and the proxy marks its end as a cache breakpoint. The provider may then keep that prefix for five minutes and bill later readings' use of it at a fraction of the input price. Nothing more is sent. The submission comes after the breakpoint, and each call records the tokens written to and read from the cache.

**Batch processing.** The moderator may send a run as one batch, through the provider's discounted batch API (half the standard price), with results within a day.
- Every request passes the same checks as a single reading, and the proxy refuses the whole batch if any one fails. The spend reserved is each request's worst case at the batch price.
- The proxy collects results only for batches it sent, and settles and logs each once. The workspace records what was sent, so a batch can be collected after a reload.
- A result becomes a reading only if what would be sent now is exactly what was sent. It is recorded as produced by batch.
- A batch has no automatic fallback. Standard calls are the fallback: a reading declined, errored or expired in the batch is reported, and can be read one at a time, with the fallback model.
- The provider keeps a batch's results for 29 days (`docs/data-handling.md`).

**Exact-match reuse.** A completed reading is kept under a key that hashes the whole request: the model, the prompt version and instructions, the rubric as sent, the brief and the submission with their approved-text hashes, and the output schema. When a planned request has exactly the same key, and is for the same submission, the stored reading is reused instead of calling the model.
- The copies record `produced_by: cache` and link to the call they came from (`cached_from_request_id`); nothing is sent, and nothing is spent.
- The moderator can ask the model again instead ("Ask the model again even where nothing has changed").
- The request is rebuilt and the approval gate checked again at run time, as for any reading, so a reused reading always answers the request that would be sent now.

**Estimates** stay a worst case that bounds the spend limit, with every input token billed at the dearest rate (a cache write), at the batch price for a batch. The plan also shows the most a run could cost with the shared prefix cached, and a reused reading costs nothing.

## Options considered

| Option | Decision |
| --- | --- |
| 1. Prompt caching | Adopted: the largest input saving, and nothing more is sent. |
| 2. Batch API | Adopted: readings are prepared in advance, so a delay costs little, and it halves output as well as input. |
| 3. Exact-match reuse | Adopted: deterministic and traceable, since the key covers everything sent and the copy links to its source. |
| 4. Local similarity for consistency | Deferred to consistency work across a cohort. Nothing is reused, so it is not a cost measure. |
| 5. Reusing results across similar submissions | **Rejected.** A reused reading would quote another student's work as evidence about this one, carry one student's content into another's record, and, unless embeddings were computed locally, send text to another service. Each submission gets its own reading. |

## Decision test

1. **Educator authority:** reused, cached and batched readings are still suggestions, and the moderator can always ask the model again.
2. **Explainable behaviour:** every reading records how it was produced (live, batch or cache), and a reused one links to the call it came from. Cache use is recorded in each call's token usage.
3. **Sensitive-data exposure:** nothing extra is sent. The provider may cache only the shared prefix (no submission text), for five minutes, and no reading crosses between students.
4. **Institutional control:** caching and batching sit in the proxy's provider adapter, behind the same interface, so another provider can do without them.
5. **Moderation and consistency:** a reading is reused only for an identical request, so readings stay comparable across a sample.
6. **Accessible and sustainable:** cost falls without any loss of provenance, and the estimate shown before a run accounts for it.

## Consequences

- The provider may hold the shared prefix for five minutes, and a batch's results for 29 days; `docs/data-handling.md` says so.
- Reusable readings are kept in the workspace (`readings/reuse/`), and deleted with it.
- A change to anything sent (a rubric re-import, a re-approved text, another model or prompt version) means a live reading.
