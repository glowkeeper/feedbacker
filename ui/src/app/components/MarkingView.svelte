<script lang="ts">
  import { confirmMarking, enterMarking, importMarking, loadMarking, loadRequest, markingPath, markingSummary, REQUEST, type Workspace } from "../../core/index.ts";
  import { fileSource } from "../../platform/fileSource.ts";
  import { parseMark, parsePairs, parsePoints, problemsOf } from "../forms.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";

  let { workspace, onChanged }: { workspace: Workspace; onChanged: () => void } = $props();

  interface Row {
    id: string;
    label: string;
    state: "none" | "unconfirmed" | "confirmed" | "problem";
    problem: string | null; // a record that doesn't load is shown with its problem
  }

  let rows: Row[] = $state([]);
  let files: FileList | null = $state(null);
  let mapping = $state("");
  let replace = $state(false);
  let busy = $state(false);
  let problems: string[] = $state([]);
  let notes: string[] = $state([]);
  let message: string | null = $state(null);
  let summary: { id: string; lines: string[]; confirmed: boolean } | null = $state(null);
  let entryId = $state("");
  let entryMarker = $state("marker");
  let entryOverall = $state("");
  let entryPoints = $state("");
  let entryComment = $state("");
  let heading: HTMLHeadingElement;
  let summaryHeading: HTMLHeadingElement | undefined = $state();

  async function refresh() {
    const sample = (await workspace.exists(REQUEST)) ? (await loadRequest(workspace)).sample : [];
    const next: Row[] = [];
    for (const s of sample) {
      const row: Row = { id: s.submission_id, label: `${s.submission_id} ${s.pseudonym}`, state: "none", problem: null };
      if (await workspace.exists(markingPath(s.submission_id))) {
        try {
          row.state = (await loadMarking(workspace, s.submission_id)).confirmed_at ? "confirmed" : "unconfirmed";
        } catch (err) {
          row.state = "problem";
          row.problem = problemsOf(err).join("; ");
        }
      }
      next.push(row);
    }
    rows = next;
    entryId ||= rows[0]?.id ?? "";
  }

  $effect(() => {
    heading?.focus();
    refresh().catch((err) => (problems = problemsOf(err)));
  });
  $effect(() => {
    if (summary) summaryHeading?.focus();
  });

  async function run(what: () => Promise<string>) {
    busy = true;
    problems = [];
    message = null;
    try {
      const done = await what();
      await refresh();
      onChanged();
      message = done; // announced once everything is updated
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      busy = false;
    }
  }

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (!files?.length) return;
    const sources = [...files].map(fileSource);
    return run(async () => {
      const result = await importMarking(workspace, sources, { criteria: Object.fromEntries(parsePairs(mapping, "MARKER_NAME=SOURCE_ID")), replace });
      summary = null;
      replace = false;
      notes = [
        ...result.downloadWarnings,
        ...[...result.failed].map(([id, why]) => `${id} couldn't be imported: ${why}`),
        ...(result.unmapped.size
          ? [`The marker's criteria ${[...result.unmapped].map((n) => `'${n}'`).join(", ")} didn't match the source rubric. Map each with MARKER_NAME=SOURCE_ID; the source IDs are ${result.sourceIds.join(", ")}.`]
          : []),
      ];
      return `Imported the marking for ${result.imported.length} sampled submission(s); ${result.ignoredCount} other file(s) were not opened. Check and confirm each record below.`;
    });
  };

  const summaryOf = async (id: string) => ({ id, lines: await markingSummary(workspace, id), confirmed: (await loadMarking(workspace, id)).confirmed_at !== null });

  async function show(id: string) {
    problems = [];
    try {
      summary = await summaryOf(id);
    } catch (err) {
      summary = null;
      problems = problemsOf(err);
    }
  }

  const confirm = () =>
    run(async () => {
      const id = summary!.id;
      await confirmMarking(workspace, id);
      summary = await summaryOf(id);
      return `Confirmed the original marking of ${id}.`;
    });

  const enter = (event: SubmitEvent) => {
    event.preventDefault();
    return run(async () => {
      const overall = parseMark(entryOverall, "the overall mark");
      const criteria = parsePoints(entryPoints);
      await enterMarking(workspace, entryId, { markerLabel: entryMarker.trim() || "marker", overall, criteria, comment: entryComment.trim() || null });
      entryOverall = entryPoints = entryComment = "";
      return `Entered the marking of ${entryId} (${entryMarker.trim() || "marker"}). Any record it replaced is kept in the history.`;
    });
  };
