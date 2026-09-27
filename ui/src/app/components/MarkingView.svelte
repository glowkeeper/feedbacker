<script lang="ts">
  import TableRegion from "./TableRegion.svelte";
  import { confirmMarking, enterMarking, markingWithheld, importMarking, loadMarking, loadRequest, markingSummary, REQUEST, type Workspace } from "../../core/index.ts";
  import { markingRecords, type MarkingRecord } from "../markingRecords.ts";
  import { fileSource } from "../../platform/fileSource.ts";
  import { parseMark, parsePairs, parsePoints, problemsOf } from "../forms.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";

  let { workspace, onChanged }: { workspace: Workspace; onChanged: () => void } = $props();

  let sample: { id: string; label: string }[] = $state([]);
  let records: MarkingRecord[] = $state([]);
  let files: FileList | null = $state(null);
  let mapping = $state("");
  let replace = $state(false);
  let busy = $state(false);
  let problems: string[] = $state([]);
  let notes: string[] = $state([]);
  let message: string | null = $state(null);
  let summary: { id: string; marker: string; lines: string[]; confirmed: boolean } | null = $state(null);
  let entryId = $state("");
  let entryMarker = $state("marker");
  let entryOverall = $state("");
  let entryPoints = $state("");
  let entryComment = $state("");
  let heading: HTMLHeadingElement;
  let summaryHeading: HTMLHeadingElement | undefined = $state();

  async function refresh() {
    sample = (await workspace.exists(REQUEST)) ? (await loadRequest(workspace)).sample.map((s) => ({ id: s.submission_id, label: `${s.submission_id} ${s.pseudonym}` })) : [];
    records = await markingRecords(workspace);
    entryId ||= sample[0]?.id ?? "";
  }

  $effect(() => {
    heading?.focus();
    refresh().catch((err) => (problems = problemsOf(err)));
  });
  let shown = $state(0); // bumped when a record is shown, to move focus to it; not when it is reloaded after confirming
  $effect(() => {
    if (shown) summaryHeading?.focus();
  });

  async function run(what: () => Promise<string>) {
    if (busy) return; // buttons stay enabled while busy, so focus isn't lost from them
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

  const summaryOf = async (id: string, marker: string) => {
    const withheld = await markingWithheld(workspace, id);
    if (withheld) throw new Error(withheld);
    return summaryLines(id, marker);
  };
  const summaryLines = async (id: string, marker: string) => ({
    id,
    marker,
    lines: await markingSummary(workspace, id, marker),
    confirmed: (await loadMarking(workspace, id, marker)).confirmed_at !== null,
  });

  async function show(id: string, marker: string) {
    problems = [];
    try {
      summary = await summaryOf(id, marker);
      shown += 1;
    } catch (err) {
      summary = null;
      problems = problemsOf(err);
    }
  }

  const confirm = () =>
    summary?.confirmed ||
    run(async () => {
      const { id, marker } = summary!;
      await confirmMarking(workspace, id, marker);
      summary = await summaryOf(id, marker);
      return `Confirmed the original marking of ${id} (${marker}).`;
    });

  const enter = (event: SubmitEvent) => {
    event.preventDefault();
    return run(async () => {
      const overall = parseMark(entryOverall, "the overall mark");
      const criteria = parsePoints(entryPoints);
      const marker = entryMarker.trim() || "marker";
      await enterMarking(workspace, entryId, { markerLabel: marker, overall, criteria, comment: entryComment.trim() || null });
      entryOverall = entryPoints = entryComment = "";
      summary = await summaryOf(entryId, marker); // show what was entered
      shown += 1;
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
    <button type="submit" aria-disabled={busy}>Import the marking</button>
  </form>
</section>

{#if sample.length}
  <section aria-labelledby="records-heading">
    <h2 id="records-heading">Check and confirm</h2>
    <TableRegion label="Marking records">
      <table>
        <caption>Each marker's record for each sampled submission</caption>
        <thead><tr><th scope="col">Submission</th><th scope="col">Marker</th><th scope="col">Marking</th><th scope="col"><span class="visually-hidden">Action</span></th></tr></thead>
        <tbody>
          {#each sample as s (s.id)}
            {@const own = records.filter((r) => r.submissionId === s.id)}
            {#if !own.length}
              <tr><th scope="row">{s.label}</th><td>—</td><td class="missing">Not yet</td><td></td></tr>
            {/if}
            {#each own as r (r.file)}
              <tr>
                <th scope="row">{s.label}</th>
                <td>{r.markerLabel ?? r.file}</td>
                <td class={r.problem ? "attention" : r.hidden ? "missing" : r.confirmed ? "done" : "attention"}>
                  {r.problem ? "Needs attention" : r.hidden ? "Hidden until the reveal (reviewed blind)" : r.confirmed ? "Confirmed" : "Not confirmed"}
                </td>
                <td>
                  <button type="button" onclick={() => show(s.id, r.markerLabel!)} disabled={r.problem !== null || r.hidden} aria-disabled={busy} aria-label={`Check the ${r.markerLabel ?? ""} marking of ${s.label}`}>Check</button>
                </td>
              </tr>
              {#if r.problem}<tr><td colspan="4" class="error">{s.label} ({r.file}): {r.problem}</td></tr>{/if}
            {/each}
          {/each}
        </tbody>
      </table>
    </TableRegion>
  </section>
{/if}

{#if summary}
  <section aria-labelledby="summary-heading">
    <h2 id="summary-heading" tabindex="-1" bind:this={summaryHeading}>The marking of {summary.id} ({summary.marker})</h2>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <pre class="text" tabindex="0" aria-label={`The marking of ${summary.id}`}>{summary.lines.join("\n")}</pre>
    <button type="button" onclick={confirm} aria-disabled={busy || summary.confirmed}>{summary.confirmed ? "Confirmed" : "Confirm this marking"}</button>
  </section>
{/if}

{#if sample.length}
  <section aria-labelledby="enter-heading">
    <h2 id="enter-heading">Enter or correct marking by hand</h2>
    <p>A record entered by hand is confirmed as it is entered. It replaces that marker's record; the old one is kept in the history.</p>
    <form onsubmit={enter}>
      <label for="entry-id">Submission</label>
      <select id="entry-id" bind:value={entryId}>
        {#each sample as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
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
      <button type="submit" aria-disabled={busy}>Enter the marking</button>
    </form>
  </section>
{/if}
