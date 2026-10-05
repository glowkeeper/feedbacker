# Data handling

## Purpose

This note defines how Feedbacker handles real assessment material: where it lives,
what may leave the machine, and when it is deleted. It applies from the first
use of real material. The rules on what the AI may be sent, in [`PRODUCT.md`](../PRODUCT.md),
take precedence if the two ever disagree.

This note describes intended practice. It is not a claim of legal, regulatory,
or institutional compliance.

Feedbacker runs as a browser app served by a local Feedbacker proxy
([ADR 0004](decisions/0004-typescript-browser-core-and-local-proxy.md)). The
Python command line, kept as the reference implementation, follows the same
rules and uses the same workspace layout.
Where the browser app handles something differently, the difference is stated
beside the rule.

## Before using real material

Confirm with the body that commissioned the moderation that AI-assisted
moderation is acceptable, and that sharing anonymised extracts with a model
provider is compatible with any confidentiality or data-sharing terms. Record
the answer in the moderation workspace, not in the repository.

Moderation judgements remain the moderator's own. AI output is a second
reading, never a decision.

## Kinds of material

| Material | Examples | Sensitivity |
| --- | --- | --- |
| Source files | Original files and marked versions with feedback (e.g. Turnitin current views), usually as bulk downloads; rubric; moderation request | Personal data; confidential |
| Extracts | Text extracted from source files | Personal data; confidential |
| Assessment brief | The task set for the assessment; may name staff and give contact details | Confidential assessment material; staff personal data |
| Pseudonym key | Mapping from pseudonyms such as `[STUDENT_A]` to real names and identifiers | Personal data; most sensitive |
| Approved anonymised text | Redacted extracts approved by the moderator | Personal data (pseudonymised); confidential |
| AI readings | Suggestions, quotes, drafts, call records | Personal data (pseudonymised); confidential |
| Moderation record | Judgements, comparisons, and the pseudonymous export | Personal data (pseudonymised); confidential |
| Re-identified export | An export with real names restored, on explicit request | Personal data; confidential |
| Synthetic fixtures | Fictional rubric, submissions, and marks for tests | Not sensitive; committed |

Pseudonymised material is treated as personal data while the pseudonym key
exists, and in practice beyond that, because submissions can contain indirect
identifiers that redaction misses. Derived material, such as AI readings that
quote anonymised text, is classified at least as highly as its source.

## Where material lives

- All real material lives in a **moderation workspace**: a folder on the
  moderator's machine, **outside any git repository**. The default is
  `~/Feedbacker/workspaces/<moderation-name>/`, and it can be configured.
- The application refuses to open or create a workspace inside a git working
  tree.
  - In the browser app, this check is made by the local proxy, because a
    browser folder handle reveals neither the folder's path nor its parents.
    The proxy creates new workspaces, or registers existing ones such as
    those made by the command line, by path, and refuses any path inside a
    git working tree.
  - The app opens only folders the proxy has confirmed as registered. The
    proxy re-checks the registered path each time and refuses it if the path
    now resolves somewhere else, for example because a folder above it was
    replaced by a link.
  - The app must also prove the folder it was given *is* the registered one.
    The proxy writes a one-time value into the registered folder, and the app
    must read it back through the folder the moderator picked, then deletes
    it. A copy of a workspace doesn't contain the value, so it is refused even
    while the original is still in place. The app also shows the registered
    path whenever a workspace is opened.
- In the browser app, the browser keeps only a handle for reopening the
  workspace folder, never any records. Deleting the workspace still means
  deleting the folder.
- The browser app is supported in Chromium-based browsers (Chrome, Edge),
  which provide the folder access it needs.
- As a second safeguard, `.gitignore` excludes common workspace, key, and
  export paths in case material is ever placed in the repository by mistake.
- Only synthetic fixtures are committed. Real material, including anonymised
  extracts, is never committed, attached to issues or pull requests, or used as
  a test fixture.

