<script lang="ts" module>
  export type Page = "home" | "marking" | "moderation";
</script>

<script lang="ts">
  import { tick } from "svelte";
  import { createNamedWorkspace, DEFAULT_RETENTION_DAYS, NoFolderChosen, workspaceNameProblem, type ListedWorkspace, type Workspace, type WorkspaceList, type WorkspaceType } from "../../core/index.ts";
  import { problemsOf } from "../forms.ts";
  import { canMove, continueLabel, elsewhereNote, moveNameProblem, suggestName, type ElsewhereAccess } from "../elsewhere.ts";
  import { done, info, type Message } from "../messages.ts";
  import type { Notice, Platform } from "../platform.ts";
  import { navigationFor, progressOf, progressText } from "../steps.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";

  /**
   * Home: the workspaces the proxy has registered, under marking and moderation, and the modules that group
   * assessments (ADR 0010), with how far each has got (ADR 0008). New work is made by name in the workspaces folder, which the educator chooses once.
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
  let elsewhere = $state<Record<string, ElsewhereAccess>>({}); // by registration ID, for each workspace kept outside the workspaces folder
  let renameFor = $state<Record<string, string>>({}); // by registration ID: the name being typed, for one that can't keep its folder's name in the workspaces folder
  let readProblem: string | null = $state(null);
  let busy = $state(false);
  let message: Message | null = $state(null);
  let problems: string[] = $state([]);
  let newName = $state("");
  let retentionDays = $state("90");
  const NEW_MODULE = "\u0000new"; // the choice of a module that is made along with the work
  let moduleChoice = $state(""); // '' for work that is not part of a module, a module's folder name, or NEW_MODULE
  let newModuleName = $state("");
  let sharedKey = $state(false);
  let registerPath = $state("");
  let heading: HTMLHeadingElement | undefined = $state();
  let nameField: HTMLInputElement | undefined = $state();

  const TITLES: Record<Page, string> = { home: "Home", marking: "Marking", moderation: "Moderation" };
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
      const e: Record<string, ElsewhereAccess> = {};
      for (const w of l.workspaces) if (!w.in_workspaces_folder && !w.problem) e[w.registration_id] = await platform.elsewhereAccess(w.registration_id);
      if (read !== reads) return;
      list = l;
      access = a;
      elsewhere = e;
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
        if (w.workspace_type === "module") {
          const n = l.workspaces.filter((x) => x.module === w.folder && !x.problem).length;
          text = `${n} ${n === 1 ? "assessment" : "assessments"}`;
          progress = { ...progress, [w.registration_id]: text };
          continue;
        }
        const ws = w.module
          ? a === "granted"
            ? await platform.openInModule(w.module, w.folder)
            : null
          : w.in_workspaces_folder
            ? a === "granted"
              ? await platform.openInFolder(w.folder)
              : null
            : await platform.openElsewhereIfAllowed(w.registration_id);
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
      // Closing the folder picker is a choice, not a failure.
      if (err instanceof NoFolderChosen) message = info("No folder chosen. Nothing was changed.");
      else problems = problemsOf(err);
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
    if (!list) await load(); // pressed before the workspaces were first listed: wait for them, rather than say there is no folder
    if (!list?.folder || !list.folder_id) throw new Error("the proxy couldn't prepare the workspaces folder; its window says why");
    if (access === "granted") return true;
    const allowed = access === "prompt" ? await platform.allowFolder(list.folder_id) : null;
    if (allowed === "refused") throw new Error("Feedbacker needs your permission to open the workspaces folder");
    if (allowed !== "granted") {
      try {
        await platform.chooseFolder(list.folder_id);
      } catch (err) {
        if (err instanceof NoFolderChosen) return false;
        throw new Error(`${problemsOf(err).join(" ")}: choose the folder named ${list.folder.split(/[\\/]/).pop()}, which is at ${list.folder}`);
      }
    }
    access = "granted";
    return true;
  }

  const open = (w: ListedWorkspace) =>
    run(async () => {
      if (!w.in_workspaces_folder) return onOpen(await platform.openElsewhere(w.registration_id, w.path));
      if (await withAccess()) onOpen(w.module ? await platform.openInModule(w.module, w.folder) : await platform.openInFolder(w.folder));
    });

  // A workspace keeps its folder's name when it moves in, unless that name is used or can't be one: then it is given another, and the name
  // field appears before anything is sent (and after, if the proxy finds a clash the list could not show).
  const nameProblemOf = (w: ListedWorkspace) => (list ? moveNameProblem(w, list.workspaces) : null);
  const needsName = (w: ListedWorkspace) => renameFor[w.registration_id] !== undefined || nameProblemOf(w) !== null;
  const nameOf = (w: ListedWorkspace) => renameFor[w.registration_id] ?? (list ? suggestName(w, list.workspaces) : w.folder);

  /**
   * Move a workspace kept elsewhere into the workspaces folder (ADR 0013): the proxy renames the folder, and it keeps its
   * registration. The folder this browser remembered for it is stale, so it is forgotten; opening it then asks nothing more.
   */
  const move = (w: ListedWorkspace) =>
    run(async () => {
      const rename = needsName(w) ? nameOf(w).trim().normalize("NFC") : undefined;
      const nameProblem = rename === undefined ? null : workspaceNameProblem(rename);
      if (nameProblem) throw new Error(`The name in the workspaces folder: ${nameProblem}`);
      try {
        await proxy.moveWorkspace(w.registration_id, rename);
      } catch (err) {
        if (rename === undefined && problemsOf(err).join(" ").includes("give it another name")) renameFor = { ...renameFor, [w.registration_id]: nameOf(w) };
        throw err;
      }
      await platform.forget(w.registration_id);
      const { [w.registration_id]: _typed, ...rest } = renameFor;
      renameFor = rest;
      const as = rename !== undefined && rename !== w.folder ? ` as ${rename}` : "";
      message = done(
        `Moved ${w.name ?? w.folder} into the workspaces folder${as}, from ${w.path}. ${as ? "Its name was updated to match; nothing else inside it was changed." : "Nothing inside it was changed."}`,
      );
      await load();
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
      if (moduleChoice === NEW_MODULE) {
        const moduleProblem = workspaceNameProblem(newModuleName);
        if (moduleProblem) throw new Error(`The module's name: ${moduleProblem}`);
      }
      const days = Number(retentionDays.trim());
      if (!Number.isInteger(days) || days < 1) throw new Error("keep it for a whole number of days, at least 1");
      if (!(await withAccess())) return;
      // An assessment added to an existing module is kept for as long as the module is, so it is not asked for here.
      const retention = moduleChoice !== "" && moduleChoice !== NEW_MODULE ? undefined : days === DEFAULT_RETENTION_DAYS ? undefined : days;
      let module = moduleChoice === NEW_MODULE ? null : moduleChoice;
      if (moduleChoice === NEW_MODULE) {
        // A new module is made along with its first assessment (ADR 0010); if the assessment can't be made, the module stays, and is listed.
        const made = await createNamedWorkspace(proxy, newModuleName, { workspace_type: "module", shared_key: sharedKey, retention_days: retention });
        module = made.path.split(/[\\/]/).pop()!;
        newModuleName = "";
        sharedKey = false;
        moduleChoice = module;
        let first;
        try {
          first = await createNamedWorkspace(proxy, newName, { workspace_type: type, module, retention_days: retention });
        } catch (err) {
          await load();
          throw new Error(`Made the module ${module}, but its first assessment couldn't be made (${problemsOf(err).join(" ")}). The module is listed on Home; choose it below and try again.`);
        }
        const folder = first.path.split(/[\\/]/).pop()!;
        newName = "";
        return onOpen(await platform.openInModule(module, folder));
      }
      const registration = await createNamedWorkspace(proxy, newName, { workspace_type: type, ...(module ? { module } : {}), retention_days: retention });
      const folder = registration.path.split(/[\\/]/).pop()!;
      newName = "";
      onOpen(module ? await platform.openInModule(module, folder) : await platform.openInFolder(folder));
    });
  };

  const register = (event: SubmitEvent) => {
    event.preventDefault();
    return run(async () => {
      const registration = await proxy.registerWorkspace(registerPath.trim());
      registerPath = "";
      message = done(`Registered ${registration.path}. It is listed below; Continue asks you to choose its folder, or you can move it into the workspaces folder.`);
      await load();
    });
  };

  async function goNew(type: Exclude<Page, "home">) {
    moduleChoice = "";
    onPage(type);
    await tick();
    nameField?.focus();
  }

  // An assessment in a module is listed under its module, not here.
  const ofType = (type: WorkspaceType) => list?.workspaces.filter((w) => !w.problem && w.workspace_type === type && !w.module) ?? [];
  const modules = $derived(list?.workspaces.filter((w) => !w.problem && w.workspace_type === "module") ?? []);
  const assessmentsOf = (m: ListedWorkspace) => list?.workspaces.filter((w) => !w.problem && w.module === m.folder) ?? [];
  const lost = $derived(list?.workspaces.filter((w) => w.problem) ?? []);
  const started = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null);
  const ABOUT: Record<Exclude<Page, "home">, string> = {
    marking: "Mark a cohort's coursework against the rubric: the AI suggests levels if you want it to, you decide every mark, and it drafts feedback from your marks for you to edit and approve.",
    moderation: "Check a sample of a colleague's marking: mark each piece yourself, compare with the original marker and an independent AI reading, and record your verdicts.",
  };
