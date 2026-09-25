# Stage 0 data handling

## Purpose

This note defines how Stage 0 handles real assessment material: where it lives,
what may leave the machine, and when it is deleted. It applies from the first
use of real material. The model data boundary in [`PRODUCT.md`](../PRODUCT.md)
takes precedence if the two ever disagree.

This note describes intended practice. It is not a claim of legal, regulatory,
or institutional compliance.

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
- Importing the whole cohort, for example to check a reported band
  distribution, requires a recorded decision.

## What may leave the machine

Only what the model data boundary in `PRODUCT.md` permits:

- approved anonymised submission text, sent only if its hash matches the
  moderator's approval record;
- the rubric's criteria and levels;
- the versioned prompt.

The pseudonym key, source files, document metadata, real names and
identifiers, the original marker's marks and comments, and the moderator's
judgements never leave the machine.

The local web interface binds to `127.0.0.1` only and is not reachable from
other devices.

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
- Exports are pseudonymous by default. A re-identified export requires an
  explicit request each time. It is labelled as containing personal data,
  stored only in the workspace unless the moderator moves it, and deleted
  with the workspace.

## Pseudonym key

The key maps each pseudonym to the real name and to any external identifiers,
such as Turnitin submission IDs or VLE user IDs. External identifiers link
directly to a student, so they are treated like names: they live only in the
key and never appear in anything sent to a model. They reappear only in a
re-identified export, for example when a moderation form needs them.

The key is stored only in the workspace, at `private/pseudonym-key.json`,
separate from the extracts and readings. The `private/` folder is readable
only by the moderator's user account (mode 700), and the key file only by
the moderator (mode 600).

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
  usage, and timestamp for each call.

The first adapter is the Anthropic API (see
[ADR 0003](decisions/0003-provider-boundary-and-spend-control.md)). Review the
provider's current terms before first real use, and again whenever they
change.

## API keys and spend

- The moderator's API key is read only from local configuration: an
  environment variable or a gitignored `.env` file. It is never logged,
  exported, or written into readings or audit records.
- Spend is bounded by:
  - a token and cost estimate the moderator confirms before each batch run;
  - a configurable limit per run, which halts processing when reached;
  - a monthly spending limit set in the provider's console as a backstop.
- Token usage is recorded with each AI reading.

## Why Stage 0 has no authentication

Stage 0 runs only on the moderator's machine, has no hosted endpoint, and uses
the moderator's own key. Anyone running the open-source code supplies their
own key and pays for their own use. There is nothing for another person to
sign in to, and no shared key to drain.

Authentication and server-side spend controls become necessary before any
hosted deployment. They are recorded in #23.

## Retention and deletion

Stage 0 retention rule:

- **Start the clock.** When a workspace is created, record the commissioning
  body's retention or query-period requirement in it. If none is given, use a
  default of 90 days after the moderation report is submitted.
- **Delete at the end.** When the report has been submitted and that period
  has closed, delete the whole workspace: source files, extracts, anonymised
  text, approvals, AI readings and cache, the pseudonym key, and any
  re-identified export.
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

The application should offer a single action that deletes a workspace, and
confirm what it removed.

## Incidents

If real material is committed, posted publicly, or sent outside the boundary:

1. Stop processing.
2. Remove the material from wherever it was exposed. For git history, rewrite
   it and treat the material as exposed regardless.
3. Record what happened, privately and outside the repository.
4. Tell the commissioning body where its terms require it.
5. Fix the safeguard that failed before resuming.
