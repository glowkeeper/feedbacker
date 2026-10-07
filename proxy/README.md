# Feedbacker proxy

This is the local proxy from [ADR 0004](../docs/decisions/0004-typescript-browser-core-and-local-proxy.md). It runs on the moderator's machine and has four jobs:

- it is the **only way anything leaves the machine**;
- it is the **only holder of the API key**;
- it keeps an **egress log**;
- it **creates and registers workspaces**, doing the checks that need a real file path.

It also serves the Feedbacker app.

## Running it

```sh
cd proxy
npm install
npm start
```

It prints an address such as `http://127.0.0.1:8765/#token=…`. Open that address; the token in it is new each time the proxy starts.

| Option | Default | |
| --- | --- | --- |
| `--port <n>` | `8765` | Port on `127.0.0.1`; `0` picks a free one. |
| `--app <dir>` | `../ui/dist`, if built | The built app to serve. |
| `--data <dir>` | `~/Feedbacker/proxy` | The workspace registry, the batch record and the egress log. The folder is 700. |
| `--workspaces <dir>` | `~/Feedbacker/workspaces` | Where the app makes new workspaces, by name. Created if missing, and made 700 at start-up; refused inside a git working tree, or if its permissions are widened later. |
| `--max-run-usd <n>` | `5` | The highest spend limit any run may have. |
| `--egress-retention-days <n>` | `90` | How long egress entries are kept. |

**The API key** is read only from `ANTHROPIC_API_KEY`, or else from `~/Feedbacker/.env` (`FEEDBACKER_ENV` overrides the path), exactly as the Python command line reads it. The file must be readable only by you (`chmod 600`).

Without a key, the proxy still runs and still handles workspaces, but it refuses model requests.

**Not a single binary yet.** Neither Bun nor Deno is assumed. Node's single executable applications need a bundling step and, on macOS, code signing, which isn't worth it before there is a UI to ship. For now it is one command, `npm start`, on Node 24.

## Prompt caching

The instructions, rubric and brief are the same for every submission of a run, and come first, so the proxy marks the end of them as a cache breakpoint. After the first reading, the provider reads that prefix from its cache, for five minutes, at a fraction of the input price. Only the submission differs. Nothing extra is sent, and the request hash covers exactly what is sent.

Each response's usage records the tokens written to and read from the cache, and the cost is billed by them. The worst case that enforces the spend limit counts every input token as a cache write, the dearest way it can be billed. `/api/health` gives each model's `cache_read` and `cache_write` multipliers, so the app can show what caching is likely to save.

## Batches

A run's readings can be sent together through the provider's Message Batches API, which bills every token at half the standard price, cached or not. A batch can take up to 24 hours; most finish much sooner.

- **The same checks.** Each request in a batch passes every check a single reading does, and if any one is refused, the whole batch is refused and nothing is sent.
- **The spend limit.** The run reserves every request's worst case at the batch price when the batch is sent. The first collection of its results replaces the reservation with what was actually spent.
- **Only its own batches.** The proxy keeps a record of the batches it sent, in `<data>/batches.json` (mode 600), and checks, collects or cancels only those, never another batch the key's account holds. The record holds, for each request, the model, the prompt version, the hash of what was sent and the spend reserved: no text, no names, no key. Batches are forgotten after 30 days, once the provider no longer keeps their results.
- **After a restart.** The record survives a restart, so results can still be collected; the run is gone by then, and its spend was bounded when the batch was sent. The record is written whole and renamed into place, so a crash never leaves it partial.
- **One waiting per workspace.** A batch names the workspace it is for (its registration), and a workspace with a batch sent in the last 25 hours and not yet collected can't send another, from any window. After 25 hours the batch has ended, so an orphaned one can't hold the place for longer.
- **Collected once.** Collecting takes a 10-minute lease, so while one window processes the results another is refused; if the window fails, the lease runs out. The first collection settles the run and logs each result, and a later one returns the same results without counting them again. A result already in the egress log is never logged twice, even after a crash.
- **Nothing untracked.** The record must be readable and writable before a batch is sent. If a batch is sent but can't be recorded, it is cancelled at once, and the log keeps its ID; its reservation stays held, since some requests may already have been billed.
- **Size.** A batch holds at most 200 requests and 32 MB.

