# Product direction

## Status

This document records Feedbacker's staged product direction. `docs/PROJECT.md`
defines what Feedbacker is and must never do; this document defines the order
in which it is built and the evidence required to move on.

## Governing principle

Build the smallest agreed stage well. A later stage is direction, not committed
scope, until its outcome, boundaries, and promotion criteria have been agreed.

Each stage records:

- the outcome it delivers;
- why it is valuable on its own;
- what is explicitly inside and outside its scope;
- the evidence or decision that permits progression;
- any product, privacy, governance, or operational constraints it introduces.

## Why moderation comes first

Moderation puts Feedbacker's principles into practice from the start. A human
already owns every mark. The AI can only offer a second reading that the
moderator checks. The moderator's independent judgement becomes the reference
against which AI assistance is measured.

Stage 0 is also directly useful: it supports real external moderation work, and
that work doubles as the test harness for the product.

## Stage 0: moderation harness

### Outcome

A moderator working alone on their own machine takes a small sample of typed,
already-marked submissions. They:

1. anonymise the sample locally;
2. re-mark each submission against the rubric using their own judgement;
3. reveal the original marker's marks and an AI reading that cites evidence;
4. export a moderation record they have approved.

### Decisions

- **One user, working locally.** The moderator is the only user. There are no
  accounts, server, database, or multi-user features. The workspace is files
  on the moderator's machine.
- **Typed documents only.** Submissions are docx or pdf. There is no OCR or
  handwriting support.
- **Normalise before inference.** Text is extracted by code, and the rubric is
  imported into a structured representation, before any model is involved.
- **Anonymise before any model call.**
  - Extracts are redacted locally.
  - The moderator reviews the redacted text and approves it before anything
    is sent to a model.
  - The key linking pseudonyms to real names never leaves the machine.
  - Pseudonymised text is still treated as personal data while that key
    exists.
- **The moderator judges first, then reveals.**
  - For each criterion, the moderator records their own judgement before the
    original marks and the AI reading are shown.
  - AI readings are prepared in advance, so the reveal is instant.
  - The moderator may revise after the reveal. Both the first and the revised
    judgement are kept.
- **Records stay separate.** Original marks, AI suggestions, and moderator
  judgements are stored separately and stay distinguishable in every view and
  export.
- **The AI is a second reader.** It proposes a level, quotes evidence, and
  drafts comments for each criterion. It never sees the original marks and
  never produces a decision.
- **The export is generic.** It is a readable moderation summary plus a
  structured audit record. Templates for specific institutional report forms
  are deferred.
- **Real material stays out of the repository.** Tests use committed synthetic
  fixtures.

### Excluded

Marking workflows for release to students, multiple markers, calibration,
institutional policy controls, hosted deployment, and form templates for
specific institutions.

### Stage gate

Stage 0 advances when the maintainer has used it for a real moderation. They
record an evaluation of whether it saved time without compromising their
independence, and whether the AI reading was useful, misleading, or neutral.
The first and revised judgements provide evidence for that evaluation.

## Stage 1: marking workspace

An educator marks their own cohort against a rubric. Feedbacker proposes
evidence, observations, and levels for each criterion, a provisional mark
recommendation, and draft feedback. The educator accepts, edits, or rejects
every suggestion, explicitly approves final marks and feedback, and exports
them for release.

A provisional mark recommendation is always visibly distinct from the
educator's confirmed mark.

## Stage 2: team moderation and calibration

Several markers work on one assessment. The stage adds calibration exercises,
moderation sampling, consistency signals across the cohort, and escalation
paths. It requires shared storage and identity, and so triggers new privacy
and governance decisions.

## Stage 3: institutional governance

Institutions control which providers and models may be used, prompt and policy
versions, retention and deletion, deployment, and tenancy. This stage requires
institutional validation and explicit governance agreements.

## Stage gates

Progression is not automatic:

- Stage 0 advances when real moderation use shows AI-assisted second reading
  is worth building on.
- Stage 1 advances when marking use demonstrates a need for coordination
  across markers.
- Stage 2 advances when an institution needs governance controls beyond what a
  single team can operate.

The project board expresses independently deliverable work for the current
agreed stage only. Later stages are context for decisions, not a backlog that
must eventually be completed.