## Bulk downloads

Bulk downloads contain the whole class, not just the sample. Examples are a
zip of every student's original file, or of every Turnitin current view. A
sample may be spread across several downloads, for example a main submission
point and a late one, split zip parts, or single files. Each sampled
identifier is matched across all of them, and an identifier found in more than
one place is reported, never guessed.

- Only the sampled submissions, selected by the identifiers in the moderation
  request, are imported. Other students' files are never opened, and their
  names, identifiers, and marks are not recorded.
- Each selected file is stored in the workspace under its pseudonymous ID
  (`sources/originals/`, `sources/marked/`). Its real file name goes only into
  the pseudonym key.
- The original marking (grade, rubric levels, general and inline comments) is
  parsed locally from the marked views. Comment text is anonymised with the
  same tokens as the submissions before it is stored in `marking/`. Replaced
  records are kept in `marking/history/` so corrections are recorded. Marking
  is never sent to a model.
- To understand an unfamiliar file or archive, use `feedbacker inspect`. It
  reports structure only, with archive file names shown as shapes. Never share
  real files, or paste their content, into issues, pull requests, or AI chat
  sessions.
- File names inside the archive may contain names or identifiers. They are
  recorded only in the pseudonym key.
- Bulk downloads are not copied into the workspace; only the selected files
  are stored there, and only their hashes and the downloads' hashes are
  recorded. Delete the downloads from wherever you saved them once importing
  is done.
- In a moderation, importing the whole cohort, for example to check a
  reported band distribution, requires a recorded decision.

### A marking cohort

In a marking workspace the educator marks the whole cohort, so every
submission in the bulk download is imported, not a sample (maintainer
decision, 2026-10-04).

- The platform names each file with the student's ID and name: Turnitin's
  `<ID> - <NAME> - <file>`, or Canvas's
  `<name>_[late_]<user ID>_<attachment ID>_<file>`. Feedbacker reads the ID
  from the name. A file whose name doesn't follow either form is listed (by its
  name's shape, never its name) and not imported, and so is an ID found in
  more than one file: nothing is guessed. The platform's report on the
  download (a `.txt` file) is not opened.
- Each submission gets a submission ID and pseudonym, recorded in
  `cohort.json`, which holds nothing else. The real ID and the file name go
  only into the pseudonym key, so feedback can be matched back to each student
  for release. The Submissions screen shows each real ID beside its pseudonym,
  as a moderation's Request screen does (see [Pseudonym key](#pseudonym-key)). Students' names are taken from Turnitin-style names for
  anonymisation; Canvas runs the name's parts together, so add a name to the
  anonymisation rules if it isn't redacted.
- Importing again adds the submissions that are new (late ones, for example),
  and everyone keeps their pseudonym. A submission already imported is replaced
  only when the educator asks.
- Each file is stored and extracted as an original is, and then anonymised,
  reviewed and approved in the same way. The educator gives the approval.

## What may leave the machine

Only what `PRODUCT.md`'s rules on what the AI may be sent permit:

- approved anonymised submission text, sent only if its hash matches the
  educator's approval;
- the approved anonymised assessment brief, under the same rule, with staff
  names and contact details redacted (add staff names on **Anonymisation**,
  under **Add to the rules**; emails, URLs, and phone numbers are caught
  automatically);
- the rubric's criteria and levels;
- Feedbacker's versioned instructions to the AI;
- **when drafting feedback only** ([ADR 0006](decisions/0006-what-the-ai-may-be-sent-when-drafting-feedback.md)):
  the educator's own final marks and comments for that one submission, and
  their feedback guide for the assessment, anonymised and approved like a
  submission.

The pseudonym key, source files, document metadata, real names and
identifiers, and any other student's material never leave the machine. Nor do
the original marker's marks and comments, or the moderator's judgements, in
moderation. A reading of a submission, which suggests levels, is never sent
anyone's marks or comments, so it stays independent.

