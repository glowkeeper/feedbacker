# 0009: Sending the image of a rubric to the AI, to propose a transcription

- **Status:** Accepted (maintainer decision, 2026-10-27)
- **Date:** 2026-10-27

In this record, **the AI** means the AI service Feedbacker sends material to, through the local proxy (at present Claude, through Anthropic's service).

## Context

Some rubrics reach a moderator only as a picture: a screenshot of the marking platform's rubric. Feedbacker can't read a picture itself (it has no OCR), so a rubric entered from an image has had to be typed into a grid beside it: a rubric of four criteria and eight levels has thirty-two descriptors to copy. Typing it by hand is slow and invites slips; asking the AI to read the image saves the typing.

The image of a rubric is module material: the task's marking criteria. It is not student work and carries no student's name or ID, so it is not the sensitive data that the AI data boundary in `PRODUCT.md` exists to protect. But the boundary lists what the AI may be sent, and it has not included an image of a rubric. Sending one needs a recorded decision. This is that decision.

An AI's reading of an image can be wrong: a misread number, a dropped level, a descriptor run into the next. The rubric governs every later comparison, so a proposal must never become the rubric unchecked.

## Decision

**The image of a rubric may be sent to the AI, on its own, to propose a transcription.** Nothing else is sent in that request: no student's text or marks, no brief, no pseudonym, no submission.

- **A separate request kind.** The proxy accepts a *rubric transcription request*, recognisable by its instructions' version (`rubric-transcription-v1`, and later versions), whose only block is the rubric's image. A reading, a marking proposal and a drafting request cannot carry an image of a rubric, and a transcription request can carry nothing but one. The proxy refuses any other shape, before anything is sent.
- **Approved as it is sent.** The moderator chooses the image and presses a button; before anything is sent the app shows exactly what will be, and the worst-case cost, and sends only on their confirmation. The request records the image's hash as its approval, the proxy refuses an image that doesn't match it, and the egress log records the image's hash, never its content.
- **Without hidden metadata.** The image is sent as every image the AI is sent is, without the metadata a picture can carry (names, places, text chunks), which neither the preview nor the text leak checks would show. The cleaned image is what the moderator confirms and what the request approves (by its hash); the original stays in the workspace as the rubric's source, and the record keeps both hashes. An image whose metadata can't be removed is not sent.
- **Controlled like any call.** The request goes through the local proxy, which holds the key, applies the spend limit the moderator set for the run, refuses a model without a known price, and applies its checks for apparent identifiers to the text and instructions that accompany the image.
- **A proposal, never a rubric.** The proposed transcription fills the rubric editor's grid, marked as the AI's, for the moderator to check against the image and edit. Nothing is saved until they save it. The editor's checks (weights adding to the total, ranges following the pattern the rubric itself follows) run on a proposal as on typed cells, and flag what departs.
- **Recorded.** A rubric saved from a proposal records that it began as the AI's proposal: the call's request hash, model, request ID and time, and the image's hash, in the workspace beside the rubric. The moderator's confirmation is their saving it.

## Options considered

| Option | Decision |
| --- | --- |
| Type the grid by hand (the editor without a proposal) | **Kept as the fallback.** It remains for a moderator who prefers it, or has no key. |
| Read the image locally (OCR) | **Not now.** Feedbacker has no local model, and OCR of a table of small type is poor. |
| Send the image with other material (the brief, a submission) | **Rejected.** Nothing but the image is needed, and a request with nothing else cannot carry a student's material. |
| Save a proposal as the rubric without review | **Rejected.** The rubric governs every comparison; a misread cell would be silent. |
| Send the image without showing what is sent | **Rejected.** The moderator confirms every send, as they do for readings. |

## Decision test

1. **Educator authority:** nothing is sent without the moderator choosing the image and confirming; nothing is saved without their saving it; every cell can be corrected first.
2. **Explainable behaviour:** the saved rubric records that it began as the AI's proposal, with the call's request hash, model and time.
3. **Data minimisation:** only the image, and the instructions that go with it, are sent; the request kind cannot carry anything else.
4. **Provenance:** the image is kept as the rubric's source, with its hash, and the call is recorded beside the rubric.
5. **Replaceable models:** the request goes through the same provider interface, with the same price and spend checks, as every other call.
6. **Accessibility:** the plan, its estimate and its confirmation are plain text and buttons, reachable by keyboard.

## Consequences

- A moderator needs the proxy running with a key to use it; without a key, the button says so and the grid can still be typed.
- An institution that adopts Feedbacker must confirm that its agreement with the provider covers images of its rubrics. They are module material rather than students' work, but they are the institution's.
- A proposal can be wrong. The editor's pattern checks catch the slips a pattern can catch, and the moderator's check against the image catches the rest; neither is a guarantee, which is why a proposal is never the rubric until it is saved by the moderator.
