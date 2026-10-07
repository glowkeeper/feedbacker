# 0008: Workspaces made by name, in one folder, and a home screen that shows them

- **Status:** Accepted (maintainer decision, 2026-10-07)
- **Date:** 2026-10-07
- **Amends:** 0004 (how a workspace is created, found and opened, not what it holds or how it is checked)

## Context

Under ADR 0004, the proxy creates or registers a workspace by its path, because a browser folder handle reveals neither the folder's path nor its parents. So the app's start screen asks for the full path of a new folder, and then asks the educator to choose that same folder again to open it. Carrying on means "Open the last workspace", or choosing a folder.

Someone new can't tell where to start, why they must type a path, or why they then pick the folder they have just named. Someone coming back sees nothing of their work until they have opened it.

The maintainer decided on 2026-10-07 that workspaces live in one place, and that the app's home screen shows the educator's work and how far each piece has got.

## Decision

- **One workspaces folder.** The browser app keeps every workspace it creates in one folder: `~/Feedbacker/workspaces`, already the default suggested to educators.
  - The proxy creates it if it is missing, readable only by its owner (700), and refuses to use it if it is inside a git working tree, or if its permissions have been widened, as it does for a workspace.
  - Someone running the proxy can name another folder when starting it, for example an institution's share. The app has no setting for it.
- **New work is made by name.** The app sends a name and a type (marking or moderation), and the proxy makes `<workspaces folder>/<name>`.
  - It accepts a plain folder name only: letters, digits, spaces, hyphens, underscores and full stops, not starting with a full stop, and at most 64 characters. It refuses anything else, including path separators, and a name that already exists.
  - It then creates and registers the workspace exactly as now: the git check, the permissions, the registration ID in the folder and in the registry.
  - The app suggests a name, such as the module and year; it never needs to be a person's name.
- **The app asks for the folder once.** The first time, the app asks the educator to choose the workspaces folder, and keeps its handle in the browser's storage. It keeps nothing else: browser storage still holds handles only, never records.
  - It opens each workspace as a folder inside that handle, so the educator never picks a workspace's own folder.
  - Each time, it still proves the folder is the registered one: the proxy re-checks the registered path and writes a one-time value into it, and the app must read that value back through the folder it opened.
  - Chrome remembers access across visits if the educator allows it; otherwise it asks once per visit, with one click, and the app says why.
- **The proxy lists the workspaces it has registered.** For each, it gives what the app needs to show it: its name, its type, when it was created and its keep-for period, all from the workspace's manifest, plus whether it is inside the workspaces folder.
  - The proxy reads only the manifest. It never reads a workspace's records, submissions or exports.
- **The app works out each workspace's progress itself,** by reading the workspace's files through the folder handle, as it does for each step now. The same summary is shown on the home screen and on that workspace's overview, in the same words.
- **Existing workspaces keep working.** A workspace registered by path stays registered and listed.
  - One outside the workspaces folder, such as one made by the command line elsewhere, is opened by choosing its folder, as now. The app may keep that handle too.
  - Registering a workspace made by the command line moves into the home screen's options.
- **Unchanged:** what the AI may be sent and when, the anonymisation and approval gates, the registry's checks, retention, the egress log, exports only into the workspace, and deleting a workspace by deleting its folder. The Python command line keeps creating and using workspaces by path.

## Options considered

| Option | Why not chosen |
| --- | --- |
| Keep typing a path | Works, but a newcomer can't tell why, and must then pick the same folder again. |
| Pick the parent folder in the browser for each new workspace | The handle still reveals no path, so the proxy couldn't check or register it. |
| Let the browser create the folder, and the proxy register it afterwards | The proxy would register a folder it hadn't checked before it held material; making it with the proxy keeps the checks first. |
| The proxy reads each workspace's records to report progress | It would widen what the proxy reads from the manifest to assessment material, for no gain: the app can already read the files. |
| Store a list of workspaces in the browser | It would duplicate the registry, and could disagree with it; browser storage holds handles only. |

## Decision test

1. **Educator authority:** unchanged. Nothing about marks, approval or release changes; the home screen only shows work and where it stands.
2. **Explainable behaviour:** every workspace is a named folder in one known place, and the home screen shows each one's progress, in the same words as its overview.
3. **Sensitive-data exposure:** no new material leaves the machine. The proxy reads only manifests, as it already does when registering. The browser keeps handles only. A name is checked to be a plain folder name, so it can't reach outside the workspaces folder.
4. **Institutional control:** the workspaces folder can be named when the proxy starts, for example a university share; every check the proxy makes still applies.
5. **Moderation and consistency:** unaffected: the same records, steps and prompts.
6. **Accessible and sustainable:** a home screen with a list and two actions is simpler to use with a keyboard and a screen reader than a form asking for a path; it is checked like every other screen.

## Consequences

- The proxy gains two requests: list the registered workspaces, and create one by name. Creating by path stays for the command line and for registering.
- The app's home screen replaces the start form, and each workspace's overview shows the shared progress summary.
- `docs/data-handling.md` describes the workspaces folder, creating by name, and what the proxy reads.
- The README and the runbook describe the new start.
- The browser check covers first use, creating by name, the list with progress, and continuing.
