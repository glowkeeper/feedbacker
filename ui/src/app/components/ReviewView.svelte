<script lang="ts">
  import { tick } from "svelte";
  import TableRegion from "./TableRegion.svelte";
  import { chooseReviewMode, criterionMax, describeBetween, entryMark, markerSlug, quickMarks, takesMark, type Level, recordJudgement, recordVerdict, reveal, type Criterion, type OriginalAssessment, type ReviewMode, type Verdict, type Workspace } from "../../core/index.ts";
  import { compare, compareOverall, yourImpliedMark } from "../comparison.ts";
  import { pyFormatG } from "../../core/pytext.ts";
  import { inApp, parseMark, problemsOf } from "../forms.ts";
  import { loadReview, passageAt, passageOf, reviewChoices, whereOnPage, type Passage, type Review } from "../review.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";
  import { asDone } from "../messages.ts";

  let { workspace, onChanged }: { workspace: Workspace; onChanged: () => void } = $props();

  let choices: { id: string; label: string }[] = $state([]);
  let chosen = $state("");
  let review: Review | null = $state(null);
  let drafts: Record<string, { level: string; mark: string; levelFromAi: boolean; comment: string; fromAi: boolean }> = $state({});
  let verdictDraft = $state({ verdict: "", mark: "", comment: "" });
  let verdictMarkTouched = false; // once the moderator types a suggested mark, it is no longer filled in from their marks
  let busy = $state(false);
  let problems: string[] = $state([]);
  let message: string | null = $state(null);
  // The outcome of recording a criterion, shown beside its button: the screen's own status is out of view by then.
  let recordedNote: { id: string; text: string } | null = $state(null);
  let recordProblem: { id: string; problems: string[] } | null = $state(null);
  // The outcome of recording the verdict, beside its button: the comparison and verdict are below the review window.
  let verdictNote: string | null = $state(null);
  let verdictProblems: string[] = $state([]);
  let heading: HTMLHeadingElement;
  let reviewHeading: HTMLHeadingElement | undefined = $state();
  let frame: HTMLElement | undefined = $state(); // the review, sized to the window on wide screens
  let opened = $state(0); // bumped when a submission is opened (or its view changes), to move focus to it; not after each judgement
  // The right-hand pane shows one criterion at a time; the comparison and verdict follow the review window, full width.
  let page = $state(""); // a criterion's id
  let pageOf = ""; // the submission the page belongs to: opening another starts again at its first criterion
  let pageHeading: HTMLHeadingElement | undefined = $state();
  let comparisonHeading: HTMLHeadingElement | undefined = $state();
  // A passage highlighted in the submission's text, and why (said in the text pane's status, for screen readers).
  let highlight: { passage: Passage; what: string } | null = $state(null);
  let highlighted: HTMLElement | undefined = $state();
  let textPane: HTMLElement | undefined = $state();

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
    if (busy) return; // the button stays enabled while busy, so focus isn't lost from it
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
  // On opening, the review is brought to the top of the window (where it fills it, on wide screens), with focus on its heading.
  $effect(() => {
    if (!opened) return;
    reviewHeading?.focus({ preventScroll: true });
    frame?.scrollIntoView({ block: "start" });
  });
  // A highlighted passage is scrolled into view within the text pane, and only the pane while it scrolls on its own (wide
  // screens); focus stays where it is.
  $effect(() => {
    if (!highlight || !highlighted || !textPane) return;
    if (getComputedStyle(textPane).overflowY === "auto") textPane.scrollTo({ top: Math.max(0, highlighted.offsetTop - textPane.clientHeight / 2) });
    else highlighted.scrollIntoView({ block: "center" });
  });

  /** The pages of the right-hand pane: each criterion. */
  const pages = (r: Review) => r.rubric.criteria.map((c) => c.id);
  /** Go down to the comparison and verdict, with focus on its heading. */
  const toComparison = () => comparisonHeading?.focus();
  /** Move to another page, and focus to its heading once it is shown. */
  async function turnTo(id: string) {
    page = id;
    await tick();
    pageHeading?.focus();
  }
  const criterionState = (r: Review, c: Criterion) => (r.stale.has(c.id) ? "Out of date" : r.judgements.has(c.id) ? "Judged" : "Not yet judged");

  function showPassage(passage: Passage | null, what: string) {
    if (passage) highlight = { passage, what };
  }

  /** Show a review afresh, with each criterion's form starting from what is recorded. */
  function show(r: Review) {
    review = r;
    recordedNote = null;
    recordProblem = null;
    verdictNote = null;
    verdictProblems = [];
    const revising = r.mode === "blind" && r.revealedAt !== null;
    drafts = Object.fromEntries(
      r.rubric.criteria.map((c) => {
        const j = r.judgements.get(c.id);
        const entry = revising ? (j?.revised ?? null) : (j?.first ?? null);
        return [
          c.id,
          {
            level: entry?.level_id ?? j?.first.level_id ?? "",
            mark: markText(c, entry ?? j?.first ?? null),
            // Still taken from the AI only while that very suggestion is the current reading's; a revision starts from the moderator's first level.
            levelFromAi: (entry?.level_from_suggestion ?? null) !== null && entry?.level_from_suggestion === r.readings.get(c.id)?.id,
            comment: entry?.comment ?? "",
            fromAi: entry?.comment_derived_from_ai ?? false,
          },
        ];
      }),
    );
    verdictMarkTouched = false;
    if (pageOf !== r.id || !pages(r).includes(page)) {
      page = r.rubric.criteria[0]?.id ?? "";
      pageOf = r.id;
      highlight = null;
    }
    verdictDraft = { verdict: r.verdict?.verdict ?? "", mark: r.verdict ? (r.verdict.suggested_mark === null ? "" : String(r.verdict.suggested_mark)) : prefill(r), comment: r.verdict?.comment ?? "" };
    opened += 1;
  }

  /** A criterion's mark as the box shows it: the one recorded, or the level's points. */
  function markText(c: Criterion, entry: { level_id: string; mark: number | null } | null): string {
    if (!entry) return "";
    const mark = entryMark(c, entry);
    return mark === null ? "" : pyFormatG(mark);
  }
  /** The suggested mark to start from: the overall the moderator's marks imply, rounded; empty while it can't be worked out. */
  const prefill = (r: Review) => {
    const implied = yourImpliedMark(r);
    return implied === null ? "" : String(Math.round(implied));
  };
  /** The level chosen for a criterion, if it takes a mark (it has points, or a mark range). */
  const markedLevel = (c: Criterion) => {
    const l = c.levels.find((x) => x.id === drafts[c.id]?.level);
    return l && takesMark(l) ? l : null;
  };
  /** How a mark must fit the level, for the hint. */
  const markRule = (c: Criterion, l: Level, picks: number[]) =>
    l.min_mark !== null || l.max_mark !== null
      ? `Within ${l.label}: a mark from ${l.min_mark ?? 0} to ${l.max_mark ?? criterionMax(c) ?? "the maximum"}${picks.length ? `, for example ${picks.join(", ")}` : ""}.`
      : `Within ${l.label}: ${picks.join(", ")}, or another mark nearer ${l.label} than any other level.`;
  /** A level chosen: its mark starts from the level's points. */
  function chooseLevel(c: Criterion, levelId: string, fromAi: boolean) {
    drafts[c.id].level = levelId;
    drafts[c.id].levelFromAi = fromAi;
    drafts[c.id].mark = markText(c, { level_id: levelId, mark: null });
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
    recordedNote = null;
    recordProblem = null;
    try {
      if (!draft.level) throw new Error(`choose your level for ${criterion.title} first`);
      const mark = parseMark(draft.mark, `your mark for ${criterion.title}`); // empty: the level's points
      const suggested = review.readings.get(criterion.id)?.suggested_level_id ?? null;
      const j = await recordJudgement(workspace, review.id, criterion.id, {
        levelId: draft.level,
        mark,
        levelFromAi: draft.levelFromAi && draft.level === suggested,
        comment: draft.comment,
        derivedFromAi: draft.fromAi && draft.comment.trim() !== "",
      });
      review = await loadReview(workspace, review.id); // drafts for other criteria are kept
      const entry = j.revised ?? j.first;
      draft.comment = entry.comment ?? "";
      draft.fromAi = entry.comment_derived_from_ai;
      draft.levelFromAi = entry.level_from_suggestion !== null;
      draft.mark = markText(criterion, entry);
      if (!review.verdict && !verdictMarkTouched) verdictDraft.mark = prefill(review); // kept in step with the marks until typed over
      onChanged();
      recordedNote = { id: criterion.id, text: `Recorded your ${j.revised ? "revision" : "judgement"} of ${criterion.title}: ${levelLabel(criterion, entry.level_id)}.` };
    } catch (err) {
      recordProblem = { id: criterion.id, problems: problemsOf(err) };
    } finally {
      busy = false;
    }
  }

  const VERDICTS: [Verdict, string, string][] = [
    ["agree", "Agree", "the marking is fair"],
    ["generous", "Generous", "marked too high"],
    ["harsh", "Harsh", "marked too low"],
    ["inconsistent", "Inconsistent", "the rubric isn't applied consistently"],
  ];
  const verdictName = (v: Verdict) => VERDICTS.find(([id]) => id === v)![1];

  async function saveVerdict() {
    if (!review || busy) return; // stays enabled while saving, so focus isn't lost from it
    busy = true;
    problems = [];
    message = null;
    try {
      verdictNote = null;
      verdictProblems = [];
      if (!verdictDraft.verdict) throw new Error("choose a verdict first");
      const v = await recordVerdict(workspace, review.id, {
        verdict: verdictDraft.verdict as Verdict,
        suggestedMark: parseMark(verdictDraft.mark, "the suggested mark"),
        comment: verdictDraft.comment,
      });
      review = await loadReview(workspace, review.id);
      verdictDraft.comment = v.comment ?? "";
      onChanged();
      verdictNote = `Recorded your verdict on ${review.id}: ${verdictName(v.verdict)}.`;
    } catch (err) {
      verdictProblems = problemsOf(err);
    } finally {
      busy = false;
    }
  }

  /**
   * Start from the AI reading: its suggested level and its draft comment, where it has them. Each is recorded as
   * taken from the AI, the level only while it is unchanged, the comment however much it is changed.
   */
  function startFromReading(c: Criterion, levelId: string | null, text: string | null) {
    if (levelId !== null) chooseLevel(c, levelId, true);
    if (text) {
      drafts[c.id].comment = text;
      drafts[c.id].fromAi = true;
    }
    document.getElementById(`comment-${c.id}`)?.focus();
  }
  function writeOwn(c: Criterion) {
    drafts[c.id].comment = "";
    drafts[c.id].fromAi = false;
    document.getElementById(`comment-${c.id}`)?.focus();
  }

  const levelLabel = (c: Criterion, id: string | null) => (id === null ? "no level" : (c.levels.find((l) => l.id === id)?.label ?? id));
  const markOf = (m: OriginalAssessment, c: Criterion) => m.criterion_marks.find((x) => x.criterion_id === c.id) ?? null;
  const when = (iso: string) => new Date(iso).toLocaleString();
