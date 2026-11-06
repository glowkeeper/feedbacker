/**
 * What the website says around the documents it shows (`site-docs.ts` writes the pages): each page's heading, eyebrow and introduction in the
 * site's own voice, the pages worth reading next, the Learn more page, and the panel every page ends with. The documents themselves stay as they
 * are on GitHub; this is the part that is only for the site, and that has the job of helping a visitor go on to use Feedbacker.
 *
 * Titles have no full stop (the page adds it). An introduction is inline Markdown, so it can link to a document by its path.
 */

export interface Copy {
  title?: string;
  eyebrow?: string;
  /** The introduction, under the heading. Without one, the document's own first paragraph is used. */
  intro?: string;
  /** Block Markdown shown before the document's own text. */
  lead?: string;
  /** Markdown written for the site, shown in place of the document's own text (the document stays on GitHub as it is). */
  markdown?: string;
  /** Keep the document's own opening paragraph, below the site's introduction (otherwise the introduction replaces it). */
  keepOpening?: boolean;
  /** Pages worth reading next (their files), in order. */
  also?: string[];
}

/** By the page's file. */
export const COPY: Record<string, Copy> = {
  "getting-started.html": {
    title: "Getting started",
    eyebrow: "Get started",
    intro:
      "Free, on your own computer, and no account to make. For now, setting it up means a few steps in a terminal, so it suits you best if that's comfortable, or if someone who looks after your computers can help. You'll need Chrome or Edge, [Node.js](https://nodejs.org/) 24 or later and an [API key for Anthropic's Claude](https://console.anthropic.com/) (paid for by use). It comes with made-up coursework to try first.",
    lead: "**Stuck, or not comfortable with a terminal?** [Ask for help](/get-help.html): it also helps me see whether an installer is wanted.",
    also: ["get-help.html", "walkthrough.html", "user-guide.html"],
  },
  "user-guide.html": {
    title: "The user guide",
    eyebrow: "User guide",
    intro:
      "Step by step, from your first workspace to the approved export. It follows a moderation first, then marking a whole cohort, which uses many of the same steps. Try it with the made-up coursework first if you like.",
    markdown: `Feedbacker helps you moderate and mark; it does not do either for you. Your judgements, verdicts and comments are yours. The AI reading is a second reading that you may use or ignore, and it is never a mark. Words in **bold** are the app's own labels and buttons.

## Moderating a colleague's marking

Follow the parts in order. Importing the marking before anonymising the texts (steps 8 to 10, in [part 2](/user-guide-your-material.html)) saves approving texts twice.

1. [Set up a moderation](/user-guide-set-up.html): what stays on your computer, starting Feedbacker, creating a workspace, recording the moderation request, and importing the rubric and the brief (steps 1 to 6).
2. [Bring in the marking and the work](/user-guide-your-material.html): downloading and importing the originals and the original marking, and anonymising and approving each text (steps 7 to 10).
3. [Review and finish](/user-guide-review-and-finish.html): the AI reading, your review of each submission, your verdicts, the approved record, returning the moderation form, and deleting everything afterwards (steps 11 to 17).

## Marking a cohort

[Marking a cohort](/user-guide-marking.html) takes you from importing the submissions to marking them, with the AI's proposed levels if you want them, to writing each student's feedback from your marks and approving and exporting it. It refers back to the moderation steps it shares, so read the set-up part first.

## A module with several assessments

[A module with more than one assessment](/user-guide-modules.html) shows how assessments that share a brief, a request and anonymisation rules are grouped.
`,
    keepOpening: true, // the first paragraph of the markdown above: who decides, and what the bold words are
    also: ["getting-started.html", "responsible-use.html", "get-help.html"],
  },
  "user-guide-set-up.html": {
    title: "Set up a moderation",
    eyebrow: "User guide · Part 1 of 3",
    intro: "By the end you have a workspace for the moderation, the request recorded, and the rubric and brief imported. Steps 1 to 6.",
    also: ["user-guide-your-material.html", "user-guide.html", "get-help.html"],
  },
  "user-guide-your-material.html": {
    title: "Bring in the marking and the work",
    eyebrow: "User guide · Part 2 of 3",
    intro: "By the end the original files and marking are in, and every text has been anonymised, checked by you and approved. Steps 7 to 10.",
    also: ["user-guide-review-and-finish.html", "user-guide-set-up.html", "user-guide.html"],
  },
  "user-guide-review-and-finish.html": {
    title: "Review and finish",
    eyebrow: "User guide · Part 3 of 3",
    intro: "By the end you have judged each submission, recorded your verdicts, approved and exported the record, and deleted what you no longer need. Steps 11 to 17.",
    also: ["user-guide-your-material.html", "user-guide.html", "get-help.html"],
  },
  "user-guide-marking.html": {
    title: "Marking a cohort",
    eyebrow: "User guide",
    intro: "From importing every student's submission to approving and exporting each student's feedback. It uses the set-up and anonymisation steps of a moderation, and says where.",
    also: ["user-guide-set-up.html", "user-guide.html", "get-help.html"],
  },
  "user-guide-modules.html": {
    title: "A module with more than one assessment",
    eyebrow: "User guide",
    intro: "Assessments in one module share a brief, a request document and anonymisation rules, so you set them up once.",
    also: ["user-guide.html", "user-guide-set-up.html"],
  },
  "responsible-use.html": {
    title: "Responsible use and known limits",
    eyebrow: "Responsible use",
    intro:
      "Who decides what when you mark with Feedbacker, what it is not for, and what it can't do yet. It's short, and honest about the limits: read it before you use it with real students' work.",
    also: ["data-handling.html", "institutions.html"],
  },
  "data-handling-in-full.html": {
    title: "Data handling in full",
    eyebrow: "Your data",
    intro:
      "The complete reference: where every kind of material lives, exactly what may leave your computer, how names are replaced, and how long things are kept. For the short version, read [How your data is handled](/data-handling.html).",
    also: ["data-handling.html", "institutions.html"],
  },
  "accessibility.html": {
    title: "Accessibility statement",
    eyebrow: "Accessibility",
    intro: "Feedbacker is built to meet WCAG 2.2 AA, and every screen is measured against it. This is what that covers, how it is checked, and where it falls short.",
    also: ["responsible-use.html", "security.html"],
  },
  "marking-evaluation.html": {
    title: "Marking and feedback, used for real",
    eyebrow: "Evidence",
    intro: "I marked a real cohort with Feedbacker and wrote down what happened. This is that account.",
    markdown: `## What I did

I marked one real cohort of three typed submissions against a five-criterion rubric, from start to finish in Feedbacker. I imported the submissions from the marking platform's bulk download, anonymised and approved each one, asked the AI for proposed levels, marked every criterion myself, drafted feedback from my own marks and comments, checked it, approved it and exported it. This is public, so I can't say which institution, module or students: the cohort is described only by its shape.

## What I found

- **The AI proposed a level for 12 of my 15 criterion judgements, and my level matched all 12.** I marked with the proposals showing, so that is not a test of whether the AI agrees with an independent marker.
- **The feedback needed drafting again.** All 18 pieces of feedback (five criteria and an overall comment for each of three students) started from an AI draft. The first drafts sometimes came back cut short, or with a stray quote, so I revised the instructions and drafted them again instead of editing by hand. The history holds 27 earlier versions.
- **I accepted four flags, and all four were false alarms.** Each was a flag for naming another mark, and each was a figure I had quoted from the student's own work, not a mark. Flags I cleared by changing or redrafting the text weren't recorded, so I don't know how many were raised in all.
- **Nothing was released without my approval.** All three submissions were approved before export, and only approved work was exported.
- **I didn't time it.** I judged that a timed run would add little. My verdict is that it works well.

## What it changed

Marking a real cohort found problems the made-up coursework hadn't: how weights were labelled, drafting instructions that produced cut-off replies, and unclear outcomes on export. I fixed each before I finished.

## The limits

This is one educator and three submissions. I marked openly, so there is no blind comparison, and I didn't measure the time saved. It showed no need yet for several markers to coordinate.
`,
    also: ["moderation-evaluation.html", "user-guide-marking.html"],
  },
  "moderation-evaluation.html": {
    title: "Moderation, used for real",
    eyebrow: "Evidence",
    intro: "Moderation was the first thing Feedbacker was built for. I used it on a real moderation and wrote down what happened.",
    markdown: `## What I did

I used Feedbacker on one real external moderation, from the moderation request to the exported record. I took the sample, the original marker's marked views and the rubric from the marking platform, anonymised and approved each text, asked for an independent AI reading of each submission, judged every criterion myself, gave a verdict on each submission's marking, and exported the approved record for the moderation form. I can't name the institution, module, staff or students.

## What I found

- **It saved time, and it didn't compromise my judgement: it aided it.**
- **The AI reading was useful.** It gave an independent second reading of each criterion, with quoted evidence and a rationale, beside the original marking.
- **Its first instructions read too generously.** It placed work a level or more above the marking. I revised them so it reads the points on the UK scale, raises a level only when the descriptor is clearly met, and doesn't credit fluency.
- **It judged a visual criterion from a description.** It saw only the text, so on an assignment where charts carried the marks it relied on the student's description of them. It is now told not to, and to say there is too little evidence. Feedbacker can now also send the images you approve.

## What it changed

Real use found problems the made-up coursework hadn't, and I fixed each before I finished: progress while the AI reads, each outcome shown beside its button, matching the marker's differently named criteria by picking instead of typing, out-of-date judgements flagged, a mark within each level, and the overall mark my criterion marks imply.

## The limits

This is one moderation, by one moderator: my own experience, not a measured comparison. I reviewed openly, so I haven't gathered the cleanest evidence, which would compare blind first judgements with revised ones. The interface worked for the whole workflow but needs more work.
`,
    also: ["marking-evaluation.html", "user-guide.html"],
  },
  "security.html": { eyebrow: "Security", also: ["data-handling.html", "institutions.html"] },
  "licence.html": {
    title: "Open source, under Apache 2.0",
    eyebrow: "Licence",
    intro: "Feedbacker is free and open source. The notice, then the licence in full.",
  },
};

