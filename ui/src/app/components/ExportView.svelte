<script lang="ts">
  import { tick } from "svelte";
  import { approveRecord, exportReidentifiedSummary, RecordNotReady, type Workspace } from "../../core/index.ts";
  import { exportAll, loadExportState, type ExportState } from "../exportStep.ts";
  import { loadedText, problemsOf } from "../forms.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";
  import { done as succeeded, info, type Message } from "../messages.ts";
  import SummaryPreview from "./SummaryPreview.svelte";
  import type { StepState } from "../steps.ts";
  import StepScreen from "./StepScreen.svelte";

  let { workspace, step, onChanged }: { workspace: Workspace; step: StepState | undefined; onChanged: () => void | Promise<void> } = $props();

  let view: ExportState | null = $state(null);
  let comment = $state("");
  let typed = false; // in the overall comment, since the record began loading
  let confirming = $state(false); // the re-identified copy asked for, and awaiting confirmation
  let confirmHeading: HTMLHeadingElement | undefined = $state();
  let reidentifyButton: HTMLButtonElement | undefined = $state();
  let busy = $state(false);
  let problems: string[] = $state([]);
  let message: Message | null = $state(null); // declining the re-identified copy, or nothing being ready, is neutral (info)

  async function refresh() {
    view = await loadExportState(workspace);
  }

  $effect(() => {
    typed = false;
    refresh().then(
      () => (comment = loadedText(view?.approved?.overall_comment, comment, typed)),
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
      const record = await approveRecord(workspace, { overallComment: comment });
      comment = record.overall_comment ?? "";
      return `Approved the moderation record on ${when(record.approved_at!)}. You can now export it.`;
    }, 'Nothing was approved: the moderation isn\'t ready yet. What is left to do is listed above.');

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
