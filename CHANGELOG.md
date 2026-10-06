# Changelog

What changes in each version of Feedbacker. The app, the proxy and the Python core share one version number, shown in the app's banner and when the proxy starts.

Feedbacker uses [semantic versioning](https://semver.org/). While the version starts with 0, any release may change how Feedbacker works. Each entry says so plainly when a release:

- changes what the AI is sent, or the instructions it is given;
- changes a workspace's files in a way that older or newer versions can't read;
- changes what an educator has to do, or check.

## Unreleased

- Feedbacker is now licensed under the Apache License 2.0, which adds an explicit patent licence and asks for attribution. Versions up to and including 0.1.0 remain under CC0 1.0 Universal.

## 0.1.0 (6 October 2026)

The first release: marking a cohort with feedback, and moderation, on your own computer, with the AI's help and your judgement throughout.

### Marking a cohort, with feedback

- Import a cohort's submissions from the bulk download of Turnitin or Canvas: typed Word and PDF files.
- Anonymise them on your computer: students' names, IDs and contact details are replaced, by rules you can add to. You review and approve each submission, and choose which of its images, if any, may be sent.
- Mark each submission against the rubric. You can ask the AI to suggest a level for each criterion, with its reasons and quotes from the work, and see its suggestions before you mark, or only after (blind). A provisional mark from its suggestions is calculated, and kept apart from yours.
- The AI drafts feedback from your own marks and comments, and from a feedback guide you write and approve. Feedbacker checks each draft against your marking, and flags, for example, praise the mark doesn't support, or a missing next step. The AI can suggest an edit to a flagged piece of feedback.
- Compare the cohort's feedback side by side, approve exactly what each student receives, and copy or export it (text, Markdown, and a CSV of marks).

### Moderation

- Record the moderation request: the sample, and how the cohort's marks were spread.
- Import the sampled students' work, the rubric (CSV, JSON, or an Excel or Word grid) and the brief, and anonymise them as above.
- Import the original marker's marks and comments from Turnitin's marked views, or enter them by hand.
- Ask for the AI's own independent reading of each piece. Mark each piece yourself, with or without seeing the original marks first, then compare yourself, the original marker and the AI, criterion by criterion, and record your verdicts.
- Approve and export the moderation record as JSON, Markdown and Word, with a copy that restores the Turnitin IDs if you ask for it.

### Throughout

- Nothing is sent to the AI (Anthropic's Claude, with your own API key) unless it has been anonymised and you have approved it, and confirmed the request. In the browser app, a small program on your computer, the Feedbacker proxy, holds the key, is the app's only route to the AI, sets a spending limit for each run, and keeps a log of what it sends, without the text. The Python command line follows the same approval rules, but its AI reading calls Anthropic directly, with the same key file, so the proxy doesn't log it.
- Every AI contribution records which AI made it, the instructions it was given, and what it was sent.
- Every screen is checked against the measured WCAG 2.2 AA checks, and every control can be reached from the keyboard.
- A Python command line covers the setup steps of both, and is the reference the browser app is checked against.

See [responsible use and known limits](docs/responsible-use.md) before using it.