/** How a page is named in a list of pages to read next, and on the Learn more page. */
export const LABELS: Record<string, string> = {
  "getting-started.html": "Getting started",
  "walkthrough.html": "See it in use",
  "user-guide.html": "The user guide",
  "responsible-use.html": "Responsible use and known limits",
  "data-handling.html": "How your data is handled",
  "data-handling-in-full.html": "Data handling in full",
  "institutions.html": "For institutions",
  "accessibility.html": "Accessibility statement",
  "security.html": "Security policy",
  "get-help.html": "Get help",
  "user-guide-set-up.html": "Part 1: Set up a moderation",
  "user-guide-your-material.html": "Part 2: Bring in the marking and the work",
  "user-guide-review-and-finish.html": "Part 3: Review and finish",
  "user-guide-marking.html": "Marking a cohort",
  "user-guide-modules.html": "A module with more than one assessment",
  "licence.html": "Open source, under Apache 2.0",
  "marking-evaluation.html": "Marking and feedback, used for real",
  "moderation-evaluation.html": "Moderation, used for real",
};

/** The panel every page ends with. Its own link is left out of it. */
export const PANEL = {
  eyebrow: "Next",
  heading: "Try Feedbacker with the made-up coursework.",
  text: "Free, open source, and it runs on your own computer. Nothing about real students goes anywhere until you approve it.",
  links: [
    ["getting-started.html", "Getting started"],
    ["walkthrough.html", "See it in use"],
    ["learn-more.html", "Learn more"],
  ] as [string, string][],
};

