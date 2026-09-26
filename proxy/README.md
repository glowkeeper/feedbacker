# Feedbacker proxy

This is the local proxy from [ADR 0004](../docs/decisions/0004-typescript-browser-core-and-local-proxy.md) (#45). It runs on the moderator's machine and has four jobs:

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
| `--app <dir>` | `../ui/dist`, if built | The built app to serve. Until #19 there is a placeholder page. |
| `--data <dir>` | `~/Feedbacker/proxy` | The workspace registry and the egress log. The folder is 700. |
| `--max-run-usd <n>` | `5` | The highest spend limit any run may have. |
| `--egress-retention-days <n>` | `90` | How long egress entries are kept. |

**The API key** is read only from `ANTHROPIC_API_KEY`, or else from `~/Feedbacker/.env` (`FEEDBACKER_ENV` overrides the path), exactly as the Python command line reads it. The file must be readable only by you (`chmod 600`).

Without a key, the proxy still runs and still handles workspaces, but it refuses model requests.

**Not a single binary yet.** Neither Bun nor Deno is assumed. Node's single executable applications need a bundling step and, on macOS, code signing, which isn't worth it before there is a UI to ship. For now it is one command, `npm start`, on Node 24.

## Security

The permission checks (700 and 600) are POSIX: macOS and Linux. On Windows those modes mean nothing, so the proxy's workspace safeguards don't apply there.


- **It binds to `127.0.0.1` only.** No option changes that.
- **Every request must carry `Host: 127.0.0.1:<port>` or `localhost:<port>`.** This defeats DNS rebinding.
- **API requests must also:**
  - come from the app's own origin (`Origin` header);
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
| `GET /api/health` | | `{ ok, key_configured, models }` |
| `POST /api/runs` | `{ limit_usd, estimate_usd, confirmed: true }` | A run: `{ id, limit_usd, estimate_usd, spent_usd, … }` |
| `GET /api/runs/:id` | | The run's limit and spend |
| `POST /api/runs/:id/read` | A reading request (below) | The result, or a refusal |
| `POST /api/workspaces` | `{ action: "create" \| "register", path }`; creating also takes optional `retention_days` and `retention_source` | `{ registration_id, path }` |
| `POST /api/workspaces/confirm` | `{ registration_id }` | `{ confirmed, path, reason }` |

### A reading request

```json
{
  "model": "claude-sonnet-5",
  "max_output_tokens": 16000,
  "prompt": { "version": "reading-v1", "instructions": "…" },
  "blocks": [
    { "kind": "rubric", "heading": "RUBRIC", "text": "…" },
    { "kind": "brief", "heading": "ASSESSMENT BRIEF", "text": "…", "approved_sha256": "…" },
    { "kind": "submission", "heading": "SUBMISSION [STUDENT_A]", "text": "…", "approved_sha256": "…" }
  ],
  "output_schema": { "type": "object" }
}
```

**The fields are exactly the model data boundary:**
- the versioned prompt;
- the rubric;
- the approved brief, which is optional;
- one approved submission.

Unknown fields are refused. Each block is sent as `heading`, a blank line, then `text`, as the Python reading renders it.

Before sending, the proxy checks:

1. **Shape.** The blocks are exactly a rubric, an optional brief, then one submission.
2. **Approval.** The submission (and the brief, when it has a hash) must hash to `approved_sha256`, which is SHA-256 of the UTF-8 text. So the text sent is the text that was approved.
3. **Leaks.** No email address, web address, phone number, or number of 7 or more digits appears anywhere in the request, including the model name and prompt version. The proxy's own API key must not appear anywhere either. These are backstops. The app's approval gate is the privacy control.
4. **Price.** The model has a known price; otherwise its spend can't be bounded. Only the table's own entries count, so names such as `toString` are refused.
5. **Spend.** The request's worst case must fit in what's left of the run's limit:
   - input (the instructions, the blocks, and the output schema, which is billed as input too) is counted at 3 characters a token, and output at its maximum, as the Python reading estimates;
   - the worst case is reserved, so concurrent requests can't overrun the limit together;
   - once the call returns, the reservation is replaced by the actual cost.

The response carries:
- `outcome`: `complete`, `refused`, `truncated` or `unparsed`;
- `parsed`, `stop_reason`, `model_reported`, `request_id`, `usage` and `raw_json`;
- `request_sha256`, the hash of exactly what was sent;
- `cost_usd` and the run's spend.

Provider failures come back as HTTP 502 with `fatal` (for example, a rejected key).

**Prices** are Anthropic's first-party rates for the models listed at `/api/health`:
- cache writes (5-minute TTL) cost 1.25× the input price;
- cache reads cost 0.1×, except Claude Opus 5.5 (0.05×) and Claude Fable 5.1 (0.025×).

The Python reference charges 0.1× for every model, which overestimates.

## Egress log

`<data>/egress.jsonl` (mode 600) has one line per forwarded or refused request:
- the time, run ID, model and prompt version;
- the hash of what was sent;
- the outcome and any refusal type;
- token usage and cost.

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
