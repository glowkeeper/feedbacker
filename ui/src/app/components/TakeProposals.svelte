<script lang="ts">
  /**
   * Taking the AI's proposed levels for many submissions in one action, by exception (ADR 0016): the list of what can be taken, each submission's proposed
   * level for every criterion with the AI's reasons, the provisional mark, and the criteria left for the educator; the confirmation that the list was
   * read, tied to what was listed; and the one action. Nothing is recorded until the educator confirms and presses the button.
   */
  import { tick } from "svelte";
  import { proposalsToTake, takeProposals, type NotTaken, type ProposedSubmission, type Workspace } from "../../core/index.ts";
  import { pyFormatG } from "../../core/pytext.ts";
  import { problemsOf } from "../forms.ts";
  import { proposalGroups } from "../notListed.ts";
  import { asDone } from "../messages.ts";
  import NotListedSummary from "./NotListedSummary.svelte";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";
  import TableRegion from "./TableRegion.svelte";
  import Waiting from "./Waiting.svelte";

  let { workspace, onChanged, onOpen }: { workspace: Workspace; onChanged: () => void | Promise<void>; onOpen: (id: string) => void } = $props();

  const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  let ready: ProposedSubmission[] = $state([]);
  let notTaken: NotTaken[] = $state([]);
  let loaded = $state(false); // until the first read is done, nothing is said of what can be taken
  let busy = $state(false);
  let message: string | null = $state(null);
  let problems: string[] = $state([]);
  let heading: HTMLHeadingElement | undefined = $state();

  // The educator's confirmation that they read the list: those submissions as they were listed, by digest. It lapses when they change.
  let confirmed: Record<string, string> | null = $state(null); // that they read the list
  const listed = $derived(Object.fromEntries(ready.map((r) => [r.id, r.digest])));
  $effect(() => {
    if (confirmed !== null && JSON.stringify(confirmed) !== JSON.stringify(listed)) confirmed = null;
  });
  const flagged = $derived(ready.filter((r) => r.left.length).length);
  // What the educator gives each criterion the AI proposed no level for, by submission and criterion (the level's id); nothing unless they say so.
  let fill: Record<string, Record<string, string>> = $state({});
  const suggestions = $derived(ready.flatMap((r) => r.left.filter((l) => l.suggestion !== null).map((l) => ({ id: r.id, criterionId: l.criterionId, levelId: l.suggestion!.levelId }))));
  const setFill = (id: string, criterionId: string, levelId: string) => {
    fill[id] = { ...(fill[id] ?? {}), [criterionId]: levelId };
  };
  /** Choose, for every criterion with no proposal that has a suggestion, the level suggested; each can be changed after. */
  const useSuggestions = () => {
    for (const s of suggestions) setFill(s.id, s.criterionId, s.levelId);
  };
  // A criterion the AI proposed no level for in every submission listed (often what is in figures that were left out): said once, and not for each of them.
  const sharedLeft = $derived.by(() => {
    if (ready.length < 2) return [];
    return ready[0].left.filter((l) => ready.every((r) => r.left.some((x) => x.criterionId === l.criterionId)));
  });
  const flaggedBeyondShared = $derived(ready.filter((r) => r.left.some((l) => !sharedLeft.some((s) => s.criterionId === l.criterionId))).length);
  const titles = (items: { title: string }[]) => (items.length === 1 ? items[0].title : `${items.slice(0, -1).map((i) => i.title).join(", ")} and ${items.at(-1)!.title}`);
  /** Why a submission has no provisional mark: a criterion has no proposal. */
  const noMarkWhy = (r: ProposedSubmission) =>
    r.left.length && r.left.every((l) => fill[r.id]?.[l.criterionId])
      ? "Worked out from every level, when taken"
      : r.left.length
        ? `Not worked out: ${titles(r.left)} ${r.left.length === 1 ? "has" : "have"} no proposed level`
        : "Not worked out";

  async function read() {
    try {
      const found = await proposalsToTake(workspace);
      ready = found.ready;
      notTaken = found.notTaken;
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      loaded = true;
    }
  }
  $effect(() => {
    void read();
  });

  async function take() {
    if (busy) return; // the button stays focusable while busy, so focus isn't lost from it
    busy = true;
    problems = [];
    message = null;
    try {
      const filled = Object.fromEntries(Object.entries(fill).map(([id, byCriterion]) => [id, Object.fromEntries(Object.entries(byCriterion).filter(([, level]) => level !== ""))]));
      const result = await takeProposals(workspace, { read: confirmed ? { ...confirmed } : null, filled });
      confirmed = null;
      fill = {};
      await onChanged(); // the step's status is read again, with what is now recorded
      await read();
      const left = result.skipped.map((s) => `${s.label}: ${s.why}`);
      const given = result.filled.accepted + result.filled.chosen;
      message =
        `Took the proposals of ${count(result.taken.length, "submission")} of ${result.size} listed` +
        (result.flagged ? `, ${count(result.flagged, "of them has", "of them have")} a criterion the AI proposed no level for` : "") +
        (given ? `; ${count(result.filled.accepted, "level")} accepted as suggested from the other criteria and ${count(result.filled.chosen, "level")} chosen by you were recorded for those` : "") +
        `.${left.length ? ` Not taken: ${left.join("; ")}.` : ""} Each mark taken says so in the record, and Export asks you to open each submission before it can be approved in a set.`;
    } catch (err) {
      problems = problemsOf(err);
      await read(); // what is listed may be why it failed: show what there is now
    } finally {
      busy = false;
    }
    await tick();
    if (!ready.length) heading?.focus(); // the last of them was taken, and the button went: focus goes to the heading, not lost
  }
