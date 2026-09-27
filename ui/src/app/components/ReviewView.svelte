<script lang="ts">
  import { chooseReviewMode, describeBetween, markerSlug, recordJudgement, reveal, type Criterion, type OriginalAssessment, type ReviewMode, type Workspace } from "../../core/index.ts";
  import { problemsOf } from "../forms.ts";
  import { loadReview, reviewChoices, whereOnPage, type Review } from "../review.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";

  let { workspace, onChanged }: { workspace: Workspace; onChanged: () => void } = $props();

  let choices: { id: string; label: string }[] = $state([]);
  let chosen = $state("");
  let review: Review | null = $state(null);
  let drafts: Record<string, { level: string; comment: string }> = $state({});
  let busy = $state(false);
  let problems: string[] = $state([]);
  let message: string | null = $state(null);
  let heading: HTMLHeadingElement;
  let reviewHeading: HTMLHeadingElement | undefined = $state();
  let opened = $state(0); // bumped when a submission is opened (or its view changes), to move focus to it; not after each judgement

  $effect(() => {
    heading?.focus();
    reviewChoices(workspace).then(
      (c) => {
        choices = c;
        chosen ||= c[0]?.id ?? "";
      },
      (err) => (problems = problemsOf(err)),
    );
  });

  async function open(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    problems = [];
    message = null;
    try {
      show(await loadReview(workspace, chosen));
    } catch (err) {
      review = null;
      problems = problemsOf(err);
    } finally {
      busy = false;
    }
  }
  $effect(() => {
    if (opened) reviewHeading?.focus();
  });

  /** Show a review afresh, with each criterion's form starting from what is recorded. */
  function show(r: Review) {
    review = r;
    const revising = r.mode === "blind" && r.revealedAt !== null;
    drafts = Object.fromEntries(
      r.rubric.criteria.map((c) => {
        const j = r.judgements.get(c.id);
        const entry = revising ? (j?.revised ?? null) : (j?.first ?? null);
        return [c.id, { level: entry?.level_id ?? j?.first.level_id ?? "", comment: entry?.comment ?? "" }];
      }),
    );
    opened += 1;
  }

  async function act(what: (r: Review) => Promise<string>) {
    if (!review || busy) return;
    busy = true;
    problems = [];
    message = null;
    try {
      const done = await what(review);
      show(await loadReview(workspace, review.id));
      onChanged();
      message = done;
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      busy = false;
    }
  }

  const choose = (mode: ReviewMode) =>
    act(async (r) => {
      await chooseReviewMode(workspace, r.id, mode);
      return mode === "blind"
        ? `Reviewing ${r.id} blind: the original marking and the AI reading stay hidden until you reveal them.`
        : `Reviewing ${r.id} openly.`;
    });

  const revealAll = () =>
    act(async (r) => {
      await reveal(workspace, r.id);
      return "Revealed the original marking and the AI reading. Your first judgements are kept; you may record a revision of any criterion.";
    });
  async function record(criterion: Criterion) {
    if (!review || busy) return; // the button stays enabled while saving, so focus isn't lost from it
    const draft = drafts[criterion.id];
    busy = true;
    problems = [];
    message = null;
    try {
      if (!draft.level) throw new Error(`choose a level for ${criterion.title} first`);
      const j = await recordJudgement(workspace, review.id, criterion.id, { levelId: draft.level, comment: draft.comment });
      review = await loadReview(workspace, review.id); // drafts for other criteria are kept
      const entry = j.revised ?? j.first;
      draft.comment = entry.comment ?? "";
      onChanged();
      message = `Recorded your ${j.revised ? "revision" : "judgement"} of ${criterion.title}: ${levelLabel(criterion, entry.level_id)}.`;
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      busy = false;
    }
  }

  const levelLabel = (c: Criterion, id: string | null) => (id === null ? "no level" : (c.levels.find((l) => l.id === id)?.label ?? id));
  const markOf = (m: OriginalAssessment, c: Criterion) => m.criterion_marks.find((x) => x.criterion_id === c.id) ?? null;
  const when = (iso: string) => new Date(iso).toLocaleString();
</script>

