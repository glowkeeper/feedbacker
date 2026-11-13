# 0015: Recording the AI's unflagged drafts for a cohort in one action, by exception

- **Status:** Accepted (design agreed with the maintainer on 2026-11-01; the four decisions below taken by the maintainer on 2026-11-12). **The guard at Export was reversed on 2026-11-12 after a real marking session: see "Revised after real use".**
- **Date:** 2026-11-11 (decisions taken 2026-11-12)
- **Amends:** 0006 (what "recorded" means for feedback that began as a draft; not what the AI may be sent)

In this record, **the AI** means the AI service Feedbacker sends material to, through the local proxy.

## Context

When an educator marks a cohort, each student receives a piece of feedback for each criterion and an overall piece. The AI can draft them from the educator's own final marks and comments (ADR 0006). The educator reads each draft, edits it if needed, and **records** it. Only recorded feedback goes on to Export, where the educator reads what the student will receive, in full, and approves it. Recording is not releasing.

Recording is now the largest cost per student. "Record all pieces of feedback" does it for one submission in one action. For a cohort of a hundred that is still a hundred rounds of reading and recording, and then a hundred reads again at Export.

Approving a set at Export, by exception (the design of ADR 0012, applied to what students receive), takes care of the second. This record is about the first: letting the educator record many drafts at once, without any piece reaching a student unread.

Today a recorded piece means two things at once: the educator has read it, and the educator stands behind it. The record names the educator as its actor, and notes that it was derived from the AI however much it was changed. Recording a draft the educator has not opened would make the first statement untrue while the record still said it. So a piece recorded this way has to say what it is.

## Decision

**The educator still records every piece, and still approves every word a student receives.** Nothing is recorded by default, nothing is approved by default, and the AI never decides. What changes is that the educator may record many drafts in one action, after reading a list that shows each draft's full text.

**Scope: the cohort's unflagged drafts only.** One action records the AI's drafts for the whole cohort. A draft that is flagged is never in it: it is recorded by hand, one submission at a time, as now. A draft is flagged when:

- a check on the piece against its mark raises a flag (the checks that already run on feedback, such as praise that does not fit a low mark, or an anonymised value left in the text), because a flag needs the educator's reason or a change, and a set action cannot give either;
- the cohort checks flag it, judged on the drafts together with the feedback already recorded: much shorter or longer than the rest at its level, or nearly the same as another student's;
- the marking it was drafted from has changed since (the draft is out of date).

**The list.** The educator sees every unflagged draft with its full text, grouped by submission, and the flagged ones set apart, each saying why and none recordable here. They confirm, with a tick, that they read the unflagged. The confirmation is of the drafts as they were listed, by digest of each piece's text: it lapses when they change, and a piece that changed since is left out of the action and named.

**What is recorded.** Each piece is recorded as it would be on its own: its own record, its own checks, recorded as derived from the AI. In addition it carries a **mark that it was recorded in a set without being opened**: how many pieces the set had, how many were flagged, and that the educator confirmed the read. The mark is part of the record in both cores, the schema and the conformance cases, and the structured record carries it.

**The guard at Export (as first designed, and since reversed: see "Revised after real use").** A submission with any piece carrying that mark was to be an **exception** at Export, in the sense of the approval by exception there: it had to be opened, as it now is, before it could be in an approved set. The mark goes only when the educator records the piece again by hand. Every piece is shown in full at Export, in the list that is read before the set is approved, so a piece the educator has not seen in full is never released.

**Editing is always possible.** The educator can edit what was recorded in a set; recording it again by hand clears the mark, as it does for any change.

**Unchanged:** what the AI is sent when drafting (ADR 0006), the checks on feedback, how a single submission's feedback is drafted and recorded, and that recording never releases anything.

## Decisions

Taken by the maintainer on 2026-11-12: (1) keep the mark; (2) opening is the read panel on Export only; (3) the whole cohort; (4) yes, each piece is judged alone. The reasoning for each is as proposed:

1. **Does opening end the mark, or only satisfy the guard?** The agreed design said opening a piece, or recording it again by hand, ends the mark. Ending it on opening would need Feedbacker to write a record each time a piece is looked at. The proposal above keeps the mark on the piece until it is recorded again by hand, and treats opening as what satisfies the guard at Export (as it does for a flagged text in ADR 0012), and says in the approval whether the submission was opened. The mark then stays as a true account of how the piece was recorded. **Decided:** keep the mark; opening satisfies the guard. The alternative is to write an "opened" event that ends the mark, which is more to build and loses the account.
2. **What counts as opening?** Proposed: the full text shown in the read panel on Export, as it now is (by digest), the same rule as for flagged submissions there. An alternative is to count opening a piece on the Feedback screen as well.
3. **Is the cohort the whole set, or the submissions the educator chooses?** Proposed: the whole cohort at once, because that is where the time goes. Choosing a subset (the next twenty, say) is possible without changing the design.
4. **Is the AI's draft for the overall comment treated like the criteria pieces?** Proposed: yes, each piece is judged alone and recorded alone, so a flagged overall comment holds back only itself.

## Revised after real use

Decided by the maintainer on 2026-11-12, the day the design was first used on a real cohort of 89 submissions.

**A submission with feedback recorded in a set is no longer an exception at Export.** It is approved with the rest of the set on the educator's confirmation that they read the list, which shows each student's mark and full feedback, tied by digest to what was shown.

**Why.** The guard was designed before it was used. In use, the educator had already seen every draft in full: the list of drafts to record shows each in full, with the overall mark beside it, and the educator confirms they read it. Export then shows each student's feedback in full again. Requiring each submission to be opened as well was a third reading of the same text. And because the action takes the whole cohort, every submission carried the mark, so every one became an exception, and the approval by exception turned into "open all 89". The point of the design, that the educator's attention goes to what is wrong and not to what is fine, was lost.

**What stays.** The mark that a piece was recorded in a set stays on the record, so the record is a true account of how it came to be there. The approval still says it was made in a set, and that the educator confirmed the read. A piece with a flag that holds it up is never in the set in the first place. The educator can still open any submission and read or change it, and recording a piece again by hand ends the mark.

**What the educator is accountable for** is unchanged: every word a student receives is in the list they read, and nothing is released without their approval.

## Options considered

| Option | Why not chosen |
| --- | --- |
| Keep recording one submission at a time | It is the largest remaining cost per student, and is what makes a cohort of a hundred slow. |
| Record every draft in one action, unseen | It would put the educator's name on text they have not read. The safeguard is that they read them, and say so. |
| Record the drafts with no mark, and rely on Export alone | The record would then say the educator read it when they did not, and Export could not tell which submissions need a closer look. |
| Let the set include flagged drafts | A flag needs a reason or a change from the educator, which one action cannot give. |
| Make the AI decide which drafts are safe to record | The AI would be deciding what the educator reads. The flags are checks that run here, not a judgement from the AI. |
| Ask the educator to open every draft before recording | That is the same cost as recording by hand, and nothing is saved. |

## Decision test

1. **Educator authority:** unchanged in kind. The educator records every piece and approves every word a student receives. A flagged draft is never recorded in a set; one recorded in a set without being opened is marked, and cannot enter an approved set until it has been opened.
2. **Explainable behaviour:** each flagged draft says why; each piece recorded in a set says it was, how large the set was, how many were flagged, and that the list was confirmed as read.
3. **Sensitive-data exposure:** no new exposure. Nothing is sent by this; what the AI was sent when drafting is unchanged, and the list is shown on the educator's own screen.
4. **Institutional control:** an institution can see, in the record, which feedback was recorded one piece at a time and which in a set, and that nothing in a set was released unread.
