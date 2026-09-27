<script lang="ts">
  import { importBrief, type Workspace } from "../../core/index.ts";
  import { fileSource } from "../../platform/fileSource.ts";
  import { problemsOf } from "../forms.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";

  let { workspace, onChanged }: { workspace: Workspace; onChanged: () => void } = $props();

  let file: File | null = $state(null);
  let replace = $state(false);
  let busy = $state(false);
  let problems: string[] = $state([]);
  let warnings: string[] = $state([]);
  let message: string | null = $state(null);
  let heading: HTMLHeadingElement;

  $effect(() => heading?.focus());

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!file) return;
    if (busy) return; // the button stays enabled while busy, so focus isn\'t lost from it
    busy = true;
    problems = [];
    warnings = []; // the previous file's warnings belong to it
    message = null;
    try {
      const brief = await importBrief(workspace, fileSource(file), { replace });
      warnings = brief.extract.warnings;
      message = `Imported the brief (${brief.source_format}, ${brief.extract.blocks.length} blocks of text). Anonymise and approve it before the AI reading uses it.`;
      replace = false;
      onChanged();
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      busy = false;
    }
  }
</script>

<h1 tabindex="-1" bind:this={heading}>Assessment brief</h1>
<p>Import the brief the students worked to (docx or pdf). Its text is read on this computer; the document's metadata never is.</p>

<Status {message} />
<Problems {problems} />
{#if warnings.length}<Problems problems={warnings} title="Warnings (the brief was still imported):" />{/if}

<form onsubmit={submit}>
  <label for="brief-file">Brief</label>
  <input id="brief-file" type="file" accept=".docx,.pdf" onchange={(e) => (file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)} required />
  <label class="check"><input type="checkbox" bind:checked={replace} /> Replace the brief already imported</label>
  <button type="submit" aria-disabled={busy}>Import the brief</button>
</form>
