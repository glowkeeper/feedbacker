<script lang="ts">
  import type { Workspace } from "../../core/index.ts";
  import BriefImport from "./BriefImport.svelte";
  import OriginalsImport from "./OriginalsImport.svelte";
  import OverviewView from "./OverviewView.svelte";
  import RequestForm from "./RequestForm.svelte";
  import RubricImport from "./RubricImport.svelte";

  let { workspace, onClose }: { workspace: Workspace; onClose: () => void } = $props();

  const SECTIONS = [
    ["overview", "Overview"],
    ["request", "Request"],
    ["originals", "Originals"],
    ["rubric", "Rubric"],
    ["brief", "Brief"],
  ] as const;
  type Section = (typeof SECTIONS)[number][0];

  let section: Section = $state("overview");
  let version = $state(0); // bumped after a change, so the overview reads the workspace again
  const changed = () => (version += 1);
</script>

<nav aria-label="Moderation steps">
  <ul class="steps-nav">
    {#each SECTIONS as [id, label] (id)}
      <li><button type="button" aria-current={section === id ? "page" : undefined} onclick={() => (section = id)}>{label}</button></li>
    {/each}
  </ul>
</nav>

{#if section === "overview"}
  {#key version}<OverviewView {workspace} />{/key}
{:else if section === "request"}
  <RequestForm {workspace} onChanged={changed} />
{:else if section === "originals"}
  <OriginalsImport {workspace} onChanged={changed} />
{:else if section === "rubric"}
  <RubricImport {workspace} onChanged={changed} />
{:else if section === "brief"}
  <BriefImport {workspace} onChanged={changed} />
{/if}

<p class="close"><button type="button" onclick={onClose}>Close this workspace</button></p>