</script>

<h1 tabindex="-1" bind:this={heading}>Original marking</h1>
<p>
  Import the marker's marked views (for example Turnitin's GradeMark download). Each is matched to the sampled submission and mapped onto your source rubric;
  disagreements are noted, never corrected. Comments are anonymised. Marking is never sent to a model.
</p>

<Status {message} />
<Problems {problems} />
{#if notes.length}<Problems problems={notes} title="Please check:" />{/if}

<section aria-labelledby="import-heading">
  <h2 id="import-heading">Import marked views</h2>
  <form onsubmit={submit}>
    <label for="views">Marked views (zips or single files)</label>
    <input id="views" type="file" multiple accept=".zip,.pdf" onchange={(e) => (files = (e.currentTarget as HTMLInputElement).files)} required />
    <label for="mapping">Map the marker's criteria (optional)</label>
    <p class="hint" id="mapping-hint">One per line, as <code>MARKER_NAME=SOURCE_ID</code>, for criteria whose names don't match the source rubric.</p>
    <textarea id="mapping" rows="2" bind:value={mapping} aria-describedby="mapping-hint" spellcheck="false"></textarea>
    <label class="check"><input type="checkbox" bind:checked={replace} /> Replace marking already imported (the old records are kept in the history)</label>
    <button type="submit" disabled={busy}>Import the marking</button>
  </form>
</section>

{#if rows.length}
  <section aria-labelledby="records-heading">
    <h2 id="records-heading">Check and confirm</h2>
    <table>
      <caption>The original marking of each sampled submission</caption>
      <thead><tr><th scope="col">Submission</th><th scope="col">Marking</th><th scope="col"><span class="visually-hidden">Action</span></th></tr></thead>
      <tbody>
        {#each rows as row (row.id)}
          <tr>
            <th scope="row">{row.label}</th>
            <td class={row.state === "confirmed" ? "done" : row.state === "none" ? "missing" : "attention"}>
              {{ confirmed: "Confirmed", unconfirmed: "Not confirmed", none: "Not yet", problem: "Needs attention" }[row.state]}
            </td>
            <td><button type="button" onclick={() => show(row.id)} disabled={row.state === "none" || row.state === "problem" || busy} aria-label={`Check the marking of ${row.label}`}>Check</button></td>
          </tr>
          {#if row.problem}<tr><td colspan="3" class="error">{row.label}: {row.problem}</td></tr>{/if}
        {/each}
      </tbody>
    </table>
  </section>
{/if}

{#if summary}
  <section aria-labelledby="summary-heading">
    <h2 id="summary-heading" tabindex="-1" bind:this={summaryHeading}>The marking of {summary.id}</h2>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <pre class="text" tabindex="0" aria-label={`The marking of ${summary.id}`}>{summary.lines.join("\n")}</pre>
    <button type="button" onclick={confirm} disabled={busy || summary.confirmed}>{summary.confirmed ? "Confirmed" : "Confirm this marking"}</button>
  </section>
{/if}

{#if rows.length}
  <section aria-labelledby="enter-heading">
    <h2 id="enter-heading">Enter or correct marking by hand</h2>
    <p>A record entered by hand is confirmed as it is entered. It replaces that marker's record; the old one is kept in the history.</p>
    <form onsubmit={enter}>
      <label for="entry-id">Submission</label>
      <select id="entry-id" bind:value={entryId}>
        {#each rows as row (row.id)}<option value={row.id}>{row.label}</option>{/each}
      </select>
      <label for="entry-marker">Marker (a role, never a name)</label>
      <input id="entry-marker" type="text" bind:value={entryMarker} />
      <label for="entry-overall">Overall mark (optional)</label>
      <input id="entry-overall" type="text" inputmode="decimal" bind:value={entryOverall} />
      <label for="entry-points">Marks by criterion (optional)</label>
      <p class="hint" id="points-hint">One per line, as <code>SOURCE_ID=POINTS</code>.</p>
      <textarea id="entry-points" rows="3" bind:value={entryPoints} aria-describedby="points-hint" spellcheck="false"></textarea>
      <label for="entry-comment">Comment (optional; it is anonymised)</label>
      <textarea id="entry-comment" rows="2" bind:value={entryComment}></textarea>
      <button type="submit" disabled={busy}>Enter the marking</button>
    </form>
  </section>
{/if}
