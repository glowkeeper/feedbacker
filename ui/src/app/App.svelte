<script lang="ts">
  import type { ProxyHealth, Workspace } from "../core/index.ts";
  import type { Platform } from "./platform.ts";
  import WorkspaceChooser from "./components/WorkspaceChooser.svelte";
  import OverviewView from "./components/OverviewView.svelte";

  let { platform }: { platform: Platform } = $props();

  let health: ProxyHealth | null = $state(null);
  let proxyProblem: string | null = $state(null);
  let workspace: Workspace | null = $state(null);
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
    workspace = null;
  }
</script>

<a class="skip" href="#main">Skip to the main content</a>
<header class="banner">
  <p class="product">Feedbacker</p>
  {#if workspace}
    <p class="where">
      Workspace <strong>{workspace.manifest.name}</strong> at <code>{workspace.registration.path}</code>
    </p>
  {/if}
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
    <WorkspaceChooser {platform} onOpen={(ws: Workspace) => (workspace = ws)} />
  {:else}
    <OverviewView {workspace} onClose={close} />
  {/if}
</main>
