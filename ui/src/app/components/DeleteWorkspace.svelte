<script lang="ts">
  import type { Workspace } from "../../core/index.ts";
  import type { Notice } from "../platform.ts";
  import Problems from "./Problems.svelte";
  import { listExports } from "../exportStep.ts";

  /** `also`: for a module, its assessments, whose exports are deleted with it (ADR 0010). */
  let { workspace, also = [], unread = [], onDeleted }: { workspace: Workspace; also?: Workspace[]; unread?: string[]; onDeleted: (what: Notice) => void } = $props();
  const isModule = $derived(workspace.manifest.workspace_type === "module");
  const kind = $derived(isModule ? "module" : "workspace");

  let heading: HTMLHeadingElement;
  let confirmName = $state("");
  let exports: Awaited<ReturnType<typeof listExports>> | null = $state(null); // read when the screen opens, so the list is current
  let keptExports = $state(false);
  let deleting = $state(false);
  let deleteProblems: string[] = $state([]);

  $effect(() => {
    heading?.focus();
    Promise.all([workspace, ...also].map((w) => listExports(w))).then(
      (e) => (exports = e.flat()),
      (err: Error) => (deleteProblems = [`the exports folder couldn't be read (${err.message}); check it yourself before deleting`]),
    );
  });

  /** Delete the whole workspace, once its name is typed; then the app returns to the chooser and says what was deleted. */
  async function deleteIt(event: SubmitEvent) {
    event.preventDefault();
    if (deleting) return;
    const { name } = workspace.manifest;
    const { path } = workspace.registration;
    const problems = [
      ...(exports === null ? ["the exports folder hasn't been read; open this screen again"] : []),
      ...(exports?.length && !keptExports ? ['tick "I have kept the exports I need" first: they are deleted with the workspace'] : []),
      ...(confirmName !== name ? [`type the ${kind}'s name, ${name}, exactly, to confirm deleting it`] : []),
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
        kind: "done",
        message: `Deleted the ${kind} ${name}: its folder, ${path}, and everything in it${isModule ? ", every assessment in it" : ""}, including the pseudonym key and every export. Feedbacker no longer holds its path. Delete the downloads (the originals and the marked views) yourself, and empty the Trash if they went there.`,
      });
    } catch (err) {
      // Part of it may already be gone, so the workspace isn't reopened: the chooser says what is left to do.
      onDeleted({
        kind: "error",
        message: `The ${kind} ${name} may not be completely deleted: ${err instanceof Error ? err.message : String(err)}. Check the folder at ${path}, and delete whatever is left of it yourself.`,
      });
    } finally {
      deleting = false;
    }
  }
</script>

<h1 tabindex="-1" bind:this={heading}>Delete this {kind}</h1>
<section class="delete-workspace">
  <p>
    This deletes the {kind}'s whole folder, <code>{workspace.registration.path}</code>, and everything in it{isModule ? `, every assessment in the module${also.length ? ` (${also.map((w) => w.manifest.name).join(", ")})` : ""}` : ""}: the source files, extracts, anonymised text,
    approvals, AI readings, marking, judgements, the pseudonym key, and every export, including re-identified copies. It can't be undone, so export and keep what
    you are required to keep first.
  </p>
  {#if unread.length}
    <p class="attention">
      {unread.join(", ")} couldn't be opened, so any exports in {unread.length === 1 ? "it" : "them"} can't be listed here. Look in {unread.length === 1 ? "its folder" : "their folders"} in the module's folder
      for an <code>exports</code> folder before deleting: it is deleted with the module.
    </p>
  {/if}
  {#if exports}
    {#if exports.length}
      <p>
        These exports are in the {kind}, and are deleted with it. Copy any you must keep to a folder outside the workspace (and outside any git repository) first,
        for example in the Finder.
      </p>
      <ul class="export-list">
        {#each exports as e (e.name)}<li><code>{e.path}</code>{e.reidentified ? " (a re-identified copy: it contains personal data)" : ""}</li>{/each}
      </ul>
      <label class="check"><input type="checkbox" bind:checked={keptExports} /> I have kept the exports I need</label>
    {:else}
      <p class="attention">There are no exports in this {kind}: nothing has been exported, so deleting leaves no copy of it.</p>
    {/if}
  {/if}
  <form onsubmit={deleteIt}>
    <label for="confirm-name">To confirm, type the {kind}'s name: <strong>{workspace.manifest.name}</strong></label>
    <input id="confirm-name" type="text" bind:value={confirmName} autocomplete="off" spellcheck="false" />
    <button type="submit" aria-disabled={deleting}>Delete this {kind} permanently</button>
  </form>
  <Problems problems={deleteProblems} />
</section>
