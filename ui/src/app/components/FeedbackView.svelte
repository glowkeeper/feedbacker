<script lang="ts">
  import { tick, untrack } from "svelte";
  import {
    cancelBatch,
    IdentifiersFound,
    matchesOn,
    type RedactionMatch,
    type IdentifierMatch,
    checkBatch,
    collectDraftBatch,
    draftsCost,
    pendingDraftBatches,
    planDrafts,
    planSuggestion,
    runSuggestion,
    type SuggestPlan,
    recordFeedback,
    acceptFlag,
    loadPraise,
    GUIDE,
    savePraise,
    BAND_NAMES,
    type PraiseWords,
    type Flag,
    runDrafts,
    sendDraftBatch,
    OVERALL,
    type BatchProgress,
    type DraftPlan,
    type DraftResult,
    type ProxyHealth,
    type SentDraftBatch,
    type Workspace,
  } from "../../core/index.ts";
  import { cohortChecks, feedbackStatus, loadFeedbackWork, submissionsWithDrafts, type CohortChecks, type FeedbackWork } from "../feedbackWork.ts";
  import { problemsOf } from "../forms.ts";
  import { asDone, done, info, type Message } from "../messages.ts";
  import { batchStatusText } from "../readingPlan.ts";
  import { reviewChoices } from "../review.ts";
  import type { AppProxy } from "../platform.ts";
  import type { StepState } from "../steps.ts";
  import CohortFeedback from "./CohortFeedback.svelte";
  import FeedbackGuide from "./FeedbackGuide.svelte";
  import Problems from "./Problems.svelte";
  import FoundIdentifiers from "./FoundIdentifiers.svelte";
  import RedactionMatches from "./RedactionMatches.svelte";
  import Status from "./Status.svelte";
  import Waiting from "./Waiting.svelte";
  import StepScreen from "./StepScreen.svelte";
  import TableRegion from "./TableRegion.svelte";

  let { workspace, proxy, step, onChanged }: { workspace: Workspace; proxy: AppProxy; step: StepState | undefined; onChanged: () => void | Promise<void> } = $props();

  let health = $state<ProxyHealth | null>(null);
  let choices: { id: string; label: string }[] = $state([]);
  let draftFor = $state(""); // "" for every marked submission that needs drafts
  let asBatch = $state(false);
  let withGuide = $state(true);
  let hasGuide = $state(false);
  let cohortVersion = $state(0); // bumped when feedback changes, so the cohort's view is read again
  let plan = $state<DraftPlan | null>(null);
  let result = $state<DraftResult | null>(null);
  let waiting: SentDraftBatch[] = $state([]);
  let progress: Record<string, BatchProgress> = $state({});
  let busy = $state(false);
  let sending: string | null = $state(null);
  let suggesting = $state(false); // asking the AI to suggest an edit to one piece of feedback
  let problems: string[] = $state([]);
  // What couldn't be read when the screen opened, by what was being read: each is cleared when that is read again. A re-read after an action says its problem
  // beside the action instead (the action is not undone by it).
  let loadProblems: Record<"checks" | "choices" | "waiting", string[]> = $state({ checks: [], choices: [], waiting: [] });
  /** Where the last action was taken: what it says (working, done, or a problem) is shown beside it, not at the top of a long page. */
  type Region = "draft" | "checks" | "write";
  let region: Region = $state("draft");
  let message = $state<Message | null>(null);
  let draftHeading: HTMLHeadingElement | undefined = $state();
  let planHeading: HTMLHeadingElement | undefined = $state();
  let resultHeading: HTMLHeadingElement | undefined = $state();

  // Writing one submission's feedback.
  let chosen = $state("");
  let writing = $state<FeedbackWork | null>(null);
  let texts: Record<string, string> = $state({});
  let fromDraft: Record<string, string | null> = $state({});
  let rowProblem: { target: string; problems: string[] } | null = $state(null);
  let rowRedacted: { id: string; target: string; matches: RedactionMatch[] } | null = $state(null); // what the rules now redact in what a suggestion would send (shown on this screen only)
  let rowFound: { id: string; target: string; matches: IdentifierMatch[] } | null = $state(null); // what looks like an identifier in what a suggestion would send (shown on this screen only)
  let rowNote: { target: string; text: string } | null = $state(null);
  let workHeading: HTMLHeadingElement | undefined = $state();

  // Suggesting an edit to one piece of flagged feedback: what will be sent, then the suggestion beside the feedback.
  let suggestPlan = $state<SuggestPlan | null>(null);
  let suggestHeading: HTMLHeadingElement | undefined = $state();
  let dismissed: Record<string, true> = $state({}); // suggestions the educator chose not to use, by id

  // The checks: a reason for each flag being accepted, the cohort's list, and the workspace's praise words.
  let reasons: Record<string, string> = $state({});
  let cohort: CohortChecks[] = $state([]);
  let praise: Record<string, string> = $state({});
  let praiseNote: string | null = $state(null);
  const PRAISE_BANDS = ["first", "upper_second", "lower_second", "third"] as const;
  const flagKey = (target: string, f: { check: string; detail: string }) => `${target}|${f.check}|${f.detail}`;

  /** Read what the checks need. It throws if it can't, so each caller says so where it is: at the top on opening, or beside the action it follows. */
  async function readChecks() {
    // Not a dependency of the effect that calls this: bumping it there would make the effect run itself again.
    untrack(() => (cohortVersion += 1));
    hasGuide = await workspace.exists(GUIDE);
    cohort = await cohortChecks(workspace);
    const words = await loadPraise(workspace);
    praise = Object.fromEntries(PRAISE_BANDS.map((b) => [b, words[b].join("\n")]));
  }
  /** Read it as the screen opens (or the guide changes): a problem is shown at the top until it is read again. */
  async function loadChecks() {
    try {
      await readChecks();
      loadProblems.checks = [];
    } catch (err) {
      loadProblems.checks = problemsOf(err);
    }
  }
  /** Read it again after something was done: if it can't be read, what to say beside what was done (which stands). */
  async function recheck(): Promise<string | null> {
    try {
      await readChecks();
      return null;
    } catch (err) {
      return `It was done, but the checks couldn't be refreshed: ${problemsOf(err).join(" ")}`;
    }
  }
  $effect(() => {
    void loadChecks();
  });

  /** Accept a flag on recorded feedback with a reason (one given, or the one typed); the text stays as it is. */
  async function accept(target: string, f: Flag, given?: string) {
    if (!writing || busy) return;
    busy = true;
    rowProblem = null;
    rowNote = null;
    try {
      await acceptFlag(workspace, writing.id, target, f, given ?? reasons[flagKey(target, f)] ?? "");
      delete reasons[flagKey(target, f)]; // the reason belongs to that text: new text starts with none
      await openWork(writing.id, false);
      const stale = await recheck();
      await onChanged();
      rowNote = { target, text: `Accepted the flag on ${titleOf(target)}, with your reason.${stale ? ` ${stale}` : ""}` };
    } catch (err) {
      rowProblem = { target, problems: problemsOf(err) };
    } finally {
      busy = false;
    }
  }

  const savePraiseWords = (event: SubmitEvent) => {
    event.preventDefault();
    return act(async () => {
      const words = Object.fromEntries(PRAISE_BANDS.map((b) => [b, (praise[b] ?? "").split("\n")])) as PraiseWords;
      await savePraise(workspace, words);
      const stale = await recheck();
      if (writing) await openWork(writing.id, false);
      await onChanged();
      praiseNote = "Saved the words. Every recorded feedback is checked against them now.";
      if (stale) problems = [...problems, stale];
    }, null, "checks");
  };

  $effect(() => {
    proxy.health().then(
      (h) => (health = h),
      () => (health = null),
    );
    reviewChoices(workspace).then(
      (c) => {
        choices = c;
        chosen ||= c[0]?.id ?? "";
        loadProblems.choices = [];
      },
      (err) => (loadProblems.choices = problemsOf(err)),
    );
    void loadWaiting();
  });

  /** Read the batches waiting as the screen opens: a problem is shown at the top until they are read again. */
  async function loadWaiting() {
    try {
      waiting = await pendingDraftBatches(workspace);
      loadProblems.waiting = [];
    } catch (err) {
      loadProblems.waiting = problemsOf(err);
    }
  }
  /** Read them again after a batch was sent or collected: if they can't be read, what to say beside it (which stands). */
  async function rewait(): Promise<string | null> {
    try {
      waiting = await pendingDraftBatches(workspace);
      return null;
    } catch (err) {
      return `It was done, but the batches waiting couldn't be refreshed: ${problemsOf(err).join(" ")}`;
    }
  }

  const usd = (n: number) => `$${n.toFixed(4)}`;
  const titleOf = (target: string) => (target === OVERALL ? "the overall feedback" : (writing?.rows.find((r) => r.target === target)?.title ?? target));

  /** What a row is called to someone who can't see where it is: the overall feedback is not a criterion called "Overall". */
  const aboutRow = (row: { target: string; title: string }) => (row.target === OVERALL ? "the overall feedback" : row.title);
  const recordedText = (target: string, derived: boolean) =>
    `${target === OVERALL ? "Recorded the overall feedback" : `Recorded the feedback on ${titleOf(target)}`}${derived ? ", adapted from the AI's draft" : ""}.`;

  /** Do something; `waitingFor` says, while it is under way, what the AI is being asked (when it is); `where` is the part of the screen it was done in. */
  async function act(what: () => Promise<void>, waitingFor: string | null = null, where: Region = "draft") {
    if (busy) return; // buttons stay enabled while busy, so focus isn't lost from them
    region = where;
    busy = true;
    problems = [];
    message = null;
    sending = waitingFor;
    try {
      await what();
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      busy = false;
      sending = null;
    }
  }

  /** Reasons for keeping flagged text, by check, to accept with in one action (or write your own). */
  const QUICK_REASONS: Record<Flag["check"], string[]> = {
    praise: ["Not praise here: it says what is missing", "Quoting the brief or rubric", "It fits this student's work"],
    other_mark: ["Quoting a figure from the submission", "Quoting the brief or rubric"],
    token: ["I'll restore it when pasting", "It doesn't identify anyone here"],
    next_step: ["The next step is in the overall feedback"],
    cut_off: ["It ends as I intended"],
  };

  /** Plan the drafts: for every submission that needs them, one submission, or (from its row) one criterion again. */
  /** The criterion being drafted again from its own row: once it is drafted, focus goes back to it. */
  let redrafting: { submissionId: string; target: string } | null = null;

  function makePlan(wanted: { submissionId: string; targets?: string[]; avoid?: Record<string, string[]> }[] | null) {
    const one = wanted?.length === 1 && wanted[0].targets?.length === 1 ? { submissionId: wanted[0].submissionId, target: wanted[0].targets[0] } : null;
    redrafting = one && writing?.id === one.submissionId ? one : null;
    return act(async () => {
      plan = null;
      result = null;
      plan = await planDrafts(workspace, proxy, wanted, { batch: asBatch && !!health?.batch, withGuide: hasGuide && withGuide });
      await tick();
      planHeading?.focus();
    });
  }
  function planFromForm(event: SubmitEvent) {
    event.preventDefault();
    void makePlan(draftFor ? [{ submissionId: draftFor }] : null);
  }

  const send = () =>
    act(async () => {
      const confirmed = plan!;
      // From here it is sent: the plan can't be confirmed twice, and it no longer says that nothing has been sent, whatever happens next. Focus
      // stays in this part of the screen, where what is happening is said.
      plan = null;
      await tick();
      draftHeading?.focus();
      let came: DraftResult;
      let said: Message | null = null;
      if (confirmed.batch) {
        const sent = await sendDraftBatch(workspace, confirmed, { proxy });
        came = sent.result;
        said = sent.batch ? info(`Sent ${sent.batch.items.length} submission(s) as one batch. Drafts come back within a day, usually much sooner: check below.`) : null;
      } else {
        came = await runDrafts(workspace, confirmed, { proxy, onProgress: (p) => (sending = `Drafting ${p.submissionId} (${p.index + 1} of ${p.total})… Keep this page open until it has finished.`) });
      }
      const stale = await rewait();
      await onChanged();
      const renewed = writing ? await openWork(writing.id, false) : new Set<string>();
      // What came back is shown once everything has changed with it, so the next press isn't ignored as busy.
      result = came;
      message = said;
      if (stale) problems = [stale];
      await tick();
      const back = redrafting;
      redrafting = null;
      if (back && came.drafted.get(back.submissionId)?.some((d) => (d.criterion_id ?? OVERALL) === back.target)) {
        // Drafted again from its row: back to that box, saying where the new draft is.
        rowNote = {
          target: back.target,
          text: renewed.has(back.target)
            ? `Drafted ${titleOf(back.target)} again: the new draft is in the box. Read it, change it as you need to, and record it.`
            : `Drafted ${titleOf(back.target)} again. Your text in the box is unchanged: press Start from the AI's draft to use the new one.`,
        };
        document.getElementById(`feedback-${back.target}`)?.focus();
      } else resultHeading?.focus();
    }, "Asking the AI for the drafts… Keep this page open until it has finished.");

  const check = (id: string) =>
    act(async () => {
      progress[id] = await checkBatch(proxy, id);
    }, "Asking the AI how far the batch has got…");
  const collect = (id: string) =>
    act(async () => {
      const came = await collectDraftBatch(workspace, proxy, id);
      const stale = await rewait();
      await onChanged();
      if (writing) await openWork(writing.id, false);
      result = came; // shown once everything has changed with it
      if (stale) problems = [stale];
      await tick();
      resultHeading?.focus();
    }, "Collecting the drafts from the AI… this can take a few seconds.");
  const cancel = (id: string) =>
    act(async () => {
      progress[id] = await cancelBatch(proxy, id);
      message = done("Cancelled. Drafts already made can be collected once it has stopped.");
    }, "Asking the AI to cancel the batch…");

  /** Open one submission's feedback, each box starting from what is recorded. */
  /**
   * Open one submission's feedback. Each box starts from the feedback recorded; an empty box is filled with its current
   * AI draft (adapted from the AI until it is cleared), which is saved only when the educator records it. Reopening the
   * same submission (after drafting) keeps whatever is in a box already.
   */
  async function openWork(id: string, focus = true): Promise<Set<string>> {
    const same = writing?.id === id;
    // The drafts before reading again: a box still holding one of them, unchanged, takes its new draft.
    const before = new Map((same ? (writing?.rows ?? []) : []).map((r) => [r.target, r.draft]));
    const renewed = new Set<string>(); // targets whose box now holds a new draft
    writing = await loadFeedbackWork(workspace, id);
    chosen = id;
    const nextTexts: Record<string, string> = {};
    const nextFrom: Record<string, string | null> = {};
    for (const r of writing.rows) {
      const kept = same ? (texts[r.target] ?? "") : "";
      const draft = r.draft && !r.draftStale ? r.draft : null;
      const old = before.get(r.target);
      if (draft && old && draft.id !== old.id && kept.trim() === old.text.trim()) {
        // Drafted again, and the box still held the old draft as it came: the new one takes its place (saved only when recorded).
        nextTexts[r.target] = draft.text;
        nextFrom[r.target] = draft.id;
        renewed.add(r.target);
      } else if (kept.trim()) {
        nextTexts[r.target] = kept;
        nextFrom[r.target] = fromDraft[r.target] ?? null;
      } else if (r.feedback) {
        nextTexts[r.target] = r.feedback.text;
        nextFrom[r.target] = r.feedback.from_draft;
      } else {
        nextTexts[r.target] = draft?.text ?? "";
        nextFrom[r.target] = draft?.id ?? null;
      }
    }
    texts = nextTexts;
    fromDraft = nextFrom;
    rowProblem = null;
    rowFound = null; // what was found was in what was sent then: not another submission's, and not once corrected
    rowRedacted = null;
    rowNote = null;
    if (focus) {
      await tick();
      workHeading?.focus();
    }
    return renewed;
  }
  const openChosen = (event: SubmitEvent) => {
    event.preventDefault();
    void act(async () => void (await openWork(chosen)), null, "write");
  };

  /** Start from the AI's draft: recorded as adapted from it, however much it is changed. */
  function startFromDraft(target: string, id: string, text: string) {
    texts[target] = text;
    fromDraft[target] = id;
    document.getElementById(`feedback-${target}`)?.focus();
  }
  function writeOwn(target: string) {
    texts[target] = "";
    fromDraft[target] = null;
    document.getElementById(`feedback-${target}`)?.focus();
  }

  /** Plan a suggested edit for one piece of flagged feedback: shows exactly what will be sent, and sends nothing. */
  async function askSuggestion(target: string) {
    if (!writing || busy) return;
    busy = true;
    rowProblem = null;
    rowNote = null;
    suggestPlan = null;
    rowFound = null;
    rowRedacted = null;
    try {
      suggestPlan = await planSuggestion(workspace, proxy, writing.id, target);
      await tick();
      suggestHeading?.focus();
    } catch (err) {
      rowProblem = { target, problems: problemsOf(err) };
      rowFound = err instanceof IdentifiersFound ? { id: writing.id, target, matches: err.matches } : null;
      rowRedacted = matchesOn(err).length ? { id: writing.id, target, matches: matchesOn(err) } : null;
    } finally {
      busy = false;
    }
  }

  async function sendSuggestion() {
    if (!writing || !suggestPlan || busy) return;
    const confirmed = suggestPlan;
    const target = confirmed.target;
    busy = true;
    rowProblem = null;
    rowNote = null;
    suggesting = true;
    try {
      const came = await runSuggestion(workspace, confirmed, { proxy });
      suggestPlan = null;
      await openWork(writing.id, false);
      // Said once everything has changed with it.
      if (came.warnings.length) rowProblem = { target, problems: came.warnings };
      rowNote = came.suggestion ? { target, text: `The AI suggested an edit (spent $${came.spentUsd.toFixed(4)}): it is below, beside your feedback, which is unchanged.` } : null;
      await tick();
      document.getElementById(`suggestion-${target}`)?.focus();
    } catch (err) {
      rowProblem = { target, problems: problemsOf(err) };
    } finally {
      suggesting = false;
      busy = false;
    }
  }

  async function dontSuggest(target: string) {
    if (busy) return; // while sending, the request may already be on its way
    suggestPlan = null;
    rowNote = { target, text: "Nothing was sent." };
    await tick();
    document.getElementById(`suggest-${target}`)?.focus();
  }

  async function record(target: string) {
    if (!writing || busy) return;
    busy = true;
    rowProblem = null;
    rowFound = null;
    rowRedacted = null;
    rowNote = null;
    try {
      const f = await recordFeedback(workspace, writing.id, target, { text: texts[target], fromDraft: texts[target].trim() ? fromDraft[target] : null });
      const kept = texts;
      const keptFrom = fromDraft;
      writing = await loadFeedbackWork(workspace, writing.id);
      texts = kept;
      fromDraft = keptFrom;
      texts[target] = f.text;
      const stale = await recheck();
      await onChanged();
      rowNote = { target, text: `${recordedText(target, f.derived_from_ai)}${stale ? ` ${stale}` : ""}` };
    } catch (err) {
      rowProblem = { target, problems: problemsOf(err) };
    } finally {
      busy = false;
    }
  }
