<script lang="ts">
  import { confirmMatches, proposeMatches, type Proposals, type Workspace } from "../../core/index.ts";
  import { fileSource } from "../../platform/fileSource.ts";
  import { problemsOf } from "../forms.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";
  import { asDone } from "../messages.ts";
  import TableRegion from "./TableRegion.svelte";

  let { workspace, files, onConfirmed }: { workspace: Workspace; files: File[]; onConfirmed: () => void | Promise<void> } = $props();

  let found = $state<Proposals | null>(null);
  let picks: Record<string, string> = $state({}); // pseudonym -> the file chosen for them ("" for none)
  let busy = $state(false);
  let problems: string[] = $state([]);
  let message: string | null = $state(null);

  const STATUS = { matched: "Matched by name", none: "No file has this name", several: "More than one file could be theirs", "no-name": "The request gave no name" } as const;

  async function find() {
    if (busy) return; // the button stays enabled while busy, so focus isn't lost from it
    problems = [];
    message = null;
    if (!files.length) {
      problems = ["Choose the downloads, or a folder of them, first."];
      return;
    }
    busy = true;
    try {
      found = await proposeMatches(workspace, files.map(fileSource));
      picks = Object.fromEntries(found.proposals.map((p) => [p.pseudonym, p.file ?? ""]));
      if (!found.proposals.length) message = "Every sampled student's ID is already found in these files; there is nothing to match.";
    } catch (err) {
      found = null;
      problems = problemsOf(err);
    } finally {
      busy = false;
    }
  }

  async function confirm() {
    if (busy || !found) return;
    const chosen = Object.entries(picks).filter(([, fileName]) => fileName);
    if (!chosen.length) {
      problems = ["Choose a file for at least one student first."];
      return;
    }
    busy = true;
    problems = [];
    try {
      await confirmMatches(workspace, chosen.map(([pseudonym, fileName]) => ({ pseudonym, fileName })), { replace: true });
      message = `Recorded ${chosen.length} match(es). Import the files again now: the students are found by the IDs in the files you chose.`;
      found = null;
      await onConfirmed();
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      busy = false;
    }
  }

  /** The files a student's row offers: the one their name matched, then the files nobody has. */
  const optionsFor = (file: string | null) => [...new Set([...(file ? [file] : []), ...(found?.free.map((f) => f.fileName) ?? [])])];
</script>

<section aria-labelledby="match-heading">
  <h2 id="match-heading">Students not found by their ID</h2>
  <p class="hint" id="match-hint">
    When the request's student IDs aren't in the files' names, match the students to the files by name. The names are compared on this computer, from
    the file names only. A name matches only when exactly one file has it; anything else you choose by hand. Nothing is recorded until you confirm.
  </p>
  <button type="button" onclick={find} aria-disabled={busy} aria-describedby="match-hint">Match the students by name</button>
  <Status message={asDone(message)} />
  <Problems {problems} />
  {#if found && found.proposals.length}
    <TableRegion label="The students to match">
      <table>
        <caption>The sampled students whose ID is in no file name, and the file for each (real names, shown on this screen only)</caption>
        <thead>
          <tr><th scope="col">Student</th><th scope="col">Name on the request</th><th scope="col">Result</th><th scope="col">File</th></tr>
        </thead>
        <tbody>
          {#each found.proposals as p (p.pseudonym)}
            <tr>
              <th scope="row">{p.pseudonym}</th>
              <td>{p.formName ?? "—"}</td>
              <td class={p.status === "matched" ? "done" : "attention"}>{STATUS[p.status]}</td>
              <td>
                <label class="visually-hidden" for={`match-${p.pseudonym}`}>File for {p.pseudonym}</label>
                <select id={`match-${p.pseudonym}`} bind:value={picks[p.pseudonym]}>
                  <option value="">Not matched</option>
                  {#each optionsFor(p.file) as name (name)}<option value={name}>{name}</option>{/each}
                </select>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </TableRegion>
    <button type="button" onclick={confirm} aria-disabled={busy}>Confirm these matches</button>
  {/if}
</section>
