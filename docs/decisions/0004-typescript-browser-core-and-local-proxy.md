# 0004: TypeScript browser core, folder workspace, and a local thin proxy

- **Status:** Accepted
- **Date:** 2026-09-26
- **Issue:** #40
- **Supersedes:** 0002
- **Amends:** 0001 (how the workspace is reached and served, not what it holds)
- **Keeps:** 0003 (with the proxy as the adapter that reaches the provider)

## Context

ADR 0002 chose a Python core behind a local HTTP API, with a TypeScript UI.
That fitted Stage 0's single, local moderator. It was made before
distribution had been discussed.

On 2026-09-26 the maintainer set the direction (#40): **Feedbacker is a
personal tool first, built so that institutional deployment stays open.**

- Educators are not developers. A Python toolchain is too much friction for
  a personal tool to spread, and institutional adoption usually follows
  individual use.
- The maintainer will **never** run a hosted service that holds assessment
  data. Real material lives only on the marker's machine or a university
  server. Only approved anonymised text goes beyond that, to a Feedbacker
  proxy.
- Institutions already run the pattern this needs: static front ends plus an
  AI proxy that holds an institutional key.

For the same code to serve an individual and an institution, the sensitive
processing has to run in the browser. The #41 spike tested the riskiest part
of that: it ported the marked-view parser to TypeScript with pdf.js. The port
matched the Python parser exactly on six synthetic cases, including a
Chrome-printed replica and a CMYK one. It ran in Chrome under a strict
Content Security Policy, and the whole bundle is about 0.4 MB compressed.
ADR 0002's reason for rejecting "TypeScript throughout" (stronger Python
document libraries) no longer holds for the parts Feedbacker needs.

## Decision

