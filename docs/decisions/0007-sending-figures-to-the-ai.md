# 0007: Sending a submission's figures to the AI

- **Status:** Accepted (maintainer decision, 2026-10-05)
- **Date:** 2026-10-05

In this record, **the AI** means the AI service Feedbacker sends material to, through the local proxy (at present Claude, through Anthropic's service).

## Context

Feedbacker has sent the AI only text. Where a criterion rests on visual work (a dashboard, a chart, a design), the AI can judge only the student's description of it, and the instructions now tell it to report too little evidence instead. In real use, in moderation and in marking, those criteria came back as "missing evidence": honest, but no help where the visual work carries the marks.

Extraction now keeps each figure (an embedded image) of a submission locally, in the workspace's private area, and marks where it was in the text with a placeholder such as `[FIGURE_1]`. On Anonymisation, the educator reviews each figure with the text, can choose not to send any of them, and approves the text and the included figures together: the approval records each figure's hash, and any change clears it.

Images carry a risk that text does not. Redaction works on text, so it can't see inside an image. A screenshot can show a name, an email, a username, a file path, an organisation or a face. The educator's review is the only control, as it already is for indirect identifiers in text.

Until now, `PRODUCT.md`'s rules have let the AI be sent only text. Sending images needs a recorded decision. This is that decision.

## Decision

**A submission's approved figures may be sent with its AI reading (moderation) and its AI proposals (marking).** Nothing else is sent images: not drafting feedback, not suggesting an edit, not the brief.

What is sent of a figure:

- its image as it was extracted, and approved: a docx image's own file, or a PDF image's pixels as PNG;
- in the submission, where its placeholder is, so the AI reads it in its place in the work;
- only if it is included, approved with the text, and its stored image still matches the hash approved;
- only in a format the AI accepts (JPEG, PNG, GIF, WebP). A figure in another format (EMF, WMF, TIFF, BMP, SVG) is not sent; its placeholder says so.

**Governance is the text's.**

- Only the approved text and the approved figures are sent. The request is rebuilt just before it is sent, from what is recorded, and must match what the educator confirmed.
- The proxy accepts an image only if its hash is one of the figures approved with that submission, as the request states them under the approval, and refuses the request otherwise.
- The egress log records each figure's hash, never its content.
- Each reading or proposal records which figures it was sent, by placeholder and hash. The exact-match reuse key includes them, so a reading is reused only if the same figures would be sent.
- The educator can read without the figures: each run has an **Include the approved figures** option, on by default, as the brief has.

**Cost and limits are checked before anything is sent.** The worst-case estimate counts each figure at the provider's documented token cost for its size, up to its cap per image. The provider's limits are checked first, with a clear message saying which figure to leave out:

- a format it accepts;
- each image within its size limits, in bytes and pixels, including the stricter pixel limit for a request with many images;
- the number of images per request;
- the whole request within the provider's request-size limit, and a batch within its limits.

**The provider's terms apply to images as to text.** Inputs are excluded from model training by default, and retained only as the provider's terms state. An institution that adopts Feedbacker must confirm that its agreement with the provider covers images of students' work, as well as text.

## Options considered

| Option | Decision |
| --- | --- |
| Keep sending text only | **Rejected.** Criteria about visual work can't be read, and real use showed it. |
| Describe each figure locally, as text, and send that | **Rejected.** Feedbacker has no local model to do it, and a description is only as good as the describer. |
| Send every figure without review | **Rejected.** Redaction can't see inside an image; the educator's review is the only control. |
| Send approved figures, each at its place in the text | **Adopted.** |
| Resize or re-encode figures locally first | **Not now.** Sending the approved image unchanged keeps what was reviewed exactly what is sent; a figure over a limit is reported, to be left out. It may come later, as its own decision. |
| Send figures when drafting feedback too | **Not now.** Drafts start from the educator's marks and comments, and the proposals have already seen the figures. It would be its own decision (ADR 0006). |

## Decision test

1. **Educator authority:** nothing is sent that the educator hasn't reviewed and approved, figure by figure, and they can leave any figure out, or every figure, for any run.
2. **Explainable behaviour:** each reading or proposal records the figures it was sent, by placeholder and hash.
3. **Sensitive-data exposure:** more is sent (images of students' work), and redaction can't check them, so they are sent only when reviewed and approved, and are kept out of every other request.
4. **Institutional control:** the same proxy, provider interface, spend controls and egress log. An institution must confirm its provider agreement covers images.
5. **Consistency:** every submission's figures pass the same review, approval and checks.
6. **Accessible and sustainable:** no new service or store; images travel in the existing request.

## Consequences

- `PRODUCT.md`'s rules on what the AI may be sent, `docs/data-handling.md`, the runbook and the proxy README describe figures.
- The request gains image parts in the submission, and the proxy's boundary check, leak check, cost estimate and egress log handle them.
- Readings, proposals, call records, and the moderation and marking records gain the figures each was sent; the contract covers them.
- The reading and proposal instructions are revised to say which figures are included and that an excluded one is evidence neither way (a new prompt version, which the maintainer reviews).
