# Responsible use and known limits

What Feedbacker is for, where responsibility lies when you use it, and what it can't do yet. Read this before using it with real students' work.

## Who is responsible for what

**You decide every mark, and you approve everything a student receives.** Feedbacker supports your judgement; it never replaces it.

- **The AI suggests; you decide.** In marking, the AI can propose a level for each criterion, with its reasons and evidence quoted from the submission. In moderation, it gives an independent second reading. Both are suggestions. You can see them before you mark, or only after you have recorded your own levels (blind), and you can always disagree.
- **The AI never gives a mark.** A provisional mark is worked out by Feedbacker, in code, from the levels the AI proposed. It is always shown apart from your mark, and it is never your mark.
- **Feedback starts from your marks.** When the AI drafts feedback, it drafts from your own levels, marks and comments for that one student. You adapt each draft, or write your own, and record it.
- **Feedback is checked against its mark, but you decide.** Feedbacker flags praise that belongs to a higher band than the mark, a missing next step, another mark named, an anonymised value the student would see, and text that ends mid-sentence. A flag never blocks you: change the text, or keep it with a reason.
- **Nothing is released without your approval.** You approve exactly what each student will receive, and any later change clears that approval. Feedbacker never sends feedback or marks to students or to your institution's systems: you copy or export them yourself.
- **You review what the AI may see.** Names, identifiers and contact details are replaced on your computer before anything is sent, and you review and approve each anonymised text, and each figure, before it can be sent. Automated redaction can miss things; your review is the safeguard.
- **Images aren't anonymised.** Redaction works on text only, so a figure (a screenshot, say) may show a name, an email, a username or a face. Check each figure, and don't send one that shows anything identifying. Hidden metadata in an image file (a photo's camera details or location, say) is removed when the figure is extracted, so what you see is what can be sent.

**Feedbacker records where the AI was involved.** Every proposal, draft and suggestion records which AI produced it, from which instructions and what it was sent, and any feedback you adapt from one is recorded as derived from the AI, however much you change it. Whether and how to tell students that AI assisted with their marking or feedback is for your institution's policy, and these records support it.

## What Feedbacker is not for

- Grading without an educator: it never assigns or releases a mark on its own.
- Releasing anything you haven't reviewed and approved.
- Holding assessment data on a hosted service: everything stays on your computer (or your institution's own infrastructure), and only what you approve is sent to the AI.
- Handwritten, scanned or image-only submissions: Feedbacker reads typed text and has no OCR.

## Known limits

- **Browsers:** Chrome or Edge, which provide the folder access Feedbacker needs. Not Firefox or Safari.
- **Installing it** needs some technical set-up for now: a copy of the code, Node.js, and starting Feedbacker from a terminal (see the README).
- **One AI provider:** Anthropic's Claude, through your own API key. You pay for what you send, and each run has a spend limit you set.
- **Marking platforms:** cohorts are imported from Turnitin's and Canvas's bulk downloads, where each student's ID is in the file name. The Canvas form hasn't yet been checked against a real Canvas download. Other platforms' downloads aren't recognised yet; an ID is never guessed.
- **Submissions:** typed `.docx` and `.pdf` files. Images smaller than 32 points either way are left out, and the AI can be sent JPEG, PNG, GIF and WebP figures only; others are kept but not sent.
- **One educator per workspace.** Team marking and calibration across markers are not built yet.
- **The UK higher-education scale.** The AI's instructions read marks against it (70 and above first-class, then upper second, lower second, third, fail), or in proportion on other scales, unless your brief or rubric describes its own bands.
- **The AI can be wrong.** Quotations it gives as evidence are checked against the submission, and any that don't match are marked as unverified. Its levels, reasons and drafts can still be mistaken, generous or harsh: read them as a second opinion.
- **Anonymisation is rule-based.** It catches the names and organisations you add, and emails, links, phone numbers and long identifiers. It takes each student's own name from a Turnitin download's file names; a Canvas download runs a name's parts together, so add each Canvas student's name to the anonymisation rules yourself. It can miss a name nobody listed (a peer, a client, an interviewee), and it can't see inside an image. That is why you review every text and figure before approving it.

## Where to read more

- [How data is handled](data-handling.md): what stays on your computer, what is sent to the AI and when, and what never is.
- [The runbook](runbook.md): moderation and marking, step by step.
- [Project definition](PROJECT.md) and [product direction](../PRODUCT.md): what Feedbacker must never do, and what is built.
- [Decision records](decisions/): why it works the way it does.
