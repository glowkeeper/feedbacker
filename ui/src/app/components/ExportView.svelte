<script lang="ts">
  import { tick } from "svelte";
  import { approveRecord, IdentifiersFound, type RedactionMatch, type IdentifierMatch, exportReidentifiedSummary, planOverallSuggestion, RecordNotReady, runOverallSuggestion, type OverallPlan, type OverallSuggestion, type Workspace } from "../../core/index.ts";
  import { exportAll, loadExportState, type ExportState } from "../exportStep.ts";
  import { loadedText, problemsOf } from "../forms.ts";
  import Problems from "./Problems.svelte";
  import FoundIdentifiers from "./FoundIdentifiers.svelte";
  import RedactionMatches from "./RedactionMatches.svelte";
  import Status from "./Status.svelte";
  import Waiting from "./Waiting.svelte";
  import { asDone, done as succeeded, info, type Message } from "../messages.ts";
  import SummaryPreview from "./SummaryPreview.svelte";
  import type { StepState } from "../steps.ts";
  import type { AppProxy } from "../platform.ts";
  import StepScreen from "./StepScreen.svelte";

  let { workspace, proxy, step, onChanged }: { workspace: Workspace; proxy: AppProxy; step: StepState | undefined; onChanged: () => void | Promise<void> } = $props();

  let view: ExportState | null = $state(null);
  let comment = $state("");
  let typed = false; // in the overall comment, since the record began loading
  let confirming = $state(false); // the re-identified copy asked for, and awaiting confirmation
  let confirmHeading: HTMLHeadingElement | undefined = $state();
  let reidentifyButton: HTMLButtonElement | undefined = $state();
  // Suggesting the overall comment (ADR 0011): what would be sent, then what came back. Nothing is filled in or recorded for the moderator.
  let overallPlan: OverallPlan | null = $state(null);
  let overallHeading: HTMLHeadingElement | undefined = $state();
  let overallSuggestion: OverallSuggestion | null = $state(null);
  let commentFromAi = $state(false); // the comment began as the suggestion, however much it was changed
  let waiting = $state(false); // asking the AI
  let overallNote: string | null = $state(null);
  let overallProblems: string[] = $state([]);
  let overallFound: IdentifierMatch[] = $state([]); // what looks like an identifier in what would be sent (shown on this screen only)
  const usd = (n: number) => `$${n.toFixed(4)}`;
  let busy = $state(false);
  let problems: string[] = $state([]);
  let message: Message | null = $state(null); // declining the re-identified copy, or nothing being ready, is neutral (info)

  async function refresh() {
    view = await loadExportState(workspace);
  }

  // What the rules now redact in the texts that keep the record from being approved, by whose they are.
  const redactions = $derived.by(() => {
    const by = new Map<string, RedactionMatch[]>();
    for (const r of view?.reasons ?? []) if (r.matches?.length) by.set(r.subject ?? "The moderation", [...(by.get(r.subject ?? "The moderation") ?? []), ...r.matches]);
    return [...by];
  });

  $effect(() => {
    typed = false;
    refresh().then(
      () => {
        comment = loadedText(view?.approved?.overall_comment, comment, typed);
        if (!typed) commentFromAi = view?.approved?.overall_comment_derived_from_ai ?? false;
      },
      (err) => (problems = problemsOf(err)),
    );
  });

  const when = (iso: string) => new Date(iso).toLocaleString();

  /**
   * Run an action; buttons stay focusable while busy (they ignore presses), and the result is announced once the screen is updated.
   * A moderation that isn't ready (or has changed since it was approved) isn't a failure: the screen shows why, and `notDone` says what didn't happen.
   */
  /** Where an action's outcome is shown: the export and the re-identified copy say what they wrote beside their own button. */
  let place = $state<"top" | "export" | "reidentify">("top");

  async function run(what: () => Promise<string>, notDone: string, at: "top" | "export" | "reidentify" = "top") {
    if (busy) return;
    busy = true;
    problems = [];
    message = null;
    place = at;
    try {
      const done = await what();
      await onChanged(); // the status is read again, so it changes with what is recorded
      await refresh();
      message = succeeded(done);
    } catch (err) {
      if (err instanceof RecordNotReady) {
        await refresh().catch(() => {});
        message = info(notDone);
      } else problems = problemsOf(err);
    } finally {
      busy = false;
    }
  }

  const approve = () =>
    run(async () => {
      const record = await approveRecord(workspace, { overallComment: comment, overallCommentFromAi: commentFromAi && comment.trim() !== "" });
      comment = record.overall_comment ?? "";
      commentFromAi = record.overall_comment_derived_from_ai;
      return `Approved the moderation record on ${when(record.approved_at!)}. You can now export it.`;
    }, 'Nothing was approved: the moderation isn\'t ready yet. What is left to do is listed above.');

  /** Show exactly what would be sent to suggest an overall comment, with a worst-case cost; sends nothing. */
  async function askOverall() {
    if (busy) return;
    busy = true;
    overallProblems = [];
    overallFound = [];
    overallNote = null;
    try {
      overallPlan = await planOverallSuggestion(workspace, proxy);
      await tick();
      overallHeading?.focus();
    } catch (err) {
      overallPlan = null;
      overallProblems = problemsOf(err);
      overallFound = err instanceof IdentifiersFound ? err.matches : [];
    } finally {
      busy = false;
    }
  }

  /** Send what was confirmed, and show what comes back: not the comment, until the moderator uses it. */
  async function sendOverall() {
    if (!overallPlan || busy) return;
    busy = true;
    waiting = true;
    overallProblems = [];
    try {
      const got = await runOverallSuggestion(workspace, overallPlan, { proxy });
      overallPlan = null;
      if (!got) overallProblems = ["No suggestion came back (the AI's answer wasn't a comment). Ask again."];
      else {
        overallSuggestion = got;
        overallNote = `Got a suggestion (${usd(got.spentUsd)}). It is not recorded: use it, or not.`;
      }
    } catch (err) {
      overallProblems = problemsOf(err);
    } finally {
      waiting = false;
      busy = false;
    }
  }

  const useOverall = () => {
    if (!overallSuggestion) return;
    comment = overallSuggestion.comment;
    typed = true;
    commentFromAi = true;
  };
  const clearOverall = () => {
    comment = "";
    typed = true;
    commentFromAi = false;
  };

  const exportIt = () =>
    run(async () => `Wrote ${(await exportAll(workspace)).join(", ")}, pseudonymous.`, 'Nothing was exported: the record needs approving first (see "Approve").', "export");

  /** Ask before making the copy: what it will contain, and why that is personal data. Asked each time. */
  async function askToReidentify() {
    if (busy) return;
    confirming = true;
    message = null;
    problems = [];
    place = "reidentify";
    await tick();
    confirmHeading?.focus();
  }
  async function dontReidentify() {
    if (busy) return;
    confirming = false;
    place = "reidentify";
    message = info("No re-identified copy was made.");
    await tick();
    reidentifyButton?.focus(); // the confirmation, where focus was, has gone
  }
  const reidentify = () =>
    run(async () => {
      const { paths } = await exportReidentifiedSummary(workspace, { confirmed: true });
      confirming = false;
      await tick();
      reidentifyButton?.focus();
      return `Wrote the re-identified copy: ${paths.join(", ")}. It contains personal data: each student's Turnitin ID, which identifies them. It is kept only in this workspace and deleted with it; share it only as the moderation requires.`;
    }, 'Nothing was written: the record needs approving first (see "Approve").', "reidentify");
