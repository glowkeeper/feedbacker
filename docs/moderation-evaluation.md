# Moderation evaluation

The evaluation of moderation, the first use of this generation of Feedbacker, recorded by the maintainer on 2026-09-29 after using Feedbacker on a real moderation, and extended on 2026-11-08 after moderating modules with several assessments.

This repository is public, so the moderation is described only in general terms: no institution, module, staff, students, identifiers, marks or submission content.

## What had to be shown

From [`PRODUCT.md`](../PRODUCT.md): before moving on, the maintainer was to use it for a real moderation, and record an evaluation of whether it saved time without compromising their judgement, and whether the AI reading was useful, misleading or neutral.

## What was used

One real external moderation, run end to end in the app:

- the moderation request and its sample, recorded from the moderation form;
- the sampled submissions (typed, docx converted to PDF by the marking platform) and the marker's marked views, each from a bulk download of the marking platform;
- the module's own rubric as the source rubric, and the assessment brief;
- local anonymisation, reviewed and approved text by text;
- the AI reading, through the local proxy, with the moderator's own key;
- open review of every submission, with a judgement for every criterion and a verdict on each submission's marking;
- an approved moderation record, exported as the structured record and the readable summary (with a re-identified copy available for the moderation form).

Every submission was reviewed openly, as is usual in moderation, so there are no blind first-and-revised judgements to compare.

## The evaluation

**Did it save time without compromising the moderator's judgement?** Yes. It saved time, and it did not compromise the moderator's judgement: it aided it.

**Was the AI reading useful, misleading or neutral?** Useful. It gave an independent second reading of each criterion, with quoted evidence and a rationale, beside the original marking.

Two things qualified that usefulness in this run, and both are addressed or tracked:

- The first version of the reading's instructions read generously, placing work a level or more above the marking. They were revised (`reading-v2`), after the maintainer reviewed the wording, to read the points on the UK higher-education scale, raise a level only when its descriptor is clearly met, and not credit fluency.
- The AI sees only a submission's text. On an assignment where visual work carries much of the marks, it judged a visual criterion from the student's description of their charts; `reading-v2` now tells it not to, and to report too little evidence instead. Sending approved figures is planned.

## What real use changed

Using Feedbacker on a real moderation found problems that the synthetic fixtures had not, and each was fixed before the moderation was completed:

- Progress while the AI reading is sent; each criterion's outcome shown beside its button; starting a judgement from the AI reading, with the level recorded as taken from it; the revised reading instructions.
- The marker's differently named criteria matched to the rubric by picking, not typing; no `KEY=VALUE` text entry anywhere in the app; overall marks in the comparison.
- Out-of-date judgements flagged beside each criterion, with **Record it again**; a level taken from the AI bound to that reading; a stale blind revision no longer stuck.
- A mark within each level (the moderator's usual 2-5-8 within a band), the overall the marks imply, and the suggested mark starting from it.
- The implied mark in the summary where no mark was suggested; the re-identified copy confirmed only when asked for.

## A module with several assessments

The maintainer then moderated real modules with more than one assessment, recorded here on 2026-11-08: five moderations across six assessments, started from the materials as the institution and the marking platform supply them. Again this is described only in general terms.

**What was used.** A request document (including a PDF) listing the whole cohort with marks, from which the moderator chose the sample; one brief covering several assessments; rubrics held only as images; downloads already unzipped into folders; and, where the marked views carried no marking, the request's marks as the original marking. The same workflow as before followed: local anonymisation, the AI reading through the local proxy, open review, and an approved record.

**Did it save time without compromising the moderator's judgement?** Yes, and by a wide margin. It saved a great deal of time, and the maintainer found the quality of the moderation much better than before.

**What worked.** Grouping a module's assessments; the whole-cohort view and the sampling scheme; finding sampled students in the downloads by name; the rubric from an image; using one assessment's section of a brief; the request's marks as the original marking; the AI's suggested verdict and comment; the review and the comparison.

**What real use changed.** The first of these moderations found problems the synthetic fixtures had not, and later ones found one or two more. Nearly all were fixed: not importing a module's brief and request again for each assessment; a clearer sign that the AI is working; a clearer choice when a submission has more figures than can be sent; saying exactly what matched when a check refuses text, and not taking tables of decimals for phone numbers or metric names for email addresses; easier closing of a workspace and moving between a module and its assessments; names that wrap onto a second line in a request PDF; and approving many texts by exception in one recorded action.

**What remains.** Marking and moderating a very large cohort would still be slow, because reading and approving each text is heavy at that size. Work to make it quicker is planned and not yet built.

**The moderator's view of the whole.** Workable, if somewhat complex, and becoming less so as it is used and refined.

## Limits of this evidence

- Five moderations across six assessments, all by one moderator: the maintainer's own experience, not a measured comparison.
- Open review only, so the cleanest evidence named above (blind first and revised judgements) was not gathered.
- Very large cohorts have not been tried, and are expected to remain slow until the planned work on them is done.
- The interface works for the whole workflow but needs more work.

## Decision

What had to be shown has been shown: real moderation use shows AI-assisted second reading is worth building on. What comes next is a separate decision for the maintainer, taken from `PRODUCT.md`'s direction; later directions are not committed scope.
