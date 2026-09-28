<script lang="ts">
  import { tick } from "svelte";
  import TableRegion from "./TableRegion.svelte";
  import {
    cachedEstimate,
    cancelBatch,
    checkBatch,
    collectBatch,
    DEFAULT_CAP_USD,
    DEFAULT_MODEL,
    estimatedCost,
    pendingBatches,
    planReadings,
    runReadings,
    sendBatch,
    type BatchProgress,
    type Plan,
    type ProxyHealth,
    type RunResult,
    type SentBatch,
    type Workspace,
  } from "../../core/index.ts";
  import { parseMark, problemsOf } from "../forms.ts";
  import { batchStatusText, briefProblem } from "../readingPlan.ts";
  import type { AppProxy } from "../platform.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";

  let { workspace, proxy, onChanged }: { workspace: Workspace; proxy: AppProxy; onChanged: () => void } = $props();

  let health: ProxyHealth | null = $state(null);
  let model = $state(DEFAULT_MODEL);
  let limit = $state(String(DEFAULT_CAP_USD));
  let fallback = $state(true);
  let withBrief = $state(true);
  let replace = $state(false);
  let rereadUnchanged = $state(false);
  let asBatch = $state(false);
  // Batches sent from this workspace and not yet collected, with what the provider last said of each (#25).
  let waiting: SentBatch[] = $state([]);
  let progress: Record<string, BatchProgress> = $state({});
  let waitingHeading: HTMLHeadingElement | undefined = $state();
  let busy = $state(false);
  let problems: string[] = $state([]);
  let message: string | null = $state(null);
  let plan: Plan | null = $state(null);
  let result: RunResult | null = $state(null);
  let heading: HTMLHeadingElement;
  let planHeading: HTMLHeadingElement | undefined = $state();
  let resultHeading: HTMLHeadingElement | undefined = $state();

  $effect(() => {
    heading?.focus();
    proxy.health().then(
      (h) => (health = h),
      (err) => (problems = problemsOf(err)),
    );
    loadWaiting().then(
      () => Promise.all(waiting.map((b) => refresh(b.id))),
      (err) => (problems = problemsOf(err)),
    );
  });

  async function loadWaiting() {
    waiting = await pendingBatches(workspace);
  }

  /** Ask the proxy how far a batch has got; a failure is shown, not thrown. */
  async function refresh(id: string) {
    try {
      progress[id] = await checkBatch(proxy, id);
    } catch (err) {
      problems = problemsOf(err);
    }
  }
  $effect(() => {
    if (plan && !result) planHeading?.focus();
  });
  $effect(() => {
    if (result) resultHeading?.focus();
  });

  const usd = (n: number) => `$${n.toFixed(4)}`;
  /** Whether the proxy gives the model's cache prices, so what caching saves can be shown. */
  const cachePriced = (h: ProxyHealth, model: string) => h.prices[model]?.cache_read !== undefined && h.prices[model]?.cache_write !== undefined;
  const batchShare = (h: ProxyHealth, plan: Plan) => (plan.batch ? (h.prices[plan.model]?.batch ?? 1) : 1);

  async function makePlan(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return; // buttons stay enabled while busy, so focus isn't lost from them
    busy = true;
    problems = [];
    message = null;
    plan = null;
    result = null;
    try {
      const capUsd = parseMark(limit, "the spend limit") ?? DEFAULT_CAP_USD;
      const brief = withBrief ? await briefProblem(workspace) : null;
      if (brief) throw new Error(brief);
      plan = await planReadings(workspace, proxy, null, { model, capUsd, fallback, withBrief, replace: replace || rereadUnchanged, rereadUnchanged, batch: asBatch && !!health?.batch });
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      busy = false;
    }
  }

  /** Drop the plan; focus was on its buttons, so it moves to the screen's heading rather than being lost. */
  async function dontSend() {
    if (busy) return;
    plan = null;
    await tick();
    heading.focus();
    message = "Nothing was sent.";
  }

  async function confirmAndRun() {
    if (!plan || busy) return;
    busy = true;
    problems = [];
    try {
      if (plan.batch) {
        const sent = await sendBatch(workspace, plan, { proxy });
        plan = null;
        await loadWaiting();
        if (sent.batch) await refresh(sent.batch.id);
        const other = sent.result;
        if (other.read.size || other.failed.size || other.notRun.size) result = other;
        else await focusWaiting();
        if (other.read.size) onChanged();
        message = sent.batch
          ? `Sent ${sent.batch.items.length} reading(s) as one batch. Results come back within a day, usually much sooner: check below. You can close Feedbacker meanwhile.`
          : "Nothing needed sending in a batch.";
        return;
      }
      result = await runReadings(workspace, plan, { proxy });
      plan = null;
      onChanged();
      message = `Spent ${usd(result.spentUsd)}. The readings are suggestions, never marks.`;
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      busy = false;
    }
  }

  async function focusWaiting() {
    await tick();
    waitingHeading?.focus();
  }

  async function checkNow(id: string) {
    if (busy) return;
    busy = true;
    problems = [];
    message = null;
    try {
      await refresh(id);
      if (progress[id]) message = batchStatusText(progress[id]);
    } finally {
      busy = false;
    }
    // Once it has ended, "Check now" gives way to "Collect the results": focus goes to the section rather than being lost.
    if (progress[id]?.status === "ended") await focusWaiting();
  }

  async function collect(id: string) {
    if (busy) return;
    busy = true;
    problems = [];
    message = null;
    try {
      result = await collectBatch(workspace, proxy, id);
      await loadWaiting();
      onChanged();
      message = `Spent ${usd(result.spentUsd)} on the batch. The readings are suggestions, never marks.`;
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      busy = false;
    }
  }

  async function cancel(id: string) {
    if (busy) return;
    busy = true;
    problems = [];
    message = null;
    try {
      progress[id] = await cancelBatch(proxy, id);
      message = "Cancelling the batch. Readings already done are still billed, and can be collected once it has stopped.";
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      busy = false;
    }
    await focusWaiting(); // the cancel button has gone
  }
