# For institutions: data protection, the AI provider and governance

For learning technologists, data protection officers and others assessing whether educators may use Feedbacker with students' work. It describes Feedbacker as built, in plain language, and links to where each point is decided or implemented.

It is not legal advice, and it claims no certification or compliance. Your institution makes its own assessment; this page is meant to support it. Read it with [responsible use and known limits](responsible-use.md).

## At a glance

- **No hosted service.** Feedbacker has no accounts and no server of its own: the material stays in workspaces the educator keeps, on their computer or on storage your institution allows. What the educator approves is sent to the AI provider, which processes it, and may retain it, under its own terms.
- **Only what the educator approves is sent to the AI,** and only when they confirm it: anonymised text, and images (figures) the educator has reviewed but which are **not** anonymised. Names and identifiers in the text are replaced on the educator's computer first, but rule-based anonymisation can miss some, so the educator's review is the safeguard.
- **The AI never gives a mark, and nothing is released without the educator's approval.** Feedbacker never sends marks or feedback to students or to your systems.
- **One AI provider today:** Anthropic (Claude), reached with the educator's or your institution's own API key, through a small program on the educator's computer that holds the key and records what it sends.
- **Every AI contribution is traceable,** to the AI, the instructions and what it was sent, and feedback adapted from it is marked as such.

## Where the material lives

- Each piece of work (a moderation, or the marking of a cohort) is a **workspace**: a folder the educator chooses, on their own disk or on storage your institution allows (a network share or a synced drive, say). Where it is decides who else can reach it. Feedbacker refuses to create or open one inside a code repository.
- The browser holds only a handle to reopen the folder, never any records. The app runs in Chrome or Edge, and talks only to a small local program, the **Feedbacker proxy**, on the same computer. The proxy is reachable only from that computer, and only with a token it issues each time it starts.
- The **pseudonym key**, which links each pseudonym (for example `[STUDENT_A]`) to a student's name and platform ID, is kept in the workspace's private folder, and is never sent to the AI. On macOS and Linux, the proxy makes that folder readable only by the educator's user account. **On Windows it can't:** those file permissions don't apply there, so rely on the access controls of wherever the workspace is kept.
- In marking, the whole cohort's submissions are imported from the marking platform's bulk download. In moderation, only the sampled submissions are imported; other students' files aren't opened.

