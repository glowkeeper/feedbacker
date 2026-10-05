# Marking and feedback evaluation

The evaluation of marking and feedback, recorded by the maintainer on 2026-10-05 after marking a real cohort with Feedbacker while it was being finished.

This repository is public, so the cohort is described only by its structure: no institution, module, students, identifiers, marks or submission content.

## What had to be shown

From [`PRODUCT.md`](../PRODUCT.md): the maintainer marks a real cohort with it and records an evaluation covering time saved; how often proposals and drafts were edited or rejected; whether feedback matched the marks (how often the checks raised a flag, how often a flag was overridden, and why); confirmation that no mark or feedback was released without explicit approval; and any demonstrated need to coordinate with other markers.

## What was used

One real cohort of three typed submissions, marked against a five-criterion rubric, run end to end in the app:

- the assessment's details, rubric and brief;
- the submissions imported from the marking platform's bulk download, anonymised locally, reviewed and approved;
- the AI's proposals, through the local proxy, with the maintainer's own key;
- open marking of every criterion of every submission, and an overall mark for each;
- feedback drafted by the AI from the maintainer's own marks and comments, checked, recorded and approved;
- the export: each student's feedback, the marks table and the structured record, with a re-identified copy.

Every submission was marked openly, so there are no blind first-and-revised judgements to compare.

## The evaluation

**Time saved.** Not measured: the maintainer judged that a timed run would add little. Their verdict is that it works well.

**Proposals.** The AI proposed a level for 12 of the 15 criterion judgements. The maintainer's level matched the proposal in all 12, recorded by taking the proposed level. Every criterion comment was the maintainer's own; none was started from the AI's draft comment.

**Drafts.** All 18 pieces of recorded feedback (five criteria and the overall, for each of three students) started from an AI draft, and each final text is a draft as the AI wrote it. Getting there took drafting again: the workspace history holds 27 earlier versions of recorded feedback, and the early drafts that came back cut short, or with a stray quote, were drafted again with the revised instructions (below) rather than edited by hand.

**Feedback against the marks.** Four flags were accepted, all "another mark or level named", and all with the reason "Quoting a figure from the submission": a figure from the student's own work, not a mark. Flags cleared by changing or redrafting the text are not recorded, so how often a flag was raised in all is not known.

**Approval.** All three submissions were approved by the maintainer before export, and only approved submissions were exported. Export takes only submissions whose approval matches what they are now, and any later change clears an approval.

**Coordination with other markers.** Not shown. This was one educator marking their own cohort, and nothing in it called for coordination with other markers.

## What real use changed

Marking a real cohort found problems that the synthetic fixtures had not, and each was fixed before it was completed:

- On setup, weights labelled as percentages, with a note when they disagree with the criterion names; levels summarised from lowest to highest; the brief anonymised before the submissions.
- On marking, a draft comment from the AI to start from, recorded as derived from it; an overall mark that shows only the mark, and is flagged to check again when a criterion changes.
- On feedback, revised drafting instructions, after the maintainer reviewed the wording: replies that a double quote had cut short now come back whole, and a check flags text that ends mid-sentence. One criterion can be drafted again on its own, including to avoid flagged praise words; a box still holding the old draft takes the new one; drafts and flags are marked out of date when a mark changes; batches sent with earlier instructions can still be collected.
- On export, outcomes shown beside the button that caused them, and a re-identified copy made only from what is approved.

## Next

Marking and feedback is complete. One educator's use showed no need to coordinate with other markers, so the move to team marking is not yet indicated. Calibration, in which several markers mark the same fictional scripts and compare, needs no student data and may come first; where it sits is being decided.