</script>

{#snippet besides(at: "export" | "reidentify")}
  {#if place === at}
    <Status {message} />
    <Problems {problems} />
  {/if}
{/snippet}

<StepScreen title="Export" {step} recorded={view !== null && view.approved !== null && view.current} complete={false}>
  {#snippet how()}
    <p>
      Approve the moderation record, then export it: the structured record (JSON) with its full provenance, and a readable summary (Markdown and Word).
      Everything is written into the workspace's <code>exports</code> folder, and is pseudonymous. A re-identified copy of the summary is a separate step.
      Export opens once every sampled submission is approved, reviewed, judged, confirmed and given a current verdict.
    </p>
  {/snippet}
  {#snippet messages()}
    {#if place === "top"}
      <Status {message} />
      <Problems {problems} />
    {/if}
    {#if view?.problems.length}<Problems problems={view.problems} title="Not ready to approve yet:" kind="note" />{/if}
    {#if redactions.length}<RedactionMatches id="export-redactions" level={2} sending={false} {workspace} groups={redactions} onChanged={async () => { await onChanged(); await refresh(); }} said={(text) => (message = succeeded(text))} />{/if}
    {#if view?.approvalProblem}<Problems problems={[view.approvalProblem]} title="The approved record can't be read:" />{/if}
    {#if !view && !problems.length}<p>Reading the workspace…</p>{/if}
  {/snippet}
  {#snippet record()}
    {@const v = view!}
    <p class="done">Approved on {when(v.approved!.approved_at!)}, and nothing has changed since.</p>
    {#if v.preview}
      <!-- Folded away, as the rubric's levels are, so the actions stay in reach once it is approved. -->
      <details class="levels">
        <summary>The approved summary</summary>
        <SummaryPreview blocks={v.preview} />
      </details>
    {/if}
  {/snippet}
  {#snippet outcome()}
    {#if view && !view.current}
      {#if view.approved}
        <p class="attention">Approved on {when(view.approved.approved_at!)}, but the moderation has changed since: approve it again before exporting.</p>
      {:else}
        <p class="missing">Not yet approved.</p>
      {/if}
      {#if view.preview}
        <section aria-labelledby="preview-heading">
          <h2 id="preview-heading">The summary, as it would be approved</h2>
          <SummaryPreview blocks={view.preview} />
        </section>
      {/if}
    {/if}
  {/snippet}
  {#snippet actions()}
    {#if view}
      <section aria-labelledby="approve-heading">
        <h2 id="approve-heading">Approve</h2>
        <form
          onsubmit={(e) => {
            e.preventDefault();
            approve();
          }}
        >
          <label for="overall-comment">Your overall moderator's comment (optional; it is anonymised)</label>
          <p class="hint" id="overall-hint">This goes into the summary, and into the section for the moderation form.</p>
          <textarea id="overall-comment" rows="4" bind:value={comment} oninput={() => (typed = true)} aria-describedby="overall-hint"></textarea>
          {#if commentFromAi}
            <p class="hint">This comment began as the AI's suggestion, and is recorded as derived from it however much you change it. <button type="button" onclick={clearOverall}>Clear and write my own</button></p>
          {/if}
          <p>
            <button type="button" aria-disabled={busy} onclick={askOverall}>Suggest an overall comment</button>
            <span class="hint">The AI suggests one from the verdicts and comments you recorded on the sample; you choose.</span>
          </p>
          <Waiting active={waiting} text="Asking the AI for an overall comment… this can take a few seconds." />
          {#if overallPlan}
            {@const op = overallPlan}
            <div class="confirm" role="group" aria-labelledby="overall-plan">
              <h3 id="overall-plan" tabindex="-1" bind:this={overallHeading}>Check what will be sent to suggest an overall comment</h3>
              <p>
                How the sample was chosen and, for each sampled submission, the original marker's overall mark and your verdict, marks and comment, exactly as below. Nothing else: not the rubric, the
                submissions, the brief, the AI reading or the original marker's comments.
              </p>
              <pre class="text" aria-label="The moderation of the sample, as it will be sent">{op.sample}</pre>
              <p>With {op.model}. At most {usd(op.cost)} (a worst case; a real call costs much less). Spend limit: ${op.capUsd}.</p>
              <div class="actions">
                <button type="button" aria-disabled={busy} onclick={sendOverall}>Confirm and send<span class="visually-hidden">: suggest an overall comment</span></button>
                <button type="button" aria-disabled={busy} onclick={() => {
                    if (busy) return; // a request already sent can't be declined
                    overallPlan = null;
                    overallNote = "Nothing was sent.";
                  }}>Don't send</button>
              </div>
            </div>
          {/if}
          {#if overallSuggestion}
            {@const og = overallSuggestion}
            <div class="suggestion" role="group" aria-labelledby="overall-suggestion">
              <h3 id="overall-suggestion">The AI's suggested overall comment</h3>
              <p class="hint">Not recorded and not in the box: use it, or not. If you use it, it is recorded as derived from the AI however much you change it.</p>
              <p class="feedback-text">{og.comment}</p>
              {#each og.warnings as w (w)}<p class="attention">{w}</p>{/each}
              <div class="actions">
                <button type="button" onclick={useOverall}>Use the AI's comment</button>
                <button type="button" onclick={() => (overallSuggestion = null)}>Dismiss</button>
              </div>
            </div>
          {/if}
          <Status message={asDone(overallNote)} />
          <Problems problems={overallProblems} />
          {#if overallFound.length}<FoundIdentifiers id="overall-identifiers" {workspace} groups={[["The moderation of the sample", overallFound]]} what="Text" />{/if}
          <button type="submit" aria-disabled={busy}>Approve the moderation record</button>
        </form>
      </section>

      <section aria-labelledby="export-heading">
        <h2 id="export-heading">Export</h2>
        <p>The approved record and its summary, into <code>exports</code>. They are written only while the workspace still matches your approval.</p>
        <button type="button" onclick={exportIt} aria-disabled={busy}>Export the record and summary</button>
        {@render besides("export")}
      </section>

      <section aria-labelledby="reidentify-heading">
        <h2 id="reidentify-heading">Re-identified copy</h2>
        <p>
          For a moderation form that needs to know which submission is which: a copy of the summary (Markdown and Word) with each student's pseudonym replaced
          by their Turnitin ID. Nothing else is restored: no names, and other redacted details stay redacted.
        </p>
        <div><button type="button" bind:this={reidentifyButton} onclick={askToReidentify} aria-disabled={busy} aria-expanded={confirming}>Make a re-identified copy</button></div>
        {#if confirming}
          <div class="confirm" role="group" aria-labelledby="confirm-reidentify-heading">
            <h3 id="confirm-reidentify-heading" tabindex="-1" bind:this={confirmHeading}>Make a re-identified copy?</h3>
            <p>
              It writes new files, beside the pseudonymous ones, with "-reidentified" in their names: the summary (Markdown and Word) with each student's
              Turnitin ID in place of their pseudonym. They contain personal data, which identifies each student; they are kept only in this workspace and
              deleted with it, so share them only as the moderation requires. The standard export is unchanged.
            </p>
            <div class="actions">
              <button type="button" onclick={reidentify} aria-disabled={busy}>Make the copy</button>
              <button type="button" onclick={dontReidentify} aria-disabled={busy}>Don't make it</button>
            </div>
          </div>
        {/if}
        {@render besides("reidentify")}
      </section>
    {/if}
  {/snippet}
</StepScreen>
