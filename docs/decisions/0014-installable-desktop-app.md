# 0014: An installable desktop app, in an Electron window

- **Status:** Proposed (the maintainer chose Electron on 2026-11-08; the spike below must confirm it before anything is built)
- **Date:** 2026-11-08
- **Amends:** 0004 (how the proxy and the app are started and shown, not what either does)

## Context

Feedbacker is a browser app served by a local proxy (ADR 0004). To use it today an educator needs Node 24, a terminal, a copy of the repository, an API key in a file with the right permissions, and Chrome or Edge, and has to open an address with a one-off token in it. The educators Feedbacker is for do not have these, and cannot be asked to learn them: the terminal is the main barrier to anyone else trying it.

The app chooses its work folder with the browser's folder picker (`showDirectoryPicker`) and remembers the folder between sessions. Only Chrome and Edge have that, which is why Feedbacker works only in them. Whatever shows the app must therefore be Chromium, or the file handling must be rewritten.

## Decision

- **Feedbacker is installed as a desktop app for macOS, Linux and Windows,** built on Electron. The window is Chromium, so the app runs there as it does in Chrome, with the same folder picker and the same remembered folder, and the educator does not need to have, or choose, a browser.
- **The proxy stays the boundary, unchanged.** The app still reaches everything outside the window through the proxy's requests; the proxy still holds the only copy of the API key, keeps the egress log, makes workspaces and does the checks that need a real path. Electron starts it, on a free port on 127.0.0.1, with a token that is new each time, and the window loads the app from it. Nothing in the app's own code changes to suit Electron. The proxy runs in a separate process from the window; the Electron version used must carry a Node the proxy supports (24 or later), or the proxy runs under a Node the app ships.
- **The window is locked down.** No Node access in the page; context isolation and the sandbox on; the page can load only the proxy's origin; every other link opens in the system browser; no remote content, no remote debugging, and no permission granted that the app does not use. The only thing the window's preload code exposes is what the app needs from the desktop (for example, to say that a link should open outside).
- **The API key is entered once, in the app, and kept by the operating system.** It is encrypted with the operating system's own store (Electron's `safeStorage`) and given only to the proxy process, never to the page. The command-line route stays: `ANTHROPIC_API_KEY`, or the private `.env` file, as now. Without a key the app still opens and says what is missing.
- **The app tells the educator when a new version exists.** On start-up it fetches one small public file from the releases page, compares the version, and says if there is a newer one, with a link to the download. The request carries no assessment material and nothing about the educator, only what any web request does; it is the only connection the app makes other than through the proxy; and it can be turned off. It never installs anything by itself. Installing updates automatically needs signed builds (macOS refuses to replace an unsigned app), so it waits for signing and is a decision of its own. There is no telemetry and no crash reporting.
- **Releases are built in public,** by a workflow that builds on each of the three systems and attaches the installers, with their checksums, to a release. The website's download button points at the release.
- **Signing is wanted, and costs money.** macOS needs a signed and notarised app, and Windows a signed installer, or each system warns before the first run. The early releases go out unsigned (the maintainer's decision, 2026-11-08), with plain instructions for the warning. Signing, and with it automatic updates, follow when the maintainer decides to pay for the certificates.
- **The command-line route stays,** for people who work in a repository and for development.
- **Unchanged:** what the AI may be sent and when, anonymisation and approval, retention, the egress log, the workspace folder and its checks.

### The spike that comes first

Electron is chosen because it is Chromium, but whether the pieces that matter work in it has not been shown. Before any other work, a small Electron shell must show, on all three systems:

1. the folder picker opens, and the folder it chose is remembered after the app is closed and started again, with permission to use it, or with a click at most;
2. the app, served by the proxy, runs a whole moderation or marking workspace as it does in Chrome, and the existing browser checks pass in it;
3. the proxy starts and stops with the window, and leaves nothing running when the window is closed;
4. the page cannot reach anything but the proxy.

If the folder is not remembered, the folder choice moves to the desktop side (the main process opens a native dialog and the proxy, which already makes workspaces, is the only one to touch folders). If that is not enough, this decision is revisited.

## Options considered

| Option | Why not chosen |
| --- | --- |
| A single program that starts the proxy and opens the educator's browser | Smallest, but it keeps the Chrome-or-Edge limit, and "open this exact address" is still strange to the people it is for. |
| Tauri | Much smaller, but it uses each system's own web view, and none of them has the folder picker the app is built on. The file handling would be rewritten on the desktop side, and the app tested in three different engines. |
| Node's single executable application, with no window | A binary, but not an app: the educator would still need a browser. |
| A hosted service | Never: Feedbacker does not hold assessment data (`PRODUCT.md`). |
| Waiting for the browsers to catch up | No date, and Safari and Firefox have not committed to the folder picker. |

## Decision test

1. **Educator authority:** unchanged. The app asks for the folder and the key; marks, approval and release are as they were.
2. **Explainable behaviour:** the educator sees one app and one window; the download page says what is installed, where work is kept and what leaves the machine.
3. **Sensitive-data exposure:** no new route out. The proxy remains the only way anything leaves; the key is held by the operating system's store and the proxy, not the page; there is the only extra connection is the version check, which carries nothing of the educator's, can be turned off, and installs nothing. The installed program is larger than the proxy alone, so the version check tells the educator when a new release is out.
4. **Institutional control:** the educator's institution can decide whether the app may be installed, and the work stays in one folder it can see. Signed builds are what an institution's software checks expect.
5. **Moderation and consistency:** unaffected; the records are the same files.
6. **Accessible and sustainable:** the window is Chromium, so the app's accessibility checks still apply; the system dialogs are the system's own. Electron carries a browser, so security fixes in it must be shipped as new releases promptly; that is a standing cost of this choice.

## Consequences

- A desktop shell is added beside the proxy and the app, with its own build and tests; Electron is a new dependency, and the Electron version is kept current.
- A release workflow builds three installers, with checksums, on each release.
- The key can be entered in the app, and is stored by the operating system.
- The setup guide, the README and the website describe the installer first, and the terminal route as the alternative; the README's "Chrome or Edge only" stays true for the command-line route and not for the installed app.
- Signing and notarising need accounts and money; until they exist, releases are unsigned, the first-run warning is documented, and updates are announced by the version check and installed by hand.
- The proxy's README, which says it is not a single binary yet, is updated once the app exists.