export const HUB = {
  title: "Learn more about Feedbacker",
  eyebrow: "Learn more",
  intro: "Everything behind the home page, in the order most people want it.",
  groups: [
    {
      title: "Start",
      items: [
        ["getting-started.html", "What you need, and the few steps to set it up."],
        ["get-help.html", "Stuck, or not comfortable with a terminal? Ask."],
        ["walkthrough.html", "Marking and moderation in pictures, with made-up coursework."],
        ["user-guide.html", "Every step of a moderation, and of marking a cohort."],
      ],
    },
    {
      title: "Trust",
      items: [
        ["responsible-use.html", "Who decides what, what it is not for, and what it can't do yet."],
        ["data-handling.html", "Your students' work stays on your computer, and the AI sees only what you approve."],
        ["data-handling-in-full.html", "The complete reference on where material lives and what may leave your computer."],
        ["institutions.html", "For data protection officers and learning technologists."],
        ["accessibility.html", "How it is checked against WCAG 2.2 AA, and where it falls short."],
        ["security.html", "How to report a vulnerability privately."],
        ["licence.html", "Free and open source."],
      ],
    },
    {
      title: "Evidence",
      items: [
        ["marking-evaluation.html", "The developer's account of marking a real cohort."],
        ["moderation-evaluation.html", "The developer's account of moderating real marking."],
      ],
    },
  ] as { title: string; items: [string, string][] }[],
  help: {
    title: "Help build it",
    items: [
      ["https://github.com/glowkeeper/feedbacker", "The code, on GitHub"],
      ["https://github.com/glowkeeper/feedbacker/blob/main/CONTRIBUTING.md", "How to contribute: bugs, ideas and corrections are all welcome"],
    ] as [string, string][],
  },
};