<h1 tabindex="-1" bind:this={heading}>Review</h1>
<p>
  Record your own level for each criterion of the source rubric, with a comment if you wish. In open review, the original marking and the AI reading are shown
  beside the submission throughout. In blind review, they stay hidden until you have judged every criterion and reveal them; you may then revise, and both
  judgements are kept. The AI reading is a suggestion, never a mark; the judgement is yours.
</p>

<Status {message} />
<Problems {problems} />

{#if choices.length}
  <form class="inline" onsubmit={open}>
    <label for="review-id">Submission</label>
    <select id="review-id" bind:value={chosen}>
      {#each choices as c (c.id)}<option value={c.id}>{c.label}</option>{/each}
    </select>
    <button type="submit" disabled={busy}>Review this submission</button>
  </form>
{:else}
  <p>Record the moderation request first.</p>
{/if}

{#if review}
  {@const r = review}
  <h2 tabindex="-1" bind:this={reviewHeading}>Reviewing {r.id} {r.pseudonym}</h2>
  {#if r.problems.length}<Problems problems={r.problems} title="Please check:" />{/if}
  {#if r.notes.length}
    <ul class="notes">
      {#each r.notes as note (note)}<li>{note}</li>{/each}
    </ul>
  {/if}

  {#if r.mode === null && r.text !== null}
    <section aria-labelledby="mode-heading">
      <h3 id="mode-heading">How will you review this submission?</h3>
      <p>
        Choose before anything else is shown; the choice can't be changed. Open review shows the original marking and the AI reading now. Blind review hides
        them until you have recorded a level for every criterion. Blind review isn't possible once you have confirmed this submission's marking.
      </p>
      <div class="actions">
        <button type="button" onclick={() => choose("open")}>Review openly</button>
        <button type="button" onclick={() => choose("blind")}>Review blind</button>
      </div>
    </section>
  {/if}

  {#if r.mode === "blind"}
    {@const judged = r.rubric.criteria.filter((c) => r.judgements.has(c.id)).length}
    <section aria-labelledby="reveal-heading">
      <h3 id="reveal-heading">Blind review</h3>
      {#if r.revealedAt === null}
        <p>{judged} of {r.rubric.criteria.length} criteria judged. When you have judged them all, reveal the original marking and the AI reading, in one action.</p>
        <button type="button" onclick={revealAll}>Reveal the original marking and the AI reading</button>
      {:else}
        <p class="done">Revealed {when(r.revealedAt)}. Your first judgements are kept as they were; a revision is recorded beside each.</p>
      {/if}
    </section>
  {/if}

  {#if r.mode !== null}
    <div class="review">
      <section aria-labelledby="text-heading" class="review-text">
        <h3 id="text-heading">The submission (approved anonymised text)</h3>
        {#if r.text !== null}
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <pre class="text tall" tabindex="0" aria-label={`The text of ${r.id}`}>{r.text}</pre>
        {:else}
          <p class="missing">Not available until the submission is anonymised and approved.</p>
        {/if}
        {#if r.brief !== null}
          <details>
            <summary>The assessment brief</summary>
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <pre class="text" tabindex="0" aria-label="The assessment brief">{r.brief}</pre>
          </details>
        {/if}
        {#each r.markings as m (m.marker_label)}
          <section aria-labelledby={`overall-${markerSlug(m.marker_label)}`}>
            <h4 id={`overall-${markerSlug(m.marker_label)}`}>The {m.marker_label}'s marking overall</h4>
            <p>Overall mark: {m.raw_overall || (m.overall_mark ?? "not recorded")}{m.overall_comment ? "" : "; no overall comment"}{m.confirmed_at ? "" : " (not yet confirmed)"}</p>
            {#if m.overall_comment}<p class="quote">{m.overall_comment}</p>{/if}
            {#if m.annotations.length}
              <h5>Inline comments</h5>
              <p class="hint">Positions are approximate: they are where the comment sits on the marked view.</p>
              <ol class="comments">
                {#each m.annotations as a, i (i)}
                  <li>
                    <span class="where">{a.number !== null ? `Comment ${a.number}, ` : ""}{whereOnPage(a.page, a.position)}{a.criterion_label ? `; tagged ${a.criterion_label}` : ""}</span>
                    {#if a.anchor_text}<span class="where">About (approximately): “{a.anchor_text}”</span>{/if}
                    <span>{a.text}</span>
                  </li>
                {/each}
              </ol>
            {/if}
          </section>
        {/each}
      </section>

      <section aria-labelledby="criteria-heading" class="review-criteria">
        <h3 id="criteria-heading">Criteria</h3>
        {#each r.rubric.criteria as c (c.id)}
          {@const reading = r.readings.get(c.id)}
          {@const recorded = r.judgements.get(c.id)}
          <section class="criterion" aria-labelledby={`c-${c.id}`}>
            <h4 id={`c-${c.id}`}>{c.title}{c.weight !== null ? ` (${c.weight}%)` : ""}</h4>
            {#if c.description}<p class="hint">{c.description}</p>{/if}
            <p class={recorded ? "done" : "missing"}>
              {#if !recorded}
                Not yet judged
              {:else if recorded.mode === "open"}
                Your judgement: {levelLabel(c, recorded.first.level_id)} (recorded {when(recorded.first.recorded_at)}, open review)
              {:else}
                Your first judgement: {levelLabel(c, recorded.first.level_id)} (recorded {when(recorded.first.recorded_at)}, blind){#if recorded.revised}; revised after the reveal to {levelLabel(c, recorded.revised.level_id)} (recorded {when(recorded.revised.recorded_at)}){/if}
              {/if}
            </p>

            {#if r.shown}
              <h5>Original marking</h5>
              {#if r.markings.length}
                <ul>
                  {#each r.markings as m (m.marker_label)}
                    {@const mark = markOf(m, c)}
                    <li>
                      <strong>{m.marker_label}:</strong>
                      {#if mark && mark.mark !== null}
                        {mark.raw_score || mark.mark} ({mark.level_id ? levelLabel(c, mark.level_id) : describeBetween(mark.mark, c)}{mark.raw_label ? `; the marker's level: ${mark.raw_label}` : ""})
                      {:else}
                        no mark for this criterion
                      {/if}
                      {#if mark?.comment}<span class="quote">{mark.comment}</span>{/if}
                    </li>
                  {/each}
                </ul>
              {:else}
                <p class="missing">None</p>
              {/if}

              <h5>AI reading <span class="hint">(a suggestion, never a mark)</span></h5>
              {#if reading}
                <p>Suggested level: {levelLabel(c, reading.suggested_level_id)}{reading.missing_evidence ? " (the model found little evidence)" : ""}</p>
                {#if reading.rationale}<p>{reading.rationale}</p>{/if}
                {#if reading.evidence.length}
                  <ul class="evidence">
                    {#each reading.evidence as e, i (i)}
                      <li>
                        <span class="quote">“{e.text}”</span>
                        <span class={e.verified ? "done" : "attention"}>{e.verified ? "Found in the submission" : "Not found in the submission: check it"}</span>
                      </li>
                    {/each}
                  </ul>
                {/if}
                {#if reading.draft_comment}<p><span class="where">AI draft comment:</span> {reading.draft_comment}</p>{/if}
              {:else}
                <p class="missing">None</p>
              {/if}
            {/if}

            {#if drafts[c.id]}
              {@const revising = r.mode === "blind" && r.revealedAt !== null}
              <fieldset class="judge">
                <legend>{revising ? `Your revised level for ${c.title} (optional)` : `Your level for ${c.title}`}</legend>
                {#each c.levels as l (l.id)}
                  <label class="level">
                    <input type="radio" name={`level-${c.id}`} value={l.id} bind:group={drafts[c.id].level} />
                    <span><strong>{l.label}</strong>{l.points !== null ? ` (${l.points})` : ""} <span class="hint">{l.descriptor}</span></span>
                  </label>
                {/each}
                <label for={`comment-${c.id}`}>Your comment (optional; it is anonymised)</label>
                <textarea id={`comment-${c.id}`} rows="2" bind:value={drafts[c.id].comment}></textarea>
                <div>
                  <button type="button" onclick={() => record(c)} disabled={r.text === null} aria-label={revising ? `Record your revision of ${c.title}` : `Record your judgement of ${c.title}`}>
                    {revising ? (recorded?.revised ? "Change the revision" : "Record a revision") : recorded ? "Change the judgement" : "Record the judgement"}
                  </button>
                </div>
              </fieldset>
            {/if}
          </section>
        {/each}
      </section>
    </div>
  {/if}
{/if}
