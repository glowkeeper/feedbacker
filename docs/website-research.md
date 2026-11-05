# Website research: what makes a website for an app work

Written 2026-11-05 for the maintainer, as the basis for how the Feedbacker website is built. It records what the research says, how far each finding can be trusted, and what Feedbacker's site does about it. It is an internal note: nothing on the website links to it.

## In short

The evidence is thinner than the advice online. A handful of findings come from real research; most conversion figures are vendor claims with no method behind them. What holds up is simple: put the point of the page at the top, write concisely and plainly, show the product early, make trying it easy, and show who is behind it.

- **Best evidence:** Nielsen Norman Group (NN/g) eyetracking and writing experiments, a 2006 study of first impressions, Stanford's credibility guidelines, and published research on why educators adopt technology.
- **Weakest evidence:** conversion benchmarks, video-versus-screenshot results, and trust-badge uplift figures, nearly all from vendors.
- **Missing entirely:** studies of landing pages for educational software, or for open-source tools aimed at people who are not developers. Applying any of this to Feedbacker is an extrapolation, which is why a test with real educators is described at the end.

## What is well supported

1. **Attention sits at the top of the page.** NN/g's 2018 eyetracking study (120 people, over 130,000 fixations) found about 57% of viewing time above the fold and about 74% in the first two screens. Attention drops sharply after the fold, though people do scroll if the top looks promising. NN/g's advice is to put the main goals and the call to action at the top. [NN/g, Scrolling and attention](https://www.nngroup.com/articles/scrolling-and-attention/)
2. **People scan, and they punish hype.** In NN/g's 1997 experiment, 79% of people always scanned a new page; 16% read word by word. Compared with a promotional control, concise text scored 58% better, a scannable layout 47% better and objective language 27% better; the three combined scored 124% better. The article does not report its sample size, and it is old, but later work points the same way. [NN/g, How users read on the web](https://www.nngroup.com/articles/how-users-read-on-the-web/)
3. **First impressions are fast, and they colour everything after.** In a 2006 study, ratings of a page's visual appeal after 50 milliseconds matched ratings after longer viewing, and the authors argue a halo effect carries into judgements of credibility. It was a small study, and it measured visual appeal, not usability. [Lindgaard and others, via Nature](https://www.nature.com/news/2006/060109/full/news060109-13.html)
4. **Credibility comes from the basics.** Stanford's 2002 guidelines (a few thousand participants; sources disagree on the exact number) stress a visible real organisation behind the site, accuracy, ease of use, and no errors: typos and broken links damage credibility more than people expect. [Stanford Web Credibility Project](https://credibility.stanford.edu/guidelines)
5. **Educators adopt tools that are useful and easy.** In the studies found (Xiao and others 2024; Bhaskar and others 2024; a 2025 study of university teachers and AI tools), usefulness and ease of use are the consistent predictors, with ease working mostly through perceived usefulness. Trust helps; perceived risk and privacy concerns hold adoption back. Privacy acts as a brake, not as a draw. Only the abstracts were read, not the full effect sizes. [Frontiers in Psychology](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2023.1293879/full), [MDPI Systems](https://www.mdpi.com/2079-8954/13/8/664)
6. **An open-source project's page must explain itself fast and show that going deeper is worth it.** Riehle's handbook on community open source projects says being open about important issues builds that trust. Practitioner write-ups agree that a getting-started guide should be a small task finished quickly on a laptop. [Riehle](https://hillside.net/plop/2020/papers/proceedings/papers/14-riehle.pdf), [DEV Community](https://dev.to/coss-media/open-source-creator-series-part-4-documentation-and-technical-writing-101-2bl1)

## What is weak or mixed

- **Conversion benchmarks.** Unbounce reports a median SaaS landing-page conversion of 3.8% and, in an older report, advises copy of no more than about 250 words. The data is the vendor's own and the full report is gated. [Unbounce](https://unbounce.com/conversion-benchmark-report/saas-conversion-rate/)
- **Video versus screenshots.** In Apple's own product page test, the page without a preview video beat the one with it by 3%. A vendor case study reported the opposite, a 75% gain for video. There is no independent study, so test before investing in video. [SplitMetrics case study](https://splitmetrics.com/cases/prequel-app-store-video-optimization-with-splitmetrcis/)
- **Trust badges and testimonials.** Uplift claims of 20% to 40% appear on vendor blogs; none comes from a controlled study.
- **"Visitors leave in 10 seconds."** It traces to a 2009 NN/g heuristic by Jakob Nielsen with no study behind it; the figures repeated elsewhere are unsourced.

## What nothing covers

No research was found on landing pages for educational software, on how educators judge a tool's website, or on open-source tools for non-developers. The studies of educators' adoption are about tools already in front of them, not about what persuades them to try one.

## What it means for Feedbacker

| The research says | Where the site stood on 2026-11-05 |
| --- | --- |
| The top of the page carries the point and the call to action | The home page opened with a slogan, an intro paragraph and a status line: no call to action, no picture of the product |
| Literal headings beat clever ones | "Assessment needs more than an answer" is a slogan; the intro sentence below it says what Feedbacker is |
| Show the product early | The 14 screenshots were on the walkthrough page only |
| Concise, scannable, objective | The rewritten pages follow this. The user guide (about 12,000 words) is a manual, and is the page a hesitant visitor reaches next |
| Ease of use works through perceived usefulness; make the first task small | Setup needs a terminal. The walkthrough lets a visitor see it without installing, but the home page did not lead with it |
| A real person and organisation behind the site; easy to reach | A name in the footer, and no way to ask for help |
| Be open about important limits | Done well: the data page, the institutions page and "Early, honest, and evaluated" |

## Changes made

Made on 2026-11-05, in response to the above.

- **Home page, top:** the headline now says what Feedbacker is ("AI-assisted marking, feedback and moderation. You decide every mark.") in place of the slogan ("Assessment needs more than an answer"), which was brand voice, not a literal statement. Under it: a two-sentence description, two buttons, a line saying who makes it and what its first real moderation showed (with its limits one click away), and a real screenshot of the marking screen with made-up coursework.
- **Which button is primary:** "See it in use, no install needed" is the filled button and "Get started" the outline one. Setup is the main barrier, and the research says ease of use works through perceived usefulness, so seeing it comes first.
- **A way to ask for help:** a new Get help page, linked from the setup guide, Learn more and every footer, with a help form for issues and an email address for people who are not on GitHub. There was no route before, and blank issues are switched off, so the existing forms did not fit a question.
- **A person behind the site:** the home page names the maker, with the facts the site already stated (a university educator who uses it for real marking and moderation).
- **Evidence of usefulness, with its limits:** the moderation evaluation says it saved time without compromising the moderator's judgement; that is one moderation by one moderator, and the line links to the account so the limits are visible.

Not done:

- **An installer.** It is the real answer to the setup barrier and a large piece of work, so it stays on the list.
- **A short video.** The evidence on video is mixed (above), the screenshots already show the product, and a recording needs a decision about what to show. Revisit after the test below.
- **The test with educators.** It needs real people; the protocol is below.
- **The user guide** is still one 12,000-word page; splitting it is separate work.

## A test with educators

The published evidence cannot say whether the site works for its actual audience, so test it with them. Five educators is enough to find the main problems.

1. Show the home page for five seconds, then hide it. Ask: *What is this? Who is it for? What would you do next?* Write the answers down word for word.
2. Show the page again and ask them to find, without help, how to see it in use and how to get started.
3. Ask: *What, if anything, would stop you trying it?* Do not suggest answers.
4. Count how many gave a correct answer to each question. If fewer than four of five can say what it is, change the top of the page and test again.

Do not explain the page while they look at it, and do not use people who have already seen it.
