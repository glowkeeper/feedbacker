<script lang="ts">
  import { tick } from "svelte";
  import TableRegion from "./TableRegion.svelte";
  import { importRubric, type Rubric, type Workspace } from "../../core/index.ts";
  import { fileSource } from "../../platform/fileSource.ts";
  import { pyFormatG } from "../../core/pytext.ts";
  import { problemsOf, totalWeight, weightsFrom } from "../forms.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";

  let { workspace, onChanged }: { workspace: Workspace; onChanged: () => void } = $props();

  let file: File | null = $state(null);
  let title = $state("");
  let version = $state("1");
  let sheet = $state("");
  let weights: Record<string, string> = $state({}); // a box per criterion in the preview, starting from the file's weights
  let replace = $state(false);
  let busy = $state(false);
  let problems: string[] = $state([]);
  let saveProblems: string[] = $state([]); // why saving failed, shown beside the Save button, with the preview (and what was entered in it) kept
  let warnings: string[] = $state([]);
  let preview: Rubric | null = $state(null);
  let message: string | null = $state(null);
  let messageKind: "done" | "info" = $state("done"); // not saving is neutral
  let heading: HTMLHeadingElement;
  let previewHeading: HTMLHeadingElement | undefined = $state();

  $effect(() => heading?.focus());
  $effect(() => previewHeading?.focus());

  /** Close the preview; focus was in it, so it moves to the screen's heading rather than being lost. */
  async function closePreview() {
    const open = preview !== null;
    preview = null;
    await tick();
    if (open) heading.focus();
  }

  async function run(confirm: boolean) {
    if (!file || busy) return; // buttons stay enabled while busy, so focus isn't lost from them
    busy = true;
    problems = [];
    saveProblems = [];
    warnings = []; // the previous file's warnings belong to it
    message = null;
    try {
      const result = await importRubric(workspace, fileSource(file), {
        title: title.trim() || null,
        version: version.trim() || "1",
        sheet: sheet.trim() || null,
        weights: confirm && preview ? weightsFrom(weights, new Map(preview.criteria.map((c) => [c.id, c.title]))) : new Map(),
        confirm,
        replace,
      });
      warnings = result.warnings;
      if (result.written) {
        await closePreview();
        messageKind = "done";
        message = `Saved the rubric "${result.rubric.title}" (version ${result.rubric.version}): ${result.rubric.criteria.length} criteria.`;
        replace = false;
        onChanged();
      } else {
        preview = result.rubric;
        weights = Object.fromEntries(result.rubric.criteria.map((c) => [c.id, c.weight === null ? "" : pyFormatG(c.weight)]));
      }
    } catch (err) {
      if (confirm && preview) saveProblems = problemsOf(err); // keep the preview, so the named box can be corrected in place
      else {
        problems = problemsOf(err);
        await closePreview();
      }
    } finally {
      busy = false;
    }
  }

  const weightTotal = $derived(totalWeight(weights));

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    return run(false);
  };
</script>

<h1 tabindex="-1" bind:this={heading}>Source rubric</h1>
<p>
  Import the rubric the marking should follow: CSV or JSON, or a grid in a spreadsheet (xlsx) or Word table (docx), with criteria down the first column
  and levels such as <code>Excellent (85)</code> across the first row. A grid is shown for you to check before it is saved.
</p>

<Status {message} kind={messageKind} />
<Problems {problems} />
{#if warnings.length}<Problems problems={warnings} title="Warnings (the rubric was still read):" kind="note" />{/if}

<form onsubmit={submit}>
  <label for="rubric-file">Rubric file</label>
  <input id="rubric-file" type="file" accept=".csv,.json,.xlsx,.docx" onchange={(e) => (file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)} required />
  <label for="rubric-title">Title (optional; otherwise from the file)</label>
  <input id="rubric-title" type="text" bind:value={title} />
  <label for="rubric-version">Version</label>
  <input id="rubric-version" type="text" bind:value={version} />
  <label for="rubric-sheet">Spreadsheet sheet (optional; otherwise the first)</label>
  <input id="rubric-sheet" type="text" bind:value={sheet} />
  <label class="check"><input type="checkbox" bind:checked={replace} /> Replace the rubric already imported</label>
  <button type="submit" aria-disabled={busy}>Read the rubric</button>
</form>

{#if preview}
  <section aria-labelledby="preview-heading">
    <h2 id="preview-heading" tabindex="-1" bind:this={previewHeading}>Check the rubric before saving it</h2>
    <p>"{preview.title}" (version {preview.version}): {preview.criteria.length} criteria. Labels are kept exactly as written.</p>
    <fieldset>
      <legend>Criterion weights</legend>
      <p class="hint">
        Each criterion's share of the overall mark, as a percentage. They start from the file; enter any it doesn't give. They are needed to work out an
        overall mark from levels.
      </p>
      <div class="per-criterion">
        {#each preview.criteria as c, i (c.id)}
          <label for={`weight-${i}`}>{c.title}</label>
          <input id={`weight-${i}`} type="text" inputmode="decimal" bind:value={weights[c.id]} />
        {/each}
      </div>
      <p aria-live="polite">
        {#if weightTotal === null}
          Total: a weight isn't a number yet.
        {:else if weightTotal === 0}
          No weights entered.
        {:else}
          Total: {pyFormatG(weightTotal)}%{Math.abs(weightTotal - 100) > 1e-9 ? " (they usually add up to 100%)" : ""}
        {/if}
      </p>
    </fieldset>
    {#each preview.criteria as criterion (criterion.id)}
      <TableRegion label={`Levels of ${criterion.title}`}>
        <table>
          <caption>{criterion.title}</caption>
          <thead><tr><th scope="col">Level</th><th scope="col">Points</th><th scope="col">Descriptor</th></tr></thead>
          <tbody>
            {#each criterion.levels as level (level.id)}
              <tr><th scope="row">{level.label}</th><td>{level.points ?? "—"}</td><td>{level.descriptor}</td></tr>
            {/each}
          </tbody>
        </table>
      </TableRegion>
    {/each}
    <Problems problems={saveProblems} title="The rubric wasn't saved:" />
    <div class="actions">
      <button type="button" onclick={() => run(true)} aria-disabled={busy}>Save this rubric</button>
      <button type="button" onclick={() => busy || closePreview().then(() => ((messageKind = "info"), (message = "The rubric wasn't saved.")))} aria-disabled={busy}>Don't save it</button>
    </div>
  </section>
{/if}
