<script lang="ts">
  import type { Workspace } from "../../core/index.ts";
  import type { AppProxy, Notice } from "../platform.ts";
  import Problems from "./Problems.svelte";
  import { listExports } from "../exportStep.ts";
  import AnonymisationView from "./AnonymisationView.svelte";
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

  let confirmName = $state("");
  let exports: Awaited<ReturnType<typeof listExports>> | null = $state(null); // read when the delete section is opened
  let keptExports = $state(false);

  /** Read what is in the exports folder, each time the delete section is opened, so the list is current. */
  async function readExports(event: Event) {
    if (!(event.currentTarget as HTMLDetailsElement).open) return;
    keptExports = false;
    try {
      exports = await listExports(workspace);
    } catch (err) {
      exports = null;
      deleteProblems = [`the exports folder couldn't be read (${err instanceof Error ? err.message : String(err)}); check it yourself before deleting`];
    }
  }
  let deleting = $state(false);
  let deleteProblems: string[] = $state([]);

  /** Delete the whole workspace, once its name is typed; then the app returns to the chooser and says what was deleted. */
  async function deleteIt(event: SubmitEvent) {
    event.preventDefault();
    if (deleting) return;
    const { name } = workspace.manifest;
    const { path } = workspace.registration;
    const problems = [
      ...(exports === null ? ["the exports folder hasn't been read; close and open this section again"] : []),
      ...(exports?.length && !keptExports ? ['tick "I have kept the exports I need" first: they are deleted with the workspace'] : []),
      ...(confirmName !== name ? [`type the workspace's name, ${name}, exactly, to confirm deleting it`] : []),
    ];
    if (problems.length) {
      deleteProblems = problems;
      return;
    }
    deleting = true;
    deleteProblems = [];
    try {
      await workspace.delete(confirmName);
      onDeleted({
        kind: "info",
        message: `Deleted the workspace ${name}: its folder, ${path}, and everything in it, including the pseudonym key and every export. Feedbacker no longer holds its path. Delete the downloads (the originals and the marked views) yourself, and empty the Trash if they went there.`,
      });
    } catch (err) {
      // Part of it may already be gone, so the workspace isn't reopened: the chooser says what is left to do.
      onDeleted({
        kind: "error",
        message: `The workspace ${name} may not be completely deleted: ${err instanceof Error ? err.message : String(err)}. Check the folder at ${path}, and delete whatever is left of it yourself.`,
      });
    } finally {
      deleting = false;
    }
  }

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
    ["export", "Export", "Export"],
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
  <details class="delete-workspace" ontoggle={readExports}>
    <summary>Delete this workspace</summary>
    <p>
      This deletes the workspace's whole folder, <code>{workspace.registration.path}</code>, and everything in it: the source files, extracts, anonymised text,
      approvals, AI readings, marking, judgements, the pseudonym key, and every export, including re-identified copies. It can't be undone, so export and keep
      what you are required to keep first.
    </p>
    {#if exports}
      {#if exports.length}
        <p>
          These exports are in the workspace, and are deleted with it. Copy any you must keep to a folder outside the workspace (and outside any git repository)
          first, for example in the Finder.
        </p>
        <ul class="export-list">
          {#each exports as e (e.name)}<li><code>{e.path}</code>{e.reidentified ? " (a re-identified copy: it contains personal data)" : ""}</li>{/each}
        </ul>
        <label class="check"><input type="checkbox" bind:checked={keptExports} /> I have kept the exports I need</label>
      {:else}
        <p class="attention">There are no exports in this workspace: the moderation record hasn't been exported, so deleting leaves no copy of it.</p>
      {/if}
    {/if}
    <form onsubmit={deleteIt}>
      <label for="confirm-name">To confirm, type the workspace's name: <strong>{workspace.manifest.name}</strong></label>
      <input id="confirm-name" type="text" bind:value={confirmName} autocomplete="off" spellcheck="false" />
      <button type="submit" aria-disabled={deleting}>Delete this workspace permanently</button>
    </form>
    <Problems problems={deleteProblems} />
  </details>
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
{/if}

<p class="close"><button type="button" onclick={onClose}>Close this workspace</button></p>
