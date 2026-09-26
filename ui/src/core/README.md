# Feedbacker core (TypeScript)

This is the browser core from [ADR 0004](../../../docs/decisions/0004-typescript-browser-core-and-local-proxy.md). It has no UI or DOM dependencies and is being ported module by module from `core/` (the Python reference), under parent issue #43. Each module's Python tests are its specification.

## Data contract (#44)

- `models.ts` defines the contract as zod schemas. **It is the source of truth.**
- `npm run contract` generates `contract/feedbacker.schema.json` from those schemas.
- **Conformance with Python.** `contract/conformance.json` lists shared cases, each marked valid or invalid. Both implementations must agree on every case. For valid cases, this core's output must equal the Python reference's, which is recorded in `contract/conformance.expected.json` by `uv run python -m feedbacker_core.contract`. That is how records written by either side stay readable by the other.
- **Offsets count Unicode code points**, as Python does, not UTF-16 units. Use `codePointLength`, never `.length`, for anything stored as an offset.
- **Timestamps** are timezone-aware ISO 8601 strings, normalised to exactly the form Python writes:
  - seconds are always present;
  - the fraction has six digits (truncated) or is omitted if zero;
  - a zero offset is written `Z`.

  Ordering checks use `instant`, a bigint count of microseconds, which is exact at any date.
- **Text that can't be encoded as UTF-8** (a lone surrogate) can't be hashed. `sha256Text` throws, as Python's encoding does, and anonymised text containing it is rejected.
- **`serialiseRecord` validates before it serialises**, so nothing invalid is written. Its output parses to exactly what Python writes.

### Intended differences from the Python models

| Difference | Why |
| --- | --- |
| Built-in validation messages come from zod, not Pydantic, e.g. `Unrecognized key: "final_mark"` rather than "Extra inputs are not permitted". | The rules are the same. Messages for Feedbacker's own rules are identical to Python's. |
| Stricter input: numeric strings are not coerced to numbers, nor `"true"` or `1` to booleans, and timestamps must include seconds. | Pydantic's lax mode accepts these, but neither implementation ever writes them. |
| Records are plain data, not frozen objects. | Treat them as immutable by convention. |
| Whole-number fields accept values only up to 2^53 − 1 (JavaScript's safe-integer limit); Python's are unbounded. | Beyond that limit, JSON numbers lose precision in JavaScript anyway. These fields (offsets, counts, token usage, page numbers) never approach it. |
| Cross-field checks may also run after a nested field has failed its own check. | Only the error list can differ, never whether a record is valid. |
| The two fixture checks on zip timestamps and modified times stay in Python. | They test the Python fixture generator, which stays in Python. |
