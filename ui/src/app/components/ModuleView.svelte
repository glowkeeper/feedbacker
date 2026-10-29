<script lang="ts">
  import { tick } from "svelte";
  import {
    createNamedWorkspace,
    importBrief,
    loadBrief,
    loadModuleContext,
    loadRequestCohort,
    moderatedRows,
    moduleMarks,
    readRequestDocument,
    recordModuleContext,
    recordModuleRequest,
    showModuleMark,
    workspaceNameProblem,
    type Brief,
    type ListedWorkspace,
    type ModuleContext,
    type ModuleMarks,
    type RequestCohort,
    type RequestFindings,
    type Workspace,
  } from "../../core/index.ts";
  import { fileSource } from "../../platform/fileSource.ts";
  import { problemsOf } from "../forms.ts";
  import { done, type Message } from "../messages.ts";
  import type { AppProxy, Notice, Platform } from "../platform.ts";
  import { navigationFor, progressOf, progressText } from "../steps.ts";
  import DeleteWorkspace from "./DeleteWorkspace.svelte";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";
  import TableRegion from "./TableRegion.svelte";

  /**
   * A module (ADR 0010): the assessments it groups, and what they share, held once: the module's context, the request document
   * (read once, as a cohort with no names or IDs), the brief, and the anonymisation rules. With the request's weightings, it shows
   * each student's module mark at three levels.
   */
  let {
    workspace,
    platform,
    onOpen,
    onClose,
    onDeleted,
  }: { workspace: Workspace; platform: Platform; onOpen: (ws: Workspace) => void; onClose: () => void; onDeleted: (what: Notice) => void } = $props();

  const proxy: AppProxy = $derived(platform.proxy!);
  const name = $derived(workspace.manifest.name);

  let heading: HTMLHeadingElement | undefined = $state();
  let assessments = $state<ListedWorkspace[]>([]);
  let progress = $state<Record<string, string>>({});
  let opened = $state<Workspace[]>([]);
  let unread = $state<string[]>([]); // assessments that couldn't be opened, whose exports can't then be listed
  let cohort = $state<RequestCohort | null>(null);
  let context = $state<ModuleContext | null>(null);
  let brief = $state<Brief | null>(null);
  let marks = $state<ModuleMarks | null>(null);
  let marksNotes = $state<string[]>([]);
  let readProblem: string | null = $state(null);
  let deleting = $state(false);
  // What the module page shows: its assessments first, and the rest by name, one at a time (as a workspace shows one step at a time).
  const SECTIONS = [
    { id: "assessments", label: "Assessments" },
    { id: "shared", label: "Shared settings" },
    { id: "request", label: "Request document" },
    { id: "brief", label: "Brief" },
    { id: "marks", label: "Module marks" },
  ] as const;
  let section = $state<(typeof SECTIONS)[number]["id"]>("assessments");
  /** Open one of the module's sections, and say so by moving focus to its heading. */
  async function show(id: (typeof SECTIONS)[number]["id"]) {
    section = id;
    // A section's file chooser is gone with it, and what was chosen in it with the chooser: what is processed is what is shown.
    briefFile = null;
    documentFiles = null;
    await tick();
    document.getElementById(`${id}-heading`)?.focus();
  }

  let busy = $state(false);
  let message: Message | null = $state(null);
  let problems: string[] = $state([]);

  let newName = $state("");
  let newType = $state<"moderation" | "marking">("moderation");
  let documentFiles: FileList | null = $state(null);
  let findings = $state<RequestFindings | null>(null);
  let briefFile: File | null = $state(null);
  let programme = $state("");
  let moduleTitle = $state("");

  $effect(() => {
    document.title = `${deleting ? "Delete this module" : name} – Feedbacker`;
    heading?.focus();
  });

  let reads = 0; // a later reading wins
  const parentOf = (path: string) => path.replace(/[\\/][^\\/]*$/, "");

  /** Reads the module and its assessments again; whether it all could be read, so a caller that needs the whole inventory can tell. */
  async function load(): Promise<boolean> {
    const read = ++reads;
    try {
      // Its assessments are the registered workspaces inside its folder, by where they are: one whose manifest can't be read has no module to name.
      const inside = (await proxy.listWorkspaces()).workspaces.filter((w) => parentOf(w.path) === workspace.registration.path);
      const listed = inside.filter((w) => w.module === name && !w.problem);
      const damaged = inside.filter((w) => w.problem || w.module !== name).map((w) => w.name ?? w.folder);
      const [c, ctx, b] = await Promise.all([loadRequestCohort(workspace), loadModuleContext(workspace), workspace.exists("brief.json").then((has) => (has ? loadBrief(workspace) : null))]);
      if (read !== reads) return false;
      assessments = listed;
      cohort = c;
      context = ctx;
      brief = b;
      programme = ctx?.programme ?? "";
      moduleTitle = ctx?.module ?? "";
      readProblem = null;
      await openAssessments(listed, c, read, damaged);
      return read === reads;
    } catch (err) {
      if (read === reads) readProblem = problemsOf(err).join(" ");
      return false;
    }
  }
  $effect(() => {
    void load();
  });

  /** Open each assessment, as its progress and the moderator's marks need, one at a time. */
  async function openAssessments(listed: ListedWorkspace[], c: RequestCohort | null, read: number, damaged: string[]) {
    const open: Workspace[] = [];
    const unopened: string[] = [...damaged];
    const merged = new Map<string, number | null>();
    const notes: string[] = [];
    for (const w of listed) {
      try {
        const ws = await platform.openInModule(name, w.folder);
        open.push(ws);
        const navigation = navigationFor(ws);
        if (read === reads) progress = { ...progress, [w.registration_id]: progressText(progressOf(navigation.entries, await navigation.states(ws))) };
        if (c) {
          const rows = await moderatedRows(ws, c);
          for (const [k, v] of rows.marks) merged.set(k, v);
          notes.push(...rows.notes);
        }
      } catch (err) {
        unopened.push(w.name ?? w.folder);
        notes.push(`${w.name ?? w.folder} couldn't be read: ${problemsOf(err).join(" ")}`);
        if (read === reads) progress = { ...progress, [w.registration_id]: "Its progress couldn't be read." };
      }
    }
    if (read !== reads) return;
    opened = open;
    unread = unopened;
    marks = c ? moduleMarks(c, merged) : null;
    marksNotes = notes;
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

  const addAssessment = (event: SubmitEvent) => {
    event.preventDefault();
    return run(async () => {
      const problem = workspaceNameProblem(newName);
      if (problem) throw new Error(problem);
      const made = await createNamedWorkspace(proxy, newName, { workspace_type: newType, module: name });
      message = done(`Made the assessment ${newName.trim()} in ${name} (${made.path}).`);
      newName = "";
      await load();
    });
  };

  const readDocument = (event: SubmitEvent) => {
    event.preventDefault();
    return run(async () => {
      const file = documentFiles?.[0];
      if (!file) throw new Error("Choose the request document first.");
      findings = await readRequestDocument(file.name, new Uint8Array(await file.arrayBuffer()));
      if (!findings.cohort.length) {
        const flags = findings.flags;
        findings = null;
        throw new Error(`The document lists no students, so there is no cohort to keep.${flags.length ? ` ${flags.join(" ")}` : ""}`);
      }
      message = done("Read the request document. Check what it found below, then keep it in the module; nothing is kept until you do.");
    });
  };

  const keepDocument = () =>
    run(async () => {
      if (!findings) return;
      await recordModuleRequest(workspace, findings);
      findings = null;
      message = done("Kept the cohort in the module: every assessment's marks and weighting, and which rows are one student. No name or ID is kept.");
      await load();
    });

  const saveContext = (event: SubmitEvent) => {
    event.preventDefault();
    return run(async () => {
      await recordModuleContext(workspace, { programme, module: moduleTitle });
      message = done("Saved the module's context.");
      await load();
    });
  };

  const importModuleBrief = (event: SubmitEvent) => {
    event.preventDefault();
    return run(async () => {
      if (!briefFile) throw new Error("Choose the brief first.");
      const imported = await importBrief(workspace, fileSource(briefFile), { replace: brief !== null });
      message = done(`Imported the brief (${imported.source_format}, ${imported.extract.blocks.length} blocks of text) into the module. Each assessment takes it from its own Brief step and chooses its section.`);
      await load();
    });
  };

  const cell = (m: { initial: number | null; internal: number | null; moderator: number | null; submitted: boolean } | undefined) =>
    !m ? "Not listed" : !m.submitted ? "No submission" : `${showModuleMark(m.initial)} · ${showModuleMark(m.internal)} · ${showModuleMark(m.moderator)}`;

  /** Read the assessments again first, so every export that would be deleted is listed, whenever delete is pressed. */
  async function startDelete() {
    if (busy) return;
    busy = true;
    problems = [];
    message = null;
    let read = false;
    try {
      read = await load();
    } finally {
      busy = false;
    }
    // Only with every assessment's exports checked just now: an inventory that failed or is out of date could hide exports that deleting would remove.
    if (!read) {
      problems = [`The module couldn't be read just now${readProblem ? ` (${readProblem})` : ""}, so its assessments' exports can't be listed and deleting isn't offered. Put that right, then try again.`];
      return;
    }
    deleting = true;
    await tick();
  }
</script>

{#if deleting}
  <DeleteWorkspace {workspace} also={opened} {unread} {onDeleted} />
{:else}
  <div class="workspace-head">
    <p class="where">Module <strong>{name}</strong> at <code>{workspace.registration.path}</code></p>
    <p>
      <button type="button" onclick={onClose}>Close this module</button>
      <button type="button" onclick={startDelete}>Delete this module…</button>
    </p>
  </div>

  <h1 tabindex="-1" bind:this={heading}>{name}</h1>
  <p>
    A module groups its assessments and holds once what they share. Each assessment is a marking or a moderation of its own, with its own rubric, sample,
    downloads and record.
  </p>
  {#if readProblem}<p class="error">The module couldn't be read: {readProblem}</p>{/if}
  <Status {message} />
  <Problems {problems} />

  <div class="workspace-bar">
    <nav aria-label="The module's sections">
      <ol class="steps-nav">
        {#each SECTIONS as s (s.id)}
          <li class="step"><button type="button" aria-current={section === s.id ? "page" : undefined} onclick={() => show(s.id)}>{s.label}</button></li>
        {/each}
      </ol>
    </nav>
  </div>

  {#if section === "assessments"}
  <section aria-labelledby="assessments-heading">
    <h2 id="assessments-heading" tabindex="-1">Assessments</h2>
    {#if assessments.length}
      <ul class="work-list">
        {#each assessments as w (w.registration_id)}
          <li class="work">
            <h3>{w.name ?? w.folder}</h3>
            <p class="hint">{w.workspace_type === "marking" ? "Marking" : "Moderation"}</p>
            <p class="progress">{progress[w.registration_id] ?? "Working out how far it has got…"}</p>
            <button
              type="button"
              aria-disabled={busy}
              aria-label={`Continue ${w.name ?? w.folder}`}
              onclick={() => run(async () => onOpen(await platform.openInModule(name, w.folder)))}>Continue</button
            >
          </li>
        {/each}
      </ul>
    {:else}
      <p>No assessments yet.</p>
    {/if}
    <form onsubmit={addAssessment}>
      <h3>Add an assessment</h3>
      <label for="assessment-name">Name</label>
      <p class="hint" id="assessment-name-hint">For example "Report". It names the assessment's folder in the module, so letters, digits, spaces, hyphens, underscores and full stops only.</p>
      <input id="assessment-name" type="text" bind:value={newName} required autocomplete="off" aria-describedby="assessment-name-hint" />
      <label for="assessment-type">What it is for</label>
      <select id="assessment-type" bind:value={newType}>
        <option value="moderation">Moderation: check a sample of a colleague's marking</option>
        <option value="marking">Marking: mark a cohort's coursework</option>
      </select>
      <button type="submit" aria-disabled={busy}>Add the assessment</button>
    </form>
  </section>
  {:else if section === "shared"}
  <section aria-labelledby="shared-heading">
    <h2 id="shared-heading" tabindex="-1">What the assessments share</h2>
    <dl class="steps">
      <dt>Anonymisation rules</dt>
      <dd class="done">Shared. A name or value you ask to be redacted in one assessment is redacted in every one.</dd>
      <dt>Pseudonym key</dt>
      <dd class={workspace.manifest.shared_key ? "attention" : ""}>
        {workspace.manifest.shared_key
          ? "Shared. A student is the same pseudonym in every assessment, so the AI could tell that work is one student's across them, and one private file links the real people for the whole module. This was chosen when the module was made and can't be changed."
          : "Separate for each assessment. A pseudonym is the same student only within one assessment. This was chosen when the module was made and can't be changed."}
      </dd>
    </dl>
  </section>

  <section aria-labelledby="context-heading">
    <h2 id="context-heading">The module's context</h2>
    <form onsubmit={saveContext}>
      <label for="module-programme">Programme</label>
      <input id="module-programme" type="text" bind:value={programme} autocomplete="off" />
      <label for="module-title">Module</label>
      <input id="module-title" type="text" bind:value={moduleTitle} autocomplete="off" />
      <button type="submit" aria-disabled={busy}>Save the context</button>
    </form>
    <p class="hint">{context ? "Each assessment's request starts from these." : "None is recorded yet; reading the request document fills them in."}</p>
  </section>

  {:else if section === "request"}
  <section aria-labelledby="request-heading">
    <h2 id="request-heading" tabindex="-1">The request document</h2>
    <p>
      The document lists every assessment's cohort with its marks and weighting. Read it once here: the module keeps each assessment's marks and weighting, and
      which rows are one student, but no name and no ID. Each assessment reads the same document again to tick its sample, and is checked against this one.
    </p>
    {#if cohort}
      <dl class="steps">
        <dt>Kept</dt>
        <dd class="done">
          {cohort.assessments.map((a) => `${a.assessment}: ${a.rows.length} student(s)${a.weight === null ? ", no weighting given" : ""}`).join("; ")}; {cohort.links.length} student(s) in more than
          one assessment
        </dd>
      </dl>
    {/if}
    <form onsubmit={readDocument}>
      <label for="module-request-document">{cohort ? "Read the request document again" : "Request document (docx or pdf)"}</label>
      <input id="module-request-document" type="file" accept=".docx,.pdf" onchange={(e) => (documentFiles = (e.currentTarget as HTMLInputElement).files)} />
      <button type="submit" aria-disabled={busy}>Read the document</button>
    </form>
    {#if findings}
      <h3>What it found</h3>
      <ul>
        {#each [...new Set(findings.cohort.map((r) => r.assessment))] as a (a)}
          {@const rows = findings.cohort.filter((r) => r.assessment === a)}
          <li>{a}: {rows.length} student(s), {rows.filter((r) => r.submitted).length} who submitted</li>
        {/each}
      </ul>
      {#if findings.flags.length}<Problems problems={findings.flags} title="Please check:" kind="note" />{/if}
      <button type="button" aria-disabled={busy} onclick={keepDocument}>{cohort ? "Replace the module's cohort with this" : "Keep this cohort in the module"}</button>
    {/if}
  </section>

  {:else if section === "brief"}
  <section aria-labelledby="brief-heading">
    <h2 id="brief-heading" tabindex="-1">The brief</h2>
    <p>Import the brief once, whole. Each assessment takes it from its own Brief step and chooses its section: only that is anonymised, approved and sent.</p>
    {#if brief}<p class="done">Imported ({brief.source_format}, {brief.extract.blocks.length} blocks of text).</p>{/if}
    <form onsubmit={importModuleBrief}>
      <label for="module-brief-file">{brief ? "Replace the brief" : "Brief (docx or pdf)"}</label>
      <input id="module-brief-file" type="file" accept=".docx,.pdf" onchange={(e) => (briefFile = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)} />
      <button type="submit" aria-disabled={busy}>Import the brief</button>
    </form>
  </section>

  {:else if section === "marks"}
  <section aria-labelledby="marks-heading">
    <h2 id="marks-heading" tabindex="-1">Module marks</h2>
    {#if marks}
      <p>
        Each cell gives the original marker's mark, the internal moderator's (after the partner's internal moderation) and yours, in that order. A module mark is each
        assessment's mark weighted by what it is worth, and is worked out only for a student with a mark in every assessment at that level. So the first two are
        filled for the whole cohort that submitted everything, and yours only for the students you have marked in every assessment. These are figures for you to
        read, never marks given.
      </p>
      <ul>
        {#each marks.assessments as a (a.name)}<li>{a.name}: {a.weight === null ? "no weighting given" : `worth ${a.weight}%`}</li>{/each}
      </ul>
      {#if marks.notes.length || marksNotes.length}<Problems problems={[...marks.notes, ...marksNotes]} title="Please note:" kind="note" />{/if}
      <TableRegion label="Module marks by student">
        <table>
          <caption>Each student's marks (original · internal moderator · yours) and module mark; no name or ID is held</caption>
          <thead>
            <tr>
              <th scope="col">Student</th>
              {#each marks.assessments as a (a.name)}<th scope="col">{a.name}</th>{/each}
              <th scope="col">Module mark: original marker</th>
              <th scope="col">Module mark: internal moderator</th>
              <th scope="col">Module mark: yours</th>
            </tr>
          </thead>
          <tbody>
            {#each marks.students as s (s.label)}
              <tr>
                <th scope="row">{s.label}</th>
                {#each marks.assessments as a (a.name)}<td>{cell(s.marks.get(a.name))}</td>{/each}
                <td>{showModuleMark(s.module.initial)}</td>
                <td>{showModuleMark(s.module.internal)}</td>
                <td>{showModuleMark(s.module.moderator)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </TableRegion>
    {:else}
      <p>Read the request document (under Request document), and the module will show each student's marks and module mark.</p>
    {/if}
  </section>
  {/if}
{/if}
