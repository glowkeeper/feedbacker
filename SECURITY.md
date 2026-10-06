# Security policy

Feedbacker handles students' work and marks, so a security problem in it can expose personal data. Thank you for reporting one privately.

## Reporting a vulnerability

**Please don't open a public issue.** Report it privately, through GitHub's private vulnerability reporting:

**[Report a vulnerability](https://github.com/glowkeeper/feedbacker/security/advisories/new)** (from the repository's **Security** tab, **Report a vulnerability**).

Include what you found, how to reproduce it, and what it could expose. **Never include real students' work, marks, names or identifiers**, from your own use or anyone else's: reproduce the problem with the synthetic files in `fixtures/synthetic/`, or describe it.

## What to expect

Feedbacker is maintained by one person. The maintainer aims to:

- acknowledge your report within a week;
- tell you whether it is accepted, and keep you updated while it is fixed;
- credit you in the advisory, if you would like that, once a fix is released.

Please give a reasonable time for a fix before disclosing the problem publicly.

## Scope

In scope: everything in this repository.

- **The app** (`ui/`), which runs in the educator's browser.
- **The Feedbacker proxy** (`proxy/`), which holds the API key and is the only route out to the AI.
- **The Python core** (`core/`), the reference implementation and command line.

Especially:

- anything that lets material reach the AI, or leave the computer, without the educator's approval, or other than as [the rules on what may be sent](docs/data-handling.md#what-may-leave-the-machine) allow;
- a way round anonymisation, the approval gate, or the proxy's checks on what it sends;
- the proxy being reachable from another device, or without its session token;
- the API key being exposed (to the browser, a log, an export or a workspace);
- a workspace opened, or written, outside the folder the educator registered;
- re-identified material being produced without the educator's confirmation.

Out of scope:

- The AI provider's own service (report those to the provider).
- Vulnerabilities in a browser, the operating system or a dependency, unless Feedbacker's use of it makes the problem worse (please report those upstream too).
- Attacks that need control of the educator's computer or user account already.
- Feedbacker's known limits, described in [responsible use and known limits](docs/responsible-use.md) and [for institutions](docs/institutions.md): for example, rule-based anonymisation missing a name nobody listed, or the folder permissions that don't apply on Windows. A way to make one of these worse than described is in scope.

## Supported versions

Feedbacker has no releases yet. Fixes are made on the `main` branch.

## Where to read more

- [For institutions: data protection, the AI provider and governance](docs/institutions.md)
- [How data is handled](docs/data-handling.md), including [what to do if real material is exposed](docs/data-handling.md#incidents)
