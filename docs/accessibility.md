# Accessibility statement

Feedbacker aims to meet the [Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/) at level AA: the standard UK public sector bodies, including universities, are expected to meet. This statement covers the Feedbacker app, and the documents it produces. It was prepared on 6 October 2026.

## How it is checked

- **Every screen, measured.** Before each change to the app is merged, the project's browser check, run on the developer's computer, runs the app in Chrome through a whole moderation and a whole marking of a cohort, with synthetic material, and measures each screen and state on the way (49 of them, as of 6 October 2026). They all passed on 6 October 2026. The measured checks are:
  - one main heading, and no heading level skipped (part of 1.3.1);
  - a page title naming the screen (2.4.2);
  - every control has an accessible name, which contains its visible label, every ARIA reference resolves, and ids are unique (part of 4.1.2; 2.5.3);
  - text contrast of at least 4.5:1, or 3:1 for large text, and the focus outline's contrast of at least 3:1 (1.4.3, 1.4.11);
  - targets at least 24 by 24 pixels (2.5.8);
  - the keyboard reaches every control, with no trap, a visible focus outline, and nothing focused hidden (2.1.1, 2.1.2, 2.4.7, 2.4.11);
  - nothing but a scrolling region wider than 320 pixels, so it reflows (1.4.10);
  - nothing clipped with increased text spacing (1.4.12).
- **By reading the screens.** What can't be measured is reviewed by reading each screen when an interface changes: whether headings and labels describe their topic (2.4.6), whether instructions are given where they are needed (3.3.2), and meaning, order and wording more generally.
- **From the keyboard.** The automated check drives most of both workflows from the keyboard (a few steps, such as opening a folded section, are clicked), and checks that focus moves to each step's heading as it opens. The keyboard reaching every control on every screen is measured, as above.
- **With a screen reader.** The maintainer used Feedbacker with VoiceOver on macOS, in Chrome, on 27 September 2026, through a moderation.

## Generated documents

- The moderation summary is produced as a Word document with real heading styles, captioned tables with header rows, real lists, and its language set (British English). These are checked by tests.
- Marking exports (each student's feedback, all of them, and the marks table) are plain text, Markdown and CSV, so they take on the accessibility of wherever they are pasted or opened.

## Known limits

- **Browsers:** Chrome or Edge only (the folder access Feedbacker needs). It hasn't been tested on phones or tablets.
- **Screen readers:** only VoiceOver on macOS has been used, and before the marking and feedback screens were added: those have been checked automatically and from the keyboard, but not yet with a screen reader. NVDA and JAWS haven't been tried.
- **Students' figures:** where the student gave a figure alternative text in a Word document, it is kept, anonymised, and read out as the image's description in the review. A figure without it, and any figure from a PDF (whose alternative text isn't read yet), is described only by its placeholder and page (for example "Figure [FIGURE_1], page 2"), not by what it shows.
- **No independent audit** has been carried out. The checks above are the project's own.

## Reporting a problem

If something in Feedbacker is hard or impossible to use with the way you work, please [open an issue](https://github.com/glowkeeper/feedbacker/issues/new/choose): say what you were doing, what you use (browser, screen reader, magnification and so on), and what happened. Never include real students' work or anything that identifies anyone: describe it, or use the synthetic files in `fixtures/synthetic/`.

## Where to read more

- [Responsible use and known limits](responsible-use.md)
- [For institutions: data protection and governance](institutions.md)
- [Architecture: accessibility](ARCHITECTURE.md#8-accessibility-is-architectural)
