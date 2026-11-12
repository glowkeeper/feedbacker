<script lang="ts">
  /**
   * Recording the AI's unflagged drafts of feedback for many submissions in one action, by exception (ADR 0015): the list of every piece that can be recorded, in
   * full, with the flagged ones set apart and not recordable here; the confirmation that the list was skimmed, tied to what was listed; and the one action.
   * Nothing is recorded until the educator confirms and presses the button.
   */
  import { tick } from "svelte";
  import { draftsToRecord, recordDrafts, type DraftedSubmission, type NotListed, type Workspace } from "../../core/index.ts";
  import { pyFormatG } from "../../core/pytext.ts";
  import { problemsOf } from "../forms.ts";
  import { asDone } from "../messages.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";
  import TableRegion from "./TableRegion.svelte";
  import Waiting from "./Waiting.svelte";

  let { workspace, onChanged, onOpen }: { workspace: Workspace; onChanged: () => void | Promise<void>; onOpen: (id: string) => void } = $props();

  const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  let ready: DraftedSubmission[] = $state([]);
  let notListed: NotListed[] = $state([]);
  let loaded = $state(false); // until the first read is done, nothing is said of what can be recorded
  let busy = $state(false);
  let message: string | null = $state(null);
  let problems: string[] = $state([]);
  let heading: HTMLHeadingElement | undefined = $state();

  // The educator's confirmation that they skimmed the list: those submissions as they were listed, by digest. It lapses when they change.
  let skimmed: Record<string, string> | null = $state(null);
  const listed = $derived(Object.fromEntries(ready.map((r) => [r.id, r.digest])));
  $effect(() => {
    if (skimmed !== null && JSON.stringify(skimmed) !== JSON.stringify(listed)) skimmed = null;
  });
  const flagged = $derived(ready.filter((r) => r.held.length).length);
  const pieces = $derived(ready.reduce((n, r) => n + r.pieces.length, 0));

  async function read() {
    try {
      const found = await draftsToRecord(workspace);
      ready = found.ready;
      notListed = found.notListed;
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      loaded = true;
    }
  }
  $effect(() => {
    void read();
  });

  async function record() {
    if (busy) return; // the button stays focusable while busy, so focus isn't lost from it
    busy = true;
    problems = [];
    message = null;
    try {
      const result = await recordDrafts(workspace, { skimmed: skimmed ? { ...skimmed } : null });
      skimmed = null;
      await onChanged(); // the step's status is read again, with what is now recorded
      await read();
      const left = result.skipped.map((s) => `${s.label}: ${s.why}`);
      message =
        `Recorded ${count(result.pieces, "piece")} of feedback for ${count(result.recorded.length, "submission")} of ${result.size} listed` +
        (result.flagged ? `; ${count(result.flagged, "of them has", "of them have")} a flagged draft held back for you to record by hand` : "") +
        `.${left.length ? ` Not recorded: ${left.join("; ")}.` : ""} Each says in the record that it was recorded from the AI's draft in a set, and Export asks you to open each submission before it can be approved in a set.`;
    } catch (err) {
      problems = problemsOf(err);
      await read(); // what is listed may be why it failed: show what there is now
    } finally {
      busy = false;
    }
    await tick();
    if (!ready.length) heading?.focus(); // the last of them was recorded, and the button went: focus goes to the heading, not lost
  }
</script>

<section aria-labelledby="record-drafts-heading">
  <h2 id="record-drafts-heading" tabindex="-1" bind:this={heading}>Record the AI's drafts for many at once</h2>
  {#if !loaded}
    <p>Reading what can be recorded…</p>
  {:else if ready.length}
    <p>
      {count(pieces, "piece")} of feedback, in {count(ready.length, "submission")}, {pieces === 1 ? "has" : "have"} an AI draft that can be recorded as your feedback, after you have looked at {pieces === 1 ? "it" : "them"}. The list shows each in full.
      {flagged ? `${count(flagged, "submission")} ${flagged === 1 ? "has" : "have"} a draft that is flagged (a check against its mark, or the cohort checks): that one is never recorded here, and is yours to read and record by hand. ` : ""}
      Skim the list, tick that you have, and record them in one action. Each piece is recorded as yours, from the AI's draft and derived from it, and says it was recorded in a set. Nothing is released: at Export you read
      what each student will receive, and a submission with feedback recorded this way has to be opened there before it can be approved in a set. Open a submission to read and change its feedback yourself; recording a piece
      again ends its being marked as recorded in a set.
    </p>
    <TableRegion label="Drafts that can be recorded">
      <table>
        <caption>Each submission with drafts that can be recorded: its overall mark, each draft in full, and any draft held back as flagged</caption>
        <thead>
          <tr><th scope="col">Submission</th><th scope="col">Overall mark</th><th scope="col">The drafts</th><th scope="col">Held back, flagged</th><th scope="col"><span class="visually-hidden">Open it</span></th></tr>
        </thead>
        <tbody>
          {#each ready as r (r.id)}
            <tr>
              <th scope="row">{r.label}</th>
              <td>{r.mark === null ? "—" : pyFormatG(r.mark)}</td>
              <td>
                {#each r.pieces as p (p.target)}<p><span>{p.title}:</span> {p.text}</p>{/each}
              </td>
              <td class={r.held.length ? "attention" : "done"}>
                {#if r.held.length}
                  {#each r.held as h (h.target)}<p><span>{h.title}:</span> {h.why.join("; ")}</p>{/each}
                {:else}None{/if}
              </td>
              <td><button type="button" onclick={() => onOpen(r.id)}>Read it myself<span class="visually-hidden">: {r.label}</span></button></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </TableRegion>
    <div class="fields">
      <label class="check"><input type="checkbox" checked={skimmed !== null} onchange={(e) => (skimmed = e.currentTarget.checked ? { ...listed } : null)} /> I have skimmed these drafts, and want to record them as my feedback</label>
      <button type="button" aria-disabled={busy} onclick={record}>Record these drafts as my feedback</button>
    </div>
    <Waiting active={busy} text="Recording the drafts: each piece, as it would be recorded on its own…" />
  {:else}
    <p>No draft can be recorded in a set now.</p>
  {/if}
  {#if loaded && notListed.length}
    <Problems problems={notListed.map((n) => `${n.label}: ${n.why}`)} title="Not listed:" kind="note" />
  {/if}
  <Status message={asDone(message)} />
  <Problems {problems} />
</section>
