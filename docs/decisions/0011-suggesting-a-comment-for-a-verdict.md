# 0011: Suggesting a verdict and its comment, and the overall comment

- **Status:** Accepted (maintainer decision, 2026-10-27)
- **Date:** 2026-10-27
- **Amends:** 0006 (what the AI may be sent: a further request, for moderation)

## Context

At the end of reviewing a submission the moderator records a verdict on the original marking (agree, generous, harsh or inconsistent), a suggested mark and, if they wish, a comment. The comment is the part that takes time: it has to say why, criterion by criterion, from the moderator's own levels, the AI's independent reading and how the original mark compares with the mark the moderator's judgements imply.

The moderator asked, during a real moderation, for the AI to suggest that text, and a verdict to go with it.

## Decision

- **A suggestion, never the verdict or the comment.** When the moderator asks, the AI suggests one of the four verdicts (agree, generous, harsh, inconsistent) and a comment for it. They are shown beside the verdict form, each with its own button to use it: nothing is chosen or filled in for the moderator, and nothing is recorded until they record the verdict. A verdict taken from the suggestion is recorded as taken from the AI while it is unchanged, and a comment that began as a suggestion is recorded as derived from the AI however much it is changed (as feedback is); the moderator can choose another verdict, or clear the comment and write their own.
- **What may be sent, for one submission, only when asked:** the versioned instructions (`verdict-comment-v1`), the rubric (criteria and levels), and one block of the moderation of that submission, shown to the moderator in full before they confirm:
  - the original marker's overall mark (and their criterion levels and marks, where they gave them);
  - the moderator's own level and mark for each criterion, with their comment on it, and the overall mark those imply;
  - the AI's own reading of each criterion: its suggested level and its rationale; and
  - the verdict the moderator has chosen, if they have chosen one.
- **What is never sent:** the submission's text, the brief, the original marker's comments, the AI's quoted evidence, another student's material, or anything that is not anonymised. The block holds only the moderator's and the AI's judgements, which were made on approved anonymised text and are anonymised when they are recorded. The AI's rationales may refer to the work in the AI's own words; that is why the moderator reads the block before it is sent.
- **The same gates as other requests.** The moderator sees exactly what will be sent and the worst-case cost, confirms or declines, and the request is rebuilt just before sending and must equal the one confirmed. The proxy accepts this request only as a rubric then the one moderation block, each hashed as shown, refuses the text if it contains what looks like a direct identifier, and applies the same spend limit. A blind review's marking can't be used before it has been revealed.
- **The overall comment on the sample.** On Export, the same way, the moderator can ask the AI to suggest the overall comment for the moderation record and the moderation form. It is sent one block alone (instructions `overall-comment-v1`): how the sample was chosen and, for each sampled submission, the original marker's overall mark, the overall mark the moderator's criterion marks implied, the mark they suggested, their verdict and their comment on it. Never a rubric, a submission, the brief, the AI reading or the marker's comments. It needs a verdict on every sampled submission that still stands. The suggestion is shown beside the box, not put in it; a comment that began as one is recorded on the approved record as derived from the AI. The instructions say a small sample can't show how the marker marked the rest, and not to generalise beyond it.
- **Needs a complete review:** the submission's text must be approved, its AI reading current, the original marking present with an overall mark, and every criterion judged by the moderator, since the suggestion is made from those. Otherwise it says what is missing and sends nothing.
- **Recorded:** each call leaves a record and its raw response, privately, as other calls do; the verdict records whether its verdict was taken from the AI and whether its comment was derived from it.

## Options considered

| Option | Why not chosen |
| --- | --- |
| Send the submission's text as well | It would send more of a student's work than the judgement needs, for a comment the AI's own rationales already support. |
| Fill in the verdict and comment as soon as the suggestion arrives | The moderator decides the verdict and every word of its comment; a suggestion is an aid, and a verdict that is already chosen or a comment already written is not overwritten. |
| Send nothing the AI wrote, only the moderator's marks | The comment is meant to say why, in the work's terms, and the AI's rationales are where those are. |

## Decision test

1. **Educator authority:** unchanged. The suggestion is text in a box; the verdict and its comment are recorded only by the moderator, and a comment from the AI is recorded as such.
2. **Explainable behaviour:** the block sent is shown in full beforehand, and what is in it is listed above.
3. **Sensitive-data exposure:** nothing new about a student leaves the machine beyond what the approved text already allowed to be read: the request holds judgements and rationales, no submission text, no names, and is checked for identifiers.
4. **Institutional control:** the moderator confirms each request and its cost; the proxy holds the key and the limit.
5. **Moderation and consistency:** the verdict still rests on the moderator's own judgements, recorded as before; the suggestion is checked by them against the marks.
6. **Accessible and sustainable:** the request, its cost and its result are in the same places as for the AI reading, and keyboard and screen-reader use are checked like every other screen.

## Consequences

- A new prompt, `verdict-comment-v1`, and a request shape the proxy accepts for it.
- The approved record gains `overall_comment_derived_from_ai`, and the verdict record gains `verdict_taken_from_ai` and `comment_derived_from_ai`; both cores, the schema and the conformance cases are updated.
- `docs/data-handling.md` and the runbook describe the request.
