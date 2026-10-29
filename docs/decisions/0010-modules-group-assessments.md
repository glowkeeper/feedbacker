# 0010: Modules group assessments, and hold once what they share

- **Status:** Accepted (maintainer decision, 2026-10-27)
- **Date:** 2026-10-27
- **Amends:** 0008 (where workspaces are kept and how they are made, listed and deleted, not what a workspace holds or how it is checked)

## Context

One workspace is one moderation (or one marking) of one assessment. A module with two assessments is therefore two workspaces that share nothing: the brief, the anonymisation rules (the real names and other values to redact) and the module's context are entered twice, a student sampled in both is a different pseudonym in each, and nothing shows the module as a whole.

A moderation request document is itself a module's: one table lists every assessment's cohort, with each assessment's weighting.

## Decision

- **A module is a workspace of its own kind, with its assessments in folders inside it.** It is made by name in the workspaces folder, like any workspace, with the type `module`; it is registered with the proxy and checked in the same way (outside git, permissions, an identity check when opened).
  - Each assessment is an ordinary marking or moderation workspace, made by name inside the module's folder (`<workspaces folder>/<module>/<assessment>`), registered with the proxy in its own right. Its manifest names the module it is in.
  - The proxy refuses an assessment in a folder that is not a registered module, a module inside a module, and an assessment named as one of the module's own files or folders (`private`, `sources`, `anonymisation`, `exports`, and anything ending `.json`).
  - **A workspace made before this still works, as a module of one.** It has no module; nothing is moved, rewritten or migrated.
- **What the module holds, once:**
  - *The anonymisation rules.* Always shared: a real name to redact is entered once and applies in every assessment.
  - *The pseudonym key, only if the module was made to share it.* This is chosen when the module is made and never changed, because changing it later would mean merging or splitting keys that records already point into. Off by default.
  - *The module's context* (the programme and module).
  - *The request document, as an anonymous cohort,* read once: every assessment's rows with their marks and weighting, the grade bands, and which rows are one student. The cohort holds no name and no ID. "Which rows are one student" is kept as groups of row numbers, so a module can follow a student without saying who they are.
  - *The brief, whole.* An assessment starts with the module's brief, taken when it is opened (one that has a brief is left as it is, and taking it again or importing another stays possible), and the educator chooses its own section of it (the section whose heading names the assessment is suggested, never chosen for them); only that section is anonymised, approved and sent, as before.
- **What stays in each assessment:** everything that decides what may leave the machine or what is recorded: the approvals, the anonymised text, the rubric, the sample, the downloads, the readings, the judgements and verdicts, and the record. The approval gate, the egress rules and the checks are unchanged, because an assessment still sees one workspace: it reads and writes the shared files through its module, and nothing else.
- **Only the sampled students' names and IDs go into a key, as before.** So the module cannot keep the whole cohort's names. It reads the request document once for its anonymous cohort; an assessment reads the same file again to tick its sample, and is checked against the module's record by the document's hash.
- **The shared key and its trade-off.** With a shared key, a student has one pseudonym in every assessment, so the module can show a student throughout and a re-identified copy is consistent. But the AI is then sent text in which the same pseudonym recurs across assessments, so a student's work can be recognised as one person's across them, and one private file links the real people for the whole module. The screen says this where the choice is made. With separate keys, a pseudonym is the same student only within one assessment.
  - A student's platform ID and the names of their files differ between assessments (the marking platform gives each submission its own), so in a shared key they are those of the assessment last imported.
- **The module's view.** The home screen lists a module with its assessments, each with its progress. Where the request gives the weightings, the module shows what each assessment is worth and a module mark for each student at three levels: the original marker's, after the partner's internal moderation, and the moderator's own. A module mark is each assessment's mark weighted by what it is worth, and is worked out only for a student with a mark in every assessment at that level. So the first two levels are filled for the whole cohort that submitted everything, and the moderator's only for the students the moderator has marked in every assessment. The weightings are used as given: if they do not add up to 100% the module says so and shows each mark as a share of what they add up to.
- **Deleting a module deletes its assessments,** by deleting its folder, with the confirmations a single workspace needs: its name typed, and the exports kept. The proxy forgets the registrations of the module and of every assessment in it.
- **The Python command line does not open a module, or an assessment in one.** It does not read the module's shared files, so working on an assessment there would quietly leave the shared rules out. It refuses, and says the app is needed.
- **Unchanged:** what the AI may be sent and when, the anonymisation and approval gates, the registry's checks, retention (an assessment is given the module's keep-for period when made), the egress log, and exports only into a workspace.

## Options considered

| Option | Why not chosen |
| --- | --- |
| Assessments as sibling workspaces, each naming a module workspace | An assessment could be anywhere, so deleting a module could not delete them, and a module's view could not find them without the proxy listing everything. It has the same need to read another workspace's files. |
| Each assessment keeps a copy of what is shared | It is not held once: changing a rule means changing every copy, and the copies drift. |
| Keep the whole cohort, with names and IDs, in the module so it is read only once | It would keep the names and IDs of students who are not sampled, which the data-handling rules do not allow. |
| A shared key for every module | A student would be one pseudonym across assessments whether or not the moderator wants the AI to be able to link their work. |
| Let the moderator switch key sharing on and off later | Pseudonyms already recorded in records and approvals would have to be merged or split. |
| A module mark from the moderator's marks where there are some and the original marker's elsewhere | A mark that mixes whose judgement it is would not be a mark of anyone's. Three levels, each from one source, are easier to read. |

## Decision test

1. **Educator authority:** unchanged. A module mark is a figure worked out for the moderator to read, never a mark given. Nothing is approved, mapped or sent without the moderator.
2. **Explainable behaviour:** the module holds a short, named list of files; everything else is in the assessment. The module mark says what it is made from and is blank when it cannot be worked out.
3. **Sensitive-data exposure:** no new material leaves the machine and no new kind of material is kept. The module's cohort holds no name or ID; the shared key is the same private file as before, kept once, with its consequence told where it is chosen.
4. **Institutional control:** a module is in the workspaces folder, under the same checks, retention and deletion as any workspace.
5. **Moderation and consistency:** assessments share their rules and optionally their key, so the same value is redacted the same way throughout the module; each is moderated and recorded as before.
6. **Accessible and sustainable:** the module's screens are checked like every other screen. Storing a module as a folder of workspaces needs no new storage.

## Consequences

- The manifest gains `module` (for an assessment) and `shared_key` (for a module), and the workspace type gains `module`. The request cohort gains `links`, and a new record, the module's context, is added to the contract; both cores and the schema are updated.
- The proxy can make a module, make an assessment inside one, list the assessments with the module they are in, and forget a module's assessments with it.
- The core's `Workspace` reads and writes the shared files (the rules, and the key where shared) through the module; a core test checks this, and that an assessment cannot be opened without its module.
- The app's home screen groups a module's assessments, and a module has its own screen.
- `docs/data-handling.md`, the runbook and the proxy's README describe modules.