The local web interface binds to `127.0.0.1` only and is not reachable from
other devices.

In the browser app, the **local Feedbacker proxy is the only way anything
leaves the machine**:

- The app's Content Security Policy allows network connections only to the
  proxy, and loads no third-party scripts.
- The proxy binds to `127.0.0.1` only, checks the `Origin` and `Host` headers,
  and requires a per-session token that it gives the app at start-up.
- It forwards only requests that carry the fields those rules permit, and the
  educator's marks, comments and guide only in a drafting request. It also runs leak checks for identifier patterns and refuses
  anything that fails them. These checks are a backstop; the app's approval
  gate is the control.

## Anonymisation

- Text is extracted locally, and document metadata (docx author and
  properties, pdf info) is discarded, never carried into extracts.
- Redaction runs locally and uses consistent pseudonyms: `[STUDENT_A]` for a
  sampled student, and `[PERSON_n]`, `[ORG_n]`, `[ID_n]`, `[EMAIL_n]`,
  `[URL_n]`, `[PHONE_n]` for other values. The values behind the tokens are
  kept only in the pseudonym key.
- Students' names come from the pseudonym key, including names taken from
  Turnitin-style file names (`<ID> - <NAME> - ...`). The moderator's added
  names, organisations, extra values, and false-positive exceptions are kept in
  `anonymisation/rules.json`, which is private (mode 600).
- The moderator reviews every redaction, can add or undo redactions, and
  approves each submission explicitly. Approval records who approved, when,
  and a hash of the approved text. Any change to the anonymised text clears
  its approval.
- Every model call obtains text only through the approval gate
  (`feedbacker_core.boundary`), which refuses anything that is not exactly the
  approved text.
- Automated redaction can miss indirect identifiers, such as employers,
  repository or portfolio URLs, usernames in screenshots, and personal
  reflections. The moderator's review is the control for these, not a
  formality.

## Exports

- Exports are written into the workspace's `exports/` folder by default and
  are named `<name>.feedbacker-export.<ext>`, a pattern that `.gitignore` also
  blocks.
- Saving an export elsewhere is an explicit choice. The application refuses
  any destination inside a git working tree.
  - The browser app can't check a save destination, so it writes exports only
    into the workspace's `exports/` folder. Moving an export elsewhere is the
    moderator's own action, outside the app's safeguards.
- The moderator approves the moderation record before anything is exported,
  and an export is refused if the workspace has changed since the approval.
- Anonymisation is re-checked before anything is sent and before anything is
  exported. The pseudonym key and the rules can grow after a text was
  anonymised (a later import can add a name; the moderator can add a rule),
  so a text the current key and rules would still redact is never sent to a
  model, and the record can't be approved or exported while any text in it
  would still be redacted. "Anonymise now" brings the submissions, the brief
  and every stored comment up to date.
- The structured record (JSON) never contains the extracted original text:
  each submission carries only its approved anonymised text, the redaction
  offsets, and its approval. Pseudonyms stand in for names and external
  identifiers throughout.
- Exports are pseudonymous by default. A re-identified export requires an
  explicit request each time. It is labelled as containing personal data,
  stored only in the workspace unless the moderator moves it, and deleted
  with the workspace.
  - It restores only the sampled students' external identifiers (such as
    Turnitin submission IDs), in place of their pseudonyms: never names, and
    never any other redacted value, which stays as its token (maintainer
    decision, 2026-09-27).
  - It is a copy of the readable summary, as Markdown and as a Word
    document. The structured record always stays pseudonymous.

## Pseudonym key

The key maps each pseudonym to the real name and to any external identifiers,
such as Turnitin submission IDs or VLE user IDs, for a moderation's sample or a
marking cohort alike. External identifiers link directly to a student, so they
are treated like names: they live only in the key and never appear in anything
sent to a model. They reappear in three places only, all on the user's own
machine:

