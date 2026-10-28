# Moderator runbook

This guide takes you through a real moderation with Feedbacker, from receiving the moderation request to returning the moderation form and deleting everything afterwards. It follows the app's steps in order: importing the marking before anonymising the texts (steps 8 to 10) saves approving texts twice.

Feedbacker helps you moderate; it does not moderate for you. Your judgements, verdicts and comments are yours. The AI reading is a second reading that you may use or ignore, and it is never a mark.

To mark a cohort of your own students instead, see [section 18](#18-marking-a-cohort); it refers back to the moderation steps it shares.

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
19. [A module with more than one assessment](#19-a-module-with-more-than-one-assessment)

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
- your judgements, verdicts and comments (in moderation), and your marks and comments (in marking), except as below when drafting feedback;
- the exports.

These are sent to a model, and only when you confirm it on the AI reading step (or, in marking, the **AI proposals** step):

- each submission's anonymised text, exactly as you approved it;
- the source rubric;
- the anonymised brief, as you approved it (unless you choose to leave it out).

In marking, drafting feedback on the **Feedback** step also sends, for that one submission only and only when you confirm it: your own levels, marks and comments for it, and your approved feedback guide, both anonymised. Asking the AI to suggest an edit to flagged feedback sends that recorded feedback, its flags and your marking of that criterion, and not the submission. Nothing about any other student is sent, and the AI proposals are never sent anyone's marks. See [section 18](#18-marking-a-cohort), step 13.

Nothing is sent until you have reviewed and approved the anonymised text. If a text changes after you approve it, it can't be sent until you approve it again; and if a rule you add later, or a name Feedbacker learns later, would redact something in it, it isn't sent until it has been anonymised and approved again. Everything leaves through the local proxy, the only program that holds the API key, and it records each request (hashes only, never the text) in its egress log: `egress.jsonl` in the proxy's data folder, `~/Feedbacker/proxy` unless the proxy was started with `--data`.

Anonymised text is still personal data while the pseudonym key exists, and in practice beyond that, because a submission can identify its author indirectly (a project name, a workplace, a photo). Your review in step 10 is the safeguard for that.

## 3. Start Feedbacker

```sh
cd ~/src/feedbacker/proxy && npm start
```

The proxy prints an address like `http://127.0.0.1:8765/#token=…`, "API key: configured", and where its egress log is and how long it keeps it. Open that exact address in Chrome or Edge. The token in it is new each time the proxy starts. If you close the tab, open the printed address again. To stop Feedbacker, press Ctrl+C in the terminal.

The app's header shows the workspace's name and folder, and whether the proxy is connected and has an API key.

## 4. Create a workspace and set its retention

A workspace is a folder holding everything for one moderation. Use one per moderation. Feedbacker keeps every workspace in one folder, `~/Feedbacker/workspaces`.

1. Press **New moderation** on **Home** (or choose **Moderation** at the top), and give it a **Name**, for example the module and year, such as `CS101 2026`. The name becomes the folder's name, so it can have letters, digits, spaces, hyphens, underscores and full stops only.
2. Under **Options**, set **Keep for** to how many days after the moderation the commissioning body lets you keep its material; the default is 90. Feedbacker records this, but it doesn't delete anything itself: deleting is step 16.
3. Press **Start the moderation**. The first time, your browser asks you to choose the workspaces folder, `~/Feedbacker/workspaces`: choose it, and Feedbacker can open your work from then on (your browser may ask for your permission again on a later visit, with one click). The moderation then opens straight away.

Next time, **Home** lists your workspaces under **Marking** and **Moderation**, with when each was started, how long it is kept for, and how far it has got; press **Continue** to open one. A workspace whose folder has gone (for example, moved or deleted outside Feedbacker) is listed under **Can't be found**; **Remove from the list** forgets it, and deletes nothing. Its name, above the steps, says it is a moderation workspace. **Close this workspace**, in the menu that opens from the workspace's name above the steps, returns you to the list. A workspace made by the command line elsewhere can be added under **More options** on **Home**, by its folder's full path; the first time you continue it, you choose its folder.

The steps are listed along the top in working order: **Overview**, **Request**, **Assessment** (**Rubric** and **Brief**), **Submissions** (**Original files** and **Original marking**), **Anonymisation**, **AI reading**, **Review** and **Export**. Under each step is its status: **Not started**, **Needs attention**, **Done**, or **Optional** for a step you can leave out (the brief and the AI reading). The **Overview** shows how far each sampled submission has got.

On **Anonymisation**, the list of texts says how many things in each still look like an identifier (an email address, a web address, a phone number, a long number), and **Review** lists them, with the text around each, on your screen only. Press **Add these to the anonymisation rules** there, then **Anonymise now**, and review and approve the text again. This finds them before the AI reading does.

If a submission "may identify someone", the plan leaves it out and lists, under **What looks like an identifier**, exactly what matched (with the text around it and how far through the text it is). These are shown on your screen only. A row of decimals can look like a phone number; if what is shown isn't an identifier, adding it only hides those numbers from the AI. Press **Add these to the anonymisation rules**, then on **Anonymisation** press **Anonymise now**, review and approve each affected text again, and plan the reading again.

**Review** and **Export** are **Locked** until the steps before them are complete. Opening a locked step lists what is left, each with a button to the step where it is done. A step locks again if a later change undoes what it needs (for example, a new rule that clears an approval); nothing you recorded is lost, and it opens again once that is put right.

## 5. Record the moderation request

On **Request**, you can read the request document (a Word file, or a PDF with text) first, or enter it by hand. A PDF's table is recovered from where its text sits, which is less reliable than a Word file's own structure: anything it can't place with certainty is left out and listed under **Please check**, so check the students listed against the document. A PDF that is only pictures of pages (a scan) can't be read; use the Word version. Under **Read it from the request document**, choose the document and press **Read the document**. On this computer, Feedbacker finds:

- the module, programme, cohort size, whether it was marked in groups, and the band distribution, and fills them in below. A band distribution that gives more than one number for a band (for example one for each assessment) can't be told apart, so it is flagged and left for you to enter;
- the students the document lists, with each one's initial mark, agreed mark and band. A student marked as not having submitted (for example `NS`) is shown as having no submission and can't be ticked. Blank rows are skipped.

Where the document lists more than one assessment, choose the one this moderation is of under **The assessment this moderation is of**; moderate the others in their own workspaces. **Choose the sample.** Under **Choose the sample**, a scheme can suggest it from the marks, and you can then tick or untick students by hand.

- **The size** is a percentage of those who submitted, always rounded up (a tenth, 10%, unless you change it; the percentage you last used is remembered on this computer). It shows the number it gives, for example "Sample size: 1 of the 6 who submitted".
- **The scheme:** *A spread across the bands* (the highest and lowest marks, then every fail below the pass mark you give, then the mark nearest each band boundary, then the rest spaced evenly through the marks; the usual choice), *Marks near a band boundary* (within the distance you give), *At random, from a seed* (anyone can repeat it from the seed, which is recorded), *Marks changed by internal moderation* (the furthest moves first), or *Pick by hand*.
- It suggests only students who submitted and whose ID can be recorded, and says where it found fewer than the size, or couldn't take every fail. The suggested students are ticked, and **How the sample was chosen** is filled in for you (for example "10% of the 6 who submitted (1), rounded up, chosen as a spread across the bands…"), with the seed where there is one. Tick or untick any student by hand and the note adds "Then adjusted by hand." The same marks and options always give the same suggestion.

Tick the students in the sample: the ticked students' IDs (and their bands, from their marks) fill in the sample below, and the count says how many of those who submitted are ticked. Anything uncertain (a mark that isn't a number, an ID Feedbacker can't record, a table that doesn't match the cohort size) is flagged for you to check, never corrected. When you record the request, the cohort the document listed is kept as well, **without its students**: for each assessment, its rows by number with the initial and agreed marks and whether the student submitted, the grade bands, which rows are in the sample, and the document's hash. No name or ID is kept for anyone not in the sample (a sampled student's go only into the private pseudonym key, as before). If you later read a different document, you are told it isn't the one the cohort was recorded from, and recording from it replaces that cohort. Nothing is recorded until you press **Record the request**. Staff named in the document are never read, nothing is kept of the document itself, and a student's name goes only into the private pseudonym key, where anonymisation uses it. Only a Word document is read; for a pdf, enter the request by hand.