</script>

{#snippet notices(here: Region)}
  <!-- What the last action says is shown beside where it was taken; each region is always on the screen, so what is put into it is announced. -->
  <Status message={region === here ? message : null} />
  <Waiting active={region === here && sending !== null} text={sending ?? ""} />
  <Problems problems={region === here ? problems : []} />
{/snippet}

<StepScreen title="Feedback" {step}>
  {#snippet how()}
    <p>
      The AI can write a first draft of the feedback for each criterion, and an overall piece, from your own marks and notes; you read each draft, change it
      or write your own, and record it. Before anything is sent you see exactly what of your marking will be sent, for each submission, and a worst-case
      estimate; confirming approves it. Only that one submission's approved anonymised text and your marking of it are sent, never anyone else's. If you
      change a mark or note afterwards, that criterion's draft and feedback are flagged, and you can draft it again on its own.
    </p>
  {/snippet}
  {#snippet messages()}
    {#if health && !health.key_configured}
      <p class="warning" role="note">The proxy has no API key, so it will refuse to send. Put the key in ~/Feedbacker/.env and restart the proxy.</p>
    {/if}
    <Problems problems={Object.values(loadProblems).flat()} />
  {/snippet}
  {#snippet work()}
    <p>This step has three parts: a guide to how you give feedback (optional), first drafts from the AI (optional), and writing and recording each student's feedback, which is the part that counts.</p>
    <FeedbackGuide {workspace} onChanged={async () => {
      await loadChecks();
      await onChanged();
    }} />

    <section aria-labelledby="draft-heading">
      <h2 id="draft-heading" tabindex="-1" bind:this={draftHeading}>Draft feedback (optional)</h2>
      <p class="hint">
        The AI writes a first draft of the feedback for each criterion, and an overall piece, from your marks and notes (and your guide, if you have one). The
        drafts are only a start: they are not feedback until you read them and record your own version, under Write the feedback. <strong>Plan the drafts</strong>
        shows exactly what would be sent and the most it could cost; nothing is sent until you confirm it.
      </p>
      <form class="inline" onsubmit={planFromForm}>
        <label for="draft-for">Draft for</label>
        <select id="draft-for" bind:value={draftFor}>
          <option value="">Every marked submission that needs drafts</option>
          {#each choices as c (c.id)}<option value={c.id}>{c.label}</option>{/each}
        </select>
        {#if hasGuide}<label class="check"><input type="checkbox" bind:checked={withGuide} /> Include the approved feedback guide</label>{/if}
        {#if health?.batch}<label class="check"><input type="checkbox" bind:checked={asBatch} /> Send as one batch, at half the price (the drafts come back within a day, usually much sooner)</label>{/if}
        <button type="submit" aria-disabled={busy}>Plan the drafts</button>
      </form>

      {#if plan}
        {@const p = plan}
        <section aria-labelledby="plan-heading">
          <h3 id="plan-heading" tabindex="-1" bind:this={planHeading}>Check what will be sent</h3>
          <p>Nothing has been sent yet.{p.drafts.length ? " Read what would be sent, then press Confirm and send, or Don't send." : ""}</p>
          {#if p.drafts.length}
            <TableRegion label="What will be drafted">
              <table>
                <caption>Each submission to draft feedback for, what for, and the most it could cost</caption>
                <thead><tr><th scope="col">Submission</th><th scope="col">Drafts</th><th scope="col">At most</th></tr></thead>
                <tbody>
                  {#each p.drafts as d (d.submissionId)}
                    <tr>
                      <th scope="row">{d.submissionId} {d.pseudonym}</th>
                      <td>{d.targets.length === 1 && d.targets[0] === OVERALL ? "The overall feedback" : `${d.targets.filter((t) => t !== OVERALL).length} criteria${d.targets.includes(OVERALL) ? " and the overall feedback" : ""}`}</td>
                      <td>{usd(d.cost + d.fallbackCost)}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </TableRegion>
            {#each p.drafts as d (d.submissionId)}
              <details>
                <summary>What will be sent of your marking of {d.submissionId} {d.pseudonym}</summary>
                <pre class="text" aria-label={`Your marking of ${d.submissionId}, as it will be sent`}>{d.marking}</pre>
              </details>
            {/each}
            <p>
              With {p.model}{p.batch ? ", as one batch at the batch price" : ""}{p.withBrief ? ", with the approved brief" : ""}{p.guideVersion !== null ? `, with version ${p.guideVersion} of your feedback guide (the same for every submission)` : ""}. At most {usd(draftsCost(p))} (a worst case;
              a real call costs much less). Spend limit: ${p.capUsd}.
            </p>
          {/if}
          {#if p.skipped.size}
            <Problems problems={[...p.skipped].map(([id, why]) => `${id}: ${why}`)} title="Not drafted:" />
          {/if}
          {#if p.redactions.size}<RedactionMatches id="draft-redactions" {workspace} groups={[...p.redactions]} {onChanged} />{/if}
          {#if p.identifiers.size}<FoundIdentifiers id="draft-identifiers" {workspace} groups={[...p.identifiers]} what="Submission" />{/if}
          <div class="actions">
            {#if p.drafts.length}<button type="button" onclick={send}>{p.batch ? "Confirm and send the batch" : "Confirm and send"}</button>{/if}
            <button type="button" onclick={() => (plan = null)}>Don't send</button>
          </div>
        </section>
      {/if}
      {@render notices("draft")}

      {#if waiting.length}
        <section aria-labelledby="waiting-heading">
          <h3 id="waiting-heading">Batches waiting</h3>
          <ul>
            {#each waiting as b (b.id)}
              <li>
                Sent on {b.sent_at.slice(0, 16).replace("T", " ")} UTC: {b.items.map((i) => i.submission_id).join(", ")}.
                {#if progress[b.id]}{batchStatusText(progress[b.id])}{/if}
                <span class="actions">
                  <button type="button" onclick={() => check(b.id)}>Check the batch</button>
                  {#if progress[b.id]?.status === "ended"}<button type="button" onclick={() => collect(b.id)}>Collect the drafts</button>{:else}<button type="button" onclick={() => cancel(b.id)}>Cancel the batch</button>{/if}
                </span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if result}
        {@const r = result}
        {@const drafted = submissionsWithDrafts(r.drafted)}
        <section aria-labelledby="result-heading">
          <h3 id="result-heading" tabindex="-1" bind:this={resultHeading}>What came back</h3>
          <p>Drafted for {drafted.length} submission(s){r.failed.size ? `, ${r.failed.size} failed` : ""}{r.notRun.size ? `, ${r.notRun.size} not run` : ""}. Spent {usd(r.spentUsd)}.</p>
          {#if drafted.length}
            <p>These are drafts, not yet your feedback. Read each one, change it as you need to, and record it.</p>
            <ul>
              {#each drafted as id (id)}
                {@const name = choices.find((c) => c.id === id)?.label ?? id}
                <li>
                  {name}:
                  <button type="button" onclick={() => act(async () => void (await openWork(id)), null, "write")} aria-disabled={busy}>Read and edit the drafts<span class="visually-hidden"> for {name}</span></button>
                </li>
              {/each}
            </ul>
          {/if}
          {#if r.failed.size}<Problems problems={[...r.failed].map(([id, why]) => `${id}: ${why}`)} title="Not drafted:" />{/if}
          {#if r.notRun.size}<Problems problems={[...r.notRun].map(([id, why]) => `${id}: ${why}`)} title="Not sent:" />{/if}
          {#each [...r.warnings] as [id, list] (id)}<Problems problems={list} title={`Check ${id}:`} />{/each}
        </section>
      {/if}
    </section>

    <section aria-labelledby="write-heading">
      <h2 id="write-heading">Write the feedback</h2>
      <p class="hint">Choose a submission to read the AI's drafts (if you asked for any), change them or write your own, and record each piece. What you record is what the student receives, once you approve it on Export.</p>
      {#if choices.length}
        <form class="inline" onsubmit={openChosen}>
          <label for="feedback-id">Submission</label>
          <select id="feedback-id" bind:value={chosen}>
            {#each choices as c (c.id)}<option value={c.id}>{c.label}</option>{/each}
          </select>
          <button type="submit" aria-disabled={busy}>Write this submission's feedback</button>
        </form>
      {:else}
        <p>Import the cohort's submissions first.</p>
      {/if}
      {@render notices("write")}

      {#if writing}
        {@const w = writing}
        <h3 tabindex="-1" bind:this={workHeading}>Feedback for {w.id} {w.pseudonym}</h3>
        {@const openFlags = w.rows.reduce((n, r) => n + r.open.length, 0)}
        <p class={openFlags ? "attention" : "done"}>
          {openFlags ? `${openFlags === 1 ? "1 flag" : `${openFlags} flags`} to check in this submission's feedback (below, under each)` : "No flags to check in this submission's recorded feedback"}
        </p>
        <details>
          <summary>The submission (approved anonymised text)</summary>
          <pre class="text" aria-label={`The text of ${w.id}`}>{w.text}</pre>
        </details>
        {#each w.rows as row (row.target)}
          {@const status = feedbackStatus(row)}
          {@const inBox = !!row.draft && fromDraft[row.target] === row.draft.id}
          {@const changed = row.feedback ? (texts[row.target] ?? "") !== row.feedback.text : !!texts[row.target]?.trim()}
          <fieldset class="judge">
            <legend>{row.target === OVERALL ? "Overall feedback" : row.title}</legend>
            <p class={changed ? "attention" : status.kind}>{!changed
              ? status.text
              : inBox && row.feedback && row.feedback.from_draft !== row.draft?.id
                ? "Not yet recorded: the AI's new draft is in the box; read it, change it as you need to, and record it"
              : row.feedback
                ? "Changed, not yet recorded: record it to keep your changes"
                : inBox
                  ? "Not yet recorded: the AI's draft is in the box; read it, change it as you need to, and record it"
                  : "Not yet recorded"}</p>
            {#if row.marking}<p class="hint">{row.marking}</p>{/if}
            {#if row.draft && !inBox}
              <p><span class="where">AI draft{row.draftStale ? " (out of date: drafted from other marking than there is now)" : ""}:</span> {row.draft.text}</p>
            {/if}
            <div class="actions">
              {#if row.draft && !row.draftStale && !inBox}
                {@const draft = row.draft}
                <button type="button" onclick={() => startFromDraft(row.target, draft.id, draft.text)}>Start from the AI's draft<span class="visually-hidden"> of {aboutRow(row)}</span></button>
              {/if}
              {#if row.marking}
                <!-- Always available once marked: a draft can be current and still not good enough (cut short, say). Nothing is sent before the plan is confirmed, and nothing replaces the box until the educator starts from the new draft. -->
                <button type="button" aria-disabled={busy} onclick={() => makePlan([{ submissionId: w.id, targets: [row.target] }])}>{row.draft ? "Draft this again" : "Draft this"}<span class="visually-hidden">: {aboutRow(row)}</span></button>
              {/if}
            </div>
            <label for={`feedback-${row.target}`}>{row.target === OVERALL ? "Your overall feedback" : `Your feedback on ${row.title}`} (it is anonymised)</label>
            <textarea
              id={`feedback-${row.target}`}
              rows="5"
              bind:value={texts[row.target]}
              oninput={() => {
                if (!texts[row.target].trim()) fromDraft[row.target] = null; // emptied: whatever is written next is the educator's own
              }}
              aria-describedby={fromDraft[row.target] ? `fderived-${row.target}` : undefined}
            ></textarea>
            {#if fromDraft[row.target] && texts[row.target]?.trim()}
              <p class="hint" id={`fderived-${row.target}`}>
                Adapted from the AI's draft or suggested edit: it is recorded as derived from it, however much you change it.
                <button type="button" onclick={() => writeOwn(row.target)}>Clear and write my own<span class="visually-hidden"> {row.target === OVERALL ? "overall feedback" : `feedback on ${row.title}`}</span></button>
              </p>
            {/if}
            <div>
              <button type="button" aria-disabled={busy} onclick={() => record(row.target)} disabled={!row.marking}>Record the feedback<span class="visually-hidden">{row.target === OVERALL ? ": the overall feedback" : ` on ${row.title}`}</span></button>
            </div>
            <Status message={asDone(rowNote?.target === row.target ? (rowNote?.text ?? null) : null)} />
            <Problems problems={rowProblem?.target === row.target ? (rowProblem?.problems ?? []) : []} />
            {#if rowRedacted?.id === w.id && rowRedacted.target === row.target}<RedactionMatches id={`redactions-${row.target}`} {workspace} groups={[[row.title, rowRedacted.matches]]} onChanged={async () => { await onChanged(); await openWork(w.id, false); }} />{/if}
            {#if rowFound?.id === w.id && rowFound.target === row.target}<FoundIdentifiers id={`identifiers-${row.target}`} {workspace} groups={[[row.title, rowFound.matches]]} what="Feedback" />{/if}
            {#if row.open.some((f) => f.check === "praise") && row.marking}
              {@const avoid = row.open.filter((f) => f.check === "praise").map((f) => f.detail)}
              <p>
                <button type="button" aria-disabled={busy} onclick={() => makePlan([{ submissionId: w.id, targets: [row.target], avoid: { [row.target]: avoid } }])}
                  >Draft this again, avoiding {avoid.map((a) => `"${a}"`).join(", ")}<span class="visually-hidden">: {aboutRow(row)}</span></button
                >
              </p>
            {/if}
            {#if row.feedback && row.open.length && row.marking && !changed}
              <p>
                <button type="button" id={`suggest-${row.target}`} aria-disabled={busy} onclick={() => askSuggestion(row.target)}
                  >Suggest an edit for {row.open.length === 1 ? "this flag" : "these flags"}<span class="visually-hidden">: {aboutRow(row)}</span></button
                >
              </p>
            {/if}
            {#if suggestPlan && suggestPlan.submissionId === w.id && suggestPlan.target === row.target}
              {@const sp = suggestPlan}
              <div class="confirm" role="group" aria-labelledby={`suggest-plan-${row.target}`}>
                <h4 id={`suggest-plan-${row.target}`} tabindex="-1" bind:this={suggestHeading}>Check what will be sent to suggest an edit</h4>
                <p>
                  The rubric, your marking of this criterion, and your recorded feedback on it with its flags, exactly as below. Nothing else: not the
                  submission, the brief, the feedback guide or your other feedback.
                </p>
                <details>
                  <summary>The rubric, as it will be sent</summary>
                  <pre class="text" aria-label="The rubric, as it will be sent">{sp.request.blocks[0].text}</pre>
                </details>
                <pre class="text" aria-label={`Your marking of ${aboutRow(row)}, as it will be sent`}>{sp.marking}</pre>
                <pre class="text" aria-label={`Your feedback on ${aboutRow(row)} and its flags, as they will be sent`}>{sp.feedback}</pre>
                <p>With {sp.model}. At most {usd(sp.cost)} (a worst case; a real call costs much less). Spend limit: ${sp.capUsd}.</p>
                <div class="actions">
                  <button type="button" aria-disabled={busy} onclick={sendSuggestion}>Confirm and send<span class="visually-hidden">: suggest an edit to {aboutRow(row)}</span></button>
                  <button type="button" aria-disabled={busy} onclick={() => dontSuggest(row.target)}>Don't send</button>
                </div>
                <Waiting active={suggesting} text="Asking the AI for a suggested edit… this can take a few seconds." />
              </div>
            {/if}
            {#if row.suggestion && !dismissed[row.suggestion.id] && fromDraft[row.target] !== row.suggestion.id}
              {@const sg = row.suggestion}
              {@const sgFlags = row.check(sg.text)}
              <div class="suggestion" role="group" aria-labelledby={`suggestion-${row.target}`}>
                <h4 id={`suggestion-${row.target}`} tabindex="-1">The AI's suggested edit</h4>
                <p class="hint">Not recorded: your feedback is unchanged unless you use it, and it is then recorded as derived from the AI.</p>
                <p class="feedback-text">{sg.text}</p>
                {#if sgFlags.length}
                  <ul class="flags" aria-label={`Checks on the suggested edit to ${aboutRow(row)}`}>
                    {#each sgFlags as f (f.check + f.detail)}<li class="attention">Check: {f.message.replace(/[.!?]$/, "")}.</li>{/each}
                  </ul>
                {:else}
                  <p class="hint">No flags on the suggested edit.</p>
                {/if}
                <div class="actions">
                  <button type="button" onclick={() => startFromDraft(row.target, sg.id, sg.text)}>Use the suggestion<span class="visually-hidden"> for {aboutRow(row)}</span></button>
                  <button type="button" onclick={() => (dismissed[sg.id] = true)}>Don't use it<span class="visually-hidden">: the suggestion for {aboutRow(row)}</span></button>
                </div>
              </div>
            {/if}
            {#if changed && texts[row.target]?.trim()}
              <!-- The box holds text not yet recorded: its checks are of that text, as it stands; flags are accepted once it is recorded. -->
              {@const live = row.check(texts[row.target])}
              <p class="hint" id={`live-${row.target}`}>
                {live.length ? "Checks on the text in the box, before you record it (a flag can be accepted once it is recorded):" : "No flags on the text in the box. Record it to keep it."}
              </p>
              {#if live.length}
                <ul class="flags" aria-labelledby={`live-${row.target}`}>
                  {#each live as f (f.check + f.detail)}<li class="attention">Check: {f.message.replace(/[.!?]$/, "")}.</li>{/each}
                </ul>
              {/if}
            {:else if row.flags.length}
              <ul class="flags" aria-label={`Checks on the recorded feedback on ${aboutRow(row)}`}>
                {#each row.flags as f (f.check + f.detail)}
                  {@const accepted = row.feedback?.accepted_flags.find((a) => a.check === f.check && a.detail === f.detail)}
                  {@const key = flagKey(row.target, f)}
                  <li class={accepted ? "done" : "attention"}>
                    {accepted ? `Accepted: ${f.message.replace(/[.!?]$/, "")}. Your reason: ${accepted.reason}` : `Check: ${f.message.replace(/[.!?]$/, "")}.`}
                    {#if !accepted}
                      <span class="flag-accept">
                        {#each QUICK_REASONS[f.check] as quick (quick)}
                          <button type="button" aria-disabled={busy} onclick={() => accept(row.target, f, quick)}>Accept: {quick}<span class="visually-hidden"> ({f.message})</span></button>
                        {/each}
                      </span>
                      <span class="flag-accept">
                        <label for={`reason-${key}`}>Reason for keeping it</label>
                        <input id={`reason-${key}`} type="text" bind:value={reasons[key]} />
                        <button type="button" aria-disabled={busy} onclick={() => accept(row.target, f)}>Accept with this reason<span class="visually-hidden">: {f.message}</span></button>
                      </span>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </fieldset>
        {/each}
        {#if w.next}
          {@const following = w.next}
          <div class="actions"><button type="button" onclick={() => act(async () => void (await openWork(following.id)), null, "write")}>Next submission: {following.label}</button></div>
        {/if}
      {/if}
    </section>

    <section aria-labelledby="checks-heading">
      <h2 id="checks-heading">Checks across the cohort</h2>
      <p class="hint">
        Each piece of feedback is checked against its mark for praise that belongs to a higher band, no "Next time" step, and another mark or level named. A flag never blocks: change the text, ask the AI for an edit, or keep it by accepting the flag with a reason, which is recorded.
      </p>
      {#if cohort.length}
        <TableRegion label="Checks across the cohort">
          <table>
            <caption>Each submission's recorded feedback, and its flags</caption>
            <thead><tr><th scope="col">Submission</th><th scope="col">Feedback recorded</th><th scope="col">Flags to check</th><th scope="col">Accepted</th></tr></thead>
            <tbody>
              {#each cohort as c (c.id)}
                <tr>
                  <th scope="row">{c.label}</th>
                  <td class={c.problem ? "missing" : ""}>{c.problem ? `Not yet: ${c.problem}` : c.recorded}</td>
                  <td class={c.open ? "attention" : c.recorded ? "done" : ""}>{c.problem ? "—" : c.open}</td>
                  <td>{c.problem ? "—" : c.accepted}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </TableRegion>
      {/if}
      <details class="step-form">
        <summary>Words that only fit higher marks</summary>
        <form onsubmit={savePraiseWords}>
          <p class="hint">One word or phrase a line. Each list's words are flagged in feedback on any mark below that band.</p>
          {#each PRAISE_BANDS as b (b)}
            <label for={`praise-${b}`}>For {BAND_NAMES[b]} work and above</label>
            <textarea id={`praise-${b}`} rows="4" bind:value={praise[b]}></textarea>
          {/each}
          <button type="submit" aria-disabled={busy}>Save the words</button>
          <Status message={asDone(praiseNote)} />
        </form>
      </details>
      {@render notices("checks")}
    </section>

    <CohortFeedback {workspace} version={cohortVersion} onEdit={(id) => act(async () => void (await openWork(id)), null, "write")} />
  {/snippet}
</StepScreen>
