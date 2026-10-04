<script lang="ts">
  import { importCohort, type Workspace } from "../../core/index.ts";
  import { fileSource } from "../../platform/fileSource.ts";
  import { problemsOf } from "../forms.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";
  import { asDone } from "../messages.ts";
  import { originalsRecorded, type OriginalRow } from "../recorded.ts";
  import type { StepState } from "../steps.ts";
  import StepScreen from "./StepScreen.svelte";
  import TableRegion from "./TableRegion.svelte";

  let { workspace, step, onChanged }: { workspace: Workspace; step: StepState | undefined; onChanged: () => void | Promise<void> } = $props();

  let files: FileList | null = $state(null);
  let replace = $state(false);
  let busy = $state(false);
  let problems: string[] = $state([]);
  let left: string[] = $state([]);
  let failed: [string, string][] = $state([]);
  let message: string | null = $state(null);
  let rows: OriginalRow[] = $state([]);
  let readProblem: string | null = $state(null);
  let screen: StepScreen;

  $effect(() => {
    read();
  });

  async function read() {
    try {
      rows = await originalsRecorded(workspace);
      readProblem = null;
    } catch (err) {
      rows = [];
      readProblem = err instanceof Error ? err.message : String(err);
    }
  }

  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!files?.length) return;
    if (busy) return; // the button stays enabled while busy, so focus isn't lost from it
    busy = true;
    problems = [];
    left = [];
    failed = [];
    message = null;
    try {
      const result = await importCohort(workspace, [...files].map(fileSource), { replace });
      replace = false;
      await onChanged(); // the status is read again, so it changes with what is recorded
      await read();
      // Everything changes together: the messages and what is recorded appear, and focus moves to it.
      failed = [...result.failed];
      left = result.notImported;
      message =
        `Imported ${count(result.imported.length, "submission", "submissions")}` +
        (result.imported.length ? ` (${result.imported.map((s) => `${s.id} ${s.pseudonym}`).join(", ")})` : "") +
        (result.kept ? `; ${count(result.kept, "submission was", "submissions were")} already imported, and kept as they were` : "") +
        (result.ignoredCount ? `; ${count(result.ignoredCount, "download report was", "download reports were")} not opened` : "") +
        ".";
      await screen.shown();
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      busy = false;
    }
  }
</script>

<StepScreen
  bind:this={screen}
  title="The cohort's submissions"
  {step}
  recorded={rows.length > 0}
  complete={rows.length > 0 && rows.every((r) => r.imported && !r.problem)}
  change="Import more submissions"
>
  {#snippet how()}
    <p>
      Choose the marking platform's bulk download of the students' own files: its zips, or single files as the platform names them, docx or pdf. Every
      submission in it is imported. Its text is extracted on this computer, and it gets a pseudonym. The student's ID and name are read from the file's
      name and kept in the private pseudonym key; the ID is shown on this screen only, so you can match each pseudonym to the student in the
      platform. A file whose name doesn't carry an ID is
      listed, not guessed at.
    </p>
    <p>Importing again adds the submissions that are new, such as late ones, and everyone keeps their pseudonym.</p>
  {/snippet}
  {#snippet messages()}
    <Status message={asDone(message)} />
    <Problems {problems} />
    {#if left.length}
      <Problems problems={left} title="These files weren't imported (the others were):" />
    {/if}
    {#if failed.length}
      <Problems problems={failed.map(([id, why]) => `${id}: ${why}`)} title="These couldn't be imported (the others were):" />
    {/if}
    {#if readProblem}<Problems problems={[readProblem]} title="The cohort can't be read:" />{/if}
  {/snippet}
  {#snippet record()}
    <TableRegion label="The cohort's submissions">
      <table>
        <caption>Each submission in the cohort, its real ID (shown only here), and what extracting its text found</caption>
        <thead>
          <tr><th scope="col">Submission</th><th scope="col">Real ID</th><th scope="col">File</th><th scope="col">Format</th><th scope="col">Warnings</th></tr>
        </thead>
        <tbody>
          {#each rows as row (row.id)}
            <tr>
              <th scope="row">{row.id} {row.pseudonym}</th>
              <td>{row.realId ?? "Not in the key"}</td>
              <td class={row.problem ? "attention" : row.imported ? "done" : "missing"}>{row.problem ? `Can't be read: ${row.problem}` : row.imported ? "Imported" : "Not yet"}</td>
              <td>{row.format ?? "—"}</td>
              <td class={row.warnings.length ? "attention" : ""}>{row.warnings.length ? row.warnings.join("; ") : "None"}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </TableRegion>
  {/snippet}
  {#snippet actions()}
    <form onsubmit={submit}>
      <label for="cohort-files">Downloads and files</label>
      <input id="cohort-files" type="file" multiple accept=".zip,.docx,.pdf" onchange={(e) => (files = (e.currentTarget as HTMLInputElement).files)} required />
      <label class="check"><input type="checkbox" bind:checked={replace} /> Replace submissions already imported</label>
      <button type="submit" aria-disabled={busy}>Import the submissions</button>
    </form>
  {/snippet}
</StepScreen>
