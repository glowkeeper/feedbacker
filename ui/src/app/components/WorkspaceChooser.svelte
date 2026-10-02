<script lang="ts">
  import { createWorkspace, type Workspace } from "../../core/index.ts";
  import type { Notice, Platform } from "../platform.ts";
  import Status from "./Status.svelte";
  import { done, failed, info, type Message } from "../messages.ts";

  let { platform, onOpen, notice = null }: { platform: Platform; onOpen: (ws: Workspace) => void; notice?: Notice | null } = $props();

  let busy = $state(false);
  let message: Message | null = $state(null);
  let createPath = $state("");
  let retentionDays = $state(90);
  let registerPath = $state("");
  let heading: HTMLHeadingElement;

  $effect(() => heading?.focus());
  // What happened to the last workspace (e.g. it was deleted) goes into the status region once it is on the page, so it is announced as well as shown.
  $effect(() => {
    if (!notice) return;
    const { message: text, kind } = notice;
    queueMicrotask(() => {
      message = { text, kind };
    });
  });

  async function run(what: () => Promise<void>) {
    if (busy) return; // buttons stay enabled while busy, so focus isn't lost from them
    busy = true;
    message = null;
    try {
      await what();
    } catch (err) {
      message = failed((err as Error).message);
    } finally {
      busy = false;
    }
  }

  const openRemembered = () =>
    run(async () => {
      const ws = await platform.openRemembered();
      if (ws) onOpen(ws);
      else {
        message = info("No workspace is remembered in this browser; choose its folder instead.");
      }
    });

  const openPicked = () => run(async () => onOpen(await platform.openPicked()));

  const create = (event: SubmitEvent) => {
    event.preventDefault();
    return run(async () => {
      const registration = await createWorkspace(platform.proxy!, createPath.trim(), { retention_days: retentionDays, retention_source: "moderator" });
      message = done(`Created ${registration.path}. Now choose that folder to open it.`);
    });
  };

  const register = (event: SubmitEvent) => {
    event.preventDefault();
    return run(async () => {
      const registration = await platform.proxy!.registerWorkspace(registerPath.trim());
      message = done(`Registered ${registration.path}. Now choose that folder to open it.`);
    });
  };
</script>

<h1 tabindex="-1" bind:this={heading}>Open a workspace</h1>
<p>A workspace is a folder on this computer holding one moderation. Nothing in it leaves the computer except through the proxy.</p>

<Status {message} />

<section aria-labelledby="open-heading">
  <h2 id="open-heading">Open an existing workspace</h2>
  <div class="actions">
    <button type="button" onclick={openRemembered} aria-disabled={busy}>Open the last workspace</button>
    <button type="button" onclick={openPicked} aria-disabled={busy}>Choose a workspace folder…</button>
  </div>
</section>

<section aria-labelledby="create-heading">
  <h2 id="create-heading">Create a new workspace</h2>
  <form onsubmit={create}>
    <label for="create-path">Full path of the new folder</label>
    <input id="create-path" type="text" bind:value={createPath} required autocomplete="off" spellcheck="false" placeholder="/Users/you/Feedbacker/workspaces/module-2026" />
    <label for="retention">Keep for (days)</label>
    <input id="retention" type="number" min="1" bind:value={retentionDays} required />
    <button type="submit" aria-disabled={busy}>Create</button>
  </form>
</section>

<section aria-labelledby="register-heading">
  <h2 id="register-heading">Register a workspace made by the command line</h2>
  <form onsubmit={register}>
    <label for="register-path">Full path of the workspace folder</label>
    <input id="register-path" type="text" bind:value={registerPath} required autocomplete="off" spellcheck="false" />
    <button type="submit" aria-disabled={busy}>Register</button>
  </form>
</section>