- **the Request screen**, which shows each sampled submission's external
  identifier beside its pseudonym (maintainer decision, 2026-10-02). It
  is where the identifiers are entered, and where the moderator matches
  pseudonyms to the moderation form and the marking platform;
- **a marking workspace's Submissions screen**, which shows each submission's
  external identifier beside its pseudonym in the same way (maintainer
  decision, 2026-10-04), so the educator can match pseudonyms to the students
  in the marking platform. Every other screen stays pseudonymous, and real
  names appear only when asked for on Anonymisation ("Show the real values");
- **a re-identified export**, for example when a moderation form needs them.

Showing them on screen means anyone who can see your screen, for example
during a screen share, can see them. Close the Request or Submissions screen
before sharing your screen.

The key is stored only in the workspace, at `private/pseudonym-key.json`,
separate from the extracts and readings. The `private/` folder is readable
only by the moderator's user account (mode 700), and the key file only by
the moderator (mode 600).

A browser can't set file permissions. For the browser app, the local proxy
sets them when it creates or registers a workspace. It confirms the workspace
whenever the app opens it and after every private write:
- it refuses a workspace whose own folder is no longer readable only by the
  moderator;
- it restores 700 for every folder inside and 600 for every file, because
  what the browser writes gets the system defaults. That is safe inside a
  700 folder, but the stricter modes are restored anyway.

The key is append-only. Once assigned, a pseudonym always refers to the same
identifier and is never reused, even if the sample changes, so no record can
end up pointing at the wrong student. It is used only locally, to re-identify an export when the
moderator explicitly asks for that.

## Model provider requirements

The provider must:

- exclude API inputs and outputs from model training by default;
- retain data only for a limited period, for abuse monitoring or as its terms
  state;
- be called only through the provider interface, which enforces the approval
  check and records the model, provider, prompt version, input hash, token
  usage, and timestamp for each call. In the browser app, the interface
  reaches the provider through the local proxy.

The first adapter is the Anthropic API (see
[ADR 0003](decisions/0003-provider-boundary-and-spend-control.md)). Review the
provider's current terms before first real use, and again whenever they
change.

**Prompt caching.** Nothing more is sent, but the provider may keep part
of each request in its prompt cache for five minutes, so later readings in a
run can reuse it at a lower price. That part is the prefix every reading
shares: the instructions, the source rubric and the approved anonymised brief.
The submission comes after the cache marker and is not part of the cached
prefix.

**Batches.** When the moderator sends a run as one batch, the same
approved requests are sent, all at once, and the provider processes them
within a day. It keeps the results for **29 days** after the batch is
created, where the proxy can collect them. The proxy records the batches it
sent (`~/Feedbacker/proxy/batches.json`, mode 600) with request hashes,
models and amounts, but no text, and only those batches can be checked,
collected or cancelled. The workspace records what it sent
(`readings/batches/`), and the batch's results become readings only if the
approved texts, rubric, brief and approvals are still exactly those sent.

**Reused readings.** A completed reading is kept in the workspace
(`readings/reuse/`), and reused, with nothing sent, only for the same
submission when everything that would be sent is identical. It is never used
for another submission, and it is deleted with the workspace. See
[ADR 0005](decisions/0005-model-cost-reduction.md).

## API keys and spend

- The moderator's API key is read only from local configuration: an
  environment variable or a gitignored `.env` file. It is never logged,
  exported, or written into readings or audit records.
  - In the browser app, the key belongs to the local proxy's configuration
    and **never enters the browser**.
- The proxy keeps an **egress log** of every request it forwards or refuses:
  the time, model, request hash, token usage, cost and outcome. The log holds
  no submission text and no names; the text stays in the workspace's call
  records. It is `~/Feedbacker/proxy/egress.jsonl` (mode 600), next to the
  proxy's workspace registry (`registry.json`, mode 600) and its record of
  the batches it sent (`batches.json`, mode 600), in a folder only the
  moderator can read (mode 700).
