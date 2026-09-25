# Project workflow

## Purpose

The [Feedbacker GitHub project board (Project 22)](https://github.com/users/glowkeeper/projects/22)
is the working plan for the project, not a retrospective status display. Its
status options and custom fields should match this document.

Product direction constrains the work, issues define agreed deliverables, and
the board communicates what is happening now. Pull requests implement and
verify issues.

## Sources of truth

1. `docs/PROJECT.md` defines the product and its boundaries.
2. `PRODUCT.md` defines the staged progression and the current stage.
3. `docs/ARCHITECTURE.md` and `docs/decisions/` record technical principles and decisions.
4. GitHub issues define agreed units of work and acceptance criteria.
5. The project board records status, priority, size, and relationships.

Conversation may clarify decisions, but anything that constrains later work
must be transferred to the appropriate project record.

## Sensitive material

The repository and its issues are public. Never put student work, marks,
feedback, names or other personal data, confidential assessment material, or
secrets in code, fixtures, issues, pull requests, or commit messages. Use
synthetic material and describe real engagements generically.

## Board statuses

### Backlog

The idea is captured but not committed. It may be speculative, incomplete,
awaiting research, or intended for a later product stage.

### Ready

The work is agreed and executable. A Ready issue has a clear outcome, testable
acceptance criteria, known dependencies, an appropriate size and priority, and
no unresolved decision capable of materially changing implementation.

Moving consequential work from Backlog to Ready is the principal approval gate
and requires an explicit maintainer decision.

### In progress

Implementation has started on a focused branch. Work in progress should
normally be limited to one issue.

### In review

The implementation is available through a pull request and is being checked
against its acceptance criteria.

### Done

The work is merged into `main`, verified, documented, and closed. Closing work
because it was declined or cancelled is not delivery.

## Stages and commitment

Only the current agreed product stage should supply Ready implementation work.
Later-stage ideas may be recorded in Backlog, but must not silently influence
the current technical foundation or be treated as commitments.

A stage transition requires its product outcome, boundaries, promotion
criteria, and material architecture consequences to be recorded first.

## Priority and size

Priority describes impact:

| Priority | Meaning |
| --- | --- |
| P0 | Broken, unsafe, or unable to deliver the current stage. |
| P1 | Required for the current agreed outcome. |
| P2 | Worthwhile, but not required for the current outcome. |

Size describes scope and uncertainty:

| Size | Meaning |
| --- | --- |
| XS | Tiny and isolated. |
| S | Small and focused. |
| M | Normal issue-sized work. |
| L | Large enough that decomposition should be considered. |
| XL | A parent outcome, normally delivered through child issues. |

## Issue structure

A parent issue defines a meaningful outcome and why it matters. It has at least
two independently deliverable children and normally does not map to one pull
request.

A child issue defines one coherent contribution to a parent. It has exactly one
GitHub parent relationship, distinct acceptance criteria, and normally maps to
one focused pull request. Children do not have children.

A standalone issue is a genuine one-off that does not naturally contribute to
a parent outcome. It is not a way to avoid structuring a larger body of work.

Before accepting a child or standalone issue, ask whether it can be completed
and reviewed independently, leaves the repository coherent, has distinct
acceptance criteria, and can reasonably own a focused pull request.

## Branches and pull requests

Use GitFlow-style names:

```text
feature/<issue-number>-<short-description>
fix/<issue-number>-<short-description>
docs/<issue-number>-<short-description>
chore/<issue-number>-<short-description>
```

Do not encode contributor or AI identity in branch names. Do not push
implementation work directly to `main`. Link each pull request to its issue and
explain how its acceptance criteria were verified.

## Definition of done

An issue is Done only when its agreed work is merged into `main`, relevant
checks pass, acceptance criteria are satisfied, documentation is accurate, and
the issue is closed.
