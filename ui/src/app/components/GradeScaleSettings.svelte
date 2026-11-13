<script lang="ts">
  /**
   * What the overall mark is out of, and whether it is rounded to grade points. Some institutions give overall marks only on fixed grade points (marks that end in
   * 2, 5 or 8); the overall worked out from the criteria then proposes the nearest one, and the educator can enter any mark. Kept for the workspace.
   */
  import { DEFAULT_GRADE_SCALE, gradePoints, loadGradeScale, saveGradeScale, describeRounding, type Workspace } from "../../core/index.ts";
  import { pyFormatG } from "../../core/pytext.ts";
  import { blankForm, formOf, scaleFrom, type GradeScaleForm } from "../gradeScaleForm.ts";
  import { problemsOf } from "../forms.ts";
  import { asDone } from "../messages.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";

  let { workspace, onChanged }: { workspace: Workspace; onChanged: () => void | Promise<void> } = $props();

  let form: GradeScaleForm = $state(blankForm());
  let saved = $state(describeRounding(DEFAULT_GRADE_SCALE));
  let note: string | null = $state(null);
  let problems: string[] = $state([]);
  let busy = $state(false);

  $effect(() => {
    loadGradeScale(workspace).then(
      (scale) => {
        form = formOf(scale);
        saved = summary(scale);
      },
      (err) => (problems = problemsOf(err)),
    );
  });

  const summary = (scale: Awaited<ReturnType<typeof loadGradeScale>>) => `Out of ${pyFormatG(scale.out_of)}, ${describeRounding(scale)}`;

  /** A few grade points of the scale as the form stands, so what it means is seen before it is saved; nothing while the form isn't a valid scale. */
  const preview = $derived.by(() => {
    try {
      const points = gradePoints(scaleFrom(form));
      if (!points) return null;
      const shown = points.slice(0, 12).map(pyFormatG).join(", ");
      return points.length > 12 ? `${shown}, and so on up to ${pyFormatG(points.at(-1)!)}` : shown;
    } catch {
      return null;
    }
  });

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    problems = [];
    note = null;
    try {
      const scale = await saveGradeScale(workspace, scaleFrom(form));
      form = formOf(scale);
      saved = summary(scale);
      note = "Saved the grade scale. A mark already recorded keeps the scale it was given on.";
      await onChanged();
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      busy = false;
    }
  }
</script>

<details class="step-form">
  <summary>Grade scale for the overall mark: {saved}</summary>
  <form onsubmit={save}>
    <p class="hint">
      The overall mark is worked out from your criterion marks, so it is rarely a whole number. If your institution gives overall marks only on fixed grade points, say so here: the overall
      mark is then proposed as the nearest grade point (exactly halfway rounds up), and you see both, as in "66.3, rounded to 65". You can always enter another mark. Criterion marks are not
      rounded.
    </p>
    <label for="grade-out-of">The overall mark is out of (100 for a percentage)</label>
    <input id="grade-out-of" type="text" inputmode="decimal" bind:value={form.outOf} />
    <label for="grade-rounding">Rounding</label>
    <select id="grade-rounding" bind:value={form.rounding}>
      <option value="none">None: keep the mark worked out</option>
      <option value="ending">Marks ending in 2, 5 or 8</option>
      <option value="step">The nearest multiple of a step</option>
      <option value="pattern">Marks in a repeating block, such as 2, 5 and 8 in every 10</option>
      <option value="list">My own list of grade points</option>
    </select>
    {#if form.rounding === "step"}
      <label for="grade-step">Step (0.5 for half marks)</label>
      <input id="grade-step" type="text" inputmode="decimal" bind:value={form.step} />
    {:else if form.rounding === "pattern"}
      <label for="grade-every">Size of the block (10 for marks ending in a digit)</label>
      <input id="grade-every" type="text" inputmode="decimal" bind:value={form.every} />
      <label for="grade-at">Grade points in each block, separated by commas or spaces</label>
      <input id="grade-at" type="text" bind:value={form.at} />
    {:else if form.rounding === "list"}
      <label for="grade-points">Grade points, separated by commas, spaces or new lines</label>
      <textarea id="grade-points" rows="3" bind:value={form.points}></textarea>
    {/if}
    {#if preview}<p class="hint">Grade points: {preview}. 0 and {form.outOf.trim() || "100"} are always grade points, except in your own list.</p>{/if}
    <button type="submit" aria-disabled={busy}>Save the grade scale</button>
    <Status message={asDone(note)} />
    <Problems {problems} />
  </form>
</details>