- Spend is bounded by:
  - a token and cost estimate the moderator confirms before each batch run;
  - a configurable limit per run, which halts processing when reached (in the
    browser app, the proxy enforces it);
  - a monthly spending limit set in the provider's console as a backstop.
- Token usage is recorded with each AI reading.

## AI readings

- A reading sends one request per submission: the versioned instructions, the
  rubric, the approved brief, and the approved anonymised submission. The brief
  is included unless the educator unticks **Include the approved brief**, which
  is recorded in the run log. Immediately before each request, it is rebuilt from
  the current approved material and must equal the request the moderator
  confirmed; otherwise nothing is sent for that submission. The original
  marker's marks and comments are never sent.
- In a marking workspace the same request asks for the AI's **proposals**,
  with instructions written for the educator (`marking-v2`): a level for each
  criterion, with reasons and quoted evidence, and a short draft comment for
  the student, which the educator may adapt (a comment adapted from it is
  recorded as derived from the AI). It is sent
  exactly what a moderation's reading is sent, and **never** the educator's
  marks or comments (ADR 0006). The provisional mark is worked out in
  Feedbacker from the proposed levels and the rubric's weights; the AI never
  gives a mark.
- The educator's levels, marks, comments and overall mark are kept in
  `judgements/` (private). Their comments are anonymised with the
  submissions' tokens when they are saved. When a submission is marked blind,
  its proposals and provisional mark are not even loaded until the educator
  has recorded a level for every criterion.
- The default AI model is Claude Sonnet 5. If it declines on safety grounds, the
  same approved request is sent once to Claude Opus 5, and both calls are
  recorded.
- Readings are stored as AI suggestions in `readings/`. Every call, including
  refused, truncated, and failed ones, leaves its call record in
  `readings/calls/` and its raw response in `readings/raw/`. Each run's log
  (models, token usage, costs, outcomes) is in `readings/runs/`. All are private (mode 600) and are deleted
  with the workspace.
- Every run shows a worst-case cost estimate (maximum output, plus a possible
  fallback call) that the moderator confirms, and it stops before exceeding its
  spend limit (default $5).

## Drafting feedback

*Decided in [ADR 0006](decisions/0006-what-the-ai-may-be-sent-when-drafting-feedback.md);
built in marking and feedback.*

- A draft is requested for one submission at a time. It is sent what a reading
  is sent, plus the educator's own final level, mark and comment for each
  criterion, their overall mark and comment, and, if they have written one,
  their feedback guide for the assessment. It is never sent the AI's own
  earlier suggestions, or anything about another student.
- The educator's comments and guide are anonymised with the same rules and
  pseudonym key as the submissions when they are saved. Before a draft is
  requested, the educator sees exactly what will be sent, and asking for the
  draft approves it; the request must match that approval when it is sent, or
  nothing is.
- Each draft records what it was drafted from, so changing a mark marks that
  draft out of date. Drafts are stored with the workspace's other records, and
  deleted with it.
- **As built:** drafting is on the **Feedback** step of a marking workspace,
  for one submission or a batch across the cohort, with the instructions
  `feedback-v3`. The marking is sent as its own block, after the submission,
  and the plan shows it exactly as it will be sent; confirming approves it,
  and each request is rebuilt just before sending and must equal what was
  confirmed. The proxy accepts that block only in a drafting request. Only
  criteria whose marks are current are drafted, and the overall summary only
  once the overall mark is current.
- **The feedback guide** is written by the educator for the assessment, on
  the Feedback step. It is anonymised when it is saved (only the anonymised
  text is kept, in `feedback/guide.json`, private), each save is a new
  version, and it is sent only once the educator approves exactly that
  text. It is sent with every drafting request, as its own block before the
  submission, and each draft records the guide version it used; a batch
  sends the same guide and instructions for every submission. It is the
  only thing shared across submissions' requests: no other student's
  material is ever sent.
