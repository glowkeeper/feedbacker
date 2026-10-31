# 0013: A workspace kept elsewhere can be moved into the workspaces folder

- **Status:** Accepted (maintainer decision, 2026-10-31)
- **Date:** 2026-10-31
- **Amends:** 0008 (how a workspace kept outside the workspaces folder is opened and shown, not what it holds or how it is checked)

## Context

A workspace made by the command line elsewhere can be registered by its path (ADR 0008). The browser can open a folder only once the educator has shown it that folder, so each such workspace asks for its own folder, once on each computer and browser: the educator chooses it in the browser's folder picker. A workspace inside the workspaces folder never asks, because the browser's permission for the workspaces folder covers everything in it.

The educator found this confusing in use. The card said "kept outside the workspaces folder", and "the first time" even when it was not the first time. The folder picker opened in the workspaces folder, not in the folder it was being asked for, because both pickers shared one picker ID and Chrome remembers where each ID was last used. A page cannot start a picker at a path, so the educator has to find the folder.

Such a workspace is an exception, made only by the command line or by a folder the educator already had. The maintainer's decision (2026-10-31) was to make the dialogue clearer, and also to let the educator remove the exception.

## Decision

- **The card says what will happen.** A workspace kept elsewhere says "Stored somewhere else, at `<path>`", and then what Continue will do, from what this browser already knows about it:
  - never shown to this browser: "Continue asks you to choose that folder, once on this computer", and the button says "Choose its folder to continue";
  - remembered, but the browser needs a click to allow it again: "Continue asks you to allow access to it again";
  - remembered and allowed: nothing more, and Continue opens it.
- **The folder picker for a workspace kept elsewhere has its own picker ID,** so it does not open in the workspaces folder. A page cannot name a path to start in, so it still cannot open in the right folder the first time. If the folder chosen is not that workspace, the message says which folder to choose.
- **A workspace can be moved into the workspaces folder,** from its card: **Move into the workspaces folder**. The proxy does it, and it is the only part that touches folders.
  - It renames the folder into the workspaces folder (`<workspaces folder>/<the folder's name>`). It never copies, so nothing is ever held twice, and nothing inside the workspace is read, changed or rewritten.
  - **The name can be changed as it moves.** A folder's name may already be used in the workspaces folder, or may not be a name a workspace can have (ADR 0008's rules). The app sees this from the list, before anything is sent, and shows a field, "Its name in the workspaces folder", with a free name filled in (its own with a number). The proxy checks the name as it checks any workspace's, and refuses a name that is used. When the folder is renamed, the `name` in its manifest is changed to match, so the folder and the list agree; nothing else inside it is changed, and the message says so. If the proxy finds a clash the list could not show, the field appears then. With a name that is free, the folder keeps its own name and nothing inside it is touched.
  - The workspace keeps its registration ID, so its history, its egress records and the registration inside it still agree. The registry records where it was and when it was moved (`moved_from`, `moved_at`).
  - Before moving, the proxy checks the workspace as it does before opening one (still there, outside git, no links, readable only by its owner, holding its own registration), and the workspaces folder as it does before making one.
  - It refuses, and changes nothing, if the workspace is a module (it holds its assessments) or an assessment (it belongs in its module's folder), if another registered workspace is inside it, if the name (its folder's, or the one given) cannot be a workspace's name or is already used there, or if the workspaces folder is on another disk (a rename cannot cross disks; copying and deleting assessment material is not done without a decision of its own).
  - If the manifest or the registry cannot be updated after the rename, the folder and the manifest are put back as they were.
  - The browser forgets the folder it remembered for the workspace, since it no longer leads there; the workspace then opens through the workspaces folder, which needs no more permission.
- **Unchanged:** what the AI may be sent and when, the anonymisation and approval gates, retention, the egress log, the registry's checks, and deleting a workspace by deleting its folder. The proxy reads no more than the manifest, as before.

## Options considered

| Option | Why not chosen |
| --- | --- |
| Only reword the card | Clearer, but the educator still has to choose a folder for each such workspace on each computer. |
| A two-step panel before the picker, with the path to copy | The maintainer found two steps too many. |
| Copy the folder into the workspaces folder, and delete the original | Holds sensitive material twice, however briefly, and a failure part-way leaves two copies or none. A rename is atomic on one disk. |
| Move modules and assessments too | A module and its assessments are registered separately, each by path; moving one changes the paths of the others. Few such cases exist; left for when one is needed. |
| Make the educator rename a folder by hand when its name is taken | The registry would then point at a folder that has gone until it was registered again, and the educator would have to leave the app to do it. |
| Always ask for a name | More to ask in the common case, where the folder's own name is fine. The field appears only when it is needed. |
| Leave the manifest's name as it was when renaming | The list shows the manifest's name, so the folder and the list would disagree. |
| Let the educator choose a different parent as the workspaces folder | Chrome refuses broad folders, and the workspaces folder is checked to be the proxy's. |

## Decision test

1. **Educator authority:** unchanged. The move is a deliberate press on the card that says what it does; nothing about marks, approval or release changes.
2. **Explainable behaviour:** the card says where the workspace is, what Continue will do, and what moving does; the message after says where it came from.
3. **Sensitive-data exposure:** no new material leaves the machine, and none is held twice. The proxy reads only the manifest and registration, as before, and when the folder is renamed it rewrites the manifest's name. The registry gains the previous path, which is already the educator's own folder.
4. **Institutional control:** unchanged; the move stays inside the workspaces folder the proxy was started with.
5. **Moderation and consistency:** unaffected; the workspace's records are untouched.
6. **Accessible and sustainable:** a button, named in words that start with its visible label (WCAG 2.5.3), and wording that says what will happen rather than "the first time".

## Consequences

- The proxy gains one request, `POST /api/workspaces/move { registration_id, name? }`, and the registry may hold `moved_from` and `moved_at` for a workspace.
- The app's card for a workspace kept elsewhere changes its words, and has a second button when the workspace can be moved.
- `proxy/README.md`, `docs/data-handling.md` and the runbook describe it.
- The browser check covers the card in each state, choosing the folder, moving, and moving under a new name; the proxy's tests cover every refusal and the roll-back.