</script>

<h1 tabindex="-1" bind:this={heading}>Review</h1>
<details class="about">
  <summary>How review works</summary>
  <p>
    Record your own level for each criterion of the source rubric, with a comment if you wish. In open review, the original marking and the AI reading are shown
    beside the submission throughout. In blind review, they stay hidden until you have judged every criterion and reveal them; you may then revise, and both
    judgements are kept. The AI reading is a suggestion, never a mark; the judgement is yours.
  </p>
</details>

{#if !review}
  <Status message={asDone(message)} />
  <Problems {problems} />
{/if}

{#if choices.length}
  <form class="inline" onsubmit={open}>
    <label for="review-id">Submission</label>
    <select id="review-id" bind:value={chosen}>
      {#each choices as c (c.id)}<option value={c.id}>{c.label}</option>{/each}
    </select>
    <button type="submit" aria-disabled={busy}>Review this submission</button>
  </form>
{:else}
  <p>Record the moderation request first.</p>
{/if}

{#if review}
  {@const r = review}
  {@const judged = r.rubric.criteria.filter((c) => r.judgements.has(c.id) && !r.stale.has(c.id)).length}
  {@const outOfDate = r.rubric.criteria.filter((c) => r.stale.has(c.id)).length}
  <div class="review-frame" bind:this={frame}>
  <div class="review-head">
    <h2 tabindex="-1" bind:this={reviewHeading}>Reviewing {r.id} {r.pseudonym}</h2>
    <Status message={asDone(message)} />
    <Problems {problems} />
    {#if r.mode !== null}
      <p class="review-progress">
        {r.mode === "open" ? "Open review" : r.revealedAt === null ? "Blind review, not yet revealed" : "Blind review, revealed"}; {judged} of {r.rubric.criteria.length} criteria judged{outOfDate ? `; ${outOfDate} out of date, to record again` : ""}.
      </p>
    {/if}
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
      {#if r.revealedAt === null}
        <p class="reveal">
          When you have judged every criterion, reveal the original marking and the AI reading, in one action.
          <button type="button" onclick={revealAll}>Reveal the original marking and the AI reading</button>
        </p>
      {:else}
        <p class="done">Revealed {when(r.revealedAt)}. Your first judgements are kept as they were; a revision is recorded beside each.</p>
      {/if}
    {/if}

    {#if r.mode !== null}
      <nav aria-label={`Criteria of ${r.id}`} class="criteria-nav">
        <ol>
          {#each r.rubric.criteria as c, i (c.id)}
            {@const state = criterionState(r, c)}
            <li>
              <button type="button" aria-current={page === c.id ? "step" : undefined} aria-describedby={`cstate-${c.id}`} onclick={() => turnTo(c.id)}>{i + 1}. {c.title}</button>
              <span id={`cstate-${c.id}`} class={state === "Judged" ? "done" : state === "Out of date" ? "attention" : "missing"}>{state}</span>
            </li>
          {/each}
          {#if r.shown}
            <li><button type="button" onclick={toComparison}>Comparison and verdict<span class="visually-hidden">, below</span></button></li>
          {/if}
        </ol>
      </nav>
    {/if}
  </div>

  {#if r.mode !== null}
    {@const order = pages(r)}
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
        {#each r.markings as m (m.marker_label)}
          <section aria-labelledby={`overall-${markerSlug(m.marker_label)}`}>
            <h4 id={`overall-${markerSlug(m.marker_label)}`}>The {m.marker_label}'s marking overall</h4>
            <p>Overall mark: {m.raw_overall || (m.overall_mark ?? "not recorded")}{m.overall_comment ? "" : "; no overall comment"}{m.confirmed_at ? "" : " (not yet confirmed)"}</p>
            {#if m.overall_comment}<p class="quote">{m.overall_comment}</p>{/if}
            {#if m.import_notes.length}
              <h5>Noted on import</h5>
              <ul>
                {#each m.import_notes as note, i (i)}<li>{inApp(note)}</li>{/each}
              </ul>
            {/if}
            {#if m.annotations.length}
              <h5>Inline comments</h5>
              <p class="hint">Positions are approximate: they are where the comment sits on the marked view.</p>
              <ol class="comments">
                {#each m.annotations as a, i (i)}
                  {@const anchor = r.text !== null ? passageOf(r.text, a.anchor_text) : null}
                  <li>
                    <span class="where">{a.number !== null ? `Comment ${a.number}, ` : ""}{whereOnPage(a.page, a.position)}{a.criterion_label ? `; tagged ${a.criterion_label}` : ""}</span>
                    {#if a.anchor_text}
                      <span class="where"
                        >About (approximately): “{a.anchor_text}”{#if anchor}{" "}<button type="button" class="show-passage" onclick={() => showPassage(anchor, `the passage of the ${m.marker_label}'s comment ${a.number ?? i + 1}`)}
                            >Show in the text<span class="visually-hidden"> for the {m.marker_label}'s comment {a.number ?? i + 1}</span></button
                          >{/if}</span
                      >
                    {/if}
                    <span>{a.text}</span>
                  </li>
                {/each}
              </ol>
            {/if}
          </section>
        {/each}
      </section>

      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <section aria-labelledby="page-heading" class="pane review-criterion" tabindex="0">
        {#snippet pager()}
          <div class="pager actions">
            {#if previous}<button type="button" onclick={() => turnTo(previous)}>Previous<span class="visually-hidden"> criterion, {titleOf(previous)}</span></button>{/if}
            {#if next}<button type="button" onclick={() => turnTo(next)}>Next: {titleOf(next)}</button>
            {:else if r.shown}<button type="button" onclick={toComparison}>Next: Comparison and verdict<span class="visually-hidden">, below</span></button>{/if}
          </div>
        {/snippet}
        {#each r.rubric.criteria as c, i (c.id)}
          {#if page === c.id}
            {@const reading = r.readings.get(c.id)}
            {@const recorded = r.judgements.get(c.id)}
            {@const outOfDate = r.stale.has(c.id)}
            <section class="criterion" aria-labelledby="page-heading">
              <h3 id="page-heading" tabindex="-1" bind:this={pageHeading}>{i + 1}. {c.title}{c.weight !== null ? ` (${c.weight}%)` : ""}</h3>
              {@render pager()}
              {#if c.description}<p class="hint">{c.description}</p>{/if}
              <p class={outOfDate ? "attention" : recorded ? "done" : "missing"}>
                {#if !recorded}
                  Not yet judged
                {:else if recorded.mode === "open"}
                  Your judgement: {levelLabel(c, recorded.first.level_id)} (recorded {when(recorded.first.recorded_at)}, open review){recorded.first.level_from_suggestion ? "; level taken from the AI suggestion" : ""}{recorded.first.comment_derived_from_ai ? "; comment adapted from the AI draft" : ""}
                {:else}
                  Your first judgement: {levelLabel(c, recorded.first.level_id)} (recorded {when(recorded.first.recorded_at)}, blind){#if recorded.revised}; revised after the reveal to {levelLabel(c, recorded.revised.level_id)} (recorded {when(recorded.revised.recorded_at)}){recorded.revised.level_from_suggestion ? "; level taken from the AI suggestion" : ""}{recorded.revised.comment_derived_from_ai ? "; comment adapted from the AI draft" : ""}{/if}
                {/if}
                {#if outOfDate}
                  <br /><strong>Out of date:</strong> judged against an earlier approved text or source rubric. Check your level and record it again.
                {/if}
              </p>

              {#if r.shown}
                <h4>Original marking</h4>
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

                <h4>AI reading <span class="hint">(a suggestion, never a mark)</span></h4>
                {#if reading}
                  <p>Suggested level: {levelLabel(c, reading.suggested_level_id)}{reading.missing_evidence ? " (the model found little evidence)" : ""}</p>
                  {#if reading.rationale}<p>{reading.rationale}</p>{/if}
                  {#if reading.evidence.length}
                    <ul class="evidence">
                      {#each reading.evidence as e, k (k)}
                        {@const found = r.text !== null && e.verified ? passageAt(r.text, e.text, e.start, e.end) : null}
                        <li>
                          <span class="quote">“{e.text}”</span>
                          <span class={e.verified ? "done" : "attention"}>{e.verified ? "Found in the submission" : "Not found in the submission: check it"}</span>
                          {#if found}
                            <button type="button" class="show-passage" onclick={() => showPassage(found, `quote ${k + 1} of the AI reading of ${c.title}`)}
                              >Show in the text<span class="visually-hidden"> for quote {k + 1} of the AI reading of {c.title}</span></button
                            >
                          {/if}
                        </li>
                      {/each}
                    </ul>
                  {/if}
                  {#if reading.draft_comment}<p><span class="where">AI draft comment:</span> {reading.draft_comment}</p>{/if}
                  {#if drafts[c.id] && (reading.suggested_level_id !== null || reading.draft_comment)}
                    {@const levelId = reading.suggested_level_id}
                    {@const draftText = reading.draft_comment}
                    <button type="button" onclick={() => startFromReading(c, levelId, draftText)}>Start from the AI reading<span class="visually-hidden"> for {c.title}</span></button>
                  {/if}
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
                      <input type="radio" name={`level-${c.id}`} value={l.id} bind:group={drafts[c.id].level} onchange={() => chooseLevel(c, l.id, false)} />
                      <span><strong>{l.label}</strong>{l.points !== null ? ` (${l.points})` : ""} <span class="hint">{l.descriptor}</span></span>
                    </label>
                  {/each}
                  {#if markedLevel(c)}
                    {@const chosen = markedLevel(c)!}
                    {@const picks = quickMarks(c, chosen)}
                    <div class="mark-row">
                      <label for={`mark-${c.id}`}>Your mark for {c.title}</label>
                      <span class="hint" id={`mark-hint-${c.id}`}>{markRule(c, chosen, picks)}</span>
                      <div class="actions">
                        {#each picks as m (m)}
                          <button type="button" aria-label={`${pyFormatG(m)} for ${c.title}`} aria-pressed={drafts[c.id].mark.trim() === pyFormatG(m)} onclick={() => (drafts[c.id].mark = pyFormatG(m))}>{pyFormatG(m)}</button>
                        {/each}
                        <input id={`mark-${c.id}`} class="mark" type="text" inputmode="decimal" bind:value={drafts[c.id].mark} aria-describedby={`mark-hint-${c.id}`} />
                      </div>
                    </div>
                  {/if}
                  {#if drafts[c.id].levelFromAi && drafts[c.id].level === reading?.suggested_level_id}
                    <p class="hint">The level is the AI's suggestion: it will be recorded as taken from it unless you choose another.</p>
                  {/if}
                  <label for={`comment-${c.id}`}>Your comment (optional; it is anonymised)</label>
                  <textarea
                    id={`comment-${c.id}`}
                    rows="3"
                    bind:value={drafts[c.id].comment}
                    oninput={() => {
                      if (!drafts[c.id].comment.trim()) drafts[c.id].fromAi = false; // emptied: whatever is written next is the moderator's own
                    }}
                    aria-describedby={drafts[c.id].fromAi ? `derived-${c.id}` : undefined}
                  ></textarea>
                  {#if drafts[c.id].fromAi && drafts[c.id].comment.trim()}
                    <p class="hint" id={`derived-${c.id}`}>
                      Adapted from the AI draft: it will be recorded as derived from it, however much you change it.
                      <button type="button" onclick={() => writeOwn(c)}>Clear and write my own<span class="visually-hidden"> comment on {c.title}</span></button>
                    </p>
                  {/if}
                  <div>
                    <button type="button" onclick={() => record(c)} disabled={r.text === null}>
                      {outOfDate ? "Record it again" : revising ? (recorded?.revised ? "Change the revision" : "Record a revision") : recorded ? "Change the judgement" : "Record the judgement"}<span class="visually-hidden"> of {c.title}</span>
                    </button>
                  </div>
                  <Status message={asDone(recordedNote?.id === c.id ? recordedNote.text : null)} />
                  <Problems problems={recordProblem?.id === c.id ? recordProblem.problems : []} />
                </fieldset>
              {/if}
            </section>
          {/if}
        {/each}

      </section>
    </div>
  {/if}
  </div>
  {#if r.mode !== null && r.shown}
    {@const rows = compare(r)}
    {@const overall = compareOverall(r)}
    <section aria-labelledby="comparison-heading" class="comparison">
      <h3 id="comparison-heading" tabindex="-1" bind:this={comparisonHeading}>Comparison: {r.id} {r.pseudonym}</h3>
      {#if !r.judgements.size}<p class="missing">Record a judgement to compare it with the marking and the AI reading.</p>{/if}
      {#if rows.length}
        <TableRegion label="Comparison table">
          <table>
            <caption>{r.id} {r.pseudonym}: your level, each marker's mark and the AI suggestion, criterion by criterion, then overall. Differences are stated in words.</caption>
            <thead>
              <tr>
                <th scope="col">Criterion</th>
                <th scope="col">Your level</th>
                {#each r.markings as m (m.marker_label)}<th scope="col">The {m.marker_label}</th>{/each}
                <th scope="col">AI suggestion</th>
              </tr>
            </thead>
            <tbody>
              {#each rows as row (row.criterionId)}
                <tr>
                  <th scope="row">{row.title}</th>
                  <td class={row.yours ? "" : "missing"}>{row.yours ?? "Not yet judged"}</td>
                  {#each row.markers as { marker, cell } (marker)}
                    <td>
                      {cell.text}
                      {#if cell.comparison}<span class={cell.differs ? "compare attention" : "compare done"}>{cell.differs ? `Differs: ${cell.comparison}` : cell.comparison}</span>{/if}
                      {#if cell.flag}<span class="compare flag">Check: {cell.flag}</span>{/if}
                    </td>
                  {/each}
                  <td>
                    {#if row.ai}
                      {row.ai.text}
                      {#if row.ai.comparison}<span class={row.ai.differs ? "compare attention" : "compare done"}>{row.ai.differs ? `Differs: ${row.ai.comparison}` : row.ai.comparison}</span>{/if}
                    {:else}
                      <span class="missing">None</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
            {#if overall}
              <tfoot>
                <tr>
                  <th scope="row">Overall</th>
                  <td>{overall.yours}</td>
                  {#each overall.markers as { marker, text } (marker)}<td>{text}</td>{/each}
                  <td class={overall.ai ? "" : "missing"}>{overall.ai ?? "None"}</td>
                </tr>
              </tfoot>
            {/if}
          </table>
        </TableRegion>
        {#if overall && r.rubric.criteria.some((c) => c.weight === null)}
          <p class="hint">Overall marks from levels need each criterion's weight. Weights are set when the rubric is imported (Rubric, "Criterion weights").</p>
        {/if}
      {/if}

      {#if r.markings.length}
        <section aria-labelledby="verdict-heading">
          <h4 id="verdict-heading">Your verdict on the marking</h4>
          <p class={r.verdictStale ? "attention" : r.verdict ? "done" : "missing"}>
            {#if r.verdict}
              Your verdict: {verdictName(r.verdict.verdict)}{r.verdict.suggested_mark !== null ? `; suggested mark ${r.verdict.suggested_mark}` : ""} (recorded {when(r.verdict.provenance.timestamp)}){r.verdictStale ? "; given on earlier marking or text: check it again" : ""}
            {:else}
              No verdict yet
            {/if}
          </p>
          <fieldset class="judge verdict">
            <legend>How was {r.id} marked?</legend>
            {#each VERDICTS as [id, name, meaning] (id)}
              <label class="level"><input type="radio" name="verdict" value={id} bind:group={verdictDraft.verdict} /> <span><strong>{name}</strong> <span class="hint">{meaning}</span></span></label>
            {/each}
            <label for="verdict-mark">Suggested mark (optional)</label>
            <p class="hint" id="verdict-mark-hint">
              {#if yourImpliedMark(r) !== null}
                Your criterion marks imply {pyFormatG(yourImpliedMark(r)!)}{r.verdict ? "" : ", so it starts from that, rounded"}; change it if you need to. Both are recorded.
              {:else}
                Once every criterion is judged (and the rubric has weights), it starts from the overall your criterion marks imply.
              {/if}
            </p>
            <input id="verdict-mark" type="text" inputmode="decimal" bind:value={verdictDraft.mark} aria-describedby="verdict-mark-hint" oninput={() => (verdictMarkTouched = true)} />
            <label for="verdict-comment">Your comment (optional; it is anonymised)</label>
            <textarea id="verdict-comment" rows="3" bind:value={verdictDraft.comment}></textarea>
            <div>
              <button type="button" onclick={saveVerdict} disabled={r.text === null}>{r.verdict ? "Change the verdict" : "Record the verdict"}</button>
            </div>
            <Status message={asDone(verdictNote)} />
            <Problems problems={verdictProblems} />
          </fieldset>
        </section>
      {/if}
    </section>
  {/if}
{/if}
