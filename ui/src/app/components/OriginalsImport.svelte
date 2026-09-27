<script lang="ts">
  import { importOriginals, type Workspace } from "../../core/index.ts";
  import { fileSource } from "../../platform/fileSource.ts";
  import { problemsOf } from "../forms.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";

  let { workspace, onChanged }: { workspace: Workspace; onChanged: () => void } = $props();

  let files: FileList | null = $state(null);
  let replace = $state(false);
  let busy = $state(false);
  let problems: string[] = $state([]);
  let failed: [string, string][] = $state([]);
  let message: string | null = $state(null);
  let heading: HTMLHeadingElement;

  $effect(() => heading?.focus());

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!files?.length) return;
    busy = true;
    problems = [];
    failed = [];
    message = null;
    try {
      const result = await importOriginals(workspace, [...files].map(fileSource), { replace });
      failed = [...result.failed];
      message =
        `Imported ${result.imported.length} of the sampled originals` +
        (result.imported.length ? ` (${result.imported.map((s) => `${s.id} ${s.source_format}`).join(", ")})` : "") +
        `; ${result.ignoredCount} other file(s) in the download were not opened.`;
      replace = false;
      onChanged();
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      busy = false;
    }
  }
</script>

<h1 tabindex="-1" bind:this={heading}>Original submissions</h1>
<p>Choose the bulk download (zip) and any single files. Only the sampled students' files are opened; the others are never read.</p>

<Status {message} />
<Problems {problems} />
{#if failed.length}
  <Problems problems={failed.map(([id, why]) => `${id}: ${why}`)} title="These couldn't be imported (the others were):" />
{/if}

<form onsubmit={submit}>
  <label for="originals">Downloads and files</label>
  <input id="originals" type="file" multiple accept=".zip,.docx,.pdf" onchange={(e) => (files = (e.currentTarget as HTMLInputElement).files)} required />
  <label class="check"><input type="checkbox" bind:checked={replace} /> Replace originals already imported</label>
  <button type="submit" disabled={busy}>Import the originals</button>
</form>
