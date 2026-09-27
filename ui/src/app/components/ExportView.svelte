<script lang="ts">
  import { approveRecord, exportReidentifiedSummary, RecordNotReady, type Workspace } from "../../core/index.ts";
  import { exportAll, loadExportState, type ExportState } from "../exportStep.ts";
  import { problemsOf } from "../forms.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";
  import SummaryPreview from "./SummaryPreview.svelte";

  let { workspace, onChanged }: { workspace: Workspace; onChanged: () => void } = $props();

  let view: ExportState | null = $state(null);
  let comment = $state("");
  let understood = $state(false);
  let busy = $state(false);
  let problems: string[] = $state([]);
  let message: string | null = $state(null);
  let heading: HTMLHeadingElement;

  async function refresh() {
    view = await loadExportState(workspace);
  }

  $effect(() => {
    heading?.focus();
    refresh().then(
      () => (comment = view?.approved?.overall_comment ?? ""),
      (err) => (problems = problemsOf(err)),
    );
  });

  const when = (iso: string) => new Date(iso).toLocaleString();

  /**
   * Run an action; buttons stay focusable while busy (they ignore presses), and the result is announced once the screen is updated.
   * A moderation that isn't ready (or has changed since it was approved) isn't a failure: the screen shows why, and `notDone` says what didn't happen.
   */
  async function run(what: () => Promise<string>, notDone: string) {
    if (busy) return;
    busy = true;
    problems = [];
    message = null;
    try {
      const done = await what();
      await refresh();
      onChanged();
      message = done;
    } catch (err) {
      if (err instanceof RecordNotReady) {
        await refresh().catch(() => {});
        message = notDone;
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
    }, 'Nothing was approved: the moderation isn\'t ready yet. "Ready to approve?" lists what is left to do.');

  const exportIt = () =>
    run(async () => `Wrote ${(await exportAll(workspace)).join(", ")}.`, 'Nothing was exported: the record needs approving first (see "Approve").');

  const reidentify = () =>
    run(async () => {
      if (!understood) throw new Error('tick "I understand this copy contains personal data" to make a re-identified copy');
      const { paths } = await exportReidentifiedSummary(workspace, { confirmed: true });
      understood = false; // asked again each time
      return `Wrote the re-identified copy: ${paths.join(", ")}. It contains personal data; share it only as the moderation requires.`;
    }, 'Nothing was written: the record needs approving first (see "Approve").');
</script>

<h1 tabindex="-1" bind:this={heading}>Export</h1>
<p>
  Approve the moderation record, then export it: the structured record (JSON) with its full provenance, and a readable summary (Markdown and Word). Everything is
  written into the workspace's <code>exports</code> folder, and is pseudonymous. A re-identified copy of the summary is a separate step.
</p>

<Status {message} />
<Problems {problems} />

{#if view}
  <section aria-labelledby="ready-heading">
    <h2 id="ready-heading">Ready to approve?</h2>
    {#if view.problems.length}
      <Problems problems={view.problems} title="Not ready to approve yet:" kind="note" />
    {:else}
      <p class="done">Yes: every sampled submission is approved, reviewed, judged, confirmed and given a current verdict.</p>
    {/if}
  </section>

  <section aria-labelledby="approve-heading">
    <h2 id="approve-heading">Approve</h2>
    {#if view.approvalProblem}
      <Problems problems={[view.approvalProblem]} title="The approved record can't be read:" />
    {:else if view.approved && view.current}
      <p class="done">Approved on {when(view.approved.approved_at!)}, and nothing has changed since.</p>
    {:else if view.approved}
      <p class="attention">Approved on {when(view.approved.approved_at!)}, but the moderation has changed since: approve it again before exporting.</p>
    {:else}
      <p class="missing">Not yet approved.</p>
    {/if}
    <form
      onsubmit={(e) => {
        e.preventDefault();
        approve();
      }}
    >
      <label for="overall-comment">Your overall moderator's comment (optional; it is anonymised)</label>
      <p class="hint" id="overall-hint">This goes into the summary, and into the section for the moderation form.</p>
      <textarea id="overall-comment" rows="4" bind:value={comment} aria-describedby="overall-hint"></textarea>
      <button type="submit" aria-disabled={busy}>Approve the moderation record</button>
    </form>
  </section>

  <section aria-labelledby="export-heading">
    <h2 id="export-heading">Export</h2>
    <p>The approved record and its summary, into <code>exports</code>. They are written only while the workspace still matches your approval.</p>
    <button type="button" onclick={exportIt} aria-disabled={busy}>Export the record and summary</button>
  </section>

  <section aria-labelledby="reidentify-heading">
    <h2 id="reidentify-heading">Re-identified copy</h2>
    <p>
      For a moderation form that needs to know which submission is which: a copy of the summary (Markdown and Word) with each student's pseudonym replaced by
      their Turnitin ID. Nothing else is restored: no names, and other redacted details stay redacted.
    </p>
    <p class="warning">This copy contains personal data. It is kept only in this workspace and deleted with it; share it only as the moderation requires.</p>
    <label class="check"><input type="checkbox" bind:checked={understood} /> I understand this copy contains personal data</label>
    <div><button type="button" onclick={reidentify} aria-disabled={busy}>Make a re-identified copy</button></div>
  </section>

  {#if view.preview}
    <section aria-labelledby="preview-heading">
      <h2 id="preview-heading">{view.current ? "The approved summary" : "The summary, as it would be approved"}</h2>
      <SummaryPreview blocks={view.preview} />
    </section>
  {/if}
{:else if !problems.length}
  <p>Reading the workspace…</p>
{/if}
