<script lang="ts">
  import { createWorkspace, type Workspace, type WorkspaceType } from "../../core/index.ts";
  import type { Notice, Platform } from "../platform.ts";
  import Status from "./Status.svelte";
  import { done, failed, info, type Message } from "../messages.ts";

  let { platform, onOpen, notice = null }: { platform: Platform; onOpen: (ws: Workspace) => void; notice?: Notice | null } = $props();

  let busy = $state(false);
  let message: Message | null = $state(null);
  let createPath = $state("");
  let workspaceType = $state<WorkspaceType | "">(""); // chosen on the page: marking or moderation
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
      if (!workspaceType) throw new Error("choose what you are doing: marking or moderation");
      const registration = await createWorkspace(platform.proxy!, createPath.trim(), {
        retention_days: retentionDays,
        retention_source: "educator",
        workspace_type: workspaceType,
      });
      message = done(`Created the ${workspaceType} workspace ${registration.path}. Now choose that folder to open it.`);
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

<h1 tabindex="-1" bind:this={heading}>What would you like to do?</h1>
<p>
  Feedbacker helps you mark coursework and write meaningful, consistent feedback, and moderate marking, with the AI as a second reader that never
  decides. Each piece of work is a workspace: a folder on this computer. Nothing in it leaves the computer except what you approve, through the proxy.
</p>

<Status {message} />

<section aria-labelledby="start-heading">
  <h2 id="start-heading">Start something new</h2>
  <form onsubmit={create}>
    <fieldset class="choices">
      <legend>What are you doing?</legend>
      <label class="choice">
        <input type="radio" name="workspace-type" value="marking" bind:group={workspaceType} required />
        <span><strong>Marking</strong> <span class="hint">Mark a cohort's coursework: the AI suggests levels, you decide every mark, and it drafts feedback from your marks for you to edit and approve.</span></span>
      </label>
      <label class="choice">
        <input type="radio" name="workspace-type" value="moderation" bind:group={workspaceType} />
        <span><strong>Moderation</strong> <span class="hint">Moderate a sample of someone else's marking, with the AI as a second reader.</span></span>
      </label>
    </fieldset>
    <label for="create-path">Full path of the new folder</label>
    <input id="create-path" type="text" bind:value={createPath} required autocomplete="off" spellcheck="false" placeholder="/Users/you/Feedbacker/workspaces/module-2026" />
    <label for="retention">Keep for (days)</label>
    <p class="hint" id="retention-hint">How long you may keep the material, for example under your institution's terms. Feedbacker records it; deleting is up to you.</p>
    <input id="retention" type="number" min="1" bind:value={retentionDays} required aria-describedby="retention-hint" />
    <button type="submit" aria-disabled={busy}>Start</button>
  </form>
</section>

<section aria-labelledby="open-heading">
  <h2 id="open-heading">Carry on with a workspace</h2>
  <div class="actions">
    <button type="button" onclick={openRemembered} aria-disabled={busy}>Open the last workspace</button>
    <button type="button" onclick={openPicked} aria-disabled={busy}>Choose a workspace folder…</button>
  </div>
</section>

<details class="step-form">
  <summary>Register a workspace made by the command line</summary>
  <form onsubmit={register}>
    <label for="register-path">Full path of the workspace folder</label>
    <input id="register-path" type="text" bind:value={registerPath} required autocomplete="off" spellcheck="false" />
    <button type="submit" aria-disabled={busy}>Register</button>
  </form>
</details>