- Drafting a criterion again after a praise flag may add a line to the
  marking block naming the words to avoid. They come from Feedbacker's own
  word lists, never from the student's text, and the plan shows them as
  they will be sent.
- The cohort view (feedback side by side by level, with outliers flagged)
  is worked out on this computer; nothing is sent.
- **Approving and exporting marking:** each submission is approved on exactly
  what its student will receive; the approval (`feedback/<id>--approval.json`)
  records a digest of it, so any change clears it. The standard exports (each
  student's feedback, one file of them all, a marks table, and the structured
  record) are pseudonymous. A re-identified copy of the feedback and marks
  table, made only when the educator confirms it each time, restores each
  student's platform ID in place of their pseudonym, and nothing else, as in
  moderation; the record always stays pseudonymous. Feedback still containing
  an anonymised value (a token) is flagged before it can be approved.
- Drafts are in `feedback/drafts/`, and the educator's feedback in
  `feedback/` (anonymised, as their comments are). Feedback adapted from a
  draft is recorded as derived from the AI however much it is changed. Every
  call's record and raw response are in `feedback/calls/` and `feedback/raw/`,
  each run's log in `feedback/runs/`, and replaced drafts and feedback in
  `feedback/history/`; all are private, and deleted with the workspace.
- Feedback is checked against its mark in Feedbacker, on this computer: no
  request is made. A flag the educator accepts is kept, with their reason, on
  that feedback record. The workspace's praise words are in
  `feedback/praise.json`.

## Why there is no authentication

Feedbacker runs only on the educator's machine, has no hosted endpoint, and uses
the educator's own key. The local proxy is reachable only from the same
machine and only with its per-session token. Anyone running the open-source code supplies their
own key and pays for their own use. There is nothing for another person to
sign in to, and no shared key to drain.

Authentication and server-side spend controls become necessary before any
hosted deployment, and will need their own recorded decision.

## Retention and deletion

The retention rule for a moderation:

- **Start the clock.** When a workspace is created, record the commissioning
  body's retention or query-period requirement in it. If none is given, use a
  default of 90 days after the moderation report is submitted.
- **Delete at the end.** When the report has been submitted and that period
  has closed, delete the whole workspace: source files, extracts, anonymised
  text, approvals, AI readings and cache, the pseudonym key, and any
  re-identified export. The app does this in one action, only once the
  workspace's name is typed, and after listing the exports (with their full
  paths) so the moderator can keep what is required, and confirm that they
  have: it deletes the folder and everything in it, the
  proxy forgets its registration (so no path to it is kept), and the browser
  forgets the folder. The downloads the moderator made are theirs to delete.
- **Keep only the required record.** Retain only the moderation record the
  moderator is required to keep, in pseudonymous form unless the
  commissioning body requires names. Keep it outside the repository, for no
  longer than that body requires.
- **Never share the cache.** Cached AI readings are never shared between
  workspaces.
- **Remind the moderator.** The application shows when a workspace passes its
  retention date and prompts for deletion. It never deletes without
  confirmation.
- **Provider retention** is governed by the provider's terms (see above).
- **The proxy's egress log** holds no assessment content. Keep it only while
  spend needs checking, and no longer than the longest retention period of
  the workspaces it covers. The proxy removes entries after 90 days by
  default (`--egress-retention-days`).

The application should offer a single action that deletes a workspace, and
confirm what it removed. The browser app deletes the whole workspace folder in
one action, after the moderator types the workspace's name.

## Incidents

If real material is committed, posted publicly, or sent outside the boundary:

1. Stop processing.
2. Remove the material from wherever it was exposed. For git history, rewrite
   it and treat the material as exposed regardless.
3. Record what happened, privately and outside the repository.
4. Tell the commissioning body where its terms require it.
5. Fix the safeguard that failed before resuming.
