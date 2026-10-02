<script lang="ts">
  import { importOriginals, type Workspace } from "../../core/index.ts";
  import { fileSource } from "../../platform/fileSource.ts";
  import { problemsOf } from "../forms.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";
  import { asDone } from "../messages.ts";
  import { originalsRecorded, type OriginalRow } from "../recorded.ts";
  import type { StepState } from "../steps.ts";
  import StepScreen from "./StepScreen.svelte";
  import TableRegion from "./TableRegion.svelte";

  let { workspace, step, onChanged }: { workspace: Workspace; step: StepState | undefined; onChanged: () => void | Promise<void> } = $props();

  let files: FileList | null = $state(null);
  let replace = $state(false);
  let busy = $state(false);
  let problems: string[] = $state([]);
  let failed: [string, string][] = $state([]);
  let message: string | null = $state(null);
  let rows: OriginalRow[] = $state([]);
  let readProblem: string | null = $state(null);
  let screen: StepScreen;

  $effect(() => {
    read();
  });

  async function read() {
    try {
      rows = await originalsRecorded(workspace);
      readProblem = null;
    } catch (err) {
      rows = [];
      readProblem = err instanceof Error ? err.message : String(err);
    }
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!files?.length) return;
    if (busy) return; // the button stays enabled while busy, so focus isn't lost from it
    busy = true;
    problems = [];
    failed = [];
    message = null;
    try {
      const result = await importOriginals(workspace, [...files].map(fileSource), { replace });
      replace = false;
      await onChanged(); // the status is read again, so it changes with what is recorded
      await read();
      // Everything changes together: the message and what is recorded appear, and focus moves to it.
      failed = [...result.failed];
      message =
        `Imported ${result.imported.length} of the sampled originals` +
        (result.imported.length ? ` (${result.imported.map((s) => `${s.id} ${s.source_format}`).join(", ")})` : "") +
        `; ${result.ignoredCount} other file(s) in the download were not opened.`;
      if (result.imported.length) await screen.shown();
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      busy = false;
    }
  }
</script>

<StepScreen bind:this={screen} title="Original submissions" {step} recorded={rows.some((r) => r.imported)} change="Import the originals again">
  {#snippet how()}
    <p>
      Choose the bulk download of the students' own files (a zip) and any single files, docx or pdf. Only the sampled students' files are opened; the others
      are never read. Each file's text is extracted on this computer, and its name, which may identify the student, isn't kept.
    </p>
  {/snippet}
  {#snippet messages()}
    <Status message={asDone(message)} />
    <Problems {problems} />
    {#if failed.length}
      <Problems problems={failed.map(([id, why]) => `${id}: ${why}`)} title="These couldn't be imported (the others were):" />
    {/if}
    {#if readProblem}<Problems problems={[readProblem]} title="The originals can't be read:" />{/if}
  {/snippet}
  {#snippet record()}
    <TableRegion label="The sampled originals">
      <table>
        <caption>Each sampled submission's original file, and what extracting its text found</caption>
        <thead>
          <tr><th scope="col">Submission</th><th scope="col">Original</th><th scope="col">Format</th><th scope="col">Warnings</th></tr>
        </thead>
        <tbody>
          {#each rows as row (row.id)}
            <tr>
              <th scope="row">{row.id} {row.pseudonym}</th>
              <td class={row.problem ? "attention" : row.imported ? "done" : "missing"}>{row.problem ? `Can't be read: ${row.problem}` : row.imported ? "Imported" : "Not yet"}</td>
              <td>{row.format ?? "—"}</td>
              <td class={row.warnings.length ? "attention" : ""}>{row.warnings.length ? row.warnings.join("; ") : "None"}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </TableRegion>
  {/snippet}
  {#snippet actions()}
    <form onsubmit={submit}>
      <label for="originals">Downloads and files</label>
      <input id="originals" type="file" multiple accept=".zip,.docx,.pdf" onchange={(e) => (files = (e.currentTarget as HTMLInputElement).files)} required />
      <label class="check"><input type="checkbox" bind:checked={replace} /> Replace originals already imported</label>
      <button type="submit" aria-disabled={busy}>Import the originals</button>
    </form>
  {/snippet}
</StepScreen>