/**
 * What a link to a document says, where the document's own text only names its file ("PRODUCT.md", "docs/PROJECT.md"): the page, as a reader
 * would call it in a sentence.
 */
export const LINK_NAMES: Record<string, string> = {
  "data-handling-in-full.html": "data handling in full",
  "institutions.html": "the page for institutions",
  "responsible-use.html": "responsible use and known limits",
  "accessibility.html": "the accessibility statement",
  "marking-evaluation.html": "the marking evaluation",
  "moderation-evaluation.html": "the moderation evaluation",
  "user-guide.html": "the user guide",
  "security.html": "the security policy",
  "getting-started.html": "the setup guide",
  "licence.html": "the licence",
};

export interface OwnPage {
  page: string;
  /** Where its links are resolved from, as if it were a document in docs/. */
  source: string;
  title: string;
  eyebrow: string;
  intro: string;
  also: string[];
  markdown: string;
}

/** Pages that are written for the site, not shown from a document: the Markdown is here. */
const DATA_PAGE: OwnPage = {
  page: "data-handling.html",
  source: "docs/data-handling-for-the-site.md",
  title: "How your data is handled",
  eyebrow: "Your data",
  intro: "Students' work is personal, and often confidential. Feedbacker is built so that it stays on your computer, the AI sees only what you approve, and you can show what was sent.",
  also: ["institutions.html", "data-handling-in-full.html", "responsible-use.html"],
  markdown: `## It stays on your computer

Feedbacker has no accounts and no server. It runs on your own computer, and your work lives in folders you keep: on your own disk, or on storage your institution allows. Feedbacker doesn't host your work: there is no Feedbacker server holding it, and nobody at Feedbacker sees it. What you approve and send is processed by the AI provider (see below).

## Names are replaced before anything is sent

Students' names, IDs, emails, links and phone numbers are replaced with tokens on your computer, and the key that links the tokens back to the students never leaves it. You read each text, see what every token replaced, and approve it before it can be sent. Change anything afterwards and the approval is cleared.

Strictly, this is pseudonymisation, not anonymisation: because you hold the key, the work is still personal data, and Feedbacker treats it that way.

The replacing follows rules, so it can miss a name nobody listed, or a clue such as an employer. That is why you review every text. Images can't be redacted, so you look at each one and choose whether to send it. The hidden details inside image files, such as the camera, the date, the place and the author, are removed.

## You decide what the AI sees

Nothing goes to the AI until you have approved the material and confirmed the request, having seen the most it could cost. Only what the task needs is sent. For a reading: the approved text, the rubric, the brief if you include it, and any images you approved. For feedback drafts: the approved text of that one student's submission, the rubric, the brief if you include it, your approved feedback guide if you have one, and your own levels, marks and comments for that student. Never another student's work, the original files, the names or the key.

Requests go to Anthropic's Claude with your own API key, through a small program on your computer that checks each one before it leaves. What you send is processed by Anthropic, under its own terms, and some of it is kept for a time: part of a request (the instructions, the rubric, the brief and the feedback guide, never a submission) can be held for five minutes to lower the cost, and the results of a batch are kept for 29 days so you can collect them. Its terms on training and retention are for you or your institution to check: [For institutions](institutions.md) lists what to confirm.

## A record of what was sent

A log on your computer records every request: when, which AI, a fingerprint of what was sent, and the cost. It holds no text and no names, so you can show it to someone who is checking without showing them students' work. Every suggestion records which AI made it and what it was sent, and feedback you adapt from an AI draft is labelled as such.

## You choose how long it is kept

Each piece of work records how long its material may be kept (90 days by default), for example under your institution's terms. Deleting a workspace removes the whole folder, and everything in it, in one action, once you have seen what it will take and typed its name. Feedbacker doesn't yet remind you when the time has passed: deleting is your action.

## Open to inspection

The code, and the instructions the AI is given, are open source, so anyone can read what Feedbacker does. [Data handling in full](data-handling.md) is the complete reference.

## What this page is, and isn't

It describes what Feedbacker does. It is not a claim of legal, regulatory or institutional compliance: your institution makes its own assessment, and [For institutions](institutions.md) is written to support it. Before you use real students' work, confirm with whoever governs the assessment that AI assistance is acceptable.
`,
};