</script>

{#snippet workspaces(type: WorkspaceType, withModules: boolean)}
  {@const items = ofType(type)}
  {@const grouped = !withModules ? [] : modules.filter((m) => assessmentsOf(m).some((w) => w.workspace_type === type))}
  {#if items.length || grouped.length}
    <ul class="work-list">
      {#each items as w (w.registration_id)}
        <li class="work">
          <h3>{w.name ?? w.folder}</h3>
          <p class="hint">Started {started(w.created_at)}; kept for {w.retention_days} days after the work is finished.</p>
          {#if !w.in_workspaces_folder}
            <p class="hint">Stored somewhere else, at <code>{w.path}</code>. {elsewhereNote(elsewhere[w.registration_id])}</p>
          {/if}
          <p class="progress">
            {progress[w.registration_id] ??
              (w.in_workspaces_folder && access === "granted"
                ? "Working out how far it has got…"
                : elsewhere[w.registration_id] === "none"
                  ? "Choose its folder to see how far it has got."
                  : "Continue to see how far it has got.")}
          </p>
          {#if canMove(w) && needsName(w)}
            <div class="fields">
              <label for={`move-name-${w.registration_id}`}>Its name in the workspaces folder</label>
              <p class="hint" id={`move-name-hint-${w.registration_id}`}>{nameProblemOf(w) ?? "Choose another name for it there."}</p>
              <input
                id={`move-name-${w.registration_id}`}
                type="text"
                value={nameOf(w)}
                oninput={(e) => (renameFor = { ...renameFor, [w.registration_id]: e.currentTarget.value })}
                autocomplete="off"
                aria-describedby={`move-name-hint-${w.registration_id}`}
              />
            </div>
          {/if}
          <div class="actions">
            {#if w.in_workspaces_folder}
              <button type="button" onclick={() => open(w)} aria-disabled={busy} aria-label={`Continue ${w.name ?? w.folder}`}>Continue</button>
            {:else}
              {@const label = continueLabel(elsewhere[w.registration_id])}
              <button type="button" onclick={() => open(w)} aria-disabled={busy} aria-label={`${label} ${w.name ?? w.folder}`}>{label}</button>
            {/if}
            {#if canMove(w)}
              <button type="button" onclick={() => move(w)} aria-disabled={busy} aria-label={`Move into the workspaces folder: ${w.name ?? w.folder}`}>Move into the workspaces folder</button>
            {/if}
          </div>
        </li>
      {/each}
      {#each grouped as m (m.registration_id)}
        <li class="work">
          <h3>{m.name ?? m.folder}</h3>
          <p class="hint">A module: its {type} {assessmentsOf(m).filter((w) => w.workspace_type === type).length === 1 ? "assessment is" : "assessments are"} here, and the module is on Home.</p>
          <ul class="work-list">
            {#each assessmentsOf(m).filter((w) => w.workspace_type === type) as w (w.registration_id)}
              <li class="work">
                <h4>{w.name ?? w.folder}</h4>
                <p class="progress">{progress[w.registration_id] ?? (access === "granted" ? "Working out how far it has got…" : "Continue to see how far it has got.")}</p>
                <button type="button" onclick={() => open(w)} aria-disabled={busy} aria-label={`Continue ${m.name ?? m.folder}: ${w.name ?? w.folder}`}>Continue</button>
              </li>
            {/each}
          </ul>
          <button type="button" onclick={() => open(m)} aria-disabled={busy} aria-label={`Open the module ${m.name ?? m.folder}`}>Open the module</button>
        </li>
      {/each}
    </ul>
  {:else if list}
    <p>No {type} yet.</p>
  {/if}
{/snippet}


{#snippet moduleList()}
  {#if modules.length}
    <ul class="work-list">
      {#each modules as m (m.registration_id)}
        <li class="work">
          <h3>{m.name ?? m.folder}</h3>
          <p class="hint">Started {started(m.created_at)}; kept for {m.retention_days} days after the work is finished.</p>
          <p class="progress">{progress[m.registration_id] ?? "Continue to see its assessments."}</p>
          {#if assessmentsOf(m).length}
            <ul class="work-list">
              {#each assessmentsOf(m) as w (w.registration_id)}
                <li class="work">
                  <h4>{w.name ?? w.folder}</h4>
                  <p class="hint">{w.workspace_type === "marking" ? "Marking" : "Moderation"}</p>
                  <p class="progress">{progress[w.registration_id] ?? (access === "granted" ? "Working out how far it has got…" : "Continue to see how far it has got.")}</p>
                  <button type="button" onclick={() => open(w)} aria-disabled={busy} aria-label={`Continue ${m.name ?? m.folder}: ${w.name ?? w.folder}`}>Continue</button>
                </li>
              {/each}
            </ul>
          {/if}
          <button type="button" onclick={() => open(m)} aria-disabled={busy} aria-label={`Open the module ${m.name ?? m.folder}`}>Open the module</button>
        </li>
      {/each}
    </ul>
  {:else if list}
    <p>No modules yet.</p>
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
        {@render workspaces(type, false)}
        <button type="button" onclick={() => goNew(type)}>{type === "marking" ? "New marking" : "New moderation"}</button>
      </section>
    {/each}
    <section aria-labelledby="modules-heading">
      <h2 id="modules-heading">Modules</h2>
      {@render moduleList()}
    </section>
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
      <p class="hint" id="new-name-hint">For example "CS101 2026". It names the folder: letters, digits, spaces, hyphens, underscores and full stops only.</p>
      <input id="new-name" type="text" bind:value={newName} bind:this={nameField} required autocomplete="off" aria-describedby="new-name-hint" />
      <fieldset class="group">
        <legend>Part of a module (optional)</legend>
        <p class="hint" id="new-module-hint">
          A module groups assessments, such as a report and a case study, and holds what they share: the brief, request document, anonymisation rules and, if you choose, the pseudonym key. Name this assessment for itself, such as "Report".
        </p>
        <label for="new-module">Module</label>
        <select id="new-module" bind:value={moduleChoice} aria-describedby="new-module-hint">
          <option value="">Not part of a module</option>
          {#each modules as m (m.registration_id)}<option value={m.folder}>{m.name ?? m.folder}</option>{/each}
          <option value={NEW_MODULE}>A new module…</option>
        </select>
        {#if moduleChoice === NEW_MODULE}
          <label for="new-module-name">The new module's name</label>
          <p class="hint" id="new-module-name-hint">For example "CS101 2026". It names the module's folder: letters, digits, spaces, hyphens, underscores and full stops only.</p>
          <input id="new-module-name" type="text" bind:value={newModuleName} required autocomplete="off" aria-describedby="new-module-name-hint" />
          <label class="check"><input type="checkbox" bind:checked={sharedKey} aria-describedby="shared-key-hint" /> Share one pseudonym key across the module's assessments</label>
          <p class="hint" id="shared-key-hint">
            A student keeps the same pseudonym in every assessment, so the module can follow them. The AI could then tell that different pieces of work are one student's, and one private file links the real people for the whole module. You choose now and can't change it later; leave it off unless you need it.
          </p>
        {/if}
      </fieldset>
      <details class="step-form options">
        <summary>Options</summary>
        <label for="retention">Keep for (days after the work is finished)</label>
        <p class="hint" id="retention-hint">How long you may keep the material, for example under your institution's terms. Feedbacker records this; deleting is up to you. An assessment in a module is kept as long as the module is.</p>
        <input id="retention" type="text" inputmode="numeric" bind:value={retentionDays} aria-describedby="retention-hint" />
      </details>
      <button type="submit" aria-disabled={busy}>{page === "marking" ? "Start the marking" : "Start the moderation"}</button>
    </form>
    {@render said()}
  </section>
  <section aria-labelledby="list-heading">
    <h2 id="list-heading">Your {page}</h2>
    {@render workspaces(page, true)}
  </section>
{/if}
