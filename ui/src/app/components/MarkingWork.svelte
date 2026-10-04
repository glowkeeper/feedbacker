<script lang="ts">
  import { tick } from "svelte";
  import { chooseReviewMode, criterionMax, entryMark, quickMarks, recordJudgement, recordSubmissionMark, reveal, takesMark, type Criterion, type Level, type ReviewMode, type Workspace } from "../../core/index.ts";
  import { pyFormatG } from "../../core/pytext.ts";
  import { parseMark, problemsOf } from "../forms.ts";
  import { loadMarkingWork, provisionalText, type MarkingWork } from "../markingWork.ts";
  import { asDone } from "../messages.ts";
  import { passageAt, reviewChoices, type Passage } from "../review.ts";
  import type { StepState } from "../steps.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";
  import StepScreen from "./StepScreen.svelte";

  let { workspace, step, onChanged }: { workspace: Workspace; step: StepState | undefined; onChanged: () => void | Promise<void> } = $props();

  let choices: { id: string; label: string }[] = $state([]);
  let chosen = $state("");
  let marking: MarkingWork | null = $state(null);
  let drafts: Record<string, { level: string; mark: string; levelFromAi: boolean; comment: string }> = $state({});
  let overallDraft = $state({ mark: "", comment: "" });
  let overallTouched = false; // once the educator types an overall mark, it is no longer filled in from their criterion marks
  let busy = $state(false);
  let problems: string[] = $state([]);
  let message: string | null = $state(null);
  // The outcome of recording a criterion or the overall mark, beside its button.
  let recordProblem: { id: string; problems: string[] } | null = $state(null);
  let overallNote: string | null = $state(null);
  let overallProblems: string[] = $state([]);
  let heading: HTMLHeadingElement | undefined = $state();
  let frame: HTMLElement | undefined = $state();
  let opened = $state(0); // bumped when a submission is opened, to move focus to it
  let page = $state(""); // the criterion shown in the right-hand pane
  let pageOf = "";
  let pageHeading: HTMLHeadingElement | undefined = $state();
  let overallHeading: HTMLHeadingElement | undefined = $state();
  let highlight: { passage: Passage; what: string } | null = $state(null);
  let highlighted: HTMLElement | undefined = $state();
  let textPane: HTMLElement | undefined = $state();

  $effect(() => {
    reviewChoices(workspace).then(
      (c) => {
        choices = c;
        chosen ||= c[0]?.id ?? "";
      },
      (err) => (problems = problemsOf(err)),
    );
  });
  $effect(() => {
    if (!opened) return;
    heading?.focus({ preventScroll: true });
    frame?.scrollIntoView({ block: "start" });
  });
  $effect(() => {
    if (!highlight || !highlighted || !textPane) return;
    if (getComputedStyle(textPane).overflowY === "auto") textPane.scrollTo({ top: Math.max(0, highlighted.offsetTop - textPane.clientHeight / 2) });
    else highlighted.scrollIntoView({ block: "center" });
  });

  async function openSubmission(id: string) {
    if (busy) return; // buttons stay enabled while busy, so focus isn't lost from them
    busy = true;
    problems = [];
    message = null;
    try {
      chosen = id;
      show(await loadMarkingWork(workspace, id));
    } catch (err) {
      marking = null;
      problems = problemsOf(err);
    } finally {
      busy = false;
    }
  }
  function open(event: SubmitEvent) {
    event.preventDefault();
    void openSubmission(chosen);
  }

  /** A criterion's mark as the box shows it: the one recorded, or the level's points. */
  function markText(c: Criterion, entry: { level_id: string; mark: number | null } | null): string {
    if (!entry) return "";
    const mark = entryMark(c, entry);
    return mark === null ? "" : pyFormatG(mark);
  }
  const prefill = (w: MarkingWork) => (w.implied === null ? "" : pyFormatG(w.implied));

  /** Show a submission afresh, each criterion's form starting from what is recorded. */
  function show(w: MarkingWork) {
    const r = w.review;
    marking = w;
    recordProblem = null;
    overallNote = null;
    overallProblems = [];
    const revising = r.mode === "blind" && r.revealedAt !== null;
    drafts = Object.fromEntries(
      r.rubric.criteria.map((c) => {
        const j = r.judgements.get(c.id);
        const entry = revising ? (j?.revised ?? j?.first ?? null) : (j?.first ?? null);
        return [
          c.id,
          {
            level: entry?.level_id ?? "",
            mark: markText(c, entry),
            levelFromAi: (entry?.level_from_suggestion ?? null) !== null && entry?.level_from_suggestion === r.readings.get(c.id)?.id,
            comment: entry?.comment ?? "",
          },
        ];
      }),
    );
    overallTouched = false;
    overallDraft = { mark: w.overall ? pyFormatG(w.overall.mark) : prefill(w), comment: w.overall?.comment ?? "" };
    if (pageOf !== r.id || !r.rubric.criteria.some((c) => c.id === page)) {
      page = r.rubric.criteria[0]?.id ?? "";
      pageOf = r.id;
      highlight = null;
    }
    opened += 1;
  }

  async function turnTo(id: string) {
    page = id;
    await tick();
    pageHeading?.focus();
  }
  const toOverall = () => overallHeading?.focus();

  async function act(what: (w: MarkingWork) => Promise<string>) {
    if (!marking || busy) return;
    busy = true;
    problems = [];
    message = null;
    try {
      const done = await what(marking);
      await onChanged();
      show(await loadMarkingWork(workspace, marking.review.id));
      message = done;
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      busy = false;
    }
  }
  const choose = (mode: ReviewMode) =>
    act(async (w) => {
      await chooseReviewMode(workspace, w.review.id, mode);
      return mode === "blind" ? `Marking ${w.review.id} blind: the AI's proposals stay hidden until you reveal them.` : `Marking ${w.review.id} with the AI's proposals shown.`;
    });
  const revealAll = () =>
    act(async () => {
      await reveal(workspace, marking!.review.id);
      return "Revealed the AI's proposals. Your levels are kept as you recorded them; you may record a revision of any criterion.";
    });

  const markedLevel = (c: Criterion) => {
    const l = c.levels.find((x) => x.id === drafts[c.id]?.level);
    return l && takesMark(l) ? l : null;
  };
  const markRule = (c: Criterion, l: Level, picks: number[]) =>
    l.min_mark !== null || l.max_mark !== null
      ? `Within ${l.label}: a mark from ${l.min_mark ?? 0} to ${l.max_mark ?? criterionMax(c) ?? "the maximum"}${picks.length ? `, for example ${picks.join(", ")}` : ""}.`
      : `Within ${l.label}: ${picks.join(", ")}, or another mark nearer ${l.label} than any other level.`;
  function chooseLevel(c: Criterion, levelId: string, fromAi: boolean) {
    drafts[c.id].level = levelId;
    drafts[c.id].levelFromAi = fromAi;
    drafts[c.id].mark = markText(c, { level_id: levelId, mark: null });
  }
  /** Take the AI's proposed level, in one action; it is recorded as taken from the proposal while it is unchanged. */
  function takeProposal(c: Criterion, levelId: string) {
    chooseLevel(c, levelId, true);
    document.getElementById(`mark-${c.id}`)?.focus() ?? document.getElementById(`comment-${c.id}`)?.focus();
  }

  /** Record a criterion, then go on to the next one (or the overall mark, after the last). */
  async function record(c: Criterion, next: string | null) {
    if (!marking || busy) return;
    const draft = drafts[c.id];
    busy = true;
    recordProblem = null;
    problems = [];
    message = null;
    try {
      if (!draft.level) throw new Error(`choose your level for ${c.title} first`);
      const suggested = marking.review.readings.get(c.id)?.suggested_level_id ?? null;
      const j = await recordJudgement(workspace, marking.review.id, c.id, {
        levelId: draft.level,
        mark: parseMark(draft.mark, `your mark for ${c.title}`),
        levelFromAi: draft.levelFromAi && draft.level === suggested,
        comment: draft.comment,
      });
      const kept = drafts; // drafts for other criteria are kept
      const w = await loadMarkingWork(workspace, marking.review.id);
      marking = w;
      drafts = kept;
      const entry = j.revised ?? j.first;
      drafts[c.id].comment = entry.comment ?? "";
      drafts[c.id].mark = markText(c, entry);
      if (!w.overall && !overallTouched) overallDraft.mark = prefill(w); // kept in step with the criterion marks until typed over
      await onChanged();
      message = `Recorded ${c.title}: ${c.levels.find((l) => l.id === entry.level_id)?.label ?? entry.level_id}${entry.mark !== null ? `, ${pyFormatG(entry.mark)}` : ""}.`;
      busy = false;
      if (next) await turnTo(next);
      else toOverall();
    } catch (err) {
      recordProblem = { id: c.id, problems: problemsOf(err) };
    } finally {
      busy = false;
    }
  }

  async function saveOverall() {
    if (!marking || busy) return;
    busy = true;
    overallNote = null;
    overallProblems = [];
    try {
      const mark = parseMark(overallDraft.mark, "your overall mark");
      if (mark === null) throw new Error("give your overall mark");
      const m = await recordSubmissionMark(workspace, marking.review.id, { mark, comment: overallDraft.comment });
      const kept = drafts;
      marking = await loadMarkingWork(workspace, marking.review.id);
      drafts = kept;
      overallDraft.comment = m.comment ?? "";
      await onChanged();
      overallNote = `Recorded your overall mark for ${marking.review.id}: ${pyFormatG(m.mark)}.`;
    } catch (err) {
      overallProblems = problemsOf(err);
    } finally {
      busy = false;
    }
  }

  const levelLabel = (c: Criterion, id: string | null) => (id === null ? "no level" : (c.levels.find((l) => l.id === id)?.label ?? id));
  const when = (iso: string) => new Date(iso).toLocaleString();
