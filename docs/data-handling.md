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
| Source files | Submitted docx/pdf, rubric, original marks and comments | Personal data; confidential |
| Extracts | Text extracted from source files | Personal data; confidential |
| Pseudonym key | Mapping from pseudonyms such as `[STUDENT_A]` to real names and identifiers | Personal data; most sensitive |
| Approved anonymised text | Redacted extracts approved by the moderator | Treated as personal data while the key exists |
| AI readings | Suggestions, quotes, drafts, call metadata | Confidential; pseudonymous |
| Moderation record | Judgements, comparisons, and the approved export | Confidential; pseudonymous by default |
| Synthetic fixtures | Fictional rubric, submissions, and marks for tests | Not sensitive; committed |

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
- Redaction runs locally and uses consistent pseudonyms.
- The moderator reviews every redaction, can add or undo redactions, and
  approves each submission explicitly. Approval records who approved, when,
  and a hash of the approved text.
- Automated redaction can miss indirect identifiers, such as employers,
  repository or portfolio URLs, usernames in screenshots, and personal
  reflections. The moderator's review is the control for these, not a
  formality.

## Pseudonym key

The key is stored only in the workspace, in a separate file from the extracts
and readings. It is used only locally, to re-identify an export when the
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

Proposed default, for the maintainer to confirm:

- Keep the workspace only until the moderation report has been submitted and
  any query period set by the commissioning body has closed.
- Then delete the source files, extracts, AI readings, and pseudonym key.
- Keep only the exported moderation record the moderator is required to
  retain, stored pseudonymously wherever re-identification is not needed.
- Delete any cached AI readings with the workspace. The cache is never shared
  between workspaces.
- Provider-side retention is governed by the provider's terms (see above).

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