## Security

The permission checks (700 and 600) are POSIX: macOS and Linux. On Windows those modes mean nothing, so the proxy's workspace safeguards don't apply there.


- **It binds to `127.0.0.1` only.** No option changes that.
- **Every request must carry `Host: 127.0.0.1:<port>` or `localhost:<port>`.** This defeats DNS rebinding.
- **API requests must also:**
  - come from the app's own origin: the `Origin` header, or, for a same-origin `GET` (which browsers send without `Origin`), `Sec-Fetch-Site: same-origin`, which a page can't set itself;
  - carry `Authorization: Bearer <token>`, the per-session token from the printed address. The app reads it from the URL fragment, which browsers never send to a server.
- **Every response carries strict headers.** The Content Security Policy allows scripts, styles and connections only from the proxy itself (`connect-src 'self'`), with no `unsafe-inline` or `unsafe-eval`. There are also `nosniff`, `no-referrer` and `frame-ancestors 'none'`.
- **The key goes only to the provider.** It is never in a response, log or error message:
  - a request that contains the key anywhere is refused;
  - anything a provider returns has the key redacted;
  - the provider's own error messages are never passed on.

  Tests plant the key in provider errors and responses to prove it.
- **Command-line numbers are validated.** A non-finite or out-of-range value (such as `--max-run-usd NaN`) stops the proxy at start-up, rather than weakening a limit.

## API

All endpoints are under `/api`, same-origin, with the session token. Refusals come back as `{ "error": { "type", "message" } }`. A message names the problem, never the text that caused it.

| Endpoint | Body | Result |
| --- | --- | --- |
| `GET /api/health` | | `{ ok, version, key_configured, provider, batch, models, prices }`: `version` is Feedbacker's version (the app warns if it differs from its own), `provider` is the provider's name (for call records), `batch` says whether it has a batch API, and prices are USD per million tokens (`input`, `output`, with the `cache_read`, `cache_write` and `batch` multipliers), so the app can show a worst-case estimate before anything is sent |
| `POST /api/runs` | `{ limit_usd, estimate_usd, confirmed: true }` | A run: `{ id, limit_usd, estimate_usd, spent_usd, … }`. The estimate is a worst case and may be above the limit; the run then stops at the limit, as the Python reading does. |
| `GET /api/runs/:id` | | The run's limit and spend |
| `POST /api/runs/:id/read` | A reading request (below) | The result, or a refusal |
| `POST /api/runs/:id/batch` | `{ workspace, requests: [...] }`: the workspace's registration ID, and up to 200 reading requests, in 32 MB | `{ id, status, counts, created_at, expires_at, ended_at, requests, provider, items: [{ custom_id, request_sha256 }], run }`, or a refusal. `custom_id` is `r1`, `r2`, … in request order. A provider failure is HTTP 502 with `request_sha256s`. |
| `GET /api/batches/:id` | | The batch's `status` (`in_progress`, `canceling` or `ended`) and `counts` |
| `GET /api/batches/:id/results` | | Once it has ended, `{ id, items }`: each item is a reading's response (below) with its `custom_id`, priced at the batch rate, or `{ custom_id, request_sha256, failed, message, cost_usd: 0 }`, where `failed` is `errored`, `canceled`, `expired` or `missing` |
| `POST /api/batches/:id/cancel` | `{}` | The batch's status; requests not yet processed are not billed |
| `GET /api/workspaces` | | `{ folder, workspaces }`: the workspaces folder, and each registered workspace, newest first, from its manifest alone (`name`, `workspace_type`, `created_at`, `retention_days`, `retention_source`; an older manifest without a type or period reads as a moderation kept for 90 days), with its `path`, its `folder` name, whether it is `in_workspaces_folder`, and a `problem` if its manifest can't be read. Nothing else in a workspace is read. |
| `POST /api/workspaces` | `{ action: "create", name }` makes it in the workspaces folder (a plain folder name: letters, digits, spaces, hyphens, underscores and full stops, with a letter or digit, not starting with a full stop or a space, not ending with a space, at most 64 characters); `{ action: "create" \| "register", path }` by absolute path. Creating also takes optional `retention_days`, `retention_source` and `workspace_type` (`"moderation"`, the default, or `"marking"`) | `{ registration_id, path }` |
| `POST /api/workspaces/confirm` | `{ registration_id }` | `{ confirmed, path, reason }` |
| `POST /api/workspaces/forget` | `{ registration_id }` | `{ forgotten }`: the registration is removed, so the registry keeps no path to a deleted workspace |

