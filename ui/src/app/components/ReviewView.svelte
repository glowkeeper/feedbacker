<script lang="ts">
  import TableRegion from "./TableRegion.svelte";
  import { chooseReviewMode, describeBetween, markerSlug, recordJudgement, recordVerdict, reveal, type Criterion, type OriginalAssessment, type ReviewMode, type Verdict, type Workspace } from "../../core/index.ts";
  import { compare } from "../comparison.ts";
  import { inApp, parseMark, problemsOf } from "../forms.ts";
  import { loadReview, reviewChoices, whereOnPage, type Review } from "../review.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";

  let { workspace, onChanged }: { workspace: Workspace; onChanged: () => void } = $props();

  let choices: { id: string; label: string }[] = $state([]);
  let chosen = $state("");
  let review: Review | null = $state(null);
  let drafts: Record<string, { level: string; levelFromAi: boolean; comment: string; fromAi: boolean }> = $state({});
  let verdictDraft = $state({ verdict: "", mark: "", comment: "" });
  let busy = $state(false);
  let problems: string[] = $state([]);
  let message: string | null = $state(null);
  // The outcome of recording a criterion, shown beside its button: the screen's own status is out of view by then.
  let recordedNote: { id: string; text: string } | null = $state(null);
  let recordProblem: { id: string; problems: string[] } | null = $state(null);
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
  $effect(() => {
    if (opened) reviewHeading?.focus();
  });

  /** Show a review afresh, with each criterion's form starting from what is recorded. */
  function show(r: Review) {
    review = r;
    recordedNote = null;
    recordProblem = null;
    const revising = r.mode === "blind" && r.revealedAt !== null;
    drafts = Object.fromEntries(
      r.rubric.criteria.map((c) => {
        const j = r.judgements.get(c.id);
        const entry = revising ? (j?.revised ?? null) : (j?.first ?? null);
        return [
          c.id,
          {
            level: entry?.level_id ?? j?.first.level_id ?? "",
            levelFromAi: entry?.level_from_ai ?? false, // a revision starts from the first level, which is then the moderator's to keep or change
            comment: entry?.comment ?? "",
            fromAi: entry?.comment_derived_from_ai ?? false,
          },
        ];
      }),
    );
    verdictDraft = { verdict: r.verdict?.verdict ?? "", mark: r.verdict?.suggested_mark === null || !r.verdict ? "" : String(r.verdict.suggested_mark), comment: r.verdict?.comment ?? "" };
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
    recordedNote = null;
    recordProblem = null;
    try {
      if (!draft.level) throw new Error(`choose your level for ${criterion.title} first`);
      const suggested = review.readings.get(criterion.id)?.suggested_level_id ?? null;
      const j = await recordJudgement(workspace, review.id, criterion.id, {
        levelId: draft.level,
        levelFromAi: draft.levelFromAi && draft.level === suggested,
        comment: draft.comment,
        derivedFromAi: draft.fromAi && draft.comment.trim() !== "",
      });
      review = await loadReview(workspace, review.id); // drafts for other criteria are kept
      const entry = j.revised ?? j.first;
      draft.comment = entry.comment ?? "";
      draft.fromAi = entry.comment_derived_from_ai;
      draft.levelFromAi = entry.level_from_ai;
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
      if (!verdictDraft.verdict) throw new Error("choose a verdict first");
      const v = await recordVerdict(workspace, review.id, {
        verdict: verdictDraft.verdict as Verdict,
        suggestedMark: parseMark(verdictDraft.mark, "the suggested mark"),
        comment: verdictDraft.comment,
      });
      review = await loadReview(workspace, review.id);
      verdictDraft.comment = v.comment ?? "";
      onChanged();
      message = `Recorded your verdict on ${review.id}: ${verdictName(v.verdict)}.`;
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      busy = false;
    }
  }

  /**
   * Start from the AI reading: its suggested level and its draft comment, where it has them. Each is recorded as
   * taken from the AI, the level only while it is unchanged, the comment however much it is changed.
   */
  function startFromReading(c: Criterion, levelId: string | null, text: string | null) {
    if (levelId !== null) {
      drafts[c.id].level = levelId;
      drafts[c.id].levelFromAi = true;
    }
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
    <button type="submit" aria-disabled={busy}>Review this submission</button>
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
                Your judgement: {levelLabel(c, recorded.first.level_id)} (recorded {when(recorded.first.recorded_at)}, open review){recorded.first.level_from_ai ? "; level taken from the AI suggestion" : ""}{recorded.first.comment_derived_from_ai ? "; comment adapted from the AI draft" : ""}
              {:else}
                Your first judgement: {levelLabel(c, recorded.first.level_id)} (recorded {when(recorded.first.recorded_at)}, blind){#if recorded.revised}; revised after the reveal to {levelLabel(c, recorded.revised.level_id)} (recorded {when(recorded.revised.recorded_at)}){recorded.revised.level_from_ai ? "; level taken from the AI suggestion" : ""}{recorded.revised.comment_derived_from_ai ? "; comment adapted from the AI draft" : ""}{/if}
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
                    <input type="radio" name={`level-${c.id}`} value={l.id} bind:group={drafts[c.id].level} onchange={() => (drafts[c.id].levelFromAi = false)} />
                    <span><strong>{l.label}</strong>{l.points !== null ? ` (${l.points})` : ""} <span class="hint">{l.descriptor}</span></span>
                  </label>
                {/each}
                {#if drafts[c.id].levelFromAi && drafts[c.id].level === reading?.suggested_level_id}
                  <p class="hint">The level is the AI's suggestion: it will be recorded as taken from it unless you choose another.</p>
                {/if}
                <label for={`comment-${c.id}`}>Your comment (optional; it is anonymised)</label>
                <textarea id={`comment-${c.id}`} rows="2" bind:value={drafts[c.id].comment}
                oninput={() => {
                  if (!drafts[c.id].comment.trim()) drafts[c.id].fromAi = false; // emptied: whatever is written next is the moderator's own
                }}
                aria-describedby={drafts[c.id].fromAi ? `derived-${c.id}` : undefined}></textarea>
              {#if drafts[c.id].fromAi && drafts[c.id].comment.trim()}
                <p class="hint" id={`derived-${c.id}`}>
                  Adapted from the AI draft: it will be recorded as derived from it, however much you change it.
                  <button type="button" onclick={() => writeOwn(c)}>Clear and write my own<span class="visually-hidden"> comment on {c.title}</span></button>
                </p>
              {/if}
                <div>
                  <button type="button" onclick={() => record(c)} disabled={r.text === null}>
                    {revising ? (recorded?.revised ? "Change the revision" : "Record a revision") : recorded ? "Change the judgement" : "Record the judgement"}<span class="visually-hidden"> of {c.title}</span>
                  </button>
                </div>
                <Status message={recordedNote?.id === c.id ? recordedNote.text : null} />
                <Problems problems={recordProblem?.id === c.id ? recordProblem.problems : []} />
              </fieldset>
            {/if}
          </section>
        {/each}
      </section>
    </div>

    {#if r.shown}
      {@const rows = compare(r)}
      <section aria-labelledby="comparison-heading">
        <h3 id="comparison-heading">Comparison</h3>
        {#if !r.judgements.size}<p class="missing">Record a judgement to compare it with the marking and the AI reading.</p>{/if}
        {#if rows.length}
          <TableRegion label="Comparison table">
            <table>
              <caption>Your level, each marker's mark and the AI suggestion, criterion by criterion. Differences are stated in words.</caption>
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
            </table>
          </TableRegion>
        {/if}
      </section>

      {#if r.markings.length}
        <section aria-labelledby="verdict-heading">
          <h3 id="verdict-heading">Your verdict on the marking</h3>
          <p class={r.verdictStale ? "attention" : r.verdict ? "done" : "missing"}>
            {#if r.verdict}
              Your verdict: {verdictName(r.verdict.verdict)}{r.verdict.suggested_mark !== null ? `; suggested mark ${r.verdict.suggested_mark}` : ""} (recorded {when(r.verdict.provenance.timestamp)}){r.verdictStale ? "; given on earlier marking or text: check it again" : ""}
            {:else}
              No verdict yet
            {/if}
          </p>
          <fieldset class="judge">
            <legend>How was {r.id} marked?</legend>
            {#each VERDICTS as [id, name, meaning] (id)}
              <label class="level"><input type="radio" name="verdict" value={id} bind:group={verdictDraft.verdict} /> <span><strong>{name}</strong> <span class="hint">{meaning}</span></span></label>
            {/each}
            <label for="verdict-mark">Suggested mark (optional)</label>
            <input id="verdict-mark" type="text" inputmode="decimal" bind:value={verdictDraft.mark} />
            <label for="verdict-comment">Your comment (optional; it is anonymised)</label>
            <textarea id="verdict-comment" rows="2" bind:value={verdictDraft.comment}></textarea>
            <div>
              <button type="button" onclick={saveVerdict} disabled={r.text === null}>{r.verdict ? "Change the verdict" : "Record the verdict"}</button>
            </div>
          </fieldset>
        </section>
      {/if}
    {/if}
  {/if}
{/if}
