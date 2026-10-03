# Product direction

## Status

This document records Feedbacker's product direction. `docs/PROJECT.md`
defines what Feedbacker is and must never do; this document defines what is
built, in what order, and the evidence required before moving on.

## Governing principle

Build the smallest useful thing well. What comes after it is a direction, not
a commitment, until its outcome, its boundaries, and the evidence needed before
moving on have been agreed.

Each part of the direction below records:

- the outcome it delivers;
- why it is valuable on its own;
- what is explicitly inside and outside its scope;
- what must be shown before moving on;
- any product, privacy, governance, or operational constraints it introduces.

## Feedbacker's purpose, and why this generation began with moderation

Feedbacker began years ago as a tool to help markers write meaningful,
consistent feedback for marked coursework. That earlier generation is preserved
on the `legacy/v1-feedback-generator` branch, and it never included moderation.
Marking and feedback remain Feedbacker's purpose.

This generation rebuilds Feedbacker as a workflow, governance and assessment
layer around AI (`docs/PROJECT.md`). Its first use case is moderation, only
because that was the maintainer's first real need for it: they were asked to
moderate some marking. Moderation was a sound place to start:

- **A human already owns every mark.** The AI can only offer a second reading
  for the moderator to check, and the moderator's own judgement is the
  reference against which AI assistance is measured.
- **The work was real.** A real moderation doubled as the test of the
  product.
- **It built what marking needs.** Extraction, anonymisation behind an
  approval gate, the local proxy, provenance and the review interface all
  carry over to marking.

Marking and feedback, now being built, brings this generation back to
Feedbacker's original purpose.

## Distribution