### A reading request

```json
{
  "model": "claude-sonnet-5",
  "max_output_tokens": 16000,
  "prompt": { "version": "reading-v2", "instructions": "…" },
  "blocks": [
    { "kind": "rubric", "heading": "RUBRIC", "text": "…" },
    { "kind": "brief", "heading": "ASSESSMENT BRIEF", "text": "…", "approved_sha256": "…" },
    { "kind": "submission", "heading": "SUBMISSION [STUDENT_A]", "text": "…", "approved_sha256": "…" }
  ],
  "output_schema": { "type": "object" }
}
```

**The fields are exactly what the AI may be sent (`PRODUCT.md`):**
- the versioned prompt;
- the rubric;
- the approved brief, which is optional;
- one approved submission.

Unknown fields are refused. Each block is sent as `heading`, a blank line, then `text`, as the Python reading renders it.

Before sending, the proxy checks:

1. **Shape.** The blocks are exactly a rubric, an optional brief, then one submission. **A drafting request** (ADR 0006), and only a drafting request, also carries the educator's marking of that one submission as a block, `marking`, last (their levels, marks and anonymised comments), and may carry their approved feedback guide, `guide`, after the brief and before the submission, so it is cached with the rest of the stable content. A request is a drafting request when its prompt version is `feedback-v` and a number; a drafting request without the marking block, or any other request with one, is refused. **A suggestion request** (ADR 0006, amended), with a prompt version `feedback-edit-v` and a number, is exactly a rubric, the educator's marking of one criterion, then their recorded feedback on it with the checks' flags, `feedback`, and no submission; the feedback block is refused in any other request.
2. **Approval.** The submission, the marking, the feedback guide and the feedback (and the brief, when it has a hash) must hash to `approved_sha256`, which is SHA-256 of the UTF-8 text. So the text sent is the text that was approved.
3. **Figures** (ADR 0007). Only a reading's or proposals' submission block may carry figures: each image must be PNG, JPEG, GIF or WebP, at most 10 MB as base64, its placeholder in the submission's text exactly once, and its bytes must hash to its `approved_sha256`. A figure that isn't sent is listed by placeholder, and marked "(figure not sent)" where it was. At most 100 figures a request, and the request at most 32 MB with them. The worst case counts each image at 4,784 input tokens, the most the provider charges for one.
4. **Leaks.** No email address, web address, phone number, or number of 7 or more digits appears anywhere in the request, including the model name and prompt version (the text, not inside a figure's image: the educator's review is the control for images). The proxy's own API key must not appear anywhere either. These are backstops. The app's approval gate is the privacy control.
5. **Price.** The model has a known price; otherwise its spend can't be bounded. Only the table's own entries count, so names such as `toString` are refused.
6. **Spend.** The request's worst case must fit in what's left of the run's limit:
   - input (the instructions, the blocks, and the output schema, which is billed as input too) is counted at 3 characters a token, and output at its maximum, as the Python reading estimates;
   - the worst case is reserved, so concurrent requests can't overrun the limit together;
   - once the call returns, the reservation is replaced by the actual cost.

