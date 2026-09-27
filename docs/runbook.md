# Stage 0 moderator runbook

This guide takes you through a real moderation with Feedbacker, from receiving the moderation request to returning the moderation form and deleting everything afterwards. It follows the app step by step. Its order differs from the app's navigation in one place: the marking is imported before the texts are anonymised, so that the anonymisation is complete (steps 8 to 10).

Feedbacker helps you moderate; it does not moderate for you. Your judgements, verdicts and comments are yours. The AI reading is a second reading that you may use or ignore, and it is never a mark.

Words in **bold** are the app's own labels and buttons.

## Contents

1. [Before you start](#1-before-you-start)
2. [What stays on your machine, and what is sent to a model](#2-what-stays-on-your-machine-and-what-is-sent-to-a-model)
3. [Start Feedbacker](#3-start-feedbacker)
4. [Create a workspace and set its retention](#4-create-a-workspace-and-set-its-retention)
5. [Record the moderation request](#5-record-the-moderation-request)
6. [Download and import the originals](#6-download-and-import-the-originals)
7. [Import the source rubric and the brief](#7-import-the-source-rubric-and-the-brief)
8. [Set the anonymisation rules](#8-set-the-anonymisation-rules)
9. [Import and confirm the original marking](#9-import-and-confirm-the-original-marking)
10. [Anonymise, review and approve](#10-anonymise-review-and-approve)
11. [Run the AI reading](#11-run-the-ai-reading)
12. [Review each submission, openly or blind](#12-review-each-submission-openly-or-blind)
13. [Record a verdict on each submission's marking](#13-record-a-verdict-on-each-submissions-marking)
14. [Approve and export the record](#14-approve-and-export-the-record)
15. [Return the moderation form](#15-return-the-moderation-form)
16. [Delete the workspace and the downloads](#16-delete-the-workspace-and-the-downloads)
17. [If something goes wrong](#17-if-something-goes-wrong)

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

Nothing is sent until you have reviewed and approved the anonymised text. If a text changes after you approve it, it can't be sent until you approve it again. Everything leaves through the local proxy, the only program that holds the API key, and it records each request (hashes only, never the text) in its egress log: `egress.jsonl` in the proxy's data folder, `~/Feedbacker/proxy` unless the proxy was started with `--data`.

Anonymised text is still personal data while the pseudonym key exists, and in practice beyond that, because a submission can identify its author indirectly (a project name, a workplace, a photo). Your review in step 10 is the safeguard for that.

## 3. Start Feedbacker

```sh
cd ~/src/feedbacker/proxy && npm start
```

The proxy prints an address like `http://127.0.0.1:8765/#token=…`, "API key: configured", and where its egress log is and how long it keeps it. Open that exact address in Chrome or Edge. The token in it is new each time the proxy starts. If you close the tab, open the printed address again. To stop Feedbacker, press Ctrl+C in the terminal.

The app's header shows the workspace's name and folder, and whether the proxy is connected and has an API key.

## 4. Create a workspace and set its retention

A workspace is a folder holding everything for one moderation. Use one per moderation.

1. On **Open a workspace**, under **Create a new workspace**, enter the **Full path of the new folder**, for example `/Users/you/Feedbacker/workspaces/module-2026`. The folder must not exist yet.
2. Set **Keep for (days)** to how long the commissioning body lets you keep moderation material; the default is 90. Feedbacker records this, but it doesn't delete anything itself: deleting is step 16.
3. Press **Create**, then choose the new folder when the browser asks.

Next time, **Open the last workspace** reopens it, or **Choose a workspace folder…** opens another. **Close this workspace**, at the foot of each step, closes it and makes the browser forget it.

The steps are listed along the top: **Overview**, **Request**, **Originals**, **Rubric**, **Brief**, **Anonymisation**, **Original marking**, **AI reading**, **Review** and **Export**. The **Overview** shows how far each sampled submission has got.

## 5. Record the moderation request

On **Request**, enter what the moderation request (the form you were sent) lists:

- **Sampled submissions**: one band per line, as `BAND:ID,ID`, for example `60-69:100200301,100200302`, using the IDs on the form (for example Turnitin submission IDs). If the form doesn't give bands, list the IDs alone.
- The module, programme, cohort size and the cohort's band distribution, as written on the form (all optional).
- **Staff roles involved**: roles only (for example "module convener"), never names.

Press **Record the request**. Each sampled submission gets a pseudonym ([STUDENT_A], [STUDENT_B], …), which is how it appears from now on.

## 6. Download and import the originals

1. From the marking platform (for example Turnitin, through the VLE), make a bulk download of the original files: the students' own documents, docx or pdf. Save it outside the Feedbacker folder, for example in `~/Feedbacker/downloads/`.
   - If the sample is spread across several downloads (for example across marking groups), download each.
   - Typed docx and pdf only; Feedbacker can't read handwriting or scanned pages.
2. On **Originals**, choose every download at once under **Downloads and files** (zips or single files), and press **Import the originals**.

Only the sampled submissions are opened; other students' files in a download are never read, and the step says how many it left unopened.

- If a sampled submission's file is missing from the downloads, or isn't docx or pdf, nothing is imported and the step lists each one. Add the missing download and import again.
- If a file is there but can't be read, the step says which, and the others are still imported.
- To import the originals again (for example after a corrected download), tick **Replace originals already imported**.

## 7. Import the source rubric and the brief

Use the rubric the module published (xlsx, csv, json, or a docx table), not the marking platform's copy of it: this source rubric governs the comparison.

1. On **Rubric**, choose the **Rubric file**. For a spreadsheet with several sheets, name the **Spreadsheet sheet**.
2. Press **Read the rubric**, and check the preview under **Check the rubric before saving it**: the criteria, their levels and points, and any warnings.
3. If the weights are missing or wrong, enter them under **Criterion weights** (one per line, as `CRITERION_ID=PERCENT`, using the IDs shown in the preview), and read it again.
4. Press **Save this rubric**.

For the assessment brief, on **Brief**, choose the brief (docx or pdf) and press **Import the brief**. It is anonymised and approved like a submission (step 10), and the AI reading sees only the approved brief.

## 8. Set the anonymisation rules

Set the rules before importing the marking: the marker's comments are anonymised as they are imported, with the rules as they are then.

On **Anonymisation**, under **Rules**, add anything the automatic redaction might miss:

- **other people's names** (staff, clients, classmates), one per line;
- **organisations**, one per line;
- **extra values to redact**, such as usernames or project names, one per line (as `TEXT=KIND`, for example `aquill99=USERNAME`, to name the token's kind);
- **values that should not be redacted**, for words wrongly redacted.

Press **Add to the rules**. The rules hold real values, so they are kept in the workspace's private folder and never shown on screen. Don't press **Anonymise now** yet: that comes after the marking is imported (step 10).

## 9. Import and confirm the original marking

Import the marking before anonymising: its files' names can add a student's name, as written there, to the pseudonym key, and anonymisation (step 10) then redacts it from every text.

1. From the marking platform, make a second bulk download: the marked versions (for example Turnitin's current-view PDFs, "GradeMark files"). Again, download each if the sample spans several.
2. On **Original marking**, choose the downloads under **Marked views (zips or single files)** and press **Import the marking**.
   - The marker's marks, levels and comments (summary and inline) are imported as written, mapped onto the source rubric, and the comments are anonymised.
   - If a sampled submission's marked view is missing from the downloads, nothing is imported and the step says which (for example "no file found for [STUDENT_A] (sub-001)"). Add the missing download and import again.
   - If the marker's criterion names don't match the source rubric, the step lists them, with the source rubric's IDs. Enter each under **Map the marker's criteria**, as `MARKER_NAME=SOURCE_ID`, tick **Replace marking already imported**, and import again.
   - Disagreements (for example a selected level that doesn't match the awarded score) are noted under **Please check**, never corrected.
3. Under **Check and confirm**, press **Check** for each record, read the summary, and press **Confirm this marking** if it's right.

If you plan to review a submission blind (step 12), don't check or confirm its marking yet: choose blind review for it first. Its marking stays hidden until you reveal it, and you confirm it then.

**Enter or correct marking by hand** is only for marking without a marked view (for example a second marker's, under a role such as "second marker"), or to correct a record. Replacing an existing record needs **Replace the existing record** ticked; the old one is kept in the history.

## 10. Anonymise, review and approve

1. On **Anonymisation**, press **Anonymise now**. Students' names are replaced by their pseudonyms, and other details by tokens such as [EMAIL_1].
2. Under **Review and approve**, open each submission, and the brief, with its **Review** button, and read the whole anonymised text. Look for anything that still identifies someone: names, emails, usernames, repository or portfolio links, workplaces, personal details.
   - **Show the real values** shows what each token replaced, to check the redaction. It shows real names, so use it only when you need it.
   - If something is missing, add it to the rules and press **Anonymise now** again. An approval stays only for a text that hasn't changed.
3. When a text is right, press **Approve this text for the AI reading**. Only approved text can ever be sent to a model.

If anything changes later, before the AI reading:

- after importing or re-importing marking, or adding to the rules, press **Anonymise now** again. A text whose anonymisation changes (for example because the key gained a name) loses its approval: review it and approve it again. An approval that stays is for exactly the same text;
- rules added after the marking was imported don't reach the marker's comments already imported. To apply them, import the marking again with **Replace marking already imported** ticked, and confirm it again.

## 11. Run the AI reading

1. On **AI reading**, choose the **Model** and the **Spend limit for this run (USD)** (at most $5 a run, unless the proxy is started with a higher `--max-run-usd`). Keep **Include the approved brief** ticked unless you have a reason not to.
2. Press **Plan the reading**. Nothing is sent yet. Under **Check the estimate before anything is sent** you see, for each approved submission, the most it could cost (a real run costs much less), and anything left out, with why. If nothing can be read yet, it says **Nothing to read yet** and why.
3. Press **Confirm and send** to send exactly what was planned, or **Don't send**. The run stops at the spend limit.
4. **What came back** lists what was read, what failed and why, and anything to check (for example a quote the model gave that isn't in the submission).

A reading is only ever a suggestion: a level for each criterion, the evidence it quotes, and a draft comment.

## 12. Review each submission, openly or blind

On **Review**, choose a submission and press **Review this submission**. The first time, choose how to review it; the choice is kept and can't be changed:

- **Review openly**: the original marking and the AI reading are shown throughout. This is usual moderation practice.
- **Review blind**: they stay hidden until you have recorded a level for every criterion and press **Reveal the original marking and the AI reading**. You can then revise any level; your first level and the revision are both kept. Blind review isn't possible once you have confirmed that submission's marking.

For each criterion, choose **Your level** from the rubric's levels, add a comment if you wish, and press **Record the judgement**. **Start from the AI draft** puts the AI's draft comment into yours to edit; a comment started that way is recorded as adapted from the AI draft, however much you change it. **Clear and write my own** undoes that.

The screen shows, side by side, the anonymised submission, the brief, every marker's marks and comments, and the AI reading. **Comparison** then sets your level beside each marker's mark and the AI suggestion, saying each difference in words, and flags a marker's level label that doesn't fit their score.

## 13. Record a verdict on each submission's marking

Under **How was … marked?** on the same screen, choose **Agree**, **Generous**, **Harsh** or **Inconsistent**, add a **Suggested mark** and a comment if you wish, and press **Record the verdict**. For a blind review, this comes after the reveal.

The **Overview** shows how far each submission has got, its verdict, and **Agreement across the sample**, by submission and by criterion.

## 14. Approve and export the record

On **Export**:

1. **Ready to approve?** lists anything left to do, by submission (for example a criterion still to judge, a blind review not yet revealed, marking not confirmed, or a verdict to check again because the marking changed after it). Deal with each; the list updates as you go.
2. Write **Your overall moderator's comment** (it goes into the summary and the section for the moderation form), and press **Approve the moderation record**.
3. Press **Export the record and summary**. It writes three files into the workspace's `exports` folder:
   - `…-record.feedbacker-export.json`: the structured record, with the full provenance of every value;
   - `…-summary.feedbacker-export.md` and `….docx`: the readable summary.

   All three are pseudonymous. If you change anything after approving, the export is refused until you approve again.

The summary is also shown on the screen, as it would be approved and then as approved.

## 15. Return the moderation form

The summary ends with **For the moderation form**: the sampled items by grade band, each with your verdict and suggested mark, then your overall comment, ready to copy into the form.

If the form must say which submission is which, make a re-identified copy on **Export**: under **Re-identified copy**, tick **I understand this copy contains personal data**, and press **Make a re-identified copy**. It writes `…-summary-reidentified.feedbacker-export.md` and `.docx`, with each student's Turnitin ID in place of their pseudonym. Nothing else is restored: no names, and other redacted details stay redacted. You're asked to confirm each time.

Copy what the form needs, add your signature as the form asks, and return it. Then delete the re-identified copy if you no longer need it (step 16).

## 16. Delete the workspace and the downloads

When the commissioning body's retention period ends, or as soon as you no longer need the material:

1. In the app, press **Close this workspace**. Then stop the proxy (Ctrl+C).
2. Delete the workspace folder, which holds everything Feedbacker made (the source files, extracts, anonymised text, approvals, readings, judgements, the pseudonym key and every export), for example:

   ```sh
   rm -rf /Users/you/Feedbacker/workspaces/module-2026
   ```

   Check the path first. There is no delete button in the app yet.
3. Delete the downloads (the originals and the marked views), and empty the Trash if they went there.
4. Keep only what you are required to keep, such as the pseudonymous record, somewhere safe outside any git repository, for no longer than required.

The proxy's egress log (`egress.jsonl` in its data folder, `~/Feedbacker/proxy` by default) holds hashes, not text. Its entries are removed after 90 days, unless the proxy was started with a different `--egress-retention-days`. The proxy prints both when it starts, as "Egress log: … (kept … days)".

## 17. If something goes wrong

Feedbacker says what went wrong in words; it never hides a failure. Most messages say what to do next. A red **This couldn't be done** is a failure. An amber **Please check** is a note: the step worked, but something needs your attention.

To report a problem, open an issue in the Feedbacker repository, and describe:

- which step you were on and what you did;
- the message, word for word, with any name, ID or other real detail replaced;
- what you expected instead.

Never attach, paste or screenshot real material: no submissions, marked views, rubrics that identify the module, exports, workspace files, or anonymised text (it is still personal data). If you can, reproduce the problem with the synthetic files in `fixtures/synthetic/`, and report that instead.