const HELP_PAGE: OwnPage = {
  page: "get-help.html",
  source: "docs/get-help-for-the-site.md",
  title: "Get help",
  eyebrow: "Help",
  intro: "Feedbacker is made and supported by one person, so a reply can take a few days. Here is how to get unstuck, and how to tell me what would make it easier to start.",
  also: ["getting-started.html", "user-guide.html", "institutions.html"],
  markdown: `## Stuck on setup, or not comfortable with a terminal?

Setting up means a few steps in a terminal. If that is what is stopping you, tell me, on [the help form](https://github.com/glowkeeper/feedbacker/issues/new?template=help-request.yml) or by email (below). It helps me see whether an installer is wanted, and I may be able to help you through it. Say what you are trying to do and where you stopped.

If you look after other people's computers, [the setup guide](/getting-started.html) is the whole of it, and [the page for institutions](institutions.md) says what an institution needs to decide.

## Using it

[The user guide](runbook.md) takes you through a moderation, and through marking a cohort, step by step. [See it in use](/walkthrough.html) shows the same screens with made-up coursework, without installing anything.

## Prefer email, or not on GitHub?

Write to [steve@huckle.studio](mailto:steve@huckle.studio?subject=Feedbacker). One person reads it, so a reply can take a few days. The same rule applies as for issues: never send students' work, marks, names or other personal data, and never your API key.

## Something isn't working

Open an issue with [the help form](https://github.com/glowkeeper/feedbacker/issues/new?template=help-request.yml) or a bug report from [the list of forms](https://github.com/glowkeeper/feedbacker/issues/new/choose). You need a free GitHub account.

Never put students' work, marks, names or other personal data in an issue, and never your API key. Describe the problem, or show it with the made-up coursework that comes with Feedbacker.

## A security problem

Please don't open a public issue. Report it privately: [the security policy](../SECURITY.md) says how.

## Ideas, and what would make you start

A correction, an idea, or "I would use it if…" are all welcome, and all help me decide what to build next. Use the same forms.
`,
};

/** Every page written for the site. */
export const OWN_PAGES: OwnPage[] = [DATA_PAGE, HELP_PAGE];
