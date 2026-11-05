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

/** By the page's file. A decision record has its own default (see `site-docs.ts`). */
export const COPY: Record<string, Copy> = {
  "getting-started.html": {
    title: "Getting started",
    eyebrow: "Get started",
    intro:
      "Free, on your own computer, and no account to make. For now, setting it up means a few steps in a terminal, so it suits you best if that's comfortable, or if someone who looks after your computers can help. You'll need Chrome or Edge, [Node.js](https://nodejs.org/) 24 or later and an [API key for Anthropic's Claude](https://console.anthropic.com/) (paid for by use). It comes with made-up coursework to try first.",
    lead: "**Not comfortable with a terminal?** [Tell me](https://github.com/glowkeeper/feedbacker/issues/new/choose): it helps me see whether an installer is wanted.",
    also: ["walkthrough.html", "user-guide.html", "responsible-use.html"],
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
  "data-handling.html": {
    title: "How your data is handled",
    eyebrow: "Your data",
    intro:
      "Everything Feedbacker does with students' work, in full: where it lives, what can leave your computer, and when it is deleted. If you want the short version first, start with [For institutions](institutions.md).",
    also: ["institutions.html", "responsible-use.html"],
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
  "product.html": {
    title: "Product direction",
    eyebrow: "Under the hood",
    intro: "Where Feedbacker is going, and what it will not become: useful if you are deciding whether to rely on it, or thinking of helping.",
    also: ["project.html", "architecture.html", "decisions.html"],
  },
  "project.html": {
    title: "What Feedbacker is, and must never do",
    eyebrow: "Under the hood",
    intro: "The short definition everything else rests on: what Feedbacker is for, and what it must never do.",
    also: ["product.html", "architecture.html", "decisions.html"],
  },
  "architecture.html": {
    title: "Architecture principles",
    eyebrow: "Under the hood",
    intro: "The rules every change is held to, including educator control, traceability and privacy.",
    also: ["product.html", "project.html", "decisions.html"],
  },
  "decisions.html": {
    title: "Why Feedbacker is built the way it is",
    eyebrow: "Under the hood",
    intro: "Each significant choice is written down: what was decided and why, the options weighed, and what follows. Read them in order, or pick the one you're curious about.",
    also: ["product.html", "architecture.html"],
  },
};

/** How a page is named in a list of pages to read next, and on the Learn more page. */
export const LABELS: Record<string, string> = {
  "getting-started.html": "Getting started",
  "walkthrough.html": "See it in use",
  "user-guide.html": "The user guide",
  "responsible-use.html": "Responsible use and known limits",
  "data-handling.html": "How your data is handled",
  "institutions.html": "For institutions",
  "accessibility.html": "Accessibility statement",
  "security.html": "Security policy",
  "licence.html": "Open source, under Apache 2.0",
  "marking-evaluation.html": "Marking and feedback, used for real",
  "moderation-evaluation.html": "Moderation, used for real",
  "product.html": "Product direction",
  "project.html": "What Feedbacker is, and must never do",
  "architecture.html": "Architecture principles",
  "decisions.html": "All the decision records",
};

export const DECISION_INTRO = "A decision record: what was decided, and why.";

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
        ["walkthrough.html", "Marking and moderation in pictures, with made-up coursework."],
        ["user-guide.html", "Every step of a moderation, and of marking a cohort."],
      ],
    },
    {
      title: "Trust",
      items: [
        ["responsible-use.html", "Who decides what, what it is not for, and what it can't do yet."],
        ["data-handling.html", "Where your students' work lives, what can leave your computer, and when it is deleted."],
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
    {
      title: "Under the hood",
      items: [
        ["product.html", "Where it is going, and what it will not become."],
        ["project.html", "What it is for, and what it must never do."],
        ["architecture.html", "The rules every change is held to."],
        ["decisions.html", "Why it is built the way it is, one decision at a time."],
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
