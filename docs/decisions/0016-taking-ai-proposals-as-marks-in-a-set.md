# 0016: Taking the AI's proposed levels for many submissions in one action, by exception

- **Status:** Accepted (the maintainer asked for it to be built, to this design, on 2026-11-12; the points under "Taken in building it" can be changed). **The guard at Export was reversed on 2026-11-12 after a real marking session: see "Revised after real use".**
- **Date:** 2026-11-12
- **Amends:** 0006 (what a mark recorded from a proposal means; not what the AI may be sent)

In this record, **the AI** means the AI service Feedbacker sends material to, through the local proxy.

## Context

An educator marking a cohort marks each criterion of each submission: a level, a mark within it, and an overall mark. The AI's proposals give a level for each criterion of each submission, with reasons and evidence, and the provisional mark those levels imply. A proposal is never a mark. Today the fastest way to use one is one press for a criterion ("Take the proposed level and record"), about eight presses a student, which for a cohort of ninety is the longest part of the work. An educator short of time has no way to take the proposals as a starting point and correct them.

The rule that the AI proposes and the educator is responsible for every mark has to survive that. A single action that recorded every proposal, unseen, would put the educator's name on marks they had not looked at. The anonymisation (ADR 0012), the approval of what students receive, and the recording of drafts (ADR 0015) deal with the same problem in the same way: the educator looks properly at what is unusual, reads the rest from a list, and says they did; the record says it was done in a set; and a later step keeps what was not opened from being released.

## Decision

**The educator still records every mark, and still approves every word a student receives.** Nothing is taken by default, and nothing is released by it. What changes is that the educator may take the AI's proposed levels for many submissions in one action, after a list that shows them.

**What is listed.** Every submission in the cohort that has a current AI proposal (of the text as approved now, against the rubric as it is now) and no mark of the educator's yet, and is not being marked blind. For each: the level proposed for every criterion, the AI's reasons, the provisional mark, and the criteria with no proposed level. A submission that is marked already, marked blind, with no current proposal, or whose text is not approved is not listed, and is named with why.

**What is taken.** For each submission listed, each criterion that has a proposed level, recorded as it would be on its own: a judgement by the educator, in an open review, whose level is taken from the AI's suggestion, at the level's points. A criterion with no proposed level (the AI found too little evidence, or proposed none) is **never taken from the AI**: it is the educator's to mark. And, only where every criterion has a level, the overall mark the levels imply, which the educator can change as they can any overall mark.