The students' IDs in the document are the institution's own, which may not be the IDs in the downloads' file names (for example Turnitin's). Feedbacker finds each student's files by name instead, on the next two steps (see **Match the students by name** below). The marks the document listed for the ticked students are kept with the request, so a marked view's grade can be checked against the initial mark.

Or enter what the moderation request (the form you were sent) lists:

- **Sampled submissions**: a row per grade band, with the band (for example `60-69`) and its submission IDs as on the form (for example Turnitin submission IDs), separated by commas or spaces. **Add another band of the sample** adds a row. If the form doesn't give bands, leave the band empty and put all the IDs in one row.
- The module, programme, cohort size and the cohort's band distribution (a row per band, with its number of students), as written on the form (all optional).
- **Staff roles involved**: roles only (for example "module convener"), never names.

Press **Record the request**. Each sampled submission gets a pseudonym ([STUDENT_A], [STUDENT_B], …), which is how it appears from now on.

The screen then shows **What's recorded**: each sampled submission's pseudonym beside its real ID, the only screen that shows real IDs, so you can match pseudonyms to the moderation form, and the context you entered. To correct it, open **Change the request**: the form starts from what is recorded; tick **Replace the request already recorded** and record it again. Every screen is laid out the same way, in the same order: a status line under the heading says whether the step is done and why (as the steps do), **How this step works** explains it, **What's recorded** shows what it holds, and its form is folded away once the step is complete. Two screens differ, on purpose: the **Overview** has no status line, as it isn't a step, and **Export** never folds its actions away, as you can export again whenever you need to ("Import the originals again", "Import the rubric again", "Import the brief again").

