<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    DEFAULT_MODEL,
    enterRubricFromImage,
    gridFlags,
    planRubricReading,
    proposalToGrid,
    RUBRIC_INSTRUCTIONS,
    runRubricReading,
    type GridCriterion,
    type ProposalRecord,
    type ProxyHealth,
    type RubricPlan,
    type Workspace,
  } from "../../core/index.ts";
  import type { AppProxy } from "../platform.ts";
  import { problemsOf } from "../forms.ts";
  import { DEFAULT_PATTERN, labelsFromPattern, type PatternLevel } from "../rubricPattern.ts";
  import Problems from "./Problems.svelte";
  import RowsEditor from "./RowsEditor.svelte";
  import Status from "./Status.svelte";
  import Waiting from "./Waiting.svelte";
  import { asDone } from "../messages.ts";

  let { workspace, proxy, exists, onSaved }: { workspace: Workspace; proxy: AppProxy; exists: boolean; onSaved: () => void | Promise<void> } = $props();

  interface Criterion {
    title: string;
    weight: string;
    maxPoints: string;
    levels: Record<string, string>[];
  }
  const blankLevel = () => ({ label: "", points: "", descriptor: "" });
  const blankCriterion = (): Criterion => ({ title: "", weight: "", maxPoints: "", levels: [blankLevel()] });

  let image: File | null = $state(null);
  let imageUrl: string | null = $state(null);
  let title = $state("");
  let criteria: Criterion[] = $state([blankCriterion()]);
  let pattern: Record<string, string>[] = $state(DEFAULT_PATTERN.map((p) => ({ ...p })));
  let replace = $state(false);
  let busy = $state(false);
  let problems: string[] = $state([]);
  let message: string | null = $state(null);

  // Asking the AI to read the image (ADR 0009): what would be sent is shown first, and nothing is sent until it is confirmed.
  let health = $state<ProxyHealth | null>(null);
  let model = $state(DEFAULT_MODEL);
  let limit = $state("0.50");
  let plan: RubricPlan | null = $state(null);
  let proposal: ProposalRecord | null = $state(null); // the grid began as the AI's proposal; kept for the record when the rubric is saved
  let replaceTyped = $state(false);
  let patternOpen = $state(false); // the pattern is for typing the grid yourself: tucked away, so it isn't taken for a step
  let asking = $state(false);
  let reading = $state(false); // the AI is reading the image
  let askProblems: string[] = $state([]);
  let askMessage: string | null = $state(null);
  let plannedGrid = ""; // the grid as it was when the replacement was confirmed
  let held: { grid: ReturnType<typeof proposalToGrid>; record: ProposalRecord } | null = $state(null); // a proposal that arrived after the grid was changed, waiting to be taken or dropped
  $effect(() => {
    proxy.health().then(
      (h) => (health = h),
      () => (health = null),
    );
  });

  const grid = $derived({
    title,
    criteria: criteria.map(
      (c): GridCriterion => ({
        title: c.title,
        weight: c.weight,
        max_points: c.maxPoints,
        levels: c.levels.filter((l) => l.label.trim() || l.points.trim() || l.descriptor.trim()).map((l) => ({ label: l.label, points: l.points, descriptor: l.descriptor })),
      }),
    ),
  });
  // What departs from the rubric's own pattern, worked out as the grid is typed; nothing is changed by it.
  const flags = $derived(gridFlags(grid));

  const choose = (event: Event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    plan = null; // a different image: what was planned, and any proposal made from the last one, don't apply
    proposal = null;
    held = null;
    askProblems = [];
    askMessage = null;
    image = file;
    imageUrl = file ? URL.createObjectURL(file) : null;
  };
  onDestroy(() => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  });

  const fillFrom = (i: number) => {
    problems = [];
    const c = criteria[i];
    const max = Number((c.maxPoints.trim() || c.weight).replace(/%$/, ""));
    const labels = labelsFromPattern(pattern as unknown as PatternLevel[], max);
    if (!labels) {
      problems = [`Give criterion ${i + 1} a weight (or points) and check the pattern: each level needs a name and a percentage lower than the one above.`];
      return;
    }
    // Only the labels: the points and descriptors are typed from the image. Levels already typed keep their points and descriptors.
    c.levels = labels.map((label, k) => ({ label, points: c.levels[k]?.points ?? "", descriptor: c.levels[k]?.descriptor ?? "" }));
  };

  const typed = () => !!title.trim() || criteria.some((c) => c.title.trim() || c.weight.trim() || c.maxPoints.trim() || c.levels.some((l) => l.label.trim() || l.points.trim() || l.descriptor.trim()));

  /** The grid's content as a string, to tell whether it has changed. */
  const snapshot = () => JSON.stringify([title, criteria]);

  /** Take a proposal into the grid, as the AI's, for checking. */
  function takeProposal(proposed: ReturnType<typeof proposalToGrid>, record: ProposalRecord) {
    title = proposed.title;
    criteria = proposed.criteria.length
      ? proposed.criteria.map((c) => ({ title: c.title, weight: c.weight, maxPoints: c.max_points, levels: c.levels.length ? c.levels.map((l) => ({ ...l })) : [blankLevel()] }))
      : [blankCriterion()];
    proposal = record;
    held = null;
    replaceTyped = false;
    askMessage = `The AI read the image and proposed ${proposed.criteria.length} criteria, now in the grid below (it cost $${record.cost_usd.toFixed(4)}). Check every cell against the image before saving: it can misread.`;
  }

  /** What would be sent, and its worst-case cost, for confirming. */
  async function planAsk() {
    const chosen = image;
    if (asking || !chosen) return; // the button stays enabled while busy, so focus isn't lost from it
    askProblems = [];
    askMessage = null;
    plan = null;
    held = null;
    const limitUsd = Number(limit);
    if (!(limitUsd > 0)) {
      askProblems = ["The spend limit must be an amount of money above zero."];
      return;
    }
    if (typed() && !replaceTyped) {
      askProblems = ["You have already typed some of the grid. Tick \"Replace what I have typed\" to let the AI's proposal take its place."];
      return;
    }
    asking = true;
    try {
      const planned = await planRubricReading(proxy, { name: chosen.name, bytes: new Uint8Array(await chosen.arrayBuffer()) }, { model, limitUsd });
      if (image !== chosen) return; // a different image was chosen meanwhile: this plan is not for it
      plan = planned;
      plannedGrid = snapshot();
    } catch (err) {
      if (image === chosen) askProblems = problemsOf(err);
    } finally {
      asking = false;
    }
  }

  /** Send the confirmed image; what comes back fills the grid, as a proposal to check, unless the grid or the image changed meanwhile. */
  async function sendAsk() {
    const chosen = image;
    const confirmed = plan;
    if (asking || !chosen || !confirmed) return;
    asking = true;
    reading = true;
    askProblems = [];
    try {
      const bytes = new Uint8Array(await chosen.arrayBuffer());
      const result = await runRubricReading(proxy, confirmed, { bytes });
      plan = null;
      if (image !== chosen) {
        askMessage = "You chose a different image while the AI was reading the first, so its proposal was dropped.";
        return;
      }
      const proposed = proposalToGrid(result.proposal);
      if (snapshot() !== plannedGrid) {
        // The grid was changed after the replacement was confirmed: nothing is overwritten unless the moderator says so now.
        held = { grid: proposed, record: result.record };
        askMessage = null;
        return;
      }
      takeProposal(proposed, result.record);
    } catch (err) {
      if (image === chosen) askProblems = problemsOf(err);
    } finally {
      reading = false;
      asking = false;
    }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return; // the button stays enabled while busy, so focus isn't lost from it
    const chosen = image;
    const record = proposal; // the image and its proposal as they are now: a change while saving can't pair one with the other
    if (!chosen) {
      problems = ["Choose the image of the rubric first."];
      return;
    }
    if (!criteria.some((c) => c.title.trim())) {
      problems = ["There is nothing to save yet: Feedbacker doesn't read the picture, so type at least one criterion from it first (its title, weight, and each level's label, points and descriptor)."];
      return;
    }
    busy = true;
    problems = [];
    message = null;
    try {
      const entered = await enterRubricFromImage(workspace, { name: chosen.name, bytes: new Uint8Array(await chosen.arrayBuffer()) }, grid, { replace, proposal: record });
      replace = false;
      await onSaved();
      message = `Saved the rubric "${entered.rubric.title}" (${entered.rubric.criteria.length} criteria), entered from the image you chose, which is kept with it as its source.${entered.flags.length ? ` ${entered.flags.length} thing(s) were flagged for you to check; they are kept with it.` : ""}`;
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      busy = false;
    }
  }
