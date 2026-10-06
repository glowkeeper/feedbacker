# Contributing to Feedbacker

Thank you for your interest. Feedbacker helps educators in higher education use AI to help them mark and moderate coursework against a rubric and brief, with every mark, and every word a student receives, still theirs. Contributions of every kind are welcome: a bug report, an idea, a correction to the documents, or code.

Feedbacker is maintained by one person, so a reply may take a few days.

Everyone taking part is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).

## Never share real material

The repository, its issues and its pull requests are public. **Never put students' work, marks, feedback, names or other personal data, confidential assessment material, or secrets in an issue, a pull request, a commit, a screenshot or a test.** That includes your own marking. Describe a problem in general terms, or reproduce it with the synthetic material in `fixtures/synthetic/`, which is fictional. New test material must be fictional too.

To report a security problem, don't open an issue: follow the [security policy](SECURITY.md).

## What Feedbacker is, and isn't

Before proposing a change, read [AGENTS.md](AGENTS.md), the project's guide for every change, whoever makes it. In short, Feedbacker is a workflow and governance layer around AI, not a feedback generator. A change should keep:

- the educator in control: the AI suggests, and nothing becomes a mark or released feedback without the educator;
- every AI contribution traceable;
- assessment material on the educator's computer, unless it has been anonymised and they have approved sending it;
- every screen accessible (WCAG 2.2 AA).

[PRODUCT.md](PRODUCT.md) says what is built, and what is being built now. Ideas for later are welcome, and are recorded, but aren't built yet.

## Proposing a change: an issue first

Open an issue before starting work on anything more than a small fix, so the change can be agreed first. The [issue forms](https://github.com/glowkeeper/feedbacker/issues/new/choose) are:

- **Bug report**: something that doesn't work as it should.
- **Standalone change**: one self-contained change.
- **Parent outcome** and **Child deliverable**: a larger outcome, and the pieces it is delivered in.

An issue is ready to work on once the maintainer has agreed it, and moved it to **Ready** on the [project board](https://github.com/users/glowkeeper/projects/22), which shows what is being worked on. If you'd like to work on one, say so in the issue first. [The project workflow](docs/project-workflow.md) explains the board's statuses, and how issues are structured.

## Setting up

You need [uv](https://docs.astral.sh/uv/) and Node.js 24, and Chrome or Chromium for the browser check (set `CHROME_PATH` if it isn't found). The [README's development section](README.md#development) lists every check, and how to run it. You don't need an Anthropic API key: no check contacts the AI.

The repository has three parts, each with its own checks:

- `core/`: the Python core, the reference implementation;
- `ui/`: the app, in TypeScript and Svelte, with the browser core in `ui/src/core/`;
- `proxy/`: the small local program that holds the API key, and is the only route out to the AI.

The data contract, shared by both cores, is owned by the TypeScript models in `ui/src/core/models.ts`. If you change them, regenerate the contract as the README describes, and commit what changes.

## Making the change

- Work on a branch named for the issue: `fix/<issue>-<short-description>`, or `feature/`, `docs/` or `chore/`.
- Make the smallest change that solves the problem.
- Add or update tests for the behaviour you change. Where the Python core and the TypeScript core share behaviour, they must still agree: the parity and contract checks compare them.
- A change to what is shown on screen must pass the accessibility audit in `npm run check:browser`.
- Update the documents a change affects. They use plain British English, and say "the AI".

## Opening a pull request

Fill in the [pull request template](.github/pull_request_template.md):

- what the change does, and the trade-offs;
- the checks you ran;
- the sensitive data and provenance checklist;
- the issue: "Closes #123" if it fully delivers it, otherwise "Refs #123".

Every pull request runs the checks automatically, on Linux (`.github/workflows/checks.yml`): the Python core, the proxy, and the app, with parity with the Python core, the browser check and the accessibility audits. They must pass before a change is merged. The maintainer reviews each pull request, and may ask for changes.

## Licence

Feedbacker is released under [CC0 1.0 Universal](LICENSE). By contributing, you agree that your contribution is released under the same terms.
