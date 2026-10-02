<script lang="ts">
  import { BRIEF, importBrief, loadBrief, type Brief, type Workspace } from "../../core/index.ts";
  import { fileSource } from "../../platform/fileSource.ts";
  import { problemsOf } from "../forms.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";
  import { asDone } from "../messages.ts";
  import type { StepId, StepState } from "../steps.ts";
  import StepScreen from "./StepScreen.svelte";

  let {
    workspace,
    step,
    onChanged,
    onGo,
  }: { workspace: Workspace; step: StepState | undefined; onChanged: () => void | Promise<void>; onGo: (step: StepId) => void } = $props();

  let file: File | null = $state(null);
  let replace = $state(false);
  let busy = $state(false);
  let problems: string[] = $state([]);
  let warnings: string[] = $state([]);
  let message: string | null = $state(null);
  let brief = $state<Brief | null>(null);
  let readProblem: string | null = $state(null);
  let screen: StepScreen;

  $effect(() => {
    read();
  });

  async function read() {
    try {
      brief = (await workspace.exists(BRIEF)) ? await loadBrief(workspace) : null;
      readProblem = null;
    } catch (err) {
      brief = null;
      readProblem = err instanceof Error ? err.message : String(err);
    }
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!file) return;
    if (busy) return; // the button stays enabled while busy, so focus isn't lost from it
    busy = true;
    problems = [];
    warnings = []; // the previous file's warnings belong to it
    message = null;
    try {
      const imported = await importBrief(workspace, fileSource(file), { replace });
      replace = false;
      await onChanged(); // the status is read again, so it changes with what is recorded
      await read();
      // Everything changes together: the message, the warnings and what is recorded appear, and focus moves to it.
      warnings = imported.extract.warnings;
      message = `Imported the brief (${imported.source_format}, ${imported.extract.blocks.length} blocks of text). Anonymise and approve it before the AI reading uses it.`;
      await screen.shown();
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      busy = false;
    }
  }
</script>

<StepScreen bind:this={screen} title="Assessment brief" {step} optional recorded={brief !== null} change="Import the brief again">
  {#snippet how()}
    <p>
      Import the brief the students worked to (docx or pdf). Its text is read on this computer; the document's metadata never is. It is anonymised and
      approved like a submission, on Anonymisation; the AI reading sees only the approved brief, and you see it beside each submission on Review.
    </p>
  {/snippet}
  {#snippet messages()}
    <Status message={asDone(message)} />
    <Problems {problems} />
    {#if warnings.length}<Problems problems={warnings} title="Warnings (the brief was still imported):" kind="note" />{/if}
    {#if readProblem}<Problems problems={[readProblem]} title="The brief can't be read:" />{/if}
  {/snippet}
  {#snippet record()}
    {@const b = brief!}
    <dl class="steps">
      <dt>Imported</dt><dd class="done">Yes ({b.source_format}, {b.extract.blocks.length} blocks of text)</dd>
      <dt>Warnings</dt><dd class={b.extract.warnings.length ? "attention" : ""}>{b.extract.warnings.length ? b.extract.warnings.join("; ") : "None"}</dd>
      <dt>Anonymised</dt><dd class={b.anonymised ? "done" : "missing"}>{b.anonymised ? "Yes" : "Not yet"}</dd>
      <dt>Approved</dt><dd class={b.approval ? "done" : "missing"}>{b.approval ? "Yes" : "Not yet"}</dd>
    </dl>
    {#if !b.approval}
      <p>Anonymise and approve it on Anonymisation. <button type="button" onclick={() => onGo("anonymisation")}>Go to Anonymisation</button></p>
    {/if}
  {/snippet}
  {#snippet actions()}
    <form onsubmit={submit}>
      <label for="brief-file">Brief</label>
      <input id="brief-file" type="file" accept=".docx,.pdf" onchange={(e) => (file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)} required />
      <label class="check"><input type="checkbox" bind:checked={replace} /> Replace the brief already imported</label>
      <button type="submit" aria-disabled={busy}>Import the brief</button>
    </form>
  {/snippet}
</StepScreen>