## 6. Import the source rubric and the brief

Use the rubric the module published (xlsx, csv, json, or a docx table), not the marking platform's copy of it: this source rubric governs the comparison.

**A rubric that exists only as an image** (a screenshot of the marking platform's rubric, say) is entered under **Or enter it from an image of the rubric**. Feedbacker doesn't read the picture: you type the grid beside it. Choose the image, and it is shown beside the grid; then enter the title, and for each criterion its title, weight and (if it differs from the weight) the points it is marked out of, and each level's label with its range as written (for example "Excellent (16-20)"), points and descriptor. If the levels are fixed percentage bands of each criterion's points, **A pattern to start a criterion's levels from** names each level and the percentage it starts at, and a criterion's **Fill … level labels from the pattern** button fills in its labels with their ranges; the points and descriptors you still type from the image.

As you type, anything that departs from the pattern the rubric itself follows is listed under **Please check these against the image**, and nothing is changed: the weights not adding to 100, a criterion with a different number of levels, a level's points outside its range, ranges that overlap, points that don't fall, and a level that starts at a different percentage of its criterion's points from the same level of the others (judged where three or more criteria give a range). A flag can be a slip in the rubric itself, so a flagged rubric can still be saved, as written. **Have the AI read the image (optional).** Typing the descriptors is the slow part, so the editor can ask the AI to propose the grid. It sends the image of the rubric through the local proxy, with its instructions and nothing else: no student's material, nothing from the brief ([ADR 0009](decisions/0009-sending-a-rubrics-image-to-the-ai.md)). It needs the proxy running with your API key. Choose the model and a spend limit, tick **Replace what I have typed** if you have started typing, and press **Show what would be sent**. You see the image (sent without its hidden metadata: names, places and the like that a picture can carry; your original stays as the rubric's source), the instructions it is sent with, and the worst-case cost against your limit; **Confirm and send the image** sends it, and **Don't send it** doesn't. What comes back fills the grid, marked as the AI's proposal. It can misread, so check every cell against the image and correct it; the checks below run on it as on anything typed. Nothing is saved until you save, and the saved rubric records that it began as the AI's proposal (the model, the time and the request's hash, not the image's content). Without a key the button says so, and you can still type the grid.

**Save the rubric entered from the image** keeps the image with the rubric as its source, with its hash, and records that it was entered from it, by you. Replacing a rubric already saved needs **Replace the rubric already saved** ticked. Import it before the original marking, which is mapped onto it.

1. On **Rubric**, choose the **Rubric file**. For a spreadsheet with several sheets, name the **Spreadsheet sheet**.
2. Press **Read the rubric**, and check the preview under **Check the rubric before saving it**: the criteria, their levels and points, and any warnings.
3. Under **Criterion weights**, check each criterion's weight, as a percentage. They start from the file; enter any it doesn't give (a rubric often has them only in its criterion titles, for example "Implementation 25"). The total is shown as you go. Weights are needed to work out an overall mark from levels on Review.
4. Press **Save this rubric**.

For the assessment brief, on **Brief**, choose the brief (docx or pdf) and press **Import the brief**. It is anonymised and approved like a submission (step 10), and the AI reading sees only the approved brief.

**A brief that describes several assessments.** Under **Which part of the brief applies**, choose the part for this assessment. Only what you choose is anonymised, approved and sent to the AI; the rest is never sent, and isn't anonymised at all.

- If the brief has headings, each is listed with the number of words under it, and a part includes the headings beneath it. Tick the part for this assessment (for example "Element 1") and any module-wide parts that apply to it (the learning outcomes, the rules), then press **Use these parts**.
- If it has no headings (often a PDF), choose where the part starts and ends from the lists of its text, and press **Use this range**.
- The whole brief and the text this assessment uses are shown side by side, as written, on this screen only. **Use all of the brief** goes back to the whole.
- Choosing a different part clears the brief's anonymised text and its approval, so anonymise and approve it again; the same choice changes nothing. Importing the brief again starts from the whole.

## 7. Download and import the original files

1. From the marking platform (for example Turnitin, through the VLE), make a bulk download of the original files: the students' own documents, docx or pdf. Save it outside the Feedbacker folder, for example in `~/Feedbacker/downloads/`.
   - If the sample is spread across several downloads (for example across marking groups), download each.
   - Typed docx and pdf only; Feedbacker can't read handwriting or scanned pages.
2. On **Original files**, choose every download at once under **Downloads and files** (zips or single files), and press **Import the originals**. If you unzipped a download, choose the folder it was unzipped into instead, under **Or a folder of unzipped downloads**; the folder's own name, and any folders inside it, make no difference. One choice at a time: choosing a folder replaces the files chosen, and the other way round.

Only the sampled submissions are opened; other students' files in a download are never read, and the step says how many it left unopened.

**Match the students by name.** If the request's student IDs aren't in the files' names, importing says "no file found for [STUDENT_A]…". Under **Students not found by their ID**, choose the downloads as before and press **Match the students by name**. On this computer, from the file names only, Feedbacker compares each student's name from the request with the name in each file's name (`<ID> - <NAME> - <file>`), ignoring case, accents, punctuation and the order of the parts. A name matches only when exactly one file has it:

- **Matched by name** shows the file in the **File** box; check it is the right one.
- **No file has this name**, **More than one file could be theirs** and **The request gave no name** leave the box empty. Choose the student's file by hand from the files nobody has been matched to (a name written differently, a middle name in one place and not the other, is a case for this).

The table shows real names, on this screen only. Nothing is recorded until you press **Confirm these matches**, which records each file's marking-platform ID in the private pseudonym key; then import again. From then on the originals and the marked views are both found by that ID, because the marked views' names carry the same one. A file is never taken for a student without your confirmation.

- A download comes with a small report (for example Turnitin's `manifest.txt`) that says how many files failed to download. Feedbacker reads that count, and nothing else in the report, from inside a zip or from beside the unzipped files. If none was found (for example it was left out when unzipping), the step says the check couldn't be made, so check the number of files yourself.
- Whether a file is the student's own or a marked view is judged from its structure, not from where you put it. If a sampled student's file is a marked view, nothing is imported and the step says which; it belongs under the original marking.
- If a sampled submission's file is missing from the downloads, or isn't docx or pdf, nothing is imported and the step lists each one. Add the missing download and import again.
- If a file is there but can't be read, the step says which, and the others are still imported.
- To import the originals again (for example after a corrected download), tick **Replace originals already imported**.

## 8. Import and confirm the original marking

Importing the marking before anonymising saves approving twice: its files' names can add a student's name, as written there, to the pseudonym key, and anonymising afterwards redacts it from every text straight away.

1. From the marking platform, make a second bulk download: the marked versions (for example Turnitin's current-view PDFs, "GradeMark files"). Again, download each if the sample spans several.
2. On **Original marking**, choose the downloads under **Marked views (zips or single files)**, or the folder you unzipped them into under **Or a folder of unzipped downloads**, and press **Import the marking**. As for the originals, the download's report is read for its failed-file count, and a file that isn't a marked view at all (it has no Submission ID, grade or rubric, so it may be a student's original) stops the import before anything is recorded.
   - The marker's marks, levels and comments (summary and inline) are imported as written, mapped onto the source rubric, and the comments are anonymised.
   - If a sampled submission's marked view is missing from the downloads, nothing is imported and the step says which (for example "no file found for [STUDENT_A] (sub-001)"). Add the missing download and import again.
   - If some of the marker's criteria don't match your rubric by name (marking platforms often abbreviate or rename them, for example `PROFESSIONALISM` for "Reflection and professional practice"), their marks aren't imported, and **Match the marker's criteria** lists each one by the marker's name. Choose the criterion of your rubric that each one marks (or leave it unmatched), choose the downloads again, tick **Replace marking already imported**, and import. The matches are kept for later imports, and a matched criterion drops off the list. Afterwards, press **Anonymise now** again (step 10), and **Check** and **Confirm** the replaced records.
   - Disagreements (for example a selected level that doesn't match the awarded score) are noted under **Please check**, never corrected.
3. Under **What's recorded**, press **Check** for each record. The marking shows how it came in, the overall mark, the comments, and a table by criterion of the marker's mark, the marker's level and where the mark falls on your source rubric, with anything the import noted under **Please check**. Press **Confirm this marking** if it's right.

**The rubric the marked views carry.** Marked views from some platforms print the platform's own copy of the rubric (each criterion's name, weight and maximum, and its levels with their points). When you import such views, Feedbacker keeps that copy as shown, beside the marking and never as your source rubric, and compares your saved rubric with it. On **Rubric**, under **Compared with the marked views' rubric**, each difference is listed in words: a criterion with no counterpart on either side, a different weight or maximum, a level that differs or is missing (levels are matched by their points). Nothing is corrected: check each against the platform and your rubric, and import your rubric again if it has a slip. It is an independent check of what you typed, such as a rubric entered from an image. If no imported marked view carries a rubric (the marking was done elsewhere, or none is imported yet), the screen says there is nothing to compare with.

**When the marked views carry no marking.** Some marking platforms hold the marking elsewhere, so the marked views are only the paper with the platform's header and footer. Importing them then says "this marked view carries no marking (no grade, rubric or comments)". If the request lists each student's marks (see step 5), use them instead: under **Use the request's marks**, press **Use the request's marks as the original marking**.

- Each sampled student's initial mark becomes the marker's overall mark. The request's agreed mark is the mark after the partner institution's internal moderation: where it differs from the initial mark, it becomes its own record, under the role "internal moderator", so you can see both. Where it is the same, the marker's record says so. A student the request gives no initial mark for has no marking made, and the step says so.
- These are overall marks only: there are no marks for the criteria and no comments. The record says so, and the comparison shows "No mark" against each criterion instead of an empty or zero mark, comparing your overall marks with the marker's overall mark.
- They are not confirmed until you check and confirm each, like any marking, and the internal moderator's record needs confirming too before the record can be approved. Recording them again over marking already recorded needs **Replace marking already recorded** ticked, and keeps the old records in the history.

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
   - **Figures** (charts, dashboards, screenshots, diagrams) are shown where they were in the text, each with its placeholder, such as [FIGURE_1], and its page. Redaction can't see inside an image, so check each for a name, an email, a username, a file path, an organisation or a face. Where the student gave a figure alternative text in a Word document, it follows the figure as a line of the text ("Alt text: …", straight after the figure), anonymised and reviewed with the rest, and is read out as the image's description. Every figure is included unless you tick **Don't send [FIGURE_n]**; you can say why, and press **Save the reason**. A figure you don't send stays in the workspace, and its placeholder stays in the text, marked "(not sent)". Changing which figures are included clears the text's approval.
3. When a text is right, press **Approve this text for the AI** (**Approve this text and its figures for the AI**, when it has figures). Only approved text, and the figures approved with it, can ever be sent to a model.

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

Each submission's approved figures (charts, dashboards, screenshots, diagrams) are sent with it, each as an image after its placeholder, such as [FIGURE_1]; the plan's **Figures** column says how many are sent, and **Figures included but not sent** lists any the AI can't be sent (an EMF or TIFF image, say). Untick **Include each submission's approved figures** to read without them. A figure you chose not to send, or one that can't be sent, is marked "(figure not sent)" for the model, which treats it as evidence neither way: where a criterion rests on visuals it doesn't see, expect it to flag that it found too little evidence, and judge those criteria from the visuals yourself. If a figure is too large for the AI (more than 8000 pixels a side, or 2000 when a submission has more than 20 figures, or more than 10 MB), the submission is left out of the plan, saying which figure to leave out.

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

**Suggest a verdict and comment.** Once every criterion of a submission is judged, press **Suggest a verdict and comment** to have the AI suggest one of the four verdicts and a comment explaining it, from your levels and marks, the original marker's overall mark and the AI's own reading. As for the AI reading, it first shows exactly what would be sent (never the submission's text, the brief or the marker's comments) and the worst-case cost, and sends nothing until you press **Confirm and send**. The suggestion is not recorded and nothing is chosen for you: press **Use the AI's verdict** and/or **Use the AI's comment**, then change what you like and **Record the verdict**. A verdict taken from the AI, and a comment that began as its suggestion, are recorded as such.

The **Overview** shows how far each submission has got and its verdict. Where the request was read from a document, it also shows **The cohort the request listed**: for each assessment, how many students submitted and how many of them are in the sample, the grade bands with how many of the cohort and of the sample are in each (and the count the request itself gives, where it gave one), and, under **The rows of …**, each student's row by number with the marks and band, never a name or ID. It says where the request's cohort size or band counts don't agree with its table, and never corrects them. Then it shows **Agreement across the sample**, by submission and by criterion. It says how many submissions and judged criteria the figures rest on. A sample of fewer than 10 submissions is small, and the Overview and the exported summary say so: the counts describe those submissions only, and are too few to show a pattern in the marking, so the summary doesn't name a criterion the marking tended to differ on. The counts themselves are still given, and the summary says how the sample was chosen where you recorded that.

## 14. Approve and export the record

On **Export**:

1. **Export** opens once the moderation is ready to approve. Until then, it lists anything left to do, by submission (for example a criterion still to judge, a blind review not yet revealed, marking not confirmed, or a verdict to check again because the marking, the rubric or your marks changed after it). Deal with each; the list updates as you go.
2. Write **Your overall moderator's comment** (it goes into the summary and the section for the moderation form), and press **Approve the moderation record**. Or press **Suggest an overall comment**: once every sampled submission has a verdict, the AI suggests a short paragraph on the sample from your verdicts and comments (it shows exactly what would be sent, and the worst-case cost, first, and sends nothing until you confirm). Use it or not, as with the verdict; a comment that began as its suggestion is recorded as derived from the AI. A small sample can't show how the marker marked the rest, and the suggestion is told to say so.
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

1. Press **New marking** on **Home** (or choose **Marking** at the top), give it a name, and press **Start the marking**; **Options** sets how long it is kept for, as in [step 4](#4-create-a-workspace-and-set-its-retention). Its name, above the steps, says it is a marking workspace.
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
16. Each piece of recorded feedback is checked against its mark, in Feedbacker (nothing is sent): praise that belongs to a higher band than the mark's (for example "excellent" on a 58), no "Next time" step, another mark or level named (for example "68%" on a 62, or "2:1" on a lower second), an anonymised value (a token such as [ORG_1]) the student would see, and text that ends mid-sentence (as a draft can, if the AI's reply is cut short; draft it again). Flags appear under each piece of feedback, and **Checks across the cohort** lists how many each submission has. While a box holds text you haven't recorded (a new draft, or your changes), the checks shown are of that text as it stands; a flag can be accepted once it is recorded. Praise that is negated or said to be missing ("lacks an effective structure", "rather than a demonstration of effective …") isn't flagged. A flag never blocks you: change the text and record it again; press **Draft this again, avoiding "…"** to have the AI draft that criterion again without the flagged praise words (they are added to what is sent, and shown in the plan); press **Suggest an edit for this flag** to have the AI suggest the smallest change to your own recorded text that deals with the flags, keeping your wording (you see exactly what will be sent first: your feedback, its flags and your marking of that criterion, never the submission; press **Confirm and send**, or **Don't send**; the suggestion appears beside your feedback with its own checks, and **Use the suggestion** puts it in the box to record, as derived from the AI, or **Don't use it**); or keep the text by pressing one of the **Accept:** reasons, or typing your own and pressing **Accept with this reason**. The reason is kept with that text; recording new text clears it. A figure quoted from the submission (such as its test coverage) may be flagged as a mark; accept it with that reason. **Words that only fit higher marks** lists the praise words for each band, which you can change for this workspace.
17. **Feedback across the cohort** shows, for each criterion, every student's recorded feedback grouped by your level, and the overall feedback by band. Feedback much shorter or longer than the rest at its level (under half, or over twice, the median), and feedback nearly the same as another student's, are flagged. **Edit** opens that student's feedback.
18. On **Export**, press **Read what they receive** for a submission: it shows exactly what that student will receive, the overall mark, then each criterion's mark and feedback, then the overall feedback. A submission can be approved once everything is marked, its feedback is current, and every flag is accepted; if it isn't ready, it lists what is left. Read it, and press **Approve exactly this**. Any later change (a mark, the feedback, a flag's reason) clears the approval.
19. For an approved submission, **Copy the mark**, **Copy** each criterion's feedback, or **Copy all the feedback**, and paste it into the student's comment box in Turnitin or Canvas. **Export the approved feedback and marks** writes, into `exports`, each approved student's feedback as text, one file of them all, a marks table (CSV) and the structured record (JSON). All of these are pseudonymous.
20. To match students in the platform, press **Make a re-identified copy**: as in moderation, it asks first, and on **Make the copy** writes the feedback files and the marks table with each student's platform ID in place of their pseudonym, and nothing else restored. It contains personal data, is kept only in this workspace, and is deleted with it. A token such as [ORG_1] left in someone's feedback stays a token, so the checks flag it before you approve.

## 19. A module with more than one assessment

A module groups its assessments, so what they share is set up once. It is a folder in the workspaces folder, and each assessment is a marking or a moderation of its own, in a folder inside it, with its own rubric, sample, downloads and record. A workspace made on its own is a module of one: nothing about it changes.

1. Press **New moderation** (or **New marking**) and name it for the assessment, such as **Report**. Under **Part of a module**, choose **A new module…**, name the module, such as the module and year, and decide now whether to **Share one pseudonym key across the module's assessments**; you cannot change it later. With a shared key, a student is the same pseudonym in every assessment, which lets the module follow them throughout; it also means the AI could tell that work in different assessments is one student's, and one private file links the real people for the whole module. Leave it off unless you need it. The module is made with its first assessment, which opens.
2. For each further assessment (for example **Case study**), press **New moderation** (or **New marking**) again and choose the module under **Part of a module**; or, on the module's page, **Add an assessment**. Home lists a module with its assessments under **Modules**; **Open the module** opens its page. The **Moderation** and **Marking** pages list a module's assessments of that kind under the module's name.
3. Under **The request document**, choose the request document and press **Read the document**, check what it found, and press **Keep this cohort in the module**. The module keeps each assessment's marks and weighting, and which rows are one student, but no name and no ID. The programme and module it gives become **The module's context**, which each assessment's request starts from; you can change them.
4. Under **The brief**, import the brief once, whole. In each assessment, on **Brief**, press **Use the module's brief** and choose the part that applies to that assessment: only that part is anonymised, approved and sent. If you replace the module's brief, each assessment says it no longer has the current one, and you can take it again (which clears that assessment's section and approval).
5. The anonymisation rules are the module's: a name or value you ask to be redacted in one assessment is redacted in every one, and each assessment then anonymises again. Only the sampled students' names and IDs are kept, in a key, as always.
6. In each assessment, record its request as in [step 5](#5-record-the-moderation-request). Reading the request document there is how you tick that assessment's sample, so read the same document as the module's: Feedbacker says if it is another.
7. **Module marks** on the module's page lists every student the request names, with each assessment's marks (the original marker's, the internal moderator's and yours, in that order) and the module mark at each of those three levels. A module mark is each assessment's mark weighted by what it is worth in the request, and is worked out only for a student with a mark in every assessment at that level. So the first two are filled for everyone who submitted everything, and yours only for those you have marked in every assessment. These figures are for you to read; they are never marks given.
8. **Delete this module…** deletes the module's folder and every assessment in it, with the same confirmations as one workspace: the exports are listed, you tick that you have kept what you need, and you type the module's name.
