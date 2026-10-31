<script lang="ts">
  import { briefPartFor, briefSections, briefText, setBriefSelection, type Brief, type BriefRange, type Workspace } from "../../core/index.ts";
  import { rangeBounds } from "../briefRange.ts";
  import { problemsOf } from "../forms.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";
  import { asDone } from "../messages.ts";

  let { workspace, brief, onChanged }: { workspace: Workspace; brief: Brief; onChanged: () => void | Promise<void> } = $props();

  const sections = $derived(briefSections(brief));
  const points = $derived(Array.from(brief.extract.text));
  // The text the brief's blocks cover, to choose a range of when it has no headings to choose by (a pdf, for example).
  const blocks = $derived(brief.extract.blocks.filter((b) => b.kind !== "figure"));
  const wordsIn = (text: string) => text.split(/\s+/u).filter(Boolean).length;

  let ticked: boolean[] = $state([]);
  let from = $state(0);
  let to = $state(0);
  let busy = $state(false);
  let problems: string[] = $state([]);
  let message: string | null = $state(null);

  // The boxes start from what is chosen: a section is ticked when the choice covers it.
  $effect(() => {
    ticked = sections.map((s) => !!brief.selection?.some((r) => r.start <= s.start && r.end >= s.end));
    // The range lists start from what is chosen, so saving again without changing them keeps it.
    ({ from, to } = rangeBounds(blocks, brief.selection));
  });

  // In a module, whose brief covers its assessments, the part whose heading names this assessment is suggested: the educator chooses it, or others.
  const suggested = $derived(workspace.module && !brief.selection ? briefPartFor(brief, workspace.manifest.name) : null);
  const whole = $derived(brief.extract.text);
  const used = $derived(briefText(brief));
  const preview = (i: number) => `${i + 1}. ${points.slice(blocks[i].start, Math.min(blocks[i].end, blocks[i].start + 50)).join("").replace(/\s+/gu, " ")}`;

  async function apply(ranges: BriefRange[] | null, said: string) {
    if (busy) return; // the button stays enabled while busy, so focus isn't lost from it
    busy = true;
    problems = [];
    message = null;
    try {
      await setBriefSelection(workspace, ranges);
      await onChanged();
      message = said;
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      busy = false;
    }
  }

  const useChosen = (event: SubmitEvent) => {
    event.preventDefault();
    const ranges = sections.flatMap((s, i) => (ticked[i] ? [{ start: s.start, end: s.end }] : []));
    if (!ranges.length) {
      problems = ["Tick at least one part of the brief, or use all of it."];
      return;
    }
    return apply(ranges, "This assessment now uses only the parts you chose. Anonymise and approve the brief again before the AI reading uses it.");
  };

  const useRange = (event: SubmitEvent) => {
    event.preventDefault();
    if (from > to) {
      problems = ["The range must end at or after where it starts."];
      return;
    }
    return apply([{ start: blocks[from].start, end: blocks[to].end }], "This assessment now uses only that range of the brief. Anonymise and approve the brief again before the AI reading uses it.");
  };
</script>

<section aria-labelledby="parts-heading">
  <h2 id="parts-heading">Which part of the brief applies</h2>
  <p class="hint" id="parts-hint">
    A brief can describe several assessments, with the module's weightings, outcomes and rules around them. Choose the parts that apply to this one: only those are anonymised, approved and sent to the AI. Changing the parts clears the brief's approval. The text is shown as written, on this screen only.
  </p>
  <p>
    Using: <strong class="done">{brief.selection ? `${brief.selection.length} chosen part(s), ${wordsIn(used)} of ${wordsIn(whole)} words` : "all of the brief"}</strong>.
  </p>
  <Status message={asDone(message)} />
  <Problems {problems} />

  {#if suggested}
    <p>
      The part headed "{suggested.title}" looks like this assessment's.
      <button type="button" onclick={() => apply([{ start: suggested.start, end: suggested.end }], `This assessment now uses only the part headed "${suggested.title}". Tick the module-wide parts too if they apply, then anonymise and approve the brief again before the AI reading uses it.`)} aria-disabled={busy}
        >Use the part headed "{suggested.title}"</button
      >
    </p>
  {/if}
  {#if sections.length > 1}
    <form onsubmit={useChosen} aria-describedby="parts-hint">
      <fieldset>
        <legend>Parts of the brief, by its headings</legend>
        <p class="hint">A part includes the headings under it. Tick the module-wide parts too (the outcomes, the rules) if they apply.</p>
        {#each sections as s, i (s.start)}
          <label class="check" style:margin-left={`${Math.min(s.level, 4) * 1.25}rem`}>
            <input type="checkbox" bind:checked={ticked[i]} /> {s.title} ({s.words} {s.words === 1 ? "word" : "words"})
          </label>
        {/each}
      </fieldset>
      <button type="submit" aria-disabled={busy}>Use these parts</button>
    </form>
  {:else if blocks.length > 1}
    <form onsubmit={useRange} aria-describedby="parts-hint">
      <fieldset>
        <legend>A range of the brief</legend>
        <p class="hint">This brief has no headings to choose by. Choose where the part that applies starts and ends.</p>
        <label for="range-from">From</label>
        <select id="range-from" bind:value={from}>
          {#each blocks as _, i (i)}<option value={i}>{preview(i)}</option>{/each}
        </select>
        <label for="range-to">To (including this one)</label>
        <select id="range-to" bind:value={to}>
          {#each blocks as _, i (i)}<option value={i}>{preview(i)}</option>{/each}
        </select>
      </fieldset>
      <button type="submit" aria-disabled={busy}>Use this range</button>
    </form>
  {/if}
  {#if brief.selection}
    <button type="button" onclick={() => apply(null, "This assessment now uses all of the brief. Anonymise and approve it again before the AI reading uses it.")} aria-disabled={busy}>Use all of the brief</button>
  {/if}

  <div class="side-by-side">
    <div>
      <h3 id="whole-heading">The whole brief</h3>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="text-region" role="region" aria-labelledby="whole-heading" tabindex="0">{whole}</div>
    </div>
    <div>
      <h3 id="used-heading">What this assessment uses</h3>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="text-region" role="region" aria-labelledby="used-heading" tabindex="0">{used}</div>
    </div>
  </div>
</section>

<style>
  .side-by-side {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), 1fr));
    gap: 1rem;
  }
  .side-by-side > div {
    min-width: 0;
  }
  .text-region {
    white-space: pre-wrap;
    max-height: 20rem;
    overflow: auto;
    padding: 0.5rem;
    border: 1px solid currentColor;
    overflow-wrap: anywhere;
  }
</style>