**A criterion with no proposed level.** The list offers a choice of level for it, in the same row, so the educator need not open the submission. Where at least half the criteria have a proposal, it also shows a level **suggested from the others**: the share of their maximum that the proposed levels average (weighted by the criteria's weights where the rubric has them), applied to this criterion's own maximum, and the level nearest that, the lower of two equally near. The suggestion is an inference and says so: it is not from the work and not from the AI, and it hides what a weak or strong section would have shown, so it is never used unless the educator chooses it (one button chooses every suggestion, and each can be changed first; the default is to leave the criterion for the educator). A level the educator accepts as suggested is recorded as accepted as suggested from the other criteria, in the set, and without being opened, like a level taken from the AI; a level they choose themselves in the list is recorded as theirs, because they chose it. A criterion given nothing stays theirs to mark, and the overall mark is not taken for that submission.

**The confirmation.** The educator confirms, with a tick, that they read the list. It is of each submission's proposals as listed, by digest: a submission whose proposals changed since is not taken, and is named.

**What is recorded.** Each judgement and each overall mark taken this way says so: how many submissions were in the set, how many had a criterion with no proposal, and that the list was confirmed as read (an optional field, on the judgement's entry and on the overall mark, in both cores, the schema and the conformance cases). A level accepted as suggested from the other criteria also says so (a flag on the judgement's entry), and carries no AI suggestion, so it can't be mistaken for one. The structured record carries it. It stays until the educator records that mark again by hand: opening a submission does not change it, so the record stays a true account of how the mark came to be there.

**The guard at Export (as first designed, and since reversed: see "Revised after real use").** A submission with any such mark was to be an **exception** at Export, in the sense of the approval by exception there: it had to be opened, as it now is, before it could be in an approved set.

**On the marking screen,** a submission with such marks says so, and that they have not been looked at one by one.

**Moderation does not offer this.** A moderator's judgement of a sampled submission has to be their own, formed before they see how the original marker or the AI judged it, and then compared with them (ADR 0006, ADR 0011); taking the AI's levels as the moderator's judgements would make the comparison with the AI meaningless. The action is for a marking workspace, where the AI's proposals are an aid to the educator's own marking, and the core refuses it elsewhere. The by-exception approval of what is sent, and the anonymisation, apply to both.

**Unchanged:** what the AI is sent (ADR 0006), how a single mark is recorded, that the AI never gives a mark, and that recording never releases anything.

## Taken in building it

These were decided in building it, and can be changed:

1. **The overall mark is taken too,** where every criterion has a proposal, as the mark the levels imply. Without it a submission could not reach Export at all, and the educator would have to record 89 overall marks by hand. It carries the same mark and the same guard.
2. **Opening does not end the mark;** recording again by hand does. Ending it on opening would need a record to be written each time a submission is looked at. (At Export, opening is no longer needed for such marks: see "Revised after real use".)
3. **Only submissions with no mark of the educator's** are listed, so the action never overwrites a mark that was thought about.
4. **The set is the whole cohort listed,** not a chosen subset.
5. **The suggestion is general:** any criteria the AI leaves out, in any number (and for any rubric with points), not only one; it needs at least half the criteria to have a proposal. The default for each is to leave it for the educator.

## Revised after real use

Decided by the maintainer on 2026-11-12, the day the design was first used on a real cohort of 89 submissions.

**A submission with marks taken in a set is no longer an exception at Export.** It is approved with the rest of the set on the educator's confirmation that they read the list, which shows each student's mark and full feedback, tied by digest to what was shown.

**Why.** The educator had already seen every proposed level in full: the list of proposals shows each level with the AI's reasons, and the educator confirms they read it. Export shows the mark and the feedback again. Requiring each submission to be opened too was a further reading of the same marks, and because the action takes the whole cohort, every submission carried the mark and so became an exception: the approval by exception turned into "open every submission".

**What stays.** The mark that a level or overall mark was taken in a set stays on the record, and the approval says it was made in a set. The marking screen still says on such a submission that its marks were not looked at one by one. The educator can still open any submission, and recording a mark again by hand ends the mark. Moderation still does not offer this action, for the reason given above.

## Options considered

| Option | Why not chosen |
| --- | --- |
| Keep taking one criterion at a time | It is the longest part of marking a large cohort, and is what makes the proposals little use to an educator short of time. |
| Record every proposal in one action, unseen | It would put the educator's name on marks they have not looked at. |
| Record them with no mark of how they were taken | The record would say the educator chose each level when they did not, and Export could not tell which submissions need a closer look. |
| Include criteria with no proposed level, at the lowest level or by a rule | The AI would be deciding where it found too little evidence to decide. Those are the educator's. |
| Let the set overwrite marks the educator has made | Marks they have thought about must not be lost to a bulk action. |
| Fill a criterion the AI proposed nothing for with the average of the others, automatically | The average isn't an assessment of that criterion: it hides a weak or strong section, and would put a level in the record that nobody judged. It is offered, and used only if the educator chooses it. |
| Ask the AI again, with the figures, for the criterion it had too little evidence for | Figures can't be redacted, which is why they may have been left out, and it costs more. |
| Leave the overall mark out | A submission could not then be approved at Export, and the saving would be mostly lost. |

## Decision test

1. **Educator authority:** unchanged in kind. The educator takes every mark, after seeing it listed, and confirms they read it; a criterion with no proposal is theirs; and every mark taken this way is seen at Export before it can be released.
2. **Explainable behaviour:** each mark taken says it was taken from the AI's suggestion in a set, how large the set was, and how many submissions had something left for the educator; the marking screen and Export say so.
3. **Sensitive-data exposure:** no new exposure. Nothing is sent by this: the proposals were read earlier, and the list is shown on the educator's own screen.
4. **Institutional control:** an institution can see, in the record, which marks were taken one at a time and which in a set, and that none of the latter was released unread.