</script>

<StepScreen title="Marking" {step}>
  {#snippet how()}
    <p>
      Mark each submission: a level and a mark for each criterion of the rubric, with a comment, then an overall mark and comment. Choose for each submission
      whether to see the AI's proposals while you mark, or to mark blind and see them only once you have recorded a level for every criterion. A proposal is
      never a mark: take it or ignore it. Your comments are anonymised when they are saved.
    </p>
  {/snippet}
  {#snippet messages()}
    {#if !marking}
      <Status message={asDone(message)} />
      <Problems {problems} />
    {/if}
  {/snippet}
  {#snippet work()}
    {#if choices.length}
      <form class="inline" onsubmit={open}>
        <label for="mark-id">Submission</label>
        <select id="mark-id" bind:value={chosen}>
          {#each choices as c (c.id)}<option value={c.id}>{c.label}</option>{/each}
        </select>
        <button type="submit" aria-disabled={busy}>Mark this submission</button>
      </form>
    {:else}
      <p>Import the cohort's submissions first.</p>
    {/if}

    {#if marking}
      {@const w = marking}
      {@const r = w.review}
      {@const marked = r.rubric.criteria.filter((c) => r.judgements.has(c.id) && !r.stale.has(c.id)).length}
      {@const provisional = provisionalText(w)}
      <div class="review-frame" bind:this={frame}>
        <div class="review-head">
          <h2 tabindex="-1" bind:this={heading}>Marking {r.id} {r.pseudonym}</h2>
          <Status message={asDone(message)} />
          <Problems {problems} />
          {#if r.mode !== null}
            <p class="review-progress">
              {r.mode === "open" ? "Proposals shown" : r.revealedAt === null ? "Marking blind, proposals not yet revealed" : "Marked blind, proposals revealed"}; {marked} of {r.rubric.criteria.length} criteria marked{w.overall ? `; your overall mark ${pyFormatG(w.overall.mark)}` : ""}.
            </p>
          {/if}
          {#if provisional}<p class="provisional">{provisional}</p>{/if}
          {#if r.problems.length}<Problems problems={r.problems} title="Please check:" />{/if}
          {#if r.notes.length}
            <ul class="notes">
              {#each r.notes as note (note)}<li>{note}</li>{/each}
            </ul>
          {/if}

          {#if r.mode === null && r.text !== null}
            <section aria-labelledby="mode-heading">
              <h3 id="mode-heading">Will you see the AI's proposals while you mark?</h3>
              <p>Choose before anything else is shown; the choice can't be changed. Blind marking hides the proposals until you have recorded a level for every criterion.</p>
              <div class="actions">
                <button type="button" onclick={() => choose("open")}>Show the proposals</button>
                <button type="button" onclick={() => choose("blind")}>Mark blind</button>
              </div>
            </section>
          {/if}

          {#if r.mode === "blind"}
            {#if r.revealedAt === null}
              <p class="reveal">
                When you have marked every criterion, reveal the AI's proposals, in one action.
                <button type="button" onclick={revealAll}>Reveal the AI's proposals</button>
              </p>
            {:else}
              <p class="done">Revealed {when(r.revealedAt)}. Your levels are kept as you recorded them; a revision is recorded beside each.</p>
            {/if}
          {/if}

          {#if r.mode !== null}
            <nav aria-label={`Criteria of ${r.id}`} class="criteria-nav">
              <ol>
                {#each r.rubric.criteria as c, i (c.id)}
                  {@const state = r.stale.has(c.id) ? "Out of date" : r.judgements.has(c.id) ? "Marked" : "Not yet marked"}
                  <li>
                    <button type="button" aria-current={page === c.id ? "step" : undefined} aria-describedby={`cstate-${c.id}`} onclick={() => turnTo(c.id)}>{i + 1}. {c.title}</button>
                    <span id={`cstate-${c.id}`} class={state === "Marked" ? "done" : state === "Out of date" ? "attention" : "missing"}>{state}</span>
                  </li>
                {/each}
                <li><button type="button" onclick={toOverall}>Overall mark<span class="visually-hidden">, below</span></button></li>
              </ol>
            </nav>
          {/if}
        </div>

        {#if r.mode !== null}
          {@const order = r.rubric.criteria.map((c) => c.id)}
          {@const at = order.indexOf(page)}
          {@const previous = at > 0 ? order[at - 1] : null}
          {@const next = at >= 0 && at < order.length - 1 ? order[at + 1] : null}
          {@const titleOf = (id: string) => r.rubric.criteria.find((c) => c.id === id)?.title ?? id}
          <div class="review">
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <section aria-labelledby="text-heading" class="pane review-text" tabindex="0" bind:this={textPane}>
              <h3 id="text-heading">The submission (approved anonymised text)</h3>
              <p class="visually-hidden" role="status">{highlight ? `Highlighted in the submission: ${highlight.what}` : ""}</p>
              {#if r.text !== null}
                {@const h = highlight?.passage}
                <pre class="text" aria-label={`The text of ${r.id}`}>{#if h}{h.before}<mark bind:this={highlighted}>{h.match}</mark>{h.after}{:else}{r.text}{/if}</pre>
                {#if highlight}<p><button type="button" onclick={() => (highlight = null)}>Clear the highlight</button></p>{/if}
              {:else}
                <p class="missing">Not available until the submission is anonymised and approved.</p>
              {/if}
              {#if r.brief !== null}
                <details>
                  <summary>The assessment brief</summary>
                  <pre class="text" aria-label="The assessment brief">{r.brief}</pre>
                </details>
              {/if}
            </section>

            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <section aria-labelledby="page-heading" class="pane review-criterion" tabindex="0">
              {#each r.rubric.criteria as c, i (c.id)}
                {#if page === c.id}
                  {@const proposal = r.readings.get(c.id)}
                  {@const recorded = r.judgements.get(c.id)}
                  {@const outOfDate = r.stale.has(c.id)}
                  {@const revising = r.mode === "blind" && r.revealedAt !== null}
                  <section class="criterion" aria-labelledby="page-heading">
                    <h3 id="page-heading" tabindex="-1" bind:this={pageHeading}>{i + 1}. {c.title}{c.weight !== null ? ` (${c.weight}%)` : ""}</h3>
                    <div class="pager actions">
                      {#if previous}<button type="button" onclick={() => turnTo(previous)}>Previous<span class="visually-hidden"> criterion, {titleOf(previous)}</span></button>{/if}
                      {#if next}<button type="button" onclick={() => turnTo(next)}>Next: {titleOf(next)}</button>{:else}<button type="button" onclick={toOverall}>Next: Overall mark<span class="visually-hidden">, below</span></button>{/if}
                    </div>
                    {#if c.description}<p class="hint">{c.description}</p>{/if}
                    <p class={outOfDate ? "attention" : recorded ? "done" : "missing"}>
                      {#if !recorded}
                        Not yet marked
                      {:else}
                        Your level: {levelLabel(c, recorded.first.level_id)}{recorded.first.mark !== null ? `, ${pyFormatG(recorded.first.mark)}` : ""}{recorded.first.level_from_suggestion ? " (the AI's proposed level)" : ""}{#if recorded.revised}; revised after the reveal to {levelLabel(c, recorded.revised.level_id)}{recorded.revised.mark !== null ? `, ${pyFormatG(recorded.revised.mark)}` : ""}{/if}
                      {/if}
                      {#if outOfDate}
                        <br /><strong>Out of date:</strong> marked against an earlier approved text or source rubric. Check your level and record it again.
                      {/if}
                    </p>

                    {#if r.shown}
                      <h4>AI proposal <span class="hint">(never a mark)</span></h4>
                      {#if proposal}
                        <p>Proposed level: {levelLabel(c, proposal.suggested_level_id)}{proposal.missing_evidence ? " (the AI found little evidence)" : ""}</p>
                        {#if proposal.rationale}<p>{proposal.rationale}</p>{/if}
                        {#if proposal.evidence.length}
                          <ul class="evidence">
                            {#each proposal.evidence as e, k (k)}
                              {@const found = r.text !== null && e.verified ? passageAt(r.text, e.text, e.start, e.end) : null}
                              <li>
                                <span class="quote">“{e.text}”</span>
                                <span class={e.verified ? "done" : "attention"}>{e.verified ? "Found in the submission" : "Not found in the submission: check it"}</span>
                                {#if found}
                                  <button type="button" class="show-passage" onclick={() => (highlight = { passage: found, what: `quote ${k + 1} of the AI proposal for ${c.title}` })}
                                    >Show in the text<span class="visually-hidden"> for quote {k + 1} of the AI proposal for {c.title}</span></button
                                  >
                                {/if}
                              </li>
                            {/each}
                          </ul>
                        {/if}
                        {#if proposal.suggested_level_id !== null && drafts[c.id]}
                          {@const levelId = proposal.suggested_level_id}
                          <button type="button" onclick={() => takeProposal(c, levelId)}>Take the proposed level<span class="visually-hidden"> for {c.title}</span></button>
                        {/if}
                      {:else}
                        <p class="missing">None</p>
                      {/if}
                    {/if}

                    {#if drafts[c.id]}
                      <fieldset class="judge">
                        <legend>{revising ? `Your revised level for ${c.title} (optional)` : `Your level for ${c.title}`}</legend>
                        {#each c.levels as l (l.id)}
                          <label class="level">
                            <input type="radio" name={`level-${c.id}`} value={l.id} bind:group={drafts[c.id].level} onchange={() => chooseLevel(c, l.id, false)} />
                            <span><strong>{l.label}</strong>{l.points !== null ? ` (${l.points})` : ""} <span class="hint">{l.descriptor}</span></span>
                          </label>
                        {/each}
                        {#if markedLevel(c)}
                          {@const chosenLevel = markedLevel(c)!}
                          {@const picks = quickMarks(c, chosenLevel)}
                          <div class="mark-row">
                            <label for={`mark-${c.id}`}>Your mark for {c.title}</label>
                            <span class="hint" id={`mark-hint-${c.id}`}>{markRule(c, chosenLevel, picks)}</span>
                            <div class="actions">
                              {#each picks as m (m)}
                                <button type="button" aria-label={`${pyFormatG(m)} for ${c.title}`} aria-pressed={drafts[c.id].mark.trim() === pyFormatG(m)} onclick={() => (drafts[c.id].mark = pyFormatG(m))}>{pyFormatG(m)}</button>
                              {/each}
                              <input id={`mark-${c.id}`} class="mark" type="text" inputmode="decimal" bind:value={drafts[c.id].mark} aria-describedby={`mark-hint-${c.id}`} />
                            </div>
                          </div>
                        {/if}
                        {#if drafts[c.id].levelFromAi && drafts[c.id].level === proposal?.suggested_level_id}
                          <p class="hint">The level is the AI's proposal: it will be recorded as taken from it unless you choose another.</p>
                        {/if}
                        <label for={`comment-${c.id}`}>Your comment on {c.title} (it is anonymised)</label>
                        <textarea id={`comment-${c.id}`} rows="3" bind:value={drafts[c.id].comment}></textarea>
                        <div>
                          <button type="button" onclick={() => record(c, next)} disabled={r.text === null}>
                            {outOfDate ? "Record it again" : "Record"}{next ? " and go to the next criterion" : " and go to the overall mark"}<span class="visually-hidden">, from {c.title}</span>
                          </button>
                        </div>
                        <Problems problems={recordProblem?.id === c.id ? (recordProblem?.problems ?? []) : []} />
                      </fieldset>
                    {/if}
                  </section>
                {/if}
              {/each}
            </section>
          </div>
        {/if}
      </div>

      {#if r.mode !== null}
        <section aria-labelledby="overall-heading" class="comparison">
          <h3 id="overall-heading" tabindex="-1" bind:this={overallHeading}>Overall mark: {r.id} {r.pseudonym}</h3>
          <p class={w.overallStale ? "attention" : w.overall ? "done" : "missing"}>
            {#if w.overall}
              Your overall mark: {pyFormatG(w.overall.mark)} (recorded {when(w.overall.provenance.timestamp)}){w.overallStale ? "; given on other criterion marks than there are now: check it again" : ""}
            {:else}
              No overall mark yet
            {/if}
          </p>
          {#if provisional}<p class="provisional">{provisional}. Your mark is the one that counts.</p>{/if}
          <fieldset class="judge">
            <legend>Your overall mark for {r.id}</legend>
            <label for="overall-mark">Overall mark</label>
            <p class="hint" id="overall-mark-hint">
              {#if w.implied !== null}
                Your criterion marks imply {pyFormatG(w.implied)}{w.overall ? "" : ", so it starts from that"}; change it if you need to. Both are recorded.
              {:else}
                Once every criterion is marked (and the rubric has weights), it starts from the overall your criterion marks imply.
              {/if}
            </p>
            <input id="overall-mark" type="text" inputmode="decimal" bind:value={overallDraft.mark} aria-describedby="overall-mark-hint" oninput={() => (overallTouched = true)} />
            <label for="overall-comment">Your overall comment (it is anonymised)</label>
            <textarea id="overall-comment" rows="3" bind:value={overallDraft.comment}></textarea>
            <div class="actions">
              <button type="button" onclick={saveOverall} disabled={r.text === null}>{w.overall ? "Change the overall mark" : "Record the overall mark"}</button>
              {#if w.next}
                {@const following = w.next}
                <button type="button" onclick={() => openSubmission(following.id)}>Next submission: {following.label}</button>
              {/if}
            </div>
            <Status message={asDone(overallNote)} />
            <Problems problems={overallProblems} />
          </fieldset>
        </section>
      {/if}
    {/if}
  {/snippet}
</StepScreen>
