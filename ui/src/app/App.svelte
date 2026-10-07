<script lang="ts">
  import { VERSION, type ProxyHealth, type Workspace } from "../core/index.ts";
  import type { Notice, Platform } from "./platform.ts";
  import Home, { type Page } from "./components/Home.svelte";
  import WorkspaceView from "./components/WorkspaceView.svelte";
  import { navigationFor } from "./steps.ts";

  let { platform }: { platform: Platform } = $props();

  let health: ProxyHealth | null = $state(null);
  let proxyProblem: string | null = $state(null);
  let workspace: Workspace | null = $state(null);
  let notice: Notice | null = $state(null); // what happened to the last workspace, shown on the home screen
  let page = $state<Page>("home");
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

  /** Back to your work, on the page for this workspace's kind. */
  function close() {
    notice = null;
    page = workspace?.manifest.workspace_type === "marking" ? "marking" : "moderation";
    workspace = null;
  }

  /** After deleting a workspace: the browser forgets its folder if it remembered one, and the home screen says what was deleted. */
  async function deleted(what: Notice) {
    const id = workspace!.registration.registration_id;
    try {
      await platform.forget(id);
      notice = what;
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      notice = { kind: "error", message: `${what.message} But this browser couldn't forget the folder (${why}).` };
    }
    page = "home";
    workspace = null;
  }

  const PAGES: { page: Page; label: string }[] = [
    { page: "home", label: "Your work" },
    { page: "marking", label: "Marking" },
    { page: "moderation", label: "Moderation" },
  ];
  /** Go to a page; from inside a workspace, that closes it, as Close does. */
  function show(next: Page) {
    notice = null;
    workspace = null;
    page = next;
  }

  const DOCS = "https://github.com/glowkeeper/feedbacker/blob/main";
  const LINKS: { href: string; label: string }[] = [
    { href: `${DOCS}/docs/runbook.md`, label: "Help: the user guide" },
    { href: `${DOCS}/docs/data-handling.md`, label: "How your data is handled" },
    { href: `${DOCS}/docs/responsible-use.md`, label: "Responsible use" },
    { href: `${DOCS}/docs/accessibility.md`, label: "Accessibility" },
    { href: "https://github.com/glowkeeper/feedbacker/issues/new/choose", label: "Report a problem" },
    { href: "https://feedbacker.education", label: "feedbacker.education" },
  ];
  // The page title names the screen (WCAG 2.4.2); a workspace's steps set their own.
  $effect(() => {
    if (!platform.proxy) document.title = "Open Feedbacker from the proxy – Feedbacker";
    else if (proxyProblem) document.title = "The proxy can't be reached – Feedbacker";
  });
</script>

<a class="skip" href="#main">Skip to the main content</a>
<header class="banner">
  <div class="banner-row">
    <p class="product">Feedbacker</p>
    {#if platform.proxy && !proxyProblem}
      <nav aria-label="Feedbacker" class="home-nav">
        <ul>
          {#each PAGES as p (p.page)}
            <li><button type="button" aria-current={!workspace && page === p.page ? "page" : undefined} onclick={() => show(p.page)}>{p.label}</button></li>
          {/each}
        </ul>
      </nav>
    {/if}
  </div>
  {#if health}
    <p class="proxy">Proxy connected; API key {health.key_configured ? "configured" : "not configured"}</p>
    {#if health.version && health.version !== VERSION}
      <p class="attention">
        The proxy is version {health.version}, but this app is {VERSION}: rebuild the app (<code>npm run build</code> in <code>ui</code>), then restart the
        proxy.
      </p>
    {/if}
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
    <Home {platform} {page} {notice} onOpen={(ws: Workspace) => (workspace = ws)} onPage={show} />
  {:else}
    <WorkspaceView {workspace} navigation={navigationFor(workspace)} proxy={platform.proxy} onClose={close} onDeleted={deleted} />
  {/if}
</main>

<footer class="app-footer">
  <nav aria-label="About Feedbacker">
    <ul>
      {#each LINKS as l (l.href)}<li><a href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a></li>{/each}
    </ul>
  </nav>
  <p>
    Feedbacker {VERSION}. © 2025–2026 Steve Huckle, under the
    <a href={`${DOCS}/LICENSE`} target="_blank" rel="noopener noreferrer">Apache License 2.0</a>. These links open in a new tab, and need an internet
    connection; Feedbacker itself runs on this computer.
  </p>
</footer>
