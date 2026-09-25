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
- **Model transmission is bounded.** What may and may not be sent to a model
  is defined in the model data boundary below.
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

### Outcome

An educator marks their own cohort against a rubric. Feedbacker proposes
evidence, observations, and levels for each criterion, a provisional mark
recommendation, and draft feedback. The educator accepts, edits, or rejects
every suggestion, explicitly approves final marks and feedback, and exports
them for release.

A provisional mark recommendation is always visibly distinct from the
educator's confirmed mark.

### Value

A single educator marks a full cohort faster and more consistently, with
feedback they have written or approved, while every mark stays theirs. It
reuses the Stage 0 pipeline: extraction, anonymisation, AI reading, and
provenance.

### Scope

- **In scope:** one educator; local-first operation; whole-cohort marking;
  explicit approval of each mark and item of feedback; export for release
  through existing institutional systems.
- **Excluded:** multiple markers; hosted deployment or accounts; direct
  integration with a virtual learning environment or student records system;
  release of marks or feedback without approval.

### Stage gate

Stage 1 advances when the maintainer has marked a real cohort with it and
recorded an evaluation covering:

- time saved;
- how often suggestions were edited or rejected;
- confirmation that no mark or feedback was released without explicit approval;
- a demonstrated need to coordinate with other markers.

## Stage 2: team moderation and calibration

### Outcome

Several markers work on one assessment. The stage adds calibration exercises,
moderation sampling, consistency signals across the cohort, and escalation
paths.

### Value

Assessment teams can see and resolve differences in interpretation between
markers before marks are released, rather than after.

### Scope

- **In scope:** shared storage; verified accounts and server-side spend
  controls (#23); roles for markers and moderators; defined retention and
  deletion.
- **Excluded:** institution-wide policy administration; multiple
  institutions on one deployment (multi-tenancy).

This stage triggers new privacy, security, and governance decisions, which
must be recorded before any work on it becomes Ready.

### Stage gate

Stage 2 advances when a team has used it on a real assessment and an
institution needs governance controls beyond what a single team can operate.

## Stage 3: institutional governance

### Outcome

Institutions control which providers and models may be used, prompt and
policy versions, retention and deletion, deployment, and tenancy.

### Value

Institutions can adopt Feedbacker under their own responsible-AI and
data-protection policies.

### Scope

- **In scope:** institutional validation and explicit governance agreements.
- **Always excluded, at every stage:** autonomous grading and unsupported
  claims of compliance.

### Stage gate

Further progression is defined only once institutional use provides evidence
for it.

## Model data boundary

This boundary applies at every stage. It can be widened only by a recorded
decision in `docs/decisions/`, and requirement 1 cannot be removed.

1. **Only approved, anonymised text is sent.** Text may be sent to a model
   provider only after it has been anonymised locally and approved by the
   educator. Its hash must match the approval record, and the provider
   interface refuses anything else.
2. **In Stage 0, a model may receive only:**
   - approved anonymised submission text;
   - the rubric's criteria and levels;
   - the versioned prompt.
3. **A model never receives:**
   - original files or their metadata;
   - the pseudonym key;
   - real names or identifiers;
   - the original marker's marks and comments;
   - the moderator's judgements.
4. **Calls go through one boundary.** Every call passes through the provider
   interface, to a provider whose API terms exclude training on inputs. Each
   call records the model, provider, prompt version, input hash, token usage,
   and timestamp.
5. **Stage 0 uses the moderator's own key.** The key is held in local
   configuration, and spending is bounded by a cost estimate the moderator
   confirms, a limit per run, and a limit set with the provider.

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
