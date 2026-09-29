# Stage 0 evaluation

The stage-gate evaluation for Stage 0 (issue #10), recorded by the maintainer on 2026-09-29 after using Feedbacker on a real moderation.

This repository is public, so the moderation is described only in general terms: no institution, module, staff, students, identifiers, marks or submission content.

## The stage gate

From [`PRODUCT.md`](../PRODUCT.md): Stage 0 advances when the maintainer has used it for a real moderation, and has recorded an evaluation of whether it saved time without compromising their judgement, and whether the AI reading was useful, misleading or neutral.

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

- The first version of the reading's instructions read generously, placing work a level or more above the marking. They were revised (`reading-v2`, #96), after the maintainer reviewed the wording, to read the points on the UK higher-education scale, raise a level only when its descriptor is clearly met, and not credit fluency.
- The model sees only a submission's text. On an assignment where visual work carries much of the marks, it judged a visual criterion from the student's description of their charts; `reading-v2` now tells it not to, and to report too little evidence instead. Sending approved figures is planned in #91.

## What real use changed

Using Stage 0 on a real moderation found problems that the synthetic fixtures had not, and each was fixed before the moderation was completed:

- #96: progress while the AI reading is sent; each criterion's outcome shown beside its button; starting a judgement from the AI reading, with the level recorded as taken from it; the revised reading instructions.
- #97: the marker's differently named criteria matched to the rubric by picking, not typing; no `KEY=VALUE` text entry anywhere in the app; overall marks in the comparison.
- #98: out-of-date judgements flagged beside each criterion, with **Record it again**; a level taken from the AI bound to that reading; a stale blind revision no longer stuck.
- #99: a mark within each level (the moderator's usual 2-5-8 within a band), the overall the marks imply, and the suggested mark starting from it.
- #100: the implied mark in the summary where no mark was suggested; the re-identified copy confirmed only when asked for.

## Limits of this evidence

- One moderation, by one moderator: the maintainer's own experience, not a measured comparison.
- Open review only, so the cleanest evidence the stage gate names (blind first and revised judgements) was not gathered.
- The interface works for the whole workflow but needs more work.

## Decision

Stage 0's gate is met: real moderation use shows AI-assisted second reading is worth building on. Issue #10 is complete. What comes next is a separate decision for the maintainer, taken from `PRODUCT.md`'s staged direction; later stages are direction, not committed scope.
