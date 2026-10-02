<script lang="ts">
  import type { Workspace } from "../../core/index.ts";
  import type { AppProxy, Notice } from "../platform.ts";
  import { loadExportState } from "../exportStep.ts";
  import { loadOverview } from "../overview.ts";
  import { moderationStates, MODERATION_STEPS, stepList, type StepDef, type StepId, type StepState } from "../steps.ts";
  import AnonymisationView from "./AnonymisationView.svelte";
  import DeleteWorkspace from "./DeleteWorkspace.svelte";
  import MarkingView from "./MarkingView.svelte";
  import ReadingView from "./ReadingView.svelte";
  import ReviewView from "./ReviewView.svelte";
  import ExportView from "./ExportView.svelte";
  import BriefImport from "./BriefImport.svelte";
  import OriginalsImport from "./OriginalsImport.svelte";
  import OverviewView from "./OverviewView.svelte";
  import RequestForm from "./RequestForm.svelte";
  import RubricImport from "./RubricImport.svelte";

  let { workspace, proxy, onClose, onDeleted }: { workspace: Workspace; proxy: AppProxy; onClose: () => void; onDeleted: (what: Notice) => void } = $props();

  // The steps of this workspace's type; moderation is the only type so far.
  const entries = MODERATION_STEPS;
  const steps = stepList(entries);
  const byId = new Map(steps.map((s) => [s.id, s]));

  let section = $state<StepId | "delete">("overview");
  let version = $state(0); // bumped after a change, so the overview and the steps read the workspace again
  const changed = () => (version += 1);

  // Each step's status and lock, read from the workspace as it is now. A lock that can't be worked out keeps Review and Export shut, and says why.
  let states = $state<Map<StepId, StepState> | null>(null);
  let pending: Promise<Map<StepId, StepState>> = Promise.resolve(new Map()); // the latest reading, which go() waits for
  $effect(() => {
    void version;
    const reading = Promise.all([loadOverview(workspace), loadExportState(workspace)]).then(
      ([overview, readiness]) => moderationStates(overview, readiness),
      (err: Error) => {
        const locked = [{ text: `The workspace couldn't be read to check this step: ${err.message}`, goTo: null }];
        return new Map<StepId, StepState>([
          ["review", { status: null, locked }],
          ["export", { status: null, locked }],
        ]);
      },
    );
    pending = reading;
    reading.then((s) => {
      if (pending === reading) states = s; // a later reading wins
    });
  });

  let menu: HTMLDetailsElement;

  /** Open a step once its lock is known, so a step chosen straight after a change is judged on the workspace as it now is. */
  async function go(id: StepId | "delete") {
    if (id !== "delete") states = await pending;
    if (menu) menu.open = false;
    section = id;
  }

  const locked = $derived(section === "delete" ? null : (states?.get(section)?.locked ?? null));
  const STATUS = { done: "Done", attention: "Needs attention", missing: "Not started" } as const;
  function statusText(s: StepDef): string | null {
    const state = states?.get(s.id);
    if (!state) return null;
    if (state.locked) return "Locked";
    if (state.status === null) return null;
    return state.status === "missing" && s.optional ? "Optional" : STATUS[state.status];
  }

  const heading = (id: StepId | "delete") => (id === "delete" ? "Delete this workspace" : byId.get(id)!.heading);
  let lockedHeading: HTMLHeadingElement | undefined = $state();
  $effect(() => {
    document.title = `${locked ? `${byId.get(section as StepId)!.label} isn't available yet` : heading(section)} – ${workspace.manifest.name} – Feedbacker`;
  });
  $effect(() => {
    if (locked) lockedHeading?.focus();
  });
</script>

{#snippet item(s: StepDef)}
  {@const status = statusText(s)}
  <button type="button" aria-current={section === s.id ? "page" : undefined} aria-describedby={status ? `step-status-${s.id}` : undefined} onclick={() => go(s.id)}
    >{s.label}</button
  >
  {#if status}<span class="step-status {states?.get(s.id)?.locked ? 'locked' : states?.get(s.id)?.status}" id={`step-status-${s.id}`}>{status}</span>{/if}
{/snippet}

<div class="workspace-head">
  <p class="where">Workspace <strong>{workspace.manifest.name}</strong> at <code>{workspace.registration.path}</code></p>
  <details class="workspace-menu" bind:this={menu}>
    <summary>Workspace</summary>
    <ul>
      <li><button type="button" onclick={onClose}>Close this workspace</button></li>
      <li><button type="button" aria-current={section === "delete" ? "page" : undefined} onclick={() => go("delete")}>Delete this workspace…</button></li>
    </ul>
  </details>
</div>
<div class="workspace-bar">
  <nav aria-label="Moderation steps">
    <ol class="steps-nav">
      {#each entries as entry ("step" in entry ? entry.step.id : entry.group)}
        {#if "step" in entry}
          <li class="step">{@render item(entry.step)}</li>
        {:else}
          <li class="step-group">
            <span class="group-name" id={`step-group-${entry.group}`}>{entry.group}</span>
            <ol aria-labelledby={`step-group-${entry.group}`}>
              {#each entry.steps as s (s.id)}<li class="step">{@render item(s)}</li>{/each}
            </ol>
          </li>
        {/if}
      {/each}
    </ol>
  </nav>
</div>

{#if locked}
  {@const step = byId.get(section as StepId)!}
  <h1 tabindex="-1" bind:this={lockedHeading}>{step.label} isn't available yet</h1>
  <p>{step.label} opens when this is done:</p>
  <ul class="locked-reasons">
    {#each locked as reason, i (i)}
      <li>
        {reason.text}{#if reason.goTo}{" "}<button type="button" onclick={() => go(reason.goTo!)}>Go to {byId.get(reason.goTo)!.label}</button>{/if}
      </li>
    {/each}
  </ul>
{:else if section === "overview"}
  {#key version}<OverviewView {workspace} />{/key}
{:else if section === "request"}
  <RequestForm {workspace} onChanged={changed} />
{:else if section === "originals"}
  <OriginalsImport {workspace} onChanged={changed} />
{:else if section === "rubric"}
  <RubricImport {workspace} onChanged={changed} />
{:else if section === "brief"}
  <BriefImport {workspace} onChanged={changed} />
{:else if section === "anonymisation"}
  <AnonymisationView {workspace} onChanged={changed} />
{:else if section === "marking"}
  <MarkingView {workspace} onChanged={changed} />
{:else if section === "reading"}
  <ReadingView {workspace} {proxy} onChanged={changed} />
{:else if section === "review"}
  <ReviewView {workspace} onChanged={changed} />
{:else if section === "export"}
  <ExportView {workspace} onChanged={changed} />
{:else if section === "delete"}
  <DeleteWorkspace {workspace} {onDeleted} />
{/if}
