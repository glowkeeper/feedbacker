<script lang="ts">
  import type { ProxyHealth, Workspace } from "../core/index.ts";
  import type { Notice, Platform } from "./platform.ts";
  import WorkspaceChooser from "./components/WorkspaceChooser.svelte";
  import WorkspaceView from "./components/WorkspaceView.svelte";

  let { platform }: { platform: Platform } = $props();

  let health: ProxyHealth | null = $state(null);
  let proxyProblem: string | null = $state(null);
  let workspace: Workspace | null = $state(null);
  let notice: Notice | null = $state(null); // what happened to the last workspace, shown on the chooser
  let messageHeading: HTMLHeadingElement | undefined = $state();

  // Every screen moves focus to its heading, including these two messages
  // (the chooser and the overview focus their own).
  $effect(() => messageHeading?.focus());

  $effect(() => {
    if (!platform.proxy) return;
    platform.proxy.health().then(
      (h) => (health = h),
      (err: Error) => (proxyProblem = err.message),
    );
  });

  async function close() {
    await platform.forget();
    notice = null;
    workspace = null;
  }

  /** After deleting a workspace: the browser forgets it too, and the chooser says what was deleted. */
  async function deleted(what: Notice) {
    try {
      await platform.forget();
      notice = what;
    } catch (err) {
      // Not hidden: "Open the last workspace" could otherwise still offer the deleted folder.
      const why = err instanceof Error ? err.message : String(err);
      notice = { kind: "error", message: `${what.message} But this browser couldn't forget the folder (${why}): don't use "Open the last workspace" for it.` };
    }
    workspace = null;
  }
  // The page title names the screen (WCAG 2.4.2); a workspace's steps set their own.
  $effect(() => {
    if (!platform.proxy) document.title = "Open Feedbacker from the proxy – Feedbacker";
    else if (proxyProblem) document.title = "The proxy can't be reached – Feedbacker";
    else if (!workspace) document.title = "Open a workspace – Feedbacker";
  });
</script>

<a class="skip" href="#main">Skip to the main content</a>
<header class="banner">
  <p class="product">Feedbacker</p>
  {#if health}
    <p class="proxy">Proxy connected; API key {health.key_configured ? "configured" : "not configured"}</p>
  {/if}
</header>

<main id="main" tabindex="-1">
  {#if !platform.proxy}
    <h1 tabindex="-1" bind:this={messageHeading}>Open Feedbacker from the proxy</h1>
    <p>
      Feedbacker runs through the local proxy. Start it with <code>npm start</code> in the <code>proxy</code> folder,
      then open the address it prints (it ends with <code>#token=…</code>).
    </p>
  {:else if proxyProblem}
    <h1 tabindex="-1" bind:this={messageHeading}>The proxy can't be reached</h1>
    <p role="alert">{proxyProblem}</p>
    <p>Check the proxy is still running, then open the address it printed again.</p>
  {:else if !workspace}
    <WorkspaceChooser {platform} {notice} onOpen={(ws: Workspace) => (workspace = ws)} />
  {:else}
    <WorkspaceView {workspace} proxy={platform.proxy} onClose={close} onDeleted={deleted} />
  {/if}
</main>
