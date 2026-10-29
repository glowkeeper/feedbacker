<script lang="ts">
  /**
   * For an assessment in a module: the module, and the module's other assessments, one step away. The module is opened as it already is (it is open with the
   * assessment, which holds what they share), and another assessment opens through the module, as it does from the module's page.
   */
  import type { ListedWorkspace, Workspace } from "../../core/index.ts";
  import { problemsOf } from "../forms.ts";
  import type { Platform } from "../platform.ts";

  let { workspace, platform, onOpen }: { workspace: Workspace; platform: Platform; onOpen: (ws: Workspace) => void } = $props();

  const module = $derived(workspace.module!);
  const moduleName = $derived(module.manifest.name);
  const parentOf = (path: string) => path.replace(/[\\/][^\\/]*$/, "");

  let siblings = $state<ListedWorkspace[] | null>(null);
  let problem: string | null = $state(null);
  let busy = $state(false);

  $effect(() => {
    const here = module.registration.path;
    const name = moduleName;
    siblings = null;
    platform.proxy!.listWorkspaces().then(
      (l) => (siblings = l.workspaces.filter((w) => parentOf(w.path) === here && w.module === name && !w.problem)),
      (err) => (problem = problemsOf(err).join(" ")),
    );
  });

  async function open(folder: string) {
    if (busy) return; // buttons stay enabled while busy, so focus isn't lost from them
    busy = true;
    problem = null;
    try {
      onOpen(await platform.openInModule(moduleName, folder));
    } catch (err) {
      problem = problemsOf(err).join(" ");
    } finally {
      busy = false;
    }
  }
</script>

<nav aria-label={`The module ${moduleName}`} class="module-bar">
  <button type="button" aria-disabled={busy} onclick={() => !busy && onOpen(module)}>Back to the module {moduleName}</button>
  {#if siblings && siblings.length > 1}
    <span class="group-name" id="module-assessments">Its assessments</span>
    <ul aria-labelledby="module-assessments">
      {#each siblings as w (w.registration_id)}
        <li>
          {#if w.registration_id === workspace.registration.registration_id}
            <span aria-current="page">{w.name ?? w.folder} (this one)</span>
          {:else}
            <button type="button" aria-disabled={busy} onclick={() => open(w.folder)}>{w.name ?? w.folder}</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  {#if problem}<span class="error" role="alert">{problem}</span>{/if}
</nav>
