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
      "Step by step, from your first workspace to the approved export: moderating a colleague's marking, with marking a whole cohort and giving feedback at the end. Try it with the made-up coursework first if you like.",
    keepOpening: true,
    also: ["getting-started.html", "responsible-use.html", "data-handling.html"],
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
    intro: "The developer marked a real cohort with Feedbacker and wrote up what the experience showed. This is that account.",
    keepOpening: true,
    also: ["moderation-evaluation.html", "user-guide.html"],
  },
  "moderation-evaluation.html": {
    title: "Moderation, used for real",
    eyebrow: "Evidence",
    intro: "Moderation was the first thing Feedbacker was built for. This is the developer's own account of using it on a real piece of marking.",
    keepOpening: true,
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