</script>

<section aria-labelledby="image-heading">
  <h2 id="image-heading">Or enter it from an image of the rubric</h2>
  <p class="hint" id="image-hint">
    For a rubric that exists only as a picture (a screenshot of the marking platform's rubric, say). Feedbacker doesn't read the picture: you type the grid beside
    it, and it checks what you typed against the pattern the rubric itself follows. It flags what departs from the pattern and never changes it, because a rubric
    can have slips of its own. The image is kept with the rubric as its source, and nothing leaves this computer.
  </p>
  <label for="rubric-image">Image of the rubric (png, jpg, webp or gif)</label>
  <input id="rubric-image" type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-describedby="image-hint" disabled={asking || busy} onchange={choose} />

  {#if imageUrl}
    <form onsubmit={save} class="rubric-entry">
      <div class="rubric-image">
        <h3 id="shown-heading">The image</h3>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div class="image-region" role="region" aria-labelledby="shown-heading" tabindex="0">
          <img src={imageUrl} alt="The rubric you chose, to type the grid from" />
        </div>
      </div>

      <div class="rubric-grid">
        <section aria-labelledby="ask-heading">
          <h3 id="ask-heading">Have the AI read the image (optional)</h3>
          <p class="hint" id="ask-hint">
            It sends the image of the rubric, with its instructions and nothing else (no student's material), through the local proxy, to the AI. It proposes a
            transcription for the grid, which you check against the image and correct before saving; nothing is saved until you save it. You see what would be
            sent, and its worst-case cost, and confirm before anything is.
          </p>
          {#if health && !health.key_configured}
            <p class="warning" role="note">The proxy has no API key, so it can't send the image. Put the key in ~/Feedbacker/.env and restart the proxy, or type the grid yourself.</p>
          {/if}
          <label for="ask-model">Model</label>
          <select id="ask-model" bind:value={model}>
            {#each Object.keys(health?.prices ?? { [DEFAULT_MODEL]: null }) as m (m)}<option value={m}>{m}</option>{/each}
          </select>
          <label for="ask-limit">Spend limit for this (USD)</label>
          <input id="ask-limit" type="text" inputmode="decimal" bind:value={limit} aria-describedby="ask-hint" />
          {#if typed()}
            <label class="check"><input type="checkbox" bind:checked={replaceTyped} /> Replace what I have typed</label>
          {/if}
          <button type="button" onclick={planAsk} aria-disabled={asking}>Show what would be sent</button>
          <Problems problems={askProblems} />
          <Status message={asDone(askMessage)} />
          {#if plan}
            <section aria-labelledby="plan-heading">
              <h4 id="plan-heading">Check what will be sent</h4>
              <ul>
                <li>The image of the rubric ({image?.name}, about {Math.ceil(plan.imageBytes / 1024)} KB), with its hidden metadata (names, places and the like that a picture can carry) removed. The original stays here as the rubric's source.</li>
                <li>
                  <details>
                    <summary>The instructions it is sent with ({plan.request.prompt.version})</summary>
                    <pre class="instructions">{RUBRIC_INSTRUCTIONS}</pre>
                  </details>
                </li>
                <li>Nothing else: no student's text, marks or names, and nothing from the brief.</li>
                <li>
                  Model {plan.model}. At most <strong>${plan.worstUsd.toFixed(4)}</strong> (the worst case), against your limit of ${plan.limitUsd.toFixed(2)}.
                </li>
              </ul>
              <div class="actions">
                <button type="button" onclick={sendAsk} aria-disabled={asking}>Confirm and send the image</button>
                <button type="button" onclick={() => (plan = null)}>Don't send it</button>
              </div>
              <Waiting active={reading} text="Asking the AI to read the image… this can take a minute." />
            </section>
          {/if}
          {#if held}
            <div role="note" class="note">
              <p>You changed the grid while the AI was reading, so its proposal hasn't replaced anything. Take it, and what you typed is replaced, or drop it.</p>
              <div class="actions">
                <button type="button" onclick={() => held && takeProposal(held.grid, held.record)}>Replace the grid with the AI's proposal</button>
                <button type="button" onclick={() => (held = null)}>Drop the proposal</button>
              </div>
            </div>
          {/if}
          {#if proposal}
            <p class="note" role="note">This grid is the AI's proposal (read by {proposal.model}). It can misread: check every cell against the image. Saving it records that it began as the AI's proposal, and that you checked and saved it.</p>
          {/if}
        </section>

        <label for="image-title">Title of the rubric</label>
        <input id="image-title" type="text" bind:value={title} />

        <details class="step-form" bind:open={patternOpen}>
          <summary>Typing it yourself? Start a criterion's levels from a pattern</summary>
          <RowsEditor
            id="pattern"
            legend="A pattern to start a criterion's levels from (optional)"
            hint="If the rubric's levels are fixed percentage bands of each criterion's points, name each level and the percentage it starts at, then use a criterion's button to fill in its level labels with their ranges. You still type each level's points and descriptor from the image."
            columns={[
              { key: "name", label: "Level" },
              { key: "starts", label: "Starts at (% of the criterion's points)", inputmode: "decimal" },
            ]}
            bind:rows={pattern}
            addLabel="Add another level to the pattern"
            rowName="pattern level"
          />
        </details>

        {#each criteria as c, i (i)}
          <fieldset class="criterion">
            <legend>Criterion {i + 1}</legend>
            <label for={`criterion-${i}-title`}>Title</label>
            <input id={`criterion-${i}-title`} type="text" bind:value={c.title} />
            <label for={`criterion-${i}-weight`}>Weight (% of the whole)</label>
            <input id={`criterion-${i}-weight`} type="text" inputmode="decimal" bind:value={c.weight} />
            <label for={`criterion-${i}-max`}>Marked out of (points; leave empty if the same as its weight)</label>
            <input id={`criterion-${i}-max`} type="text" inputmode="decimal" bind:value={c.maxPoints} />
            <RowsEditor
              id={`levels-${i}`}
              legend={`Levels of criterion ${i + 1}, best first`}
              columns={[
                { key: "label", label: "Level, with its range as written" },
                { key: "points", label: "Points", inputmode: "decimal" },
                { key: "descriptor", label: "Descriptor" },
              ]}
              bind:rows={c.levels}
              addLabel={`Add a level to criterion ${i + 1}`}
              rowName="level"
            />
            <div class="actions">
              {#if patternOpen}
                <button type="button" onclick={() => fillFrom(i)}>Fill criterion {i + 1}'s level labels from the pattern</button>
              {/if}
              {#if criteria.length > 1}
                <button type="button" onclick={() => criteria.splice(i, 1)}>Remove criterion {i + 1}</button>
              {/if}
            </div>
          </fieldset>
        {/each}
        <button type="button" onclick={() => criteria.push(blankCriterion())}>Add another criterion</button>

        <div aria-live="polite">
          {#if flags.length}<Problems problems={flags} title="Please check these against the image (nothing has been changed):" kind="note" />{/if}
        </div>
        {#if exists}
          <label class="check"><input type="checkbox" bind:checked={replace} /> Replace the rubric already saved</label>
        {/if}
        <Problems {problems} />
        <Status message={asDone(message)} />
        <button type="submit" aria-disabled={busy}>Save the rubric entered from the image</button>
      </div>
    </form>
  {/if}
</section>

<style>
  .rubric-entry {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(22rem, 100%), 1fr));
    gap: 1rem;
    align-items: start;
  }
  .rubric-entry > div {
    min-width: 0;
  }
  .image-region {
    max-height: 60vh;
    overflow: auto;
    border: 1px solid currentColor;
  }
  .image-region img {
    display: block;
    max-width: none;
    width: 100%;
    height: auto;
  }
  .criterion {
    margin-block: 1rem;
  }
  .instructions {
    white-space: pre-wrap;
    max-height: 16rem;
    overflow: auto;
    padding: 0.5rem;
    border: 1px solid currentColor;
  }
</style>