The response carries:
- `outcome`: `complete`, `refused`, `truncated` or `unparsed`;
- `parsed`, `stop_reason`, `model_reported`, `request_id`, `usage` and `raw_json`;
- `request_sha256`, the hash of exactly what was sent;
- `cost_usd` and the run's spend.

Provider failures come back as HTTP 502 with `fatal` (for example, a rejected key) and `request_sha256`, the hash of what was forwarded, so the app can keep an audit record of the failed call.

**Prices** are Anthropic's first-party rates for the models listed at `/api/health`:
- cache writes (5-minute TTL) cost 1.25× the input price;
- cache reads cost 0.1×, except Claude Opus 5.5 (0.05×) and Claude Fable 5.1 (0.025×);
- a batched request costs 0.5× all of the above.

The Python reference charges 0.1× for every model, which overestimates.

## Egress log

`<data>/egress.jsonl` (mode 600) has one line per forwarded or refused request:
- the time, run ID, model and prompt version;
- the hash of what was sent;
- the hash of each figure (image) sent with it, never the image (ADR 0007);
- the outcome and any refusal type;
- token usage and cost;
- for a batched request, the batch ID: one line when it is sent (`batch_submitted`), and one when its result is first collected.

It holds **no text, no names and no key**. For a refused request, which isn't trusted, only a priced model name is logged, never the app-supplied prompt version. The request itself stays in the workspace's call records.

Entries older than the retention period are removed at start-up and daily. The file is set back to 600 at start-up if its mode was changed.

## Workspaces

A browser folder handle reveals neither the folder's path nor its parents, so the path-based safeguards live here:

- **Create** makes a new workspace exactly as the Python core's `Workspace.create` does, so the command line can open it. It checks for git first, from the nearest folder that exists, then creates any missing parent folders:
  - the folder (700), with a `private/` folder (700);
  - a valid `workspace.json` manifest, with the name, the creation time and the retention settings (default 90 days).

  The path must not exist, and nothing above it may be a git working tree.
- **Register** takes an existing Feedbacker workspace, identified by its `workspace.json`, such as one made by the command line. It applies the same git check, and tightens permissions: folders 700, files in `private/` 600.
- Both write a random ID into `registration.json` (600) and record the path in `<data>/registry.json` (600).
- **Register** checks everything before changing anything, so a refused folder is left as it was:
  - the path must not itself be a symbolic link;
  - `workspace.json` must be a valid manifest of layout version 1;
  - nothing inside may be a symbolic link.
- **Confirm** is called by the app each time it opens a folder, and again after the app writes a private file. It re-checks the registered path:
  - it still exists;
  - it still resolves to itself. If a folder above it was replaced by a link, confirmation is refused rather than followed;
  - it is still outside any git working tree;
  - it holds the same ID;
  - **the workspace folder itself is still 700.** A looser mode means someone changed it, so confirmation is refused.

  Then it **restores the permissions of everything inside**: every folder 700, every file 600. It reports what it changed in `tightened`. The browser can't set permissions, so what the app writes gets the system defaults; that is safe inside a 700 folder, and confirming restores the stricter modes. A workspace containing a symbolic link is refused, before anything is changed.

  **The identity check.** When the app opens a folder, it asks for a challenge (`{ registration_id, challenge: true }`). The proxy writes a one-time random value into the registered folder, as `challenge-<random>.json` (mode 600), and returns it. The app must read the same value back through the folder the moderator picked, then deletes the file. A copy of the workspace doesn't contain it, so the copy is refused even while the original is still in place. Checks the app never collects, such as one a refused copy couldn't reach, are cleared after ten minutes.

## Development

```sh
npm test          # 123 tests; no network, no real key
npm run typecheck
```

The tests use temporary folders and a fake provider. The Anthropic adapter is tested through the real SDK client pointed at a fake API, which also checks the exact request shape.
