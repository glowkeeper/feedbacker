<script lang="ts">
  import TableRegion from "./TableRegion.svelte";
  import { confirmMarking, enterMarking, markingWithheld, importMarking, loadMarking, loadRequest, loadRubric, markingSummary, REQUEST, RUBRIC, type Workspace } from "../../core/index.ts";
  import { entryProblem, markingRecords, unmatchedCriteria, type MarkingRecord } from "../markingRecords.ts";
  import { fileSource } from "../../platform/fileSource.ts";
  import { inApp, parseMark, pointsFrom, problemsOf } from "../forms.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";
  import { asDone } from "../messages.ts";

  let { workspace, onChanged }: { workspace: Workspace; onChanged: () => void } = $props();

  let sample: { id: string; label: string }[] = $state([]);
  let records: MarkingRecord[] = $state([]);
  let files: FileList | null = $state(null);
  let criteria: { id: string; title: string }[] = $state([]); // the source rubric's, to match the marker's criteria to
  let matches: Record<string, string> = $state({}); // the marker's criterion name → the source criterion chosen for it
  const unmatched = $derived(unmatchedCriteria(records));
  let replace = $state(false);
  let busy = $state(false);
  let problems: string[] = $state([]);
  let notes: string[] = $state([]);
  let failed: string[] = $state([]); // sampled submissions whose marking couldn't be imported (the others were)
  let message: string | null = $state(null);
  let summary: { id: string; marker: string; lines: string[]; confirmed: boolean } | null = $state(null);
  let entryId = $state("");
  let entryMarker = $state("marker");
  let entryOverall = $state("");
  let entryMarks: Record<string, string> = $state({}); // a box per source criterion
  let entryComment = $state("");
  let entryReplace = $state(false);
  let heading: HTMLHeadingElement;
  let summaryHeading: HTMLHeadingElement | undefined = $state();

  async function refresh() {
    sample = (await workspace.exists(REQUEST)) ? (await loadRequest(workspace)).sample.map((s) => ({ id: s.submission_id, label: `${s.submission_id} ${s.pseudonym}` })) : [];
    records = await markingRecords(workspace);
    criteria = (await workspace.exists(RUBRIC)) ? (await loadRubric(workspace)).criteria.map((c) => ({ id: c.id, title: c.title })) : [];
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
    notes = failed = []; // the last import's notes and failures belong to it
    return run(async () => {
      const chosen = Object.fromEntries(Object.entries(matches).filter(([name, id]) => id && unmatched.includes(name)));
      const result = await importMarking(workspace, sources, { criteria: chosen, replace });
      summary = null;
      replace = false;
      matches = {};
      failed = [...result.failed].map(([id, why]) => `${id}: ${why}`);
      notes = [
        ...result.downloadWarnings,
        ...(result.unmapped.size
          ? [`The marker's criteria ${[...result.unmapped].map((n) => `'${n}'`).join(", ")} didn't match the source rubric. Match each under "Match the marker's criteria", then import again with "Replace marking already imported" ticked.`]
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
    if (busy) return; // the button stays focusable while busy (aria-disabled), so it must not act
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
      const marks = pointsFrom(entryMarks, new Map(criteria.map((c) => [c.id, c.title])));
      const marker = entryMarker.trim() || "marker";
      const problem = entryProblem(records, entryId, marker, { overall, criteria: marks.size, comment: entryComment }, entryReplace);
      if (problem) throw new Error(problem);
      await enterMarking(workspace, entryId, { markerLabel: marker, overall, criteria: marks, comment: entryComment.trim() || null });
      entryOverall = entryComment = "";
      entryMarks = {};
      entryReplace = false;
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

<Status message={asDone(message)} />
<Problems {problems} />
{#if notes.length}<Problems problems={notes} title="Please check (the marking was still imported):" kind="note" />{/if}
{#if failed.length}<Problems problems={failed} title="These couldn't be imported (the others were):" />{/if}

<section aria-labelledby="import-heading">
  <h2 id="import-heading">Import marked views</h2>
  <form onsubmit={submit}>
    <label for="views">Marked views (zips or single files)</label>
    <input id="views" type="file" multiple accept=".zip,.pdf" onchange={(e) => (files = (e.currentTarget as HTMLInputElement).files)} required />
    {#if unmatched.length}
      <fieldset class="matches">
        <legend>Match the marker's criteria</legend>
        <p class="hint">
          These of the marker's criteria, named as on the marking platform, didn't match your rubric, so their marks weren't imported. Choose the criterion of
          your rubric each one marks, then choose the marked views again, tick "Replace marking already imported" and import.
        </p>
        {#each unmatched as name, i (name)}
          <label for={`match-${i}`}>The marker's “{name}”</label>
          <select id={`match-${i}`} bind:value={matches[name]}>
            <option value="">Leave unmatched</option>
            {#each criteria as c (c.id)}<option value={c.id}>{c.title}</option>{/each}
          </select>
        {/each}
      </fieldset>
    {/if}
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
    <pre class="text" tabindex="0" aria-label={`The marking of ${summary.id}`}>{summary.lines.map(inApp).join("\n")}</pre>
    <button type="button" onclick={confirm} aria-disabled={busy || summary.confirmed}>{summary.confirmed ? "Confirmed" : "Confirm this marking"}</button>
  </section>
{/if}

{#if sample.length}
  <section aria-labelledby="enter-heading">
    <h2 id="enter-heading">Enter or correct marking by hand</h2>
    <p>
      Only for marking that has no marked view (for example a second marker's), or to correct a record. You don't need it to confirm imported marking: use
      "Check" above. A record entered by hand is confirmed as it is entered.
    </p>
    <form onsubmit={enter}>
      <label for="entry-id">Submission</label>
      <select id="entry-id" bind:value={entryId}>
        {#each sample as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
      </select>
      <label for="entry-marker">Marker (a role, never a name)</label>
      <input id="entry-marker" type="text" bind:value={entryMarker} />
      <label for="entry-overall">Overall mark (optional)</label>
      <input id="entry-overall" type="text" inputmode="decimal" bind:value={entryOverall} />
      {#if criteria.length}
        <fieldset>
          <legend>Marks by criterion (optional)</legend>
          <p class="hint">The mark given for each criterion of your rubric, as a number; leave a box empty for no mark.</p>
          <div class="per-criterion">
            {#each criteria as c, i (c.id)}
              <label for={`entry-mark-${i}`}>{c.title}</label>
              <input id={`entry-mark-${i}`} type="text" inputmode="decimal" bind:value={entryMarks[c.id]} />
            {/each}
          </div>
        </fieldset>
      {/if}
      <label for="entry-comment">Comment (optional; it is anonymised)</label>
      <textarea id="entry-comment" rows="2" bind:value={entryComment}></textarea>
      <label class="check"><input type="checkbox" bind:checked={entryReplace} /> Replace the existing record from this marker, if there is one (the old one is kept in the history)</label>
      <button type="submit" aria-disabled={busy}>Enter the marking</button>
    </form>
  </section>
{/if}
