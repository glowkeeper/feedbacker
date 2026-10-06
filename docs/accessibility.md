# Accessibility statement

Feedbacker aims to meet the [Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/) at level AA: the standard UK public sector bodies, including universities, are expected to meet. This statement covers the Feedbacker app, and the documents it produces. It was prepared on 6 October 2026.

## How it is checked

- **Every screen, measured.** Before each change is merged, the project's browser check runs the app in Chrome through a whole moderation and a whole marking of a cohort, with synthetic material, and measures each screen and state on the way (49 of them, as of 6 October 2026). They all passed on 6 October 2026. The measured checks are:
  - one main heading, and no heading level skipped (1.3.1, 2.4.6);
  - a page title naming the screen (2.4.2);
  - every control has an accessible name, and it contains its visible label (4.1.2, 3.3.2, 2.5.3);
  - text contrast of at least 4.5:1, or 3:1 for large text, and the focus outline's contrast of at least 3:1 (1.4.3, 1.4.11);
  - targets at least 24 by 24 pixels (2.5.8);
  - the keyboard reaches every control, with no trap, a visible focus outline, and nothing focused hidden (2.1.1, 2.1.2, 2.4.7, 2.4.11);
  - nothing but a scrolling region wider than 320 pixels, so it reflows (1.4.10);
  - nothing clipped with increased text spacing (1.4.12).
- **By reading the screens.** What can't be measured (meaning, order, instructions, wording) is reviewed when an interface changes.
- **From the keyboard.** The whole of both workflows is driven from the keyboard in the automated check, and focus moves to each step's heading as it opens.
- **With a screen reader.** The maintainer used Feedbacker with VoiceOver on macOS, in Chrome, on 27 September 2026, through a moderation.

## Generated documents

- The moderation summary is produced as a Word document with real heading styles, captioned tables with header rows, real lists, and its language set (British English). These are checked by tests.
- Marking exports (each student's feedback, all of them, and the marks table) are plain text, Markdown and CSV, so they take on the accessibility of wherever they are pasted or opened.

## Known limits

- **Browsers:** Chrome or Edge only (the folder access Feedbacker needs). It hasn't been tested on phones or tablets.
- **Screen readers:** only VoiceOver on macOS has been used, and before the marking and feedback screens were added: those have been checked automatically and from the keyboard, but not yet with a screen reader. NVDA and JAWS haven't been tried.
- **Students' figures:** a figure from a submission is described by its placeholder and page (for example "Figure [FIGURE_1], page 2"), not by what it shows. It is only as accessible as the student made it.
- **No independent audit** has been carried out. The checks above are the project's own.

## Reporting a problem

If something in Feedbacker is hard or impossible to use with the way you work, please [open an issue](https://github.com/glowkeeper/feedbacker/issues/new/choose): say what you were doing, what you use (browser, screen reader, magnification and so on), and what happened. Never include real students' work or anything that identifies anyone: describe it, or use the synthetic files in `fixtures/synthetic/`.

## Where to read more

- [Responsible use and known limits](responsible-use.md)
- [For institutions: data protection and governance](institutions.md)
- [Architecture: accessibility](ARCHITECTURE.md#8-accessibility-is-architectural)
