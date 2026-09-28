<script lang="ts">
  import { tick } from "svelte";
  import TableRegion from "./TableRegion.svelte";
  import { cachedEstimate, DEFAULT_CAP_USD, DEFAULT_MODEL, estimatedCost, planReadings, runReadings, type Plan, type ProxyHealth, type RunResult, type Workspace } from "../../core/index.ts";
  import { parseMark, problemsOf } from "../forms.ts";
  import { briefProblem } from "../readingPlan.ts";
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
  });
  $effect(() => {
    if (plan && !result) planHeading?.focus();
  });
  $effect(() => {
    if (result) resultHeading?.focus();
  });

  const usd = (n: number) => `$${n.toFixed(4)}`;
  /** Whether the proxy gives the model's cache prices, so what caching saves can be shown. */
  const cachePriced = (h: ProxyHealth, model: string) => h.prices[model]?.cache_read !== undefined && h.prices[model]?.cache_write !== undefined;

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
      plan = await planReadings(workspace, proxy, null, { model, capUsd, fallback, withBrief, replace: replace || rereadUnchanged, rereadUnchanged });
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
  <button type="submit" aria-disabled={busy}>Plan the reading</button>
</form>

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
                <tr><th scope="row">{r.submissionId} {r.pseudonym}</th><td>{r.tokensIn}</td><td>{usd(r.cost)}</td><td>{plan.fallbackModel ? usd(r.fallbackCost) : "—"}</td></tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </TableRegion>
      {#if plan.skipped.size}
        <Problems problems={[...plan.skipped].map(([id, why]) => `${id}: ${why}`)} title="Not included:" kind="note" />
      {/if}
      <p>
        With {plan.model}{plan.fallbackModel ? ` (and ${plan.fallbackModel} if it declines)` : ""}, at most <strong>{usd(estimatedCost(plan))}</strong>, a worst case; a
        real run costs much less. The run stops at the ${plan.capUsd} limit.
      </p>
      {#if plan.readings.length > 1 && health && cachePriced(health, plan.model)}
        <p>
          The instructions, rubric and brief are the same for every submission, so after the first reading the provider can read them from its cache, at a
          fraction of the price: then at most <strong>{usd(cachedEstimate(health.prices, plan.readings))}</strong>. It does so when they are long enough to
          cache, and while the readings follow within five minutes of each other.
        </p>
      {/if}
      <div class="actions">
        <button type="button" onclick={confirmAndRun} aria-disabled={busy}>Confirm and send</button>
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
