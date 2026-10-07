<script lang="ts" module>
  export type Page = "home" | "marking" | "moderation";
</script>

<script lang="ts">
  import { tick } from "svelte";
  import { createNamedWorkspace, DEFAULT_RETENTION_DAYS, workspaceNameProblem, type ListedWorkspace, type Workspace, type WorkspaceList, type WorkspaceType } from "../../core/index.ts";
  import { problemsOf } from "../forms.ts";
  import { done, type Message } from "../messages.ts";
  import type { Notice, Platform } from "../platform.ts";
  import { navigationFor, progressOf, progressText } from "../steps.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";

  /**
   * Your work: the workspaces the proxy has registered, under marking and moderation, with how far each has got
   * (ADR 0008). New work is made by name in the workspaces folder, which the educator chooses once.
   */
  let {
    platform,
    page,
    notice = null,
    onOpen,
    onPage,
  }: { platform: Platform; page: Page; notice?: Notice | null; onOpen: (ws: Workspace) => void; onPage: (page: Page) => void } = $props();

  const proxy = $derived(platform.proxy!);

  let list = $state<WorkspaceList | null>(null);
  let access = $state<"granted" | "prompt" | "none" | null>(null);
  let progress = $state<Record<string, string>>({}); // by registration ID, once worked out
  let readProblem: string | null = $state(null);
  let busy = $state(false);
  let message: Message | null = $state(null);
  let problems: string[] = $state([]);
  let newName = $state("");
  let retentionDays = $state("90");
  let registerPath = $state("");
  let heading: HTMLHeadingElement | undefined = $state();
  let nameField: HTMLInputElement | undefined = $state();

  const TITLES: Record<Page, string> = { home: "Your work", marking: "Marking", moderation: "Moderation" };
  $effect(() => {
    document.title = `${TITLES[page]} – Feedbacker`;
    heading?.focus();
  });
  // What happened to the last workspace (e.g. it was deleted) goes into the status region once it is on the page, so it is announced as well as shown.
  $effect(() => {
    if (!notice) return;
    const { message: text, kind } = notice;
    queueMicrotask(() => (message = { text, kind }));
  });

  let reads = 0; // a later read wins
  async function load() {
    const read = ++reads;
    try {
      const l = await proxy.listWorkspaces();
      const a = l.folder_id ? await platform.folderAccess(l.folder_id) : "none";
      if (read !== reads) return;
      list = l;
      access = a;
      readProblem = null;
      void workOutProgress(l, a, read);
    } catch (err) {
      if (read === reads) readProblem = problemsOf(err).join(" ");
    }
  }
  $effect(() => {
    void load();
  });

  /**
   * Each workspace's progress, opened through the proxy's checks and read as its overview reads it; one at a time. Only
   * what the browser already allows is opened (nothing is asked): the rest say Continue shows it.
   */
  async function workOutProgress(l: WorkspaceList, a: typeof access, read: number) {
    for (const w of l.workspaces) {
      if (read !== reads) return;
      if (w.problem || progress[w.registration_id]) continue;
      let text: string;
      try {
        const ws = w.in_workspaces_folder ? (a === "granted" ? await platform.openInFolder(w.folder) : null) : await platform.openElsewhereIfAllowed(w.registration_id);
        if (!ws) continue;
        const navigation = navigationFor(ws);
        text = progressText(progressOf(navigation.entries, await navigation.states(ws)));
      } catch (err) {
        text = `Its progress couldn't be read: ${problemsOf(err).join(" ")}`;
      }
      if (read === reads) progress = { ...progress, [w.registration_id]: text };
    }
  }

  async function run(what: () => Promise<void>) {
    if (busy) return; // buttons stay enabled while busy, so focus isn't lost from them
    busy = true;
    message = null;
    problems = [];
    try {
      await what();
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      busy = false;
    }
  }

  /**
   * Make sure the workspaces folder can be reached, asking only when it must (from the press that needs it): the first
   * time, the educator chooses it, and it is kept only if it is the proxy's; on a later visit, the browser may ask again.
   * Returns false if the educator closed the picker.
   */
  async function withAccess(): Promise<boolean> {
    if (!list?.folder || !list.folder_id) throw new Error("the proxy couldn't prepare the workspaces folder; its window says why");
    if (access === "granted") return true;
    const allowed = access === "prompt" ? await platform.allowFolder(list.folder_id) : null;
    if (allowed === "refused") throw new Error("Feedbacker needs your permission to open the workspaces folder");
    if (allowed !== "granted") {
      try {
        await platform.chooseFolder(list.folder_id);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return false; // the picker was closed
        throw new Error(`${problemsOf(err).join(" ")}: choose the folder at ${list.folder}`);
      }
    }
    access = "granted";
    return true;
  }

  const open = (w: ListedWorkspace) =>
    run(async () => {
      if (!w.in_workspaces_folder) return onOpen(await platform.openElsewhere(w.registration_id));
      if (await withAccess()) onOpen(await platform.openInFolder(w.folder));
    });

  /** Forget a workspace that can't be found: only the proxy's registration goes; nothing is deleted. */
  const remove = (w: ListedWorkspace) =>
    run(async () => {
      await proxy.forgetWorkspace(w.registration_id);
      message = done(`Removed ${w.name ?? w.folder} from the list. Nothing was deleted.`);
      await load();
    });

  const startNew = (type: WorkspaceType) => (event: SubmitEvent) => {
    event.preventDefault();
    return run(async () => {
      // Checked before the folder is asked for, so a name that can't be used asks nothing; made only once it can be reached.
      const nameProblem = workspaceNameProblem(newName);
      if (nameProblem) throw new Error(nameProblem);
      const days = Number(retentionDays.trim());
      if (!Number.isInteger(days) || days < 1) throw new Error("keep it for a whole number of days, at least 1");
      if (!(await withAccess())) return;
      const registration = await createNamedWorkspace(proxy, newName, { workspace_type: type, retention_days: days === DEFAULT_RETENTION_DAYS ? undefined : days });
      newName = "";
      onOpen(await platform.openInFolder(registration.path.split(/[\\/]/).pop()!));
    });
  };

  const register = (event: SubmitEvent) => {
    event.preventDefault();
    return run(async () => {
      const registration = await proxy.registerWorkspace(registerPath.trim());
      registerPath = "";
      message = done(`Registered ${registration.path}. It is listed below; Continue asks you to choose its folder the first time.`);
      await load();
    });
  };

  async function goNew(type: WorkspaceType) {
    onPage(type);
    await tick();
    nameField?.focus();
  }

  const ofType = (type: WorkspaceType) => list?.workspaces.filter((w) => !w.problem && w.workspace_type === type) ?? [];
  const lost = $derived(list?.workspaces.filter((w) => w.problem) ?? []);
  const started = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null);
  const ABOUT: Record<WorkspaceType, string> = {
    marking: "Mark a cohort's coursework against the rubric: the AI suggests levels if you want it to, you decide every mark, and it drafts feedback from your marks for you to edit and approve.",
    moderation: "Check a sample of a colleague's marking: mark each piece yourself, compare with the original marker and an independent AI reading, and record your verdicts.",
  };