Detail: [Where material lives](data-handling.md#where-material-lives), [Bulk downloads](data-handling.md#bulk-downloads), [Pseudonym key](data-handling.md#pseudonym-key), [ADR 0004](decisions/0004-typescript-browser-core-and-local-proxy.md).

## What is sent to the AI, and when

Nothing is sent until the educator has reviewed and approved the anonymised material and confirmed the request, having seen a worst-case cost. Each request is rebuilt from what is recorded just before it is sent, and must match what was approved, or nothing is sent.

| When the educator asks for | The AI is sent | Never |
| --- | --- | --- |
| An AI reading (moderation) or proposals (marking) | The approved anonymised submission, the approved anonymised brief (optional), the rubric, and the submission's approved figures (optional) | Anyone's marks or comments |
| Feedback drafts (marking) | As above but without figures, plus the educator's own levels, marks and comments for that one student, and their approved feedback guide | Another student's material; the AI's own earlier proposals |
| A suggested edit to flagged feedback (marking) | The educator's recorded feedback on one criterion, the checks' flags on it, their marking of that criterion, and the rubric | The submission, the brief, the guide |

Everything is sent with Feedbacker's versioned instructions to the AI, which are in the code and can be read there.

**Never sent:** the pseudonym key; the original submission files and their document properties (author and so on); any other student's material; in moderation, the original marker's marks and comments, or the moderator's judgements. Names and identifiers aren't sent deliberately, but one can still reach the AI if anonymisation misses it in the text, or if a figure shows it.

Detail: [What may leave the machine](data-handling.md#what-may-leave-the-machine), [ADR 0006](decisions/0006-what-the-ai-may-be-sent-when-drafting-feedback.md) (drafting and suggested edits), [ADR 0007](decisions/0007-sending-figures-to-the-ai.md) (figures).

## Anonymisation, and its limits

- Text is extracted on the educator's computer, and the submission document's properties (author and so on) are discarded. Alternative text a student gave a figure in a Word document is kept as part of the text, so it is anonymised and reviewed with it.
- Names, identifiers, emails, links and phone numbers are replaced with consistent tokens. Students' own names come from Turnitin downloads' file names; a Canvas download runs a name's parts together, so the educator adds Canvas students' names to the rules. The educator also adds other people's names and organisations.
- The educator reviews every anonymised text, and can see what each token replaced, before approving it. Any later change clears the approval, and a text that newer rules would redact further is not sent until it is anonymised and approved again.
- **Its limits:** it is rule-based, so it can miss a name nobody listed (a peer, a client, an interviewee) and indirect identifiers (an employer, a project). **It can't see inside images:** a screenshot may show a name, an email, a username or a face. The educator reviews each figure and can choose not to send any of them. The educator's review is the control for both.
- **Images' hidden metadata is removed.** Image files can carry metadata the educator's review can't see: a photo's camera details, date or location, or an author's name. When a figure is extracted from a Word document, that metadata is removed (EXIF, XMP, IPTC, text chunks and comments, wherever they are in the file; only what draws the picture is kept). This is done for the types the AI can be sent (JPEG, PNG, GIF, WebP). An image in another type (EMF or TIFF, say), or one that can't be read, is marked where it was, but its file isn't kept, and it is never sent. A figure from a PDF is rebuilt from its pixels, so it carries none. So what the educator reviews is what can be sent.

Detail: [Anonymisation](data-handling.md#anonymisation).

## The AI provider

- **Anthropic's Claude**, through Anthropic's API. Claude Sonnet is used by default. If it declines a reading, proposals or a draft on safety grounds, the same approved request may be sent once to Claude Opus: only when the fallback is on (it is by default) and the run's spend limit allows, and both calls are recorded. A run sent as a batch doesn't fall back (a declined request is reported, to be sent again one at a time), and a suggested edit is one call.
- **The key:** your institution's or the educator's own API key, read by the local proxy on the educator's computer from its environment or a file in the educator's home folder (`~/Feedbacker/.env`). It is never sent to the AI or to the browser, and never logged or exported. Keep that file off shared or synced storage, readable only by the educator.
- **Feedbacker's requirement of any provider:** it must exclude API inputs and outputs from training by default, and retain data only for a limited period, as its terms state. **Check Anthropic's current terms yourself**, before first use and whenever they change, including that your agreement covers images of students' work.
- **What the provider may keep:** part of a request (the instructions, the rubric, the brief and, when drafting, the feedback guide; never a submission) may be held in its prompt cache for five minutes, to lower the cost of later requests. If the educator sends a run as a batch, the provider keeps the results for 29 days so they can be collected.
- **Spend:** the educator sees a worst-case estimate before each run, and each run stops at a spend limit (by default, $5). A monthly limit in the provider's console is a further safeguard.
- Only one provider is supported today. Feedbacker is built so that others can be added, each through the same checks.

Detail: [Model provider requirements](data-handling.md#model-provider-requirements), [API keys and spend](data-handling.md#api-keys-and-spend), [ADR 0003](decisions/0003-provider-boundary-and-spend-control.md), [ADR 0005](decisions/0005-model-cost-reduction.md).

## Records and audit

- **In the workspace:** every request's record (the AI used, the instructions' version, hashes of what was sent and of the approvals it was sent under, the figures sent, token use and cost) and the AI's raw reply. Every proposal, draft and suggestion records where it came from, and feedback adapted from one is recorded as derived from the AI, however much it is changed.
- **On the educator's computer, outside the workspace:** the proxy's **egress log**, one line per request it sent or refused: the time, the AI, a hash of what was sent (and of each image), the outcome, token use and cost. It holds no text and no names. Entries are removed after 90 days by default.
- **Exports** are pseudonymous: the structured record (for audit), and readable summaries or each student's feedback. A copy with each student's platform ID in place of their pseudonym is made only when the educator confirms it, each time, and nothing else is restored.

Detail: [Exports](data-handling.md#exports), [the proxy's egress log](../proxy/README.md).

## Retention and deletion

- When an educator creates a workspace, Feedbacker records how long its material may be kept (90 days by default), for example under your institution's terms. It doesn't yet remind anyone when that has passed: deleting is the educator's action.
- Deleting a workspace removes the whole folder, and everything in it, in one action, once its exports have been listed and the workspace's name typed. Bulk downloads the educator saved are theirs to delete.
- The provider's own retention is governed by its terms (above).

Detail: [Retention and deletion](data-handling.md#retention-and-deletion).

## Security

- No hosted endpoint, no accounts, and no shared key: each user runs their own copy with their own key.
- The app loads no third-party scripts and may connect only to the local proxy. The proxy accepts requests only from the same computer, with its session token, and checks every request against what may be sent before it leaves.

Detail: [Why there is no authentication](data-handling.md#why-there-is-no-authentication), [Incidents](data-handling.md#incidents).

## What your institution needs to confirm

Feedbacker can't decide these for you:

- [ ] That using AI assistance in marking or moderation is acceptable for the assessments concerned, and whether and how students are told.
- [ ] That your agreement with the AI provider (Anthropic) covers students' work, images included, and that its terms on training and retention meet your requirements.
- [ ] Who holds the API key: each educator, or your institution.
- [ ] How long material may be kept, so educators set the retention period correctly, and who deletes it.
- [ ] Where exports may be kept, and for how long.
- [ ] That educators using it understand the review they are responsible for: anonymised text, images, and everything released.
- [ ] Any data protection impact assessment your institution requires.

## Where to read more

- [Responsible use and known limits](responsible-use.md)
- [How data is handled, in full](data-handling.md)
- [Decision records](decisions/)
- [The runbook](runbook.md): moderation and marking, step by step