</script>

<h1 tabindex="-1" bind:this={heading}>AI reading</h1>
<p>
  A second reading of each approved submission against the rubric, with evidence quoted from it. Only approved anonymised text is sent, through the local proxy;
  the original marks are never sent. You see a worst-case estimate first, and nothing is sent until you confirm it.
</p>
{#if health && !health.key_configured}
  <p class="warning" role="note">The proxy has no API key, so it will refuse to send. Put the key in ~/Feedbacker/.env and restart the proxy.</p>
{/if}

<Status {message} />
<Problems {problems} />

<form onsubmit={makePlan}>
  <label for="model">Model</label>
  <select id="model" bind:value={model}>
    {#each Object.keys(health?.prices ?? { [DEFAULT_MODEL]: null }) as m (m)}<option value={m}>{m}</option>{/each}
  </select>
  <label for="limit">Spend limit for this run (USD)</label>
  <input id="limit" type="text" inputmode="decimal" bind:value={limit} />
  <label class="check"><input type="checkbox" bind:checked={fallback} /> If the model declines, ask the fallback model once</label>
  <label class="check"><input type="checkbox" bind:checked={withBrief} /> Include the approved brief (recommended)</label>
  <label class="check"><input type="checkbox" bind:checked={replace} /> Read again submissions already read</label>
  <label class="check"><input type="checkbox" bind:checked={rereadUnchanged} aria-describedby="reuse-hint" /> Ask the model again even where nothing has changed</label>
  <p class="hint" id="reuse-hint">
    This reads every submission again, even one already read with exactly the same text, rubric, brief, instructions and model. Otherwise such a
    reading is reused, at no cost.
  </p>
  {#if health?.batch}
    <label class="check"><input type="checkbox" bind:checked={asBatch} aria-describedby="batch-hint" /> Send as one batch, at half the price</label>
    <p class="hint" id="batch-hint">
      Results come back within a day, usually much sooner, and you can close Feedbacker meanwhile. A batch has no automatic fallback: a submission the model
      declines can then be read again one at a time.
    </p>
  {/if}
  <button type="submit" aria-disabled={busy}>Plan the reading</button>
</form>

{#if waiting.length}
  <section aria-labelledby="waiting-heading">
    <h2 id="waiting-heading" tabindex="-1" bind:this={waitingHeading}>Waiting for a batch</h2>
    {#each waiting as b (b.id)}
      <p>
        Sent on {b.sent_at.slice(0, 16).replace("T", " ")} UTC with {b.model}: {b.items.length} reading(s) ({b.items.map((i) => i.submission_id).join(", ")}).
        {progress[b.id] ? batchStatusText(progress[b.id]) : "Checking how far it has got…"}
      </p>
      <div class="actions">
        {#if progress[b.id]?.status === "ended"}
          <button type="button" onclick={() => collect(b.id)} aria-disabled={busy}>Collect the results</button>
        {:else}
          <button type="button" onclick={() => checkNow(b.id)} aria-disabled={busy}>Check now</button>
          {#if progress[b.id]?.status === "in_progress"}
            <button type="button" onclick={() => cancel(b.id)} aria-disabled={busy}>Cancel the batch</button>
          {/if}
        {/if}
      </div>
    {/each}
  </section>
{/if}

{#if plan}
  <section aria-labelledby="plan-heading">
    {#if plan.readings.length}
      <h2 id="plan-heading" tabindex="-1" bind:this={planHeading}>Check the estimate before anything is sent</h2>
      <TableRegion label="What would be sent">
        <table>
          <caption>What would be sent, each with its worst-case cost</caption>
          <thead><tr><th scope="col">Submission</th><th scope="col">Tokens in (at most)</th><th scope="col">Cost (at most)</th><th scope="col">Fallback (at most)</th></tr></thead>
          <tbody>
            {#each plan.readings as r (r.submissionId)}
              {#if r.reuse}
                <tr><th scope="row">{r.submissionId} {r.pseudonym}</th><td colspan="3">Reused: read before with exactly the same request, so nothing is sent ($0)</td></tr>
              {:else}
                <tr><th scope="row">{r.submissionId} {r.pseudonym}</th><td>{r.tokensIn}</td><td>{usd(r.cost)}</td><td>{plan.fallbackModel && !plan.batch ? usd(r.fallbackCost) : "—"}</td></tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </TableRegion>
      {#if plan.skipped.size}
        <Problems problems={[...plan.skipped].map(([id, why]) => `${id}: ${why}`)} title="Not included:" kind="note" />
      {/if}
      {#if plan.batch}
        <p>
          Sent as one batch with {plan.model}, at the batch price: at most <strong>{usd(estimatedCost(plan))}</strong>, a worst case; a real batch costs much
          less. Only the readings that fit the ${plan.capUsd} limit are sent.
        </p>
      {:else}
        <p>
          With {plan.model}{plan.fallbackModel ? ` (and ${plan.fallbackModel} if it declines)` : ""}, at most <strong>{usd(estimatedCost(plan))}</strong>, a worst
          case; a real run costs much less. The run stops at the ${plan.capUsd} limit.
        </p>
      {/if}
      {#if plan.readings.length > 1 && health && cachePriced(health, plan.model)}
        <p>
          The instructions, rubric and brief are the same for every submission, so after the first reading the provider can read them from its cache, at a
          fraction of the price: then at most <strong>{usd(cachedEstimate(health.prices, plan.readings, batchShare(health, plan)))}</strong>. It does so when
          they are long enough to cache{plan.batch ? ", and in a batch only as it can" : ", and while the readings follow within five minutes of each other"}.
        </p>
      {/if}
      <div class="actions">
        <button type="button" onclick={confirmAndRun} aria-disabled={busy}>{plan.batch ? "Confirm and send the batch" : "Confirm and send"}</button>
        <button type="button" onclick={dontSend} aria-disabled={busy}>Don't send</button>
      </div>
    {:else}
      <!-- Nothing would be sent, so there is no estimate to confirm: only why. -->
      <h2 id="plan-heading" tabindex="-1" bind:this={planHeading}>Nothing to read yet</h2>
      <p>
        A submission is read once it has been imported (Originals), anonymised and approved (Anonymisation){replace ? "" : ", and not read already"}. Nothing
        has been sent.
      </p>
      {#if plan.skipped.size}
        <Problems problems={[...plan.skipped].map(([id, why]) => `${id}: ${why}`)} title="Not included:" kind="note" />
      {/if}
      <div class="actions"><button type="button" onclick={dontSend} aria-disabled={busy}>Close</button></div>
    {/if}
  </section>
{/if}

{#if result}
  <section aria-labelledby="result-heading">
    <h2 id="result-heading" tabindex="-1" bind:this={resultHeading}>What came back</h2>
    {#if result.reused.length}
      <p>Reused {result.reused.length} earlier reading(s) of exactly the same request, at no cost: {result.reused.join(", ")}. Each says so in its call record.</p>
    {/if}
    {#if result.cached.length}
      <p>The shared instructions, rubric and brief were read from the provider's cache for {result.cached.length} of {result.read.size} reading(s).</p>
    {/if}
    <ul>
      {#each [...result.read.keys()] as id (id)}<li>{id}: read{result.fallbacks.includes(id) ? " (by the fallback model)" : ""}</li>{/each}
      {#each [...result.failed] as [id, why] (id)}<li class="error">{id}: {why}</li>{/each}
      {#each [...result.notRun] as [id, why] (id)}<li class="attention">{id}: not run ({why})</li>{/each}
    </ul>
    {#each [...result.warnings] as [id, warnings] (id)}
      <Problems problems={warnings} title={`${id}: please check`} kind="note" />
    {/each}
  </section>
{/if}
