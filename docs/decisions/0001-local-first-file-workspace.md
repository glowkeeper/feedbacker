# 0001: Local-first, file-based moderation workspace

- **Status:** Accepted
- **Date:** 2026-09-25
- **Issue:** #13

## Context

Stage 0 has one user, a moderator, working on a small sample of real,
sensitive submissions (see `PRODUCT.md`). The quickest safe route to real use
is one that introduces no server, no accounts, and no shared storage.

## Decision

Stage 0 stores everything in a **moderation workspace**, a folder on the
moderator's machine outside any git repository.

- The workspace holds source files, extracts, anonymised text, approvals, the
  pseudonym key (in its own file), original marks, AI readings, moderator
  judgements, and exports.
- Records are plain files: JSON for structured records, with the original
  source files kept as they are. Every record carries provenance.
- The application refuses to open or create a workspace inside a git working
  tree. `.gitignore` also excludes common workspace, key, and export paths.
- The application is a local web app, served on `127.0.0.1` only.
- There is no database. A single-user workspace of tens of submissions does
  not justify one. Adding one later requires a new decision record.

## Options considered

| Option | Why not chosen |
| --- | --- |
| Local SQLite database | More machinery than a small single-user sample needs; plain files are easier to inspect and delete. It remains a candidate if file handling becomes awkward. |
| Hosted app with shared storage | Would upload unanonymised material to a server and require authentication and spend controls (#23). Out of scope for Stage 0. |
| Browser-only storage | Hard to inspect, back up, or reliably delete; ties sensitive data to one browser profile. |

## Decision test

1. **Educator authority:** preserved. Nothing happens without the moderator.
2. **Explainable behaviour:** records are plain files the moderator can read.
3. **Sensitive-data exposure:** minimised. Material stays on one machine and
   is deleted in one action.
4. **Institutional control:** the moderator controls where data lives.
5. **Moderation and consistency:** supported for a single moderator. Stage 2
   will need shared storage and a new decision.
6. **Accessible and sustainable:** a local web UI can meet WCAG. There is no
   infrastructure to operate.

## Consequences

- The file layout needs versioning so later changes don't break older
  workspaces.
- Deleting a workspace must be simple and complete (see
  `docs/data-handling.md`).
- Moving to shared storage in Stage 2 is a deliberate migration, not an
  extension.