</script>

<section aria-labelledby="take-heading">
  <h2 id="take-heading" tabindex="-1" bind:this={heading}>Take the AI's proposals for many at once</h2>
  {#if !loaded}
    <p>Reading what can be taken…</p>
  {:else if ready.length}
    <p>
      {count(ready.length, "submission")} {ready.length === 1 ? "has" : "have"} an AI proposal that can be taken as your marks, after you have looked at them. The list shows each proposed level, and the
      AI's reasons if you open them, with the provisional mark the levels imply. {#if sharedLeft.length}Every submission listed has no proposed level for {titles(sharedLeft)}: the AI found too little evidence, which can happen when what it needs is in figures that were left out. That is never taken, and is yours to mark.
      {flaggedBeyondShared ? `${count(flaggedBeyondShared, "submission")} ${flaggedBeyondShared === 1 ? "has" : "have"} another criterion the AI proposed no level for as well. ` : ""}{:else if flagged}{count(flagged, "submission")} {flagged === 1 ? "has" : "have"} a criterion the AI proposed no level for: that one is never taken, and is yours to mark. {/if}
      For a criterion the AI proposed no level for, you can choose one in the list. Where there are enough other criteria, a level is suggested from them: it is not from the work and not from the AI, only
      what the levels proposed for the others average, and it is used only if you choose it ("Use the suggestions for all" chooses every one, and each can be changed). Read the list, tick that you have,
      and take them in one action. Each mark taken is recorded as yours, taken from the AI's proposal, or accepted as suggested from the other criteria, in a set, and says so; a level you choose yourself is recorded as
      yours. The overall mark is the one the levels imply, and is taken only where every criterion has a level. A proposal is never a mark until you take it. Nothing is released: at Export you read what each student
      will receive, in full, and approve it, so a submission with marks taken this way needs no separate opening. Open a submission to mark it yourself instead, or to change anything taken; recording a mark
      again ends its being marked as taken.
    </p>
    <TableRegion label="Proposals that can be taken">
      <table>
        <caption>Each submission whose proposals can be taken, with the level proposed for each criterion, the provisional mark, and what is left for you</caption>
        <thead>
          <tr><th scope="col">Submission</th><th scope="col">Levels proposed</th><th scope="col">Provisional mark</th><th scope="col">Left for you</th><th scope="col"><span class="visually-hidden">Open it</span></th></tr>
        </thead>
        <tbody>
          {#each ready as r (r.id)}
            <tr>
              <th scope="row">{r.label}</th>
              <td>
                <ul>
                  {#each r.proposals as p (p.criterionId)}<li>{p.title}: {p.levelLabel}</li>{/each}
                </ul>
                <details>
                  <summary>The AI's reasons<span class="visually-hidden"> for {r.label}</span></summary>
                  {#each r.proposals as p (p.criterionId)}<p><span>{p.title}:</span> {p.rationale}</p>{/each}
                </details>
              </td>
              <td>{r.provisional === null ? noMarkWhy(r) : pyFormatG(r.provisional)}{r.provisionalWorked !== null && r.provisionalWorked !== r.provisional ? ` (${pyFormatG(r.provisionalWorked)} before rounding)` : ""}</td>
              <td class={r.left.length ? "attention" : "done"}>
                {#if r.left.length}
                  {#each r.left as l (l.criterionId)}
                    <div>
                      <label for={`fill-${r.id}-${l.criterionId}`}>{l.title} ({l.why})</label>
                      <select id={`fill-${r.id}-${l.criterionId}`} value={fill[r.id]?.[l.criterionId] ?? ""} onchange={(e) => setFill(r.id, l.criterionId, e.currentTarget.value)}>
                        <option value="">Leave it for me</option>
                        {#each l.levels as level (level.id)}<option value={level.id}>{level.label}{l.suggestion?.levelId === level.id ? " (suggested)" : ""}</option>{/each}
                      </select>
                      {#if l.suggestion}
                        <p class="hint">Suggested: {l.suggestion.levelLabel}, from the {count(l.suggestion.from, "other criterion", "other criteria")}, which average {l.suggestion.averagePercent}% of their maximum. Not from the work.</p>
                      {:else}
                        <p class="hint">Too few other criteria have a proposed level to suggest one.</p>
                      {/if}
                    </div>
                  {/each}
                {:else}None{/if}
              </td>
              <td><button type="button" onclick={() => onOpen(r.id)}>Mark it myself<span class="visually-hidden">: {r.label}</span></button></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </TableRegion>
    <div class="fields">
      <label class="check"><input type="checkbox" checked={confirmed !== null} onchange={(e) => (confirmed = e.currentTarget.checked ? { ...listed } : null)} /> I have read these proposals, and want to take them as my marks</label>
      {#if suggestions.length}<button type="button" aria-disabled={busy} onclick={useSuggestions}>Use the suggestions for all</button>{/if}
      <button type="button" aria-disabled={busy} onclick={take}>Take these proposals as my marks</button>
    </div>
    <Waiting active={busy} text="Taking the proposals: recording each level, and the overall mark where it can be worked out…" />
  {:else}
    <p>No submission's proposals can be taken now.</p>
  {/if}
  {#if loaded && notTaken.length}<NotListedSummary groups={proposalGroups(notTaken)} />{/if}
  <Status message={asDone(message)} />
  <Problems {problems} />
</section>
