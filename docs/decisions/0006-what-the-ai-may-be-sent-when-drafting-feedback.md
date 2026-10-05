# 0006: What the AI may be sent when drafting feedback

- **Status:** Accepted (maintainer decision, 2026-10-04); amended to allow suggesting an edit (maintainer decision, 2026-10-05)
- **Date:** 2026-10-04

In this record, **the AI** means the AI service Feedbacker sends text to, through the local proxy (at present Claude, through Anthropic's service).

## Context

Marking and feedback asks the AI for two different things.

1. **Suggesting levels.** The AI reads a submission against the rubric and, for each criterion, suggests a level, with its reasons and evidence quoted from the submission. Feedbacker turns those levels into a suggested mark. The educator may see the suggestions before they mark (open), or record their own marks first and see the suggestions afterwards (blind).
2. **Drafting feedback.** Once the educator has decided their marks, the AI drafts feedback for each criterion and overall, for the educator to edit and approve.

The feedback has to match the educator's marks. If the AI suggested 72 for a criterion and the educator disagreed and gave 58, feedback drafted from the AI's own reading may well call the work "excellent", which contradicts the mark. To draft feedback that matches the educator's marks, the AI has to be told them, with the educator's comments.

Until now, the AI has never been sent anyone's marks or comments, and `PRODUCT.md`'s rules on what the AI may be sent can be widened only by a recorded decision. This is that decision.

The maintainer agreed to it on 2026-10-04, on one condition: the AI may suggest marks, with its reasons, before the educator sees them, but it must always be possible for the educator to go first, and to disagree, and the educator's mark is always the one that counts.

## Decision

**The two requests are kept apart.**

- **Suggesting levels** is sent exactly what an AI reading in moderation is sent today: the approved anonymised submission, the approved anonymised brief, the rubric, and Feedbacker's versioned instructions. It is **never** sent the educator's marks or comments, or anyone else's, so its suggestions stay an independent second opinion. The educator chooses for each submission whether to see them first (open) or to go first (blind), and can always disagree. Their mark is always the one that counts.
- **Drafting feedback** may also be sent, **for that one submission only**:
  - the educator's final level, mark and comment for each criterion;
  - their overall mark and comment;
  - optionally, a feedback guide the educator has written for the assessment: what each level of each criterion typically needs to hear, and common next steps.

  It is not sent the AI's own earlier suggestions, so the draft starts from the educator's judgement, not the AI's. It may quote the submission itself.

**The educator's words are anonymised and approved before they are sent**, as a submission is, so the first rule (only approved, anonymised text is sent) still holds:

- The educator's comments and the feedback guide are anonymised with the same rules and pseudonym key as the submissions, when they are saved. Moderators' comments are already handled this way.
- Before a draft is requested, the educator sees exactly what will be sent for that submission, and asking for the draft approves it. The approval records a hash of everything sent.
- At the moment of sending, the request is rebuilt from what is recorded and must match the approval, or nothing is sent. The proxy refuses a drafting request whose content doesn't match, as it does for readings.
- Each draft records what it was drafted from: the marks and comments, the guide's version, the instructions' version and the AI used. So when the educator later changes a mark, Feedbacker knows that draft is out of date.

**What is still never sent:**

- the pseudonym key, real names or identifiers;
- original files or their metadata;
- **any other student's** text, marks, comments or feedback.

Consistency across a cohort does **not** come from sending other students' material. It comes from the educator's feedback guide, which is the same for every draft, and from comparing feedback side by side in Feedbacker, on the educator's own machine. Sending another student's material would need a new recorded decision.

**Moderation is unchanged.** Its AI reading is never sent the original marker's marks or the moderator's judgements.

## Options considered

| Option | Decision |
| --- | --- |
| Draft feedback without the educator's marks, from the AI's own reading | **Rejected.** Feedback could contradict the mark the student receives. |
| Send the educator's marks, but not their comments | **Rejected.** The draft couldn't build on the educator's own reasons, so it would say less of what the educator meant. |
| Send the educator's marks and comments for the one submission being drafted | **Adopted.** The feedback can follow the educator's judgement, and nothing about other students is sent. |
| Send other students' approved feedback as examples, for consistency | **Rejected.** It would carry one student's content into another student's request, as ADR 0005 rejected for readings. The feedback guide and comparison in Feedbacker give consistency without it. |
| One request that both suggests levels and drafts feedback | **Rejected.** The AI would see the educator's marks while suggesting its own, so its suggestion would no longer be independent, and the educator couldn't go first. |

## Decision test

1. **Educator authority:** the educator decides every mark. The AI's suggestions can be seen first or after, and can always be overruled. Drafts follow the educator's marks, and every draft is edited and approved before release.
2. **Explainable behaviour:** each draft records what it was drafted from (marks, comments, guide, instructions, AI), and the educator sees what will be sent before it is.
3. **Sensitive-data exposure:** more is sent than before (the educator's marks and comments), so it is limited to the one submission, anonymised and approved like a submission, and never includes another student's material.
4. **Institutional control:** the two requests go through the same proxy and provider interface as readings, so an institution's choice of AI and key applies to both.
5. **Consistency:** consistency across a cohort comes from a shared guide and comparison on the educator's machine, without mixing students' material.
6. **Accessible and sustainable:** no new service or store; the drafting request is one more kind of request through the existing proxy.

## Consequences

- `PRODUCT.md`'s rules on what the AI may be sent, and `docs/data-handling.md`, now include the drafting request.
- The proxy must accept the educator's marks, comments and guide only in a drafting request, and refuse them in any other request.
- Feedbacker's records gain a drafting request and a record of what each draft was drafted from, in both implementations and the data contract.
- The educator's approval of what is sent for a draft is a new step in the marking screens.
- Suggesting levels is built on the existing AI reading, with nothing new sent.

## Amendment: suggesting an edit to flagged feedback

- **Status:** Accepted (maintainer decision, 2026-10-05)
- **Date:** 2026-10-05

### Context

Feedbacker checks each piece of recorded feedback against its mark, in code: praise above the mark's band, no next step, another mark or level named, an anonymised value the student would see, text that ends mid-sentence. The educator can deal with a flag by changing the text, by accepting it with a reason, or by drafting that criterion again without the flagged words. Drafting again starts afresh from the educator's marks, so any wording the educator had changed is lost.

Suggesting an edit to the educator's own text would keep their wording, but it means sending that text, which this decision does not allow.

### Decision

**A suggestion request may be sent, for one piece of feedback of one submission, only when the educator asks for it on a flag.** It is sent:

- the rubric, and the educator's level, mark and comment for that criterion (for the overall feedback: the overall mark and comment, and each criterion's level and mark);
- the educator's recorded feedback for that criterion, as it was saved, and so anonymised;
- the flags raised on it, as Feedbacker's checks word them;
- Feedbacker's versioned instructions, which ask for the smallest edit that deals with the flags and keeps everything else.

It is **not** sent the submission, the brief, the feedback guide, or the educator's other feedback: an edit changes the wording to fit the mark, and needs the mark and the text, not the work. Only recorded feedback is sent, never text still being typed, because text is anonymised when it is recorded.

As for a draft, the educator sees exactly what will be sent and what it could cost before anything is sent, and asking for the suggestion approves it; the request is rebuilt from what is recorded at the moment of sending, and must match. The proxy accepts the educator's feedback only in a suggestion request, sent with the suggestion instructions, and refuses it in any other request.

**The suggestion never replaces the educator's text.** It is shown beside their text, with its own checks, and the educator accepts it, adapts it or rejects it. Feedback recorded from it is recorded as derived from the AI, with the suggestion it came from.

Everything this decision says is never sent is still never sent, including any other student's text, marks, comments or feedback.

### Options considered

| Option | Decision |
| --- | --- |
| Only draft again, without the flagged words | **Kept, not enough on its own.** It loses the educator's wording. |
| Replace flagged words in code, from a list | **Rejected.** A word that fits the mark depends on the sentence; a list can't keep the meaning. |
| Send the educator's text, the flags, and that criterion's marking | **Adopted.** The least that lets the AI fit the wording to the mark. |
| Also send the submission, brief and guide, as a draft is | **Rejected.** More student material than an edit to wording needs. |
| Send the text as it stands in the box, before it is recorded | **Rejected.** It isn't anonymised until it is recorded. |

### Decision test

1. **Educator authority:** nothing changes the educator's text until they accept or adapt the suggestion and record it.
2. **Explainable behaviour:** the request is shown before it is sent, and feedback recorded from a suggestion says so.
3. **Sensitive-data exposure:** one more thing is sent, the educator's own anonymised feedback for one criterion, and the submission is not sent with it, so less of the student's work is sent than for a draft.
4. **Institutional control:** the same proxy, provider interface and spend controls.
5. **Consistency:** the edit is checked by the same checks as any other feedback.
6. **Accessible and sustainable:** no new service or store.