Decided by the maintainer on 2026-09-26 (#40, [ADR 0004](docs/decisions/0004-typescript-browser-core-and-local-proxy.md)):

- **A personal tool first.** An educator can use Feedbacker alone, in their
  browser, without installing a Python toolchain or depending on anyone else's
  service.
- **The institutional route stays open.** An institution can serve the same
  app and run the same Feedbacker proxy with its own key and model choices.
  The maintainer doesn't have to operate anything for that to work.
- **Never a hosted service holding assessment data.** Real material lives only
  on the educator's machine or the institution's own infrastructure. Beyond
  that goes only what the model data boundary below permits, and only
  through a Feedbacker proxy the educator or institution controls.

## Moderation

**Status: built.** It was used on a real moderation and evaluated, as recorded
in [`docs/moderation-evaluation.md`](docs/moderation-evaluation.md) (#10,
2026-09-29). Its interface was then simplified (#102).

### Outcome

A moderator working alone on their own machine takes a moderation request and
a small sample of typed, already-marked submissions. Two bulk downloads cover
the whole class:

- the **original files**, which give the student's text;
- the **marked versions**, for example Turnitin "current view" PDFs, which give
  the grade, rubric levels, and comments. Their report pages are images, so
  they cannot supply the student's text.

They:

1. import the sampled submissions and their original marking, and anonymise
   them locally;
2. review each submission against the rubric alongside the original marking and
   an AI reading that cites evidence, recording their own judgement and a
   verdict on the marking;
3. export a moderation record they have approved.

### Decisions

- **One user, working locally.** The moderator is the only user. There are no
  accounts, hosted server, database, or multi-user features.
  - The app runs in the moderator's browser, served by a local Feedbacker
    proxy that also holds the API key.
  - The workspace is a folder of files on the moderator's machine or a
    university share.
- **Typed documents only.** Submissions are docx or pdf. There is no OCR or
  handwriting support.
- **Two files per submission, and only the sample.** The original file gives
  the text and the marked version gives the marking. From each bulk download,
  only the sampled submissions are imported. Other students' files are never
  opened.
- **Normalise before inference.** Text is extracted by code, and the rubric is
  imported into a structured representation, before any model is involved.
- **Anonymise before any model call.**
  - Extracts are redacted locally.
  - The moderator reviews the redacted text and approves it before anything
    is sent to a model.
  - The key linking pseudonyms to real names never leaves the machine.
  - Pseudonymised text is still treated as personal data while that key
    exists.
- **Open review by default, blind marking as an option.**
  - Moderation is normally open: the moderator reviews the original marks and
    comments, so they are visible throughout. Feedbacker supports that process
    as it is.
  - The moderator may choose **blind marking** for a submission. The original
    marks and the AI reading then stay hidden until the moderator has recorded
    their own judgement. After the reveal they may revise, and both the first
    and revised judgements are kept.
  - Every judgement records its mode, so the record and the evaluation always
    show what the moderator had seen.
  - AI readings are prepared in advance, so they are available immediately.
- **Original marking is imported, never inferred.** Marks, rubric levels,
  summary comments, and inline comments are imported from the marker's
  feedback, with manual entry as a fallback. The marker's labels and scores are
  kept exactly as written, and a mark that cannot be mapped to a rubric level
  stays unmapped rather than guessed.
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
- **The brief is part of the moderation.** The assessment brief is imported,
  redacted, and approved like a submission. The AI reading sees the approved
  brief, and the moderator sees it alongside each submission.
- **Real material stays out of the repository.** Tests use committed synthetic
  fixtures.

### Excluded

Marking workflows for release to students, multiple markers, calibration,
institutional policy controls, hosted deployment, and form templates for
specific institutions.

### What had to be shown before moving on

The maintainer was to use it for a real moderation, and record an evaluation of
whether it saved time without compromising their judgement, and whether the AI
reading was useful, misleading, or neutral. Blind-marked judgements, with their
first and revised entries, provide the cleanest evidence for that evaluation.
This was done on 2026-09-29.

## Marking and feedback

**Status: being built, from 2026-10-03 (#105).**

### Outcome

An educator marks their own cohort of typed submissions against a rubric, and
Feedbacker helps them write meaningful, consistent feedback for it.

- **Proposals.** For each criterion, Feedbacker proposes a level, with evidence
  quoted from the submission, and calculates a provisional mark from those
  levels. The educator sees the proposals while they mark (open), or only
  after recording their own levels (blind), as in moderation's review. A
  provisional mark is calculated in code, never stated by a model, and is
  always visibly distinct from the educator's own mark.
- **The educator's marks.** The educator enters their own mark and comment
  for each criterion, and an overall mark and comment, in Feedbacker.
- **Feedback from the educator's marks.** Feedbacker drafts feedback for each
  criterion, and overall, from the educator's marks and comments rather than
  from its own proposal. If the educator changes a criterion's mark, that
  criterion's feedback is flagged so it can be drafted again.
- **Consistent feedback.**
  - It matches the mark: work awarded 58% is never called "excellent".
  - It always says what to do next time.
  - Similar work at a similar level gets similar feedback across the cohort.
- **Approval and release.** The educator edits and approves every mark and
  every piece of feedback, then exports the approved feedback as text to paste
  into Turnitin, Canvas or another platform.

### Value

Helping markers write meaningful, consistent feedback for marked coursework is
Feedbacker's original purpose. A single educator marks a full cohort faster,
with feedback that matches their marks and that they have written or approved,
while every mark stays theirs.

It reuses what moderation built:
- extraction;
- anonymisation and the approval gate;
- the proxy, with its batches and caching;
- rubric and brief import;
- judgements with marks within a level;
- open and blind review;
- record approval;
- local re-identification.

### Scope

- **In scope:**
  - one educator, working locally;
  - a whole cohort;
  - proposed levels and a provisional mark, seen openly or blind;
  - the educator's marks and comments, entered in Feedbacker;
  - feedback drafted from them, and drafted again when a mark changes;
  - checks, in code, that feedback matches its mark and says what to do next
    time;
  - consistency across the cohort;
  - explicit approval of each mark and piece of feedback;
  - export as text, to paste into the institution's own systems.
- **Excluded:**
  - multiple markers, and calibration (where calibration sits is decided in
    #116);
  - hosted deployment or accounts;
  - direct integration with a virtual learning environment, Turnitin or a
    student records system. Copy and paste is the start; integration may come
    later;
  - release of marks or feedback without approval;
  - a model setting or stating a mark.

### What must be shown before moving on

The maintainer marks a real cohort with it and records an evaluation covering:

- time saved;
- how often proposals and drafts were edited or rejected;
- whether feedback matched the marks: how often the checks raised a flag, and
  how often a flag was overridden, and why;
- confirmation that no mark or feedback was released without explicit approval;
- a demonstrated need to coordinate with other markers.

## Team marking and calibration

**Status: a direction only.**

### Outcome

*Where calibration sits is being decided in #116. A calibration exercise run
with files (a pack sent out, returns collected) may need no shared storage, and
so might come before the rest of this.*

Several markers work on one assessment. This adds calibration exercises,
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

This raises new privacy, security, and governance decisions, which must be
recorded before any of the work becomes Ready.

### What must be shown before moving on

A team has used it on a real assessment, and an institution needs governance
controls beyond what a single team can operate.

## Institutional governance

**Status: a direction only.**

### Outcome

Institutions control which providers and models may be used, prompt and
policy versions, retention and deletion, deployment, and tenancy.

### Value

Institutions can adopt Feedbacker under their own responsible-AI and
data-protection policies.

### Scope

- **In scope:** institutional validation and explicit governance agreements.
- **Always excluded, whatever is built:** autonomous grading and unsupported
  claims of compliance.

### What must be shown before moving on

What comes after this is defined only once institutional use provides evidence
for it.

## Model data boundary

This boundary applies to every call to a model. It can be
widened only by a recorded decision in `docs/decisions/`, and requirement 1
cannot be removed.

1. **Only approved, anonymised text is sent.** Text may be sent to a model
   provider only after it has been anonymised locally and approved by the
   educator. Its hash must match the approval record, and the provider
   interface refuses anything else.
2. **What a model may receive.** By default, only:
   - the approved anonymised text of the one submission being read;
   - the approved anonymised assessment brief, with staff names and contact
     details redacted (maintainer decision, 2026-09-25);
   - the rubric's criteria and levels;
   - the versioned prompt.

   Anything more needs its own recorded decision, for a particular kind of call.
   The first proposed is drafting feedback from the educator's own marks and comments,
   which the ADR from #107 is to decide. Until that ADR is accepted, nothing beyond
   this list is sent.
3. **What a model never receives:**
   - original files or their metadata;
   - the pseudonym key;
   - real names or identifiers;
   - another student's material.
4. **A reading of a submission stays independent.** When a model reads a
   submission against the rubric (an AI reading in moderation, or proposed
   levels in marking), it never receives anyone's marks or comments on it: not
   the original marker's, not the moderator's, and not the educator's.
5. **Calls go through one boundary.** Every call passes through the provider
   interface and then the Feedbacker proxy, to a provider whose API terms
   exclude training on inputs. Each call records the model, provider, prompt
   version, input hash, token usage, and timestamp.
6. **Local use relies on the educator's own key.**
   - The key is held only in the local proxy's configuration, never in the
     browser.
   - Spending is bounded by a cost estimate the educator confirms, a limit per
     run that the proxy enforces, and a limit set with the provider.

## Moving on

Moving from one part of the direction to the next is not automatic:

- Moderation led on to marking and feedback once real moderation use showed
  that AI-assisted second reading is worth building on.
- Marking and feedback leads on to team marking when marking use shows a need
  to coordinate across markers.
- Team marking leads on to institutional governance when an institution needs
  governance controls beyond what a single team can operate.

The project board holds independently deliverable work for what is being built
now. Later directions are context for decisions, not a list of work that must
eventually be done.