- **One static app.**
  - A Svelte and TypeScript app (Svelte as decided for #19), built by Vite,
    with no backend of its own.
  - The same bundle can be served by the local proxy (Stage 0), by a
    university web server, or later from a static host together with a
    hosted proxy.
- **A TypeScript core, running in the browser.**
  - It does all the processing of sensitive material: extraction,
    anonymisation, the approval gate, the pseudonym key, storage, import of
    the original marking, and export.
  - Libraries:
    - pdf.js for PDFs, proven by #41;
    - docx and xlsx libraries, chosen in their port issues;
    - rule-based anonymisation, ported as it is. Heavier name recognition
      (#34) and similarity (#24) would use in-browser models (e.g.
      transformers.js), decided in those issues.
  - Pyodide is not used. It stays a fallback for a single component only if
    a port issue shows it is needed.
- **The workspace stays a plain folder of files** (ADR 0001's model).
  - The app opens a folder the moderator chooses, through the File System
    Access API. The folder can be on their disk, a university share or a
    synced drive.
  - It holds the same JSON records, the separate pseudonym-key file, and the
    same versioned layout, so the Python command line and the app can use
    one workspace during the transition.
  - Browser storage (IndexedDB) holds only the handle for reopening the
    folder, never records.
  - Supported browsers are Chromium-based (Chrome, Edge). Firefox and Safari
    are out of scope for Stage 0.
- **A thin Feedbacker proxy, built now and run locally.**
  - It is written in TypeScript on a framework that also runs on a Worker or
    a server (e.g. Hono), so the same code can later be run by an
    institution with its own key. It ships as a single binary if practical.
  - It holds the API key. The key never enters the browser, and is read only
    from the proxy's environment or a gitignored `.env` file.
  - It is the **single egress point.** The app's Content Security Policy
    allows connections only to the proxy (`connect-src 'self'`).
  - It enforces the **spend limit** from ADR 0003. The app still estimates
    cost and asks for confirmation before a run.
  - It keeps an **egress log**: what was sent, when, to which model, the
    request hash, token use and cost. The log never includes the API key.
    Request bodies are kept only in the workspace's call records, as now.
  - It runs **leak checks as a backstop.** It checks that each request has
    only the fields the model data boundary permits, and that no known
    identifier patterns appear. It can refuse to forward a request, but it
    is not the privacy boundary; the app's approval gate is.
  - **Localhost hardening:**
    - it binds to `127.0.0.1` only;
    - it checks the `Origin` and `Host` headers (against DNS rebinding);
    - it requires a per-session token, which it prints at start-up in the
      app's URL fragment, as Jupyter does.
  - It also **serves the app**, with strict security headers. This avoids
    browsers' local-network prompts for a public page calling localhost.
  - **Not built in Stage 0:** accounts, multi-user quotas, a shared cache,
    and hosting. Those need #23 and a new decision.
- **The provider boundary (ADR 0003) stays in the core.**
  - Every model call still goes through the approval-gated interface.
  - The proxy is reached through an adapter implementing it; a local model
    (#39) could be another.
  - Prompt versioning, call records and the model data boundary are
    unchanged.
- **Code delivery is locked down:**
  - a strict Content Security Policy: `script-src 'self'`, no `unsafe-eval`
    or `unsafe-inline`;
  - no third-party scripts or runtime CDNs;
  - pinned dependencies;
  - versioned releases.
- **One data contract, owned by TypeScript.**
  - When the models are ported, zod schemas in the TypeScript core become
    the source of truth, and JSON Schema is generated from them.
  - Until the Python core is retired, a check keeps the Python models
    compatible with that schema.
- **Python keeps narrower jobs:**
  - the reference implementation, whose tests are the port's specification;
  - offline evaluation for the stage gate, on exported JSON;
  - generating the synthetic fixtures.

  The Python command line stays usable for current moderation until the app
  reaches parity. The local FastAPI layer planned in 0002 is not built.

## Options considered

| Option | Why not chosen |
| --- | --- |
| Keep 0002 (a local Python server and a TypeScript UI) | Works for one technical user, but every user must install Python. It can't become a page an institution serves, and the planned FastAPI layer would be thrown away. |
| Python in the browser (Pyodide) | Keeps the Python code, but costs a 10–30 MB download and a slow start, needs two languages in the browser, and its native libraries (spaCy, Presidio) don't run well there. #41 showed it isn't needed for the hardest parser. |
| Desktop package (Tauri or Electron) | Solves installation for individuals, but institutions can't serve it, and it adds packaging and signing work. |
| Browser storage for records (IndexedDB or OPFS) | Hard to inspect, back up or delete in one action, and it can be evicted. ADR 0001's reasons still apply. |
| Each user's key used directly from the browser | No install at all, but the key sits in browser storage where a script bug could read it, and there is no single egress point, egress log or enforced spend limit. |
| A hosted proxy now (e.g. a Cloudflare Worker) | Needs authentication and quotas (#23), plus an operator. Deferred: the same proxy code can be hosted later under a new decision. |
| A hosted service holding assessment data | Ruled out by the maintainer. Assessment data stays with the marker or the institution. |

## Decision test

1. **Educator authority:** unchanged. The approval gate, judge-first review
   and confirmation of imported marks stay in the core, and nothing reaches a
   model without approval.
2. **Explainable behaviour:** records remain plain files in a folder the
   moderator controls. The egress log adds proof of exactly what left the
   machine.
3. **Sensitive-data exposure:** raw material and the pseudonym key never
   leave the machine. The API key never enters the browser. The only network
   path is the proxy, which carries approved anonymised text. The #41 spike
   also found and fixed a Python bug where CMYK colours defeated the
   rubric-level check.
4. **Institutional control:** an institution can serve the same app and run
   the same proxy with its own key and provider choice, without the
   maintainer operating anything.
5. **Moderation and consistency:** unaffected. The same records, prompts and
   call provenance are kept.
6. **Accessible and sustainable:** the browser UI can meet WCAG 2.2 AA. One
   language replaces two toolchains once the port is done. There is no
   hosted infrastructure to operate in Stage 0.

## Consequences

- **Port work.** The core is ported module by module in its own issues, with
  the Python tests as the specification:
  - models;
  - the workspace;
  - extraction and archives;
  - rubric import;
  - anonymisation;
  - the brief;
  - original marking and marked views (from the #41 spike);
  - the approval boundary and requests;
  - the AI reading.

  The proxy is its own issue. #19 and #20 build on the TypeScript core.
- **Two toolchains during the transition.** The Python core is retired to
  reference and evaluation use once the app reaches parity. The
  contract-compatibility check runs until then.
- **Safeguards that need a browser equivalent**, settled in the workspace
  port issue and recorded in `docs/data-handling.md`:
  - **Refusing git working trees.** A browser can see only the chosen folder,
    not its parents. The app will refuse a folder containing `.git`, and the
    proxy (which can see the file system) will check the parents too.
  - **Restrictive file permissions.** A browser can't set file modes such as
    700 on the workspace and key. The proxy will create new workspaces with
    those permissions, and the app will warn when a folder was not created
    that way.
  - **Browser storage.** The app stores only the folder handle, and "delete
    the workspace" still means deleting the folder.
- **Updates to other documents:**
  - `docs/data-handling.md`: the key and spend now sit in the proxy, the
    egress log, the browser requirements, and the safeguards above;
  - `docs/ARCHITECTURE.md` and `AGENTS.md`: the repository shape and
    runtime;
  - `PRODUCT.md`: a personal tool first, with the institutional route kept
    open, and never a hosted service holding assessment data;
  - 0001 is marked as amended and 0002 as superseded.
- **Pinned pdf.js.** pdf.js's operator shapes can change between versions,
  so it stays pinned, and the operator-level tests from #41 move into the
  core.
- **Hosting is a new decision.** Serving the app from a public host, or
  running a hosted proxy, needs authentication (#23) and a new decision
  record before any shared use.
