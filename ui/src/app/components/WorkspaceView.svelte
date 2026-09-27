<script lang="ts">
  import type { Workspace } from "../../core/index.ts";
  import type { AppProxy } from "../platform.ts";
  import AnonymisationView from "./AnonymisationView.svelte";
  import MarkingView from "./MarkingView.svelte";
  import ReadingView from "./ReadingView.svelte";
  import ReviewView from "./ReviewView.svelte";
  import BriefImport from "./BriefImport.svelte";
  import OriginalsImport from "./OriginalsImport.svelte";
  import OverviewView from "./OverviewView.svelte";
  import RequestForm from "./RequestForm.svelte";
  import RubricImport from "./RubricImport.svelte";

  let { workspace, proxy, onClose }: { workspace: Workspace; proxy: AppProxy; onClose: () => void } = $props();

  // Each step: its id, its name in the navigation, and its screen's heading (which is also the page title, WCAG 2.4.2).
  const SECTIONS = [
    ["overview", "Overview", "Moderation overview"],
    ["request", "Request", "Moderation request"],
    ["originals", "Originals", "Original submissions"],
    ["rubric", "Rubric", "Source rubric"],
    ["brief", "Brief", "Assessment brief"],
    ["anonymisation", "Anonymisation", "Anonymisation"],
    ["marking", "Original marking", "Original marking"],
    ["reading", "AI reading", "AI reading"],
    ["review", "Review", "Review"],
  ] as const;
  type Section = (typeof SECTIONS)[number][0];

  let section: Section = $state("overview");
  let version = $state(0); // bumped after a change, so the overview reads the workspace again
  const changed = () => (version += 1);
  $effect(() => {
    document.title = `${SECTIONS.find(([id]) => id === section)![2]} – ${workspace.manifest.name} – Feedbacker`;
  });
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
{:else if section === "anonymisation"}
  <AnonymisationView {workspace} onChanged={changed} />
{:else if section === "marking"}
  <MarkingView {workspace} onChanged={changed} />
{:else if section === "reading"}
  <ReadingView {workspace} {proxy} onChanged={changed} />
{:else if section === "review"}
  <ReviewView {workspace} onChanged={changed} />
{/if}

<p class="close"><button type="button" onclick={onClose}>Close this workspace</button></p>
