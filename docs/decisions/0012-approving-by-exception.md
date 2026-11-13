# 0012: Approving many anonymised texts by exception, in one recorded action

- **Status:** Accepted (maintainer decision, 2026-10-27; design agreed 2026-10-29)
- **Date:** 2026-10-29 (flags amended 2026-11-11)
- **Amends:** 0001 (how an educator approves anonymised text, not what an approval means)

In this record, **the AI** means the AI service Feedbacker sends material to, through the local proxy.

## Context

Everything sent to the AI is anonymised and then approved by the educator: the one mandatory safeguard. Automatic redaction can miss a name in an odd spelling, a place or a personal detail, so the approval is the educator's own check, and it was made one text at a time.

For a sample of a few students that is quick. For a whole cohort (to screen it with the AI before choosing a sample, or to mark a whole class) it is a heavy burden, and it makes anything cohort-wide impractical. On 2026-10-27 the maintainer chose to reduce the burden without removing the approval: the app points the educator at what is likely to be wrong, and the educator approves what they have reviewed in one action.

## Decision

**The approval stays explicit, and per text.** Each text is approved by its own hash, by the educator, as before. Nothing is approved by default; nothing is sent until it is; a rule or name added later still clears the approvals it changes. What changes is that the educator may approve a set of texts in one action, after reviewing by exception: looking properly at the texts the app flagged, and reading the rest.

**What is flagged,** from the anonymised text as it is now, each flag saying why and never quoting the text (so a flag can't carry what it is there to keep out):

- what the check before every request would refuse is still in it (an email address, a web address, a phone number, a long number): the one thing a pattern can tell for certain;
- three or more different capitalised words in the middle of sentences that are neither names nor terms Feedbacker knows (the rules, the key, the brief, the rubric, the calendar, or a word that three or more texts of the cohort share, which is a term of that cohort and not a name), and, once there are two other texts to compare, more than twice the median of theirs, which may be names it has not been told. A cohort of technical reports names many tools in every text, so a fixed number flagged every one of them. A capitalised word that is an ordinary word is not counted: one the text itself writes in lowercase, or that three or more texts do, and, in a line that reads as a heading (short, and not ending as a sentence does), one that any text does. Feedbacker ships no dictionary: a name is never written in lowercase, and the cohort's own words are a better dictionary than a general one, which would not know the subject's vocabulary and would hold many names as words. A cited author is public, so a word that is a cited author is shown in the educator's review but not counted: a name followed, past other names, by a year ("Smith and Jones (2020)") or by "et al.", or anywhere in the reference list (from a heading such as "References" or "References:", or, with none, a run of at least three numbered entries "[1] …" or author-date entries "Smith, A., & Lee, B. (2024). …" one after another with no prose between them, and only that run). An author cited once in a text is the author wherever else that text names them ("(Pemberton)", or "Thornley" alone). The same name in a text that does not cite it still counts. The first word of a paragraph or line is a start, not a word in the middle of a sentence;
- a part of a name that the key or the rules hold (a student's, from a file name, or one added), of three letters or more, still in the text in a form the replacing missed (a lowercase single part, say), unless the educator has said to leave it, or the part is also an ordinary word that three or more texts of the cohort use in lowercase (a student called Will or Rose): a name left behind is in its owner's text, not in many;
- nothing replaced at all in a submission (no student name, link, email, phone number or ID was found in it), or far fewer than the others (under a quarter of the *other* submissions' median, when that is at least four), once there are three submissions to compare;
- an included figure. An image is sent to the AI with the text and redaction can't see inside it (ADR 0007), and the list can't show it, so a submission with an included figure is always flagged: the educator opens its review and looks at each figure before it is approved. An educator who does not mean to send figures to the AI can leave every figure out in one action (**Don't send any of the figures**), for the texts not yet approved; they stay in the workspace, each can be included again from its text's review, and a text left with none included is not flagged for them.

These are advice. A name the app has no way to know is not flagged, and a technical term may be: which is why the educator, not the flags, approves. A reason never quotes the text, but the educator's own review of a text does show the capitalised words behind that reason (highlighted in the text, on the educator's screen only), and lets them redact one as a name or an organisation, or say it is not a name, which stops it being flagged.

**The action.** The Anonymisation screen lists each text with what was replaced (by kind) and why it is flagged, so the rest can be read. The educator opens the review of each flagged text. One action, **Approve the reviewed set**, then approves every text waiting for approval except a flagged text whose review has not been opened *as it now is* (a text anonymised again since is not counted as opened); those are not approved by it, and the educator is told which, and why. Where any text waiting is not flagged, the educator must first confirm, with a tick, that they read those; nothing is approved without it. The confirmation is of those texts as they were listed when it was given: it lapses when they change (a rule, anonymising again), and an unflagged text that changed since is not approved by it, but said. Where every text waiting is flagged, there is nothing to confirm.

**What is recorded.** Each approval made this way says so: how many texts the set had, how many of them were flagged, whether this text was flagged, whether its review had been opened before it was approved, and whether the confirmation was given. A flagged text is never approved in a set unopened, and the record can't say it was. An approval made on its own records no set. This is an optional field on the approval, in both cores, the schema and the conformance cases.

**Scope.** Submissions and the brief, as listed on the Anonymisation screen, for marking and for moderation. A text that is not anonymised, or whose figures are broken, is left out and said.

## Options considered

| Option | Why not chosen |
| --- | --- |
| Keep approving one text at a time | The burden is what makes a cohort-wide use impractical. |
| Approve everything in one action, unseen | It removes the educator's check, which is the safeguard. |
| Trust the flags: approve whatever isn't flagged without a confirmation | The flags can't know a name. The educator confirms they read the rest, and the approval records it. |
| Judge unexplained capitalised words by a fixed number alone | Used at first (three). On a real cohort of technical reports every text had thirty or more, so every text was flagged and the set could not be approved by exception. It is now judged against the cohort. |
| Flag any single unexplained capitalised word | Nearly every text would be flagged, and the exception list would stop being short. Three different words is the threshold; it can be tuned once seen on real work. |
| Flag from a dictionary of names | There is no list of names to ship that is right for the students of any institution, and one would send names where it should send none. |
| Record the opening of each review as a separate event | The approval already records whether the text was opened, as it was when approved; a separate log would add a record without adding a check. |

## Decision test

1. **Educator authority:** unchanged in kind. The educator approves every text, explicitly; a flagged text is never approved without their opening it, and the rest only after their confirmation. Nothing is approved by default.
2. **Explainable behaviour:** each text says why it is flagged, and what was replaced in it; each approval says it was made in a set, how large, and what became of this text.
3. **Sensitive-data exposure:** no new exposure. A flag never quotes the text; nothing is sent by this; a text the educator did not open and that is flagged is not approved.
4. **Institutional control:** an institution can see, in each approval, whether it was made one at a time or in a set, and how many were flagged.