</script>

{#snippet workspaces(type: WorkspaceType)}
  {@const items = ofType(type)}
  {#if items.length}
    <ul class="work-list">
      {#each items as w (w.registration_id)}
        <li class="work">
          <h3>{w.name ?? w.folder}</h3>
          <p class="hint">Started {started(w.created_at)}; kept for {w.retention_days} days after the work is finished.</p>
          {#if !w.in_workspaces_folder}
            <p class="hint">Kept outside the workspaces folder, at <code>{w.path}</code>: the first time, Continue asks you to choose its folder.</p>
          {/if}
          <p class="progress">
            {progress[w.registration_id] ?? (w.in_workspaces_folder && access === "granted" ? "Working out how far it has got…" : "Continue to see how far it has got.")}
          </p>
          <button type="button" onclick={() => open(w)} aria-disabled={busy} aria-label={`Continue ${w.name ?? w.folder}`}>Continue</button>
        </li>
      {/each}
    </ul>
  {:else if list}
    <p>No {type} yet.</p>
  {/if}
{/snippet}


{#snippet said()}
  <Status {message} />
  <Problems {problems} />
{/snippet}

<h1 tabindex="-1" bind:this={heading}>{TITLES[page]}</h1>

{#if page === "home"}{@render said()}{/if}
{#if readProblem}<p class="error">Your workspaces couldn't be listed: {readProblem}</p>{/if}
{#if !list && !readProblem}<p>Reading your workspaces…</p>{/if}

{#if list && !list.folder}
  <p class="error">The proxy couldn't prepare the workspaces folder, so your work can't be opened or started. Its window says why; fix that, then restart the proxy.</p>
{/if}

{#if page === "home"}
  <p class="intro">
    Feedbacker helps you mark coursework and write meaningful, consistent feedback, and moderate marking, with the AI as a second reader that never
    decides. You decide every mark, and approve every word a student receives. Nothing leaves this computer except what you approve.
  </p>
  {#if list && !list.workspaces.some((w) => !w.problem)}
    <section aria-labelledby="start-heading">
      <h2 id="start-heading">Start here</h2>
      <p>Feedbacker helps you with two kinds of work. Try either first with the sample coursework in <code>fixtures/synthetic/</code>, in the Feedbacker folder you downloaded.</p>
      <div class="start-choices">
        <div>
          <h3>Marking</h3>
          <p>{ABOUT.marking}</p>
          <button type="button" onclick={() => goNew("marking")}>New marking</button>
        </div>
        <div>
          <h3>Moderation</h3>
          <p>{ABOUT.moderation}</p>
          <button type="button" onclick={() => goNew("moderation")}>New moderation</button>
        </div>
      </div>
    </section>
  {:else if list}
    {#each ["marking", "moderation"] as const as type (type)}
      <section aria-labelledby={`${type}-heading`}>
        <h2 id={`${type}-heading`}>{type === "marking" ? "Marking" : "Moderation"}</h2>
        {@render workspaces(type)}
        <button type="button" onclick={() => goNew(type)}>{type === "marking" ? "New marking" : "New moderation"}</button>
      </section>
    {/each}
  {/if}
  {#if lost.length}
    <section aria-labelledby="lost-heading">
      <h2 id="lost-heading">Can't be found</h2>
      <p>These are registered with the proxy, but can't be opened. Removing one from the list deletes nothing.</p>
      <ul class="work-list">
        {#each lost as w (w.registration_id)}
          <li class="work">
            <h3>{w.name ?? w.folder}</h3>
            <p class="error">{w.problem}.</p>
            <button type="button" onclick={() => remove(w)} aria-disabled={busy} aria-label={`Remove from the list: ${w.name ?? w.folder}`}>Remove from the list</button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
  {#if list?.folder}
    <p class="hint">Feedbacker keeps your work in <code>{list.folder}</code>. The first time you continue or start some work, your browser asks you to choose that folder.</p>
  {/if}
  <details class="step-form">
    <summary>More options</summary>
    <form onsubmit={register}>
      <h2>Register a workspace made by the command line</h2>
      <label for="register-path">Full path of the workspace folder</label>
      <input id="register-path" type="text" bind:value={registerPath} required autocomplete="off" spellcheck="false" />
      <button type="submit" aria-disabled={busy}>Register</button>
    </form>
  </details>
{:else}
  <p>{ABOUT[page]}</p>
  <section aria-labelledby="new-heading">
    <h2 id="new-heading">{page === "marking" ? "New marking" : "New moderation"}</h2>
    <form onsubmit={startNew(page)}>
      <label for="new-name">Name</label>
      <p class="hint" id="new-name-hint">For example the module and year, such as "CS101 2026". It names the folder, so letters, digits, spaces, hyphens, underscores and full stops only.</p>
      <input id="new-name" type="text" bind:value={newName} bind:this={nameField} required autocomplete="off" aria-describedby="new-name-hint" />
      <details class="step-form options">
        <summary>Options</summary>
        <label for="retention">Keep for (days after the work is finished)</label>
        <p class="hint" id="retention-hint">How long you may keep the material, for example under your institution's terms. Feedbacker records it; deleting is up to you.</p>
        <input id="retention" type="text" inputmode="numeric" bind:value={retentionDays} aria-describedby="retention-hint" />
      </details>
      <button type="submit" aria-disabled={busy}>{page === "marking" ? "Start the marking" : "Start the moderation"}</button>
    </form>
    {@render said()}
  </section>
  <section aria-labelledby="list-heading">
    <h2 id="list-heading">Your {page}</h2>
    {@render workspaces(page)}
  </section>
{/if}
