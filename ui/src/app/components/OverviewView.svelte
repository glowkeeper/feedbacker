<script lang="ts">
  import type { Workspace } from "../../core/index.ts";
  import { loadOverview, type Overview, type Step } from "../overview.ts";
  import Status from "./Status.svelte";

  let { workspace }: { workspace: Workspace } = $props();

  let overview: Overview | null = $state(null);
  let problem: string | null = $state(null);
  let heading: HTMLHeadingElement;

  $effect(() => {
    heading?.focus();
    loadOverview(workspace).then(
      (o) => (overview = o),
      (err: Error) => (problem = err.message),
    );
  });

  const label: Record<Step, string> = { done: "Done", missing: "Not yet", attention: "Needs attention" };
</script>

<h1 tabindex="-1" bind:this={heading}>Moderation overview</h1>
<Status message={problem ?? overview?.problem ?? null} kind="error" />

{#if overview}
  {#if overview.request}
    <p>
      {overview.request.module ?? "Module not recorded"}{overview.request.programme ? `, ${overview.request.programme}` : ""}{overview.request.cohortSize
        ? `; cohort of ${overview.request.cohortSize}`
        : ""}.
    </p>
  {:else}
    <p>No moderation request has been recorded yet.</p>
  {/if}

  <h2>Workspace</h2>
  <dl class="steps">
    <dt>Rubric</dt>
    <dd class={overview.rubric}>{label[overview.rubric]}</dd>
    <dt>Brief imported</dt>
    <dd class={overview.brief.imported}>{label[overview.brief.imported]}</dd>
    <dt>Brief approved</dt>
    <dd class={overview.brief.approved}>{label[overview.brief.approved]}</dd>
  </dl>
  {#if overview.rubricProblem}<p class="error">Rubric: {overview.rubricProblem}</p>{/if}
  {#if overview.brief.problem}<p class="error">Brief: {overview.brief.problem}</p>{/if}

  {#if overview.submissions.length}
    <h2>Sample</h2>
    <table>
      <caption>Each sampled submission, by pseudonym, and how far it has got</caption>
      <thead>
        <tr>
          <th scope="col">Submission</th>
          <th scope="col">Band</th>
          <th scope="col">Original</th>
          <th scope="col">Anonymised</th>
          <th scope="col">Approved</th>
          <th scope="col">Original marking</th>
          <th scope="col">AI reading</th>
          <th scope="col">Judged</th>
        </tr>
      </thead>
      <tbody>
        {#each overview.submissions as row (row.id)}
          <tr>
            <th scope="row">{row.id} {row.pseudonym}</th>
            <td>{row.band ?? "—"}</td>
            <td class={row.original}>{label[row.original]}</td>
            <td class={row.anonymised}>{label[row.anonymised]}</td>
            <td class={row.approved}>{label[row.approved]}</td>
            <td class={row.marking}>{row.marking === "attention" ? "Not confirmed" : label[row.marking]}</td>
            <td class={row.reading}>{label[row.reading]}</td>
            <td class={row.judgedStep}>{row.judged || row.judgedStep !== "missing" ? `${row.judged} of ${overview.criteria || "?"} criteria` : label.missing}{row.review ? ` (${row.review})` : ""}</td>
          </tr>
          {#if row.problem}
            <tr><td colspan="8" class="error">{row.id}: {row.problem}</td></tr>
          {/if}
        {/each}
      </tbody>
    </table>
  {/if}
{:else if !problem}
  <p>Reading the workspace…</p>
{/if}
