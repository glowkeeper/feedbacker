# Moderator runbook

This guide takes you through a real moderation with Feedbacker, from receiving the moderation request to returning the moderation form and deleting everything afterwards. It follows the app's steps in order: importing the marking before anonymising the texts (steps 8 to 10) saves approving texts twice.

Feedbacker helps you moderate; it does not moderate for you. Your judgements, verdicts and comments are yours. The AI reading is a second reading that you may use or ignore, and it is never a mark.

Words in **bold** are the app's own labels and buttons.

## Contents

1. [Before you start](#1-before-you-start)
2. [What stays on your machine, and what is sent to a model](#2-what-stays-on-your-machine-and-what-is-sent-to-a-model)
3. [Start Feedbacker](#3-start-feedbacker)
4. [Create a workspace and set its retention](#4-create-a-workspace-and-set-its-retention)
5. [Record the moderation request](#5-record-the-moderation-request)
6. [Import the source rubric and the brief](#6-import-the-source-rubric-and-the-brief)
7. [Download and import the original files](#7-download-and-import-the-original-files)
8. [Import and confirm the original marking](#8-import-and-confirm-the-original-marking)
9. [Set the anonymisation rules](#9-set-the-anonymisation-rules)
10. [Anonymise, review and approve](#10-anonymise-review-and-approve)
11. [Run the AI reading](#11-run-the-ai-reading)
12. [Review each submission, openly or blind](#12-review-each-submission-openly-or-blind)
13. [Record a verdict on each submission's marking](#13-record-a-verdict-on-each-submissions-marking)
14. [Approve and export the record](#14-approve-and-export-the-record)
15. [Return the moderation form](#15-return-the-moderation-form)
16. [Delete the workspace and the downloads](#16-delete-the-workspace-and-the-downloads)
17. [If something goes wrong](#17-if-something-goes-wrong)
18. [Marking a cohort](#18-marking-a-cohort)

## 1. Before you start

You need:

- a Mac or Linux computer: the workspace's permission safeguards (folders only you can read) don't work on Windows;
- Node.js 24;
- Chrome or Edge: the app opens your workspace folder through a browser feature that Safari and Firefox don't have;
- an Anthropic API key, for the AI reading. Everything else works without one;
- a copy of Feedbacker, installed once:

  ```sh
  cd ~/src/feedbacker/proxy && npm install
  cd ../ui && npm install && npm run build
  ```

  Run `npm run build` again in `ui` after updating Feedbacker.

Put the API key in a private file, once. Use an editor rather than `echo`, so the key stays out of your shell history:

```sh
mkdir -p ~/Feedbacker && touch ~/Feedbacker/.env && chmod 600 ~/Feedbacker/.env
nano ~/Feedbacker/.env        # one line: ANTHROPIC_API_KEY=…
```

Two folders matter, and they must be different:

- the Feedbacker source: the copy of the program you installed from (for example `~/src/feedbacker`). Never put moderation material in it, or in any other git repository;
- your Feedbacker data folder, `~/Feedbacker`: it holds the key file, the proxy's own data (`~/Feedbacker/proxy`), and is a good place for the workspaces and downloads (for example `~/Feedbacker/workspaces/` and `~/Feedbacker/downloads/`).

Don't install the source as `~/feedbacker`: macOS doesn't distinguish capitals in folder names, so it would be the same folder as `~/Feedbacker`.

## 2. What stays on your machine, and what is sent to a model

These never leave your machine:

- the original files and the marked views;
- the text extracted from them;
- the pseudonym key, which links each pseudonym (for example [STUDENT_A]) to a student's name and Turnitin ID;
- the original marking and the marker's comments;
- your judgements, verdicts and comments;
- the exports.

These are sent to a model, and only when you confirm it on the AI reading step:

- each submission's anonymised text, exactly as you approved it;
- the source rubric;
- the anonymised brief, as you approved it (unless you choose to leave it out).

Nothing is sent until you have reviewed and approved the anonymised text. If a text changes after you approve it, it can't be sent until you approve it again; and if a rule you add later, or a name Feedbacker learns later, would redact something in it, it isn't sent until it has been anonymised and approved again. Everything leaves through the local proxy, the only program that holds the API key, and it records each request (hashes only, never the text) in its egress log: `egress.jsonl` in the proxy's data folder, `~/Feedbacker/proxy` unless the proxy was started with `--data`.

Anonymised text is still personal data while the pseudonym key exists, and in practice beyond that, because a submission can identify its author indirectly (a project name, a workplace, a photo). Your review in step 10 is the safeguard for that.

## 3. Start Feedbacker

```sh
cd ~/src/feedbacker/proxy && npm start
```

The proxy prints an address like `http://127.0.0.1:8765/#token=…`, "API key: configured", and where its egress log is and how long it keeps it. Open that exact address in Chrome or Edge. The token in it is new each time the proxy starts. If you close the tab, open the printed address again. To stop Feedbacker, press Ctrl+C in the terminal.

The app's header shows the workspace's name and folder, and whether the proxy is connected and has an API key.

## 4. Create a workspace and set its retention

A workspace is a folder holding everything for one moderation. Use one per moderation.

1. On the start page, **What would you like to do?**, under **Start something new**, choose **Moderation**, then enter the **Full path of the new folder**, for example `/Users/you/Feedbacker/workspaces/module-2026`. The folder must not exist yet.
2. Set **Keep for (days)** to how long the commissioning body lets you keep moderation material; the default is 90. Feedbacker records this, but it doesn't delete anything itself: deleting is step 16.
3. Press **Start**, then choose the new folder when the browser asks (under **Carry on with a workspace**, **Choose a workspace folder…**).

Next time, under **Carry on with a workspace**, **Open the last workspace** reopens it, or **Choose a workspace folder…** opens another. Its name, above the steps, says it is a moderation workspace. **Close this workspace**, in the menu that opens from the workspace's name above the steps, closes it and makes the browser forget it.

The steps are listed along the top in working order: **Overview**, **Request**, **Assessment** (**Rubric** and **Brief**), **Submissions** (**Original files** and **Original marking**), **Anonymisation**, **AI reading**, **Review** and **Export**. Under each step is its status: **Not started**, **Needs attention**, **Done**, or **Optional** for a step you can leave out (the brief and the AI reading). The **Overview** shows how far each sampled submission has got.

**Review** and **Export** are **Locked** until the steps before them are complete. Opening a locked step lists what is left, each with a button to the step where it is done. A step locks again if a later change undoes what it needs (for example, a new rule that clears an approval); nothing you recorded is lost, and it opens again once that is put right.

## 5. Record the moderation request

On **Request**, enter what the moderation request (the form you were sent) lists:

- **Sampled submissions**: a row per grade band, with the band (for example `60-69`) and its submission IDs as on the form (for example Turnitin submission IDs), separated by commas or spaces. **Add another band of the sample** adds a row. If the form doesn't give bands, leave the band empty and put all the IDs in one row.
- The module, programme, cohort size and the cohort's band distribution (a row per band, with its number of students), as written on the form (all optional).
- **Staff roles involved**: roles only (for example "module convener"), never names.

Press **Record the request**. Each sampled submission gets a pseudonym ([STUDENT_A], [STUDENT_B], …), which is how it appears from now on.

The screen then shows **What's recorded**: each sampled submission's pseudonym beside its real ID, the only screen that shows real IDs, so you can match pseudonyms to the moderation form, and the context you entered. To correct it, open **Change the request**: the form starts from what is recorded; tick **Replace the request already recorded** and record it again. Every screen is laid out the same way, in the same order: a status line under the heading says whether the step is done and why (as the steps do), **How this step works** explains it, **What's recorded** shows what it holds, and its form is folded away once the step is complete. Two screens differ, on purpose: the **Overview** has no status line, as it isn't a step, and **Export** never folds its actions away, as you can export again whenever you need to ("Import the originals again", "Import the rubric again", "Import the brief again").

## 6. Import the source rubric and the brief

Use the rubric the module published (xlsx, csv, json, or a docx table), not the marking platform's copy of it: this source rubric governs the comparison. Import it before the original marking, which is mapped onto it.

1. On **Rubric**, choose the **Rubric file**. For a spreadsheet with several sheets, name the **Spreadsheet sheet**.
2. Press **Read the rubric**, and check the preview under **Check the rubric before saving it**: the criteria, their levels and points, and any warnings.
3. Under **Criterion weights**, check each criterion's weight, as a percentage. They start from the file; enter any it doesn't give (a rubric often has them only in its criterion titles, for example "Implementation 25"). The total is shown as you go. Weights are needed to work out an overall mark from levels on Review.
4. Press **Save this rubric**.

For the assessment brief, on **Brief**, choose the brief (docx or pdf) and press **Import the brief**. It is anonymised and approved like a submission (step 10), and the AI reading sees only the approved brief.

## 7. Download and import the original files

1. From the marking platform (for example Turnitin, through the VLE), make a bulk download of the original files: the students' own documents, docx or pdf. Save it outside the Feedbacker folder, for example in `~/Feedbacker/downloads/`.
   - If the sample is spread across several downloads (for example across marking groups), download each.
   - Typed docx and pdf only; Feedbacker can't read handwriting or scanned pages.
2. On **Original files**, choose every download at once under **Downloads and files** (zips or single files), and press **Import the originals**.

Only the sampled submissions are opened; other students' files in a download are never read, and the step says how many it left unopened.

- If a sampled submission's file is missing from the downloads, or isn't docx or pdf, nothing is imported and the step lists each one. Add the missing download and import again.
- If a file is there but can't be read, the step says which, and the others are still imported.
- To import the originals again (for example after a corrected download), tick **Replace originals already imported**.

## 8. Import and confirm the original marking

Importing the marking before anonymising saves approving twice: its files' names can add a student's name, as written there, to the pseudonym key, and anonymising afterwards redacts it from every text straight away.

1. From the marking platform, make a second bulk download: the marked versions (for example Turnitin's current-view PDFs, "GradeMark files"). Again, download each if the sample spans several.
2. On **Original marking**, choose the downloads under **Marked views (zips or single files)** and press **Import the marking**.
   - The marker's marks, levels and comments (summary and inline) are imported as written, mapped onto the source rubric, and the comments are anonymised.
   - If a sampled submission's marked view is missing from the downloads, nothing is imported and the step says which (for example "no file found for [STUDENT_A] (sub-001)"). Add the missing download and import again.
   - If some of the marker's criteria don't match your rubric by name (marking platforms often abbreviate or rename them, for example `PROFESSIONALISM` for "Reflection and professional practice"), their marks aren't imported, and **Match the marker's criteria** lists each one by the marker's name. Choose the criterion of your rubric that each one marks (or leave it unmatched), choose the downloads again, tick **Replace marking already imported**, and import. The matches are kept for later imports, and a matched criterion drops off the list. Afterwards, press **Anonymise now** again (step 10), and **Check** and **Confirm** the replaced records.
   - Disagreements (for example a selected level that doesn't match the awarded score) are noted under **Please check**, never corrected.
3. Under **What's recorded**, press **Check** for each record. The marking shows how it came in, the overall mark, the comments, and a table by criterion of the marker's mark, the marker's level and where the mark falls on your source rubric, with anything the import noted under **Please check**. Press **Confirm this marking** if it's right.

If you plan to review a submission blind (step 12), don't check or confirm its marking yet: choose blind review for it first. Its marking stays hidden until you reveal it, and you confirm it then.

Once every sampled submission has a marking record and none of the marker's criteria is left to match, the import is folded away under **Import or enter marking again**. **Enter or correct marking by hand**, folded away too, is only for marking without a marked view (for example a second marker's, under a role such as "second marker"), or to correct a record. It has a box for each criterion of your rubric, by title. Replacing an existing record needs **Replace the existing record** ticked; the old one is kept in the history.

## 9. Set the anonymisation rules

Set the rules before you press **Anonymise now** (step 10). Rules added later still apply everywhere, but a text they change has to be approved again.

On **Anonymisation**, under **Add to the rules** (open until there are rules, then folded away; **What's recorded** shows how many of each there are), add anything the automatic redaction might miss:

- **other people's names** (staff, clients, classmates), one per line;
- **organisations**, one per line;
- **extra values to redact**, such as usernames or project names: a row each, with the value and its kind (for example Username), so its token says what it was ([USERNAME_1]);
- **values that should not be redacted**, for words wrongly redacted.

Press **Add to the rules**. The rules hold real values, so they are kept in the workspace's private folder and never shown on screen.

## 10. Anonymise, review and approve

1. On **Anonymisation**, press **Anonymise now**. Students' names are replaced by their pseudonyms, and other details by tokens such as [EMAIL_1].
2. Under **What's recorded**, open each submission, and the brief, with its **Review** button, and read the whole anonymised text. Look for anything that still identifies someone: names, emails, usernames, repository or portfolio links, workplaces, personal details.
   - **Show the real values** shows what each token replaced, to check the redaction. It shows real names, so use it only when you need it.
   - If something is missing, add it to the rules and press **Anonymise now** again. An approval stays only for a text that hasn't changed.
3. When a text is right, press **Approve this text for the AI reading**. Only approved text can ever be sent to a model.

If anything changes later (you add a rule, or import or re-import marking, which can add a name to the pseudonym key), press **Anonymise now** again. It brings everything up to date:

- the submissions and the brief: a text that changes loses its approval, so review it and approve it again. An approval that stays is for exactly the same text;
- the comments already stored (the marker's, and yours): they are redacted with the current rules too, and a marking record whose comments change says so in its notes.

Feedbacker also checks for you, so nothing depends on remembering this: the AI reading leaves out, and never sends, any text that the current rules or pseudonym key would still redact; and **Export** won't approve the record while any text in it would still be redacted. Each says which text, never the value.

## 11. Run the AI reading

1. On **AI reading**, choose the **Model** and the **Spend limit for this run (USD)** (at most $5 a run, unless the proxy is started with a higher `--max-run-usd`). Keep **Include the approved brief** ticked unless you have a reason not to. The other options (asking the fallback model, reading again, asking again, sending as a batch) are under **More options**.
2. Press **Plan the reading**. Nothing is sent yet. Under **Check the estimate before anything is sent** you see, for each approved submission, the most it could cost (a real run costs much less), and anything left out, with why. If nothing can be read yet, it says **Nothing to read yet** and why.
3. Press **Confirm and send** to send exactly what was planned, or **Don't send**. Below the button, it says which reading it is on ("Reading sub-002 (2 of 3)…"); each can take a minute or more, so keep the page open until it has finished. The run stops at the spend limit.
   - A submission already read with exactly the same text, rubric, brief, instructions and model reuses that reading, at no cost, and the plan says so. Its record says it was reused and from which call. To have the model read it again anyway, tick **Ask the model again even where nothing has changed**.
4. **What's recorded** lists each sampled submission's reading: whether it is current or needs reading again (and why), by which model and instructions, when, how (directly, in a batch, or reused) and what it cost. Once every submission has a current reading, the form is folded away under **Read again**.
5. **What came back** starts with what was read, failed or not run, and what it cost, then lists each, with why, and anything to check (for example a quote the model gave that isn't in the submission).

**To pay half as much**, tick **Send as one batch, at half the price** (under **More options**) before planning (it is offered only when the proxy's provider can send batches). The plan is priced at the batch rate; press **Confirm and send the batch**.

- The results come back within a day, usually much sooner, and you can close Feedbacker meanwhile. **Waiting for a batch** shows how far it has got: press **Check now**, then **Collect the results** once it has finished. **Cancel the batch** stops it; readings already done are still billed, and can be collected.
- Only one batch waits at a time, so nothing is sent twice.
- A batch has no automatic fallback. A submission the model declined, or that didn't come back, is listed with why: plan the reading again without the batch to read it one at a time, with the fallback.
- If a submission, the brief, the rubric or an approval changes while the batch is out, its reading isn't kept: read it again.
- The provider keeps a batch's results for 29 days, so collect them within that time.

A reading is only ever a suggestion: a level for each criterion, the evidence it quotes, and a draft comment.

The model sees only the submission's text: figures, charts, dashboards and screenshots aren't sent (not yet). Where a criterion rests on visual work, expect it to flag that it found too little evidence ("the model found little evidence"), rather than judge the student's description of their visuals. It may still suggest a level for what the text itself shows, or suggest none if the text shows too little. Either way, judge those criteria from the visuals yourself.

## 12. Review each submission, openly or blind

**Review** opens once the source rubric is saved and every sampled submission has its original file and marking imported and its anonymised text approved; until then it lists what is left. The AI reading is optional, and doesn't hold it back.

On **Review**, choose a submission and press **Review this submission**. The first time, choose how to review it; the choice is kept and can't be changed:

- **Review openly**: the original marking and the AI reading are shown throughout. This is usual moderation practice.
- **Review blind**: they stay hidden until you have recorded a level for every criterion and press **Reveal the original marking and the AI reading**. You can then revise any level; your first level and the revision are both kept. Blind review isn't possible once you have confirmed that submission's marking.

The review fills the window in two panes, each scrolling on its own:

- **left**, the submission: the approved anonymised text, the brief (under **The assessment brief**), and each marker's overall mark, overall comment and inline comments;
- **right**, one criterion at a time: the original marking and the AI reading for that criterion, and your judgement.

Above the panes, the list of criteria shows each one's state (**Judged**, **Out of date** or **Not yet judged**). Choose one to open it, or move through them with **Next** and **Previous**. **Comparison and verdict** (once the marking and the AI reading are shown) is below the panes, full width: scroll down to it, or press **Comparison and verdict** in the list of criteria (or **Next** after the last criterion) to go there. **Show in the text**, beside a quote the AI reading found in the submission or a marker's comment whose passage is found as written, highlights that passage in the text and scrolls the left pane to it; **Clear the highlight** removes it. On a narrow window, or zoomed in, the panes are one above the other and the page scrolls as usual.

For each criterion, choose **Your level** from the rubric's levels. Its mark starts at the level's points (for example 68 for 2:1 (68)); to place the work within the level, press a quick pick (3 below, the level's points, or 3 above: 65, 68, 71) or enter another mark, which must be nearer that level than any other (or, for a level the rubric gives a mark range, within that range). Add a comment if you wish, and press **Record the judgement**. The comparison (on **Comparison and verdict**) sets your mark beside each marker's, and its **Overall** row shows the overall your marks imply, weighted by the rubric. **Start from the AI reading** chooses the AI's suggested level and puts its draft comment into yours to edit. The level is recorded as taken from the AI suggestion unless you choose another; the comment is recorded as adapted from the AI draft, however much you change it. The summary says how many levels were taken from the AI, since those agree with it by construction. **Clear and write my own** clears the comment, so you can write your own.

**Comparison** (headed with the submission and its pseudonym, on **Comparison and verdict**) sets your level and mark beside each marker's mark and the AI's suggested level, saying each difference in words ("Harsher than your mark (68) by 3 points"), and flags a marker's level label that doesn't fit their score. Its **Overall** row gives each marker's overall mark as awarded, the overall your marks imply, and the overall the AI's levels imply (never a mark); where one can't be worked out (no criterion weights, a criterion not yet judged, or the AI suggesting no level), it says why.

If the approved text or the source rubric changes after you judge a criterion (for example you add weights to the rubric), its judgement is marked **Out of date** beside it, and its button reads **Record it again**: check your level and mark, and press it. Nothing out of date is counted, in the Overall row or the export, until you do.

## 13. Record a verdict on each submission's marking

Under **How was … marked?**, on **Comparison and verdict** below the comparison, choose **Agree**, **Generous**, **Harsh** or **Inconsistent**, check the **Suggested mark** (once every criterion is judged, it starts from the overall your criterion marks imply, rounded; change it if you need to), add a comment if you wish, and press **Record the verdict**. Both the mark you suggest and the overall your marks implied are recorded, and the summary shows them side by side. For a blind review, this comes after the reveal.

A verdict rests on the marking, the approved text, the rubric and your levels and marks as they were when you gave it. If any of them changes afterwards (for example you move a mark), the verdict is flagged to check again: press **Change the verdict** to give it again.

The **Overview** shows how far each submission has got, its verdict, and **Agreement across the sample**, by submission and by criterion.

## 14. Approve and export the record

On **Export**:

1. **Export** opens once the moderation is ready to approve. Until then, it lists anything left to do, by submission (for example a criterion still to judge, a blind review not yet revealed, marking not confirmed, or a verdict to check again because the marking, the rubric or your marks changed after it). Deal with each; the list updates as you go.
2. Write **Your overall moderator's comment** (it goes into the summary and the section for the moderation form), and press **Approve the moderation record**.
3. Press **Export the record and summary**. It writes three files into the workspace's `exports` folder:
   - `…-record.feedbacker-export.json`: the structured record, with the full provenance of every value;
   - `…-summary.feedbacker-export.md` and `….docx`: the readable summary.

   All three are pseudonymous. If you change anything after approving, the export is refused until you approve again.

The status line under **Export** says whether the record is ready to approve, or approved with nothing changed since. Before you approve, the summary is shown as it would be approved, just above **Approve**; once approved, **What's recorded** holds it, folded away under **The approved summary**, and the export buttons stay in reach below.

## 15. Return the moderation form

The summary ends with **For the moderation form**: the sampled items by grade band, each with your verdict, your suggested mark if you gave one, and the overall your marks imply (when it can be worked out), then your overall comment, ready to copy into the form. In the **Sample overview**, a submission without a suggested mark shows the overall your marks imply instead, labelled "(implied by your marks)".

If the form must say which submission is which, make a re-identified copy on **Export**: under **Re-identified copy**, press **Make a re-identified copy**. It asks first, saying what the copy will contain (each student's Turnitin ID, which identifies them, so it is personal data); press **Make the copy**, or **Don't make it**. It writes `…-summary-reidentified.feedbacker-export.md` and `.docx`, with each student's Turnitin ID in place of their pseudonym. Nothing else is restored: no names, and other redacted details stay redacted. You're asked to confirm each time. The standard exports are pseudonymous, so they need no such confirmation.

Copy what the form needs, add your signature as the form asks, and return it. Then delete the re-identified copy if you no longer need it (step 16).

## 16. Delete the workspace and the downloads

When the commissioning body's retention period ends, or as soon as you no longer need the material:

1. Open the menu from the workspace's name, above the steps, and choose **Delete this workspace…**. It deletes the workspace's whole folder and everything Feedbacker made in it: the source files, extracts, anonymised text, approvals, readings, marking, judgements, the pseudonym key and every export, including re-identified copies. It can't be undone.
2. It lists every export in the workspace, with its full path (a re-identified copy is marked as containing personal data). Exports are written only inside the workspace, so copy any you are required to keep, such as the pseudonymous record, to a folder outside it and outside any git repository, for example in the Finder. Keep them for no longer than required. Then tick **I have kept the exports I need**. If there are no exports, it says so: the record was never exported.
3. Type the workspace's name exactly, and press **Delete this workspace permanently**. Feedbacker also stops recording the folder's path, and the browser forgets it. The app returns to the start page and says what was deleted. If the browser could only empty the folder, it says so and gives the folder's path, so you can remove it yourself.
4. Delete the downloads (the originals and the marked views), and empty the Trash if they went there. Feedbacker didn't make them, so it can't delete them.

The proxy's egress log (`egress.jsonl` in its data folder, `~/Feedbacker/proxy` by default) holds hashes, not text. Its entries are removed after 90 days, unless the proxy was started with a different `--egress-retention-days`. The proxy prints both when it starts, as "Egress log: … (kept … days)".

## 17. If something goes wrong

Feedbacker says what went wrong in words; it never hides a failure. Most messages say what to do next. A red **This couldn't be done** is a failure. An amber **Please check** is a note: the step worked, but something needs your attention.

To report a problem, open an issue in the Feedbacker repository, and describe:

- which step you were on and what you did;
- the message, word for word, with any name, ID or other real detail replaced;
- what you expected instead.

Never attach, paste or screenshot real material: no submissions, marked views, rubrics that identify the module, exports, workspace files, or anonymised text (it is still personal data). If you can, reproduce the problem with the synthetic files in `fixtures/synthetic/`, and report that instead.

## 18. Marking a cohort

Feedbacker can also hold your own marking of a whole cohort, in a marking workspace. So far, it takes you from importing the submissions to marking them, with the AI's proposed levels if you want them, to writing each student's feedback from your marks, and to approving and exporting it to paste into the marking platform.

1. On the start page, under **Start something new**, choose **Marking**, enter the folder and how long to keep it, and press **Start**. Its name, above the steps, says it is a marking workspace.
2. On **Details**, record the assessment's title, and its module and programme if you like.
3. Import the rubric and the brief as in [step 6](#6-import-the-source-rubric-and-the-brief).
4. From the marking platform (for example Turnitin, through the VLE, or Canvas), make a bulk download of the students' own files. Save it outside the Feedbacker folder.
5. On **Submissions**, choose the download's zips (and any single files, named as the platform names them), and press **Import the submissions**. Every submission is imported and gets a pseudonym. The student's ID and name, read from the file's name, are kept in the private pseudonym key; the table shows each submission's real ID beside its pseudonym, on this screen only, so you can match them in the platform. A file whose name doesn't carry an ID, an ID found in more than one file, and a file that isn't docx or pdf are listed, not imported: put it right in the download and import again.
6. If late submissions arrive, download them and import again: only the new ones are added, and everyone keeps their pseudonym. Tick **Replace submissions already imported** only to replace files you've already imported.
7. On **Anonymisation**, set the rules, anonymise, review and approve each submission as in [steps 9](#9-set-the-anonymisation-rules) and [10](#10-anonymise-review-and-approve). Canvas file names run a student's names together, so check their names are redacted, and add them to the rules if not.
8. Delete the downloads once importing is done, as in [step 16](#16-delete-the-workspace-and-the-downloads).
9. Optionally, on **AI proposals**, ask the AI to propose a level for each criterion of each approved submission, with its reasons and evidence. It works as the AI reading does in [step 11](#11-run-the-ai-reading): you see a worst-case estimate first, and nothing is sent until you confirm it. Your marks and comments are never sent.
10. On **Marking**, choose a submission and press **Mark this submission**. Choose whether to see the AI's proposals while you mark (**Show the proposals**) or to mark blind (**Mark blind**); the choice can't be changed. Blind marking hides the proposals until you have recorded a level for every criterion and press **Reveal the AI's proposals**.
11. For each criterion, choose your level (or press **Take the proposed level**), adjust the mark within it, write your comment (or press **Start from the AI's draft comment** and adapt it; it is recorded as derived from the AI however much you change it), and press **Record and go to the next criterion**. The **Provisional mark** comes from the AI's proposed levels: it is never your mark, and it is always shown apart from it.
12. After the last criterion, your **Overall mark** starts from the mark your criterion marks imply; change it if you need to, write your overall comment, and press **Record the overall mark**. **Next submission** opens the next one. If you later change a criterion, the overall mark is flagged for you to check again.
13. On **Feedback**, write a **Feedback guide** if you like: what each level of each criterion typically needs to hear, and the common next steps. Press **Save the guide** (it is anonymised, and becomes a new version), read it as it will be sent, and press **Approve this guide for the AI**. It is then sent with every draft, so similar work starts from the same place; untick **Include the approved feedback guide** to draft without it. Each draft records the guide version it used. Under **Draft feedback**, choose **Every marked submission that needs drafts** (or one submission), tick **Send as one batch, at half the price** if you like, and press **Plan the drafts**. **Check what will be sent** lists each submission, what will be drafted and the most it could cost; open **What will be sent of your marking of …** to read exactly what of your marks and comments will be sent. Nothing about any other student is sent. Press **Confirm and send** (or **Confirm and send the batch**), or **Don't send**. The overall summary is drafted only once your overall mark is recorded and current.
14. Under **Write the feedback**, choose a submission and press **Write this submission's feedback**. Each empty box starts with its current AI draft, which is not saved until you record it: for each criterion and then overall, read it, change it as you need to (or clear it and write your own), and press **Record the feedback**. Anything you have already recorded or typed is kept as it is; **Start from the AI's draft** puts a newer draft in its place. Feedback adapted from a draft is recorded as derived from the AI, however much you change it; **Clear and write my own** undoes that. Your feedback is anonymised when it is saved.
15. If you change a mark or comment afterwards, that criterion's draft and feedback are flagged as out of date (and the overall summary's, which rests on every mark). Press **Draft this again** on that criterion to draft it alone, then check your feedback and record it again. **Draft this again** is on every criterion and the overall, whenever it is marked: use it too when a draft is current but not good enough (cut short, say). Nothing is sent until you confirm the plan. Once it is drafted, you are taken back to that criterion: if its box still held the old draft unchanged, the new draft is now in it, not yet recorded, so read it and record it; if you had changed the text, your text stays, and **Start from the AI's draft** puts the new draft in its place.
16. Each piece of recorded feedback is checked against its mark, in Feedbacker (nothing is sent): praise that belongs to a higher band than the mark's (for example "excellent" on a 58), no "Next time" step, another mark or level named (for example "68%" on a 62, or "2:1" on a lower second), an anonymised value (a token such as [ORG_1]) the student would see, and text that ends mid-sentence (as a draft can, if the AI's reply is cut short; draft it again). Flags appear under each piece of feedback, and **Checks across the cohort** lists how many each submission has. While a box holds text you haven't recorded (a new draft, or your changes), the checks shown are of that text as it stands; a flag can be accepted once it is recorded. Praise that is negated or said to be missing ("lacks an effective structure", "rather than a demonstration of effective …") isn't flagged. A flag never blocks you: change the text and record it again; press **Draft this again, avoiding "…"** to have the AI draft that criterion again without the flagged praise words (they are added to what is sent, and shown in the plan); or keep the text by pressing one of the **Accept:** reasons, or typing your own and pressing **Accept with this reason**. The reason is kept with that text; recording new text clears it. A figure quoted from the submission (such as its test coverage) may be flagged as a mark; accept it with that reason. **Words that only fit higher marks** lists the praise words for each band, which you can change for this workspace.
17. **Feedback across the cohort** shows, for each criterion, every student's recorded feedback grouped by your level, and the overall feedback by band. Feedback much shorter or longer than the rest at its level (under half, or over twice, the median), and feedback nearly the same as another student's, are flagged. **Edit** opens that student's feedback.
18. On **Export**, press **Read what they receive** for a submission: it shows exactly what that student will receive, the overall mark, then each criterion's mark and feedback, then the overall feedback. A submission can be approved once everything is marked, its feedback is current, and every flag is accepted; if it isn't ready, it lists what is left. Read it, and press **Approve exactly this**. Any later change (a mark, the feedback, a flag's reason) clears the approval.
19. For an approved submission, **Copy the mark**, **Copy** each criterion's feedback, or **Copy all the feedback**, and paste it into the student's comment box in Turnitin or Canvas. **Export the approved feedback and marks** writes, into `exports`, each approved student's feedback as text, one file of them all, a marks table (CSV) and the structured record (JSON). All of these are pseudonymous.
20. To match students in the platform, press **Make a re-identified copy**: as in moderation, it asks first, and on **Make the copy** writes the feedback files and the marks table with each student's platform ID in place of their pseudonym, and nothing else restored. It contains personal data, is kept only in this workspace, and is deleted with it. A token such as [ORG_1] left in someone's feedback stays a token, so the checks flag it before you approve.
