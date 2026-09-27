<script lang="ts">
  import { anonymiseWorkspace, approve, loadRules, updateRules, type AnonymisationRules, type Workspace } from "../../core/index.ts";
  import { parseRedactions, recordsToReview, reviewOf, type RecordStatus, type Review } from "../anonymisation.ts";
  import { parseList, problemsOf } from "../forms.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";

  let { workspace, onChanged }: { workspace: Workspace; onChanged: () => void } = $props();

  let rules: AnonymisationRules | null = $state(null);
  let records: RecordStatus[] = $state([]);
  let names = $state("");
  let organisations = $state("");
  let redact = $state("");
  let ignore = $state("");
  let busy = $state(false);
  let problems: string[] = $state([]);
  let message: string | null = $state(null);
  let reviewing: Review | null = $state(null);
  let showValues = $state(false);
  let heading: HTMLHeadingElement;
  let reviewHeading: HTMLHeadingElement | undefined = $state();

  async function refresh() {
    rules = await loadRules(workspace);
    records = await recordsToReview(workspace);
  }

  $effect(() => {
    heading?.focus();
    refresh().catch((err) => (problems = problemsOf(err)));
  });

  async function run(what: () => Promise<string>) {
    busy = true;
    problems = [];
    message = null;
    try {
      const done = await what();
      await refresh();
      onChanged();
      message = done; // announced once everything is updated and the buttons work again
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      busy = false;
    }
  }

  const addRules = (event: SubmitEvent) => {
    event.preventDefault();
    return run(async () => {
      await updateRules(workspace, { names: parseList(names), organisations: parseList(organisations), redact: parseRedactions(redact), ignore: parseList(ignore) });
      names = organisations = redact = ignore = "";
      return "Added to the rules. Anonymise again to apply them.";
    });
  };

  const anonymise = () =>
    run(async () => {
      const result = await anonymiseWorkspace(workspace);
      reviewing = null;
      const lines = Object.entries(result.counts).map(([id, counts]) => {
        const total = Object.values(counts).reduce((n, c) => n + c, 0);
        return `${id}: ${total} redaction(s); ${result.approvalKept[id] ? "approval kept (the text is unchanged)" : "needs approval"}`;
      });
      return `Anonymised. ${lines.join(". ")}.`;
    });

  async function open(id: string) {
    problems = [];
    message = null;
    showValues = false;
    try {
      reviewing = await reviewOf(workspace, id, false);
    } catch (err) {
      reviewing = null; // never leave another text's review on screen
      problems = problemsOf(err);
    }
  }

  // Read the box's own state: the change handler can run before the binding updates.
  // Nothing else can be pressed while the values load, so an approval can't overlap the reload.
  async function toggleValues(checked: boolean) {
    showValues = checked;
    if (!reviewing) return;
    busy = true;
    try {
      reviewing = await reviewOf(workspace, reviewing.id, checked);
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    if (reviewing) reviewHeading?.focus();
  });

  const approveCurrent = () =>
    run(async () => {
      const id = reviewing!.id;
      await approve(workspace, id);
      reviewing = await reviewOf(workspace, id, showValues);
      return `Approved ${reviewing!.label}: exactly this text may be sent to the AI reading.`;
    });
</script>

<h1 tabindex="-1" bind:this={heading}>Anonymisation</h1>
<p>
  Names, identifiers, emails, links and phone numbers are replaced with tokens such as <code>[STUDENT_A]</code> on this computer. Automated redaction can miss
  things, so review each text and approve it: only approved text is ever sent to a model.
</p>

<Status {message} />
<Problems {problems} />

<section aria-labelledby="rules-heading">
  <h2 id="rules-heading">Rules</h2>
  {#if rules}
    <dl class="steps">
      <dt>Other people's names</dt>
      <dd>{rules.names.length}</dd>
      <dt>Organisations</dt>
      <dd>{rules.organisations.length}</dd>
      <dt>Extra values</dt>
      <dd>{Object.keys(rules.redact).length}</dd>
      <dt>Values kept</dt>
      <dd>{rules.ignore.length}</dd>
    </dl>
    <p class="hint">The rules hold real values, so they are kept in the workspace's private folder and not shown here.</p>
  {/if}
  <form onsubmit={addRules}>
    <label for="rule-names">Add other people's names (one per line)</label>
    <textarea id="rule-names" rows="2" bind:value={names}></textarea>
    <label for="rule-orgs">Add organisations (one per line)</label>
    <textarea id="rule-orgs" rows="2" bind:value={organisations}></textarea>
    <label for="rule-redact">Add extra values to redact</label>
    <p class="hint" id="redact-hint">One per line; <code>TEXT=KIND</code> names the token's kind in capitals (for example <code>aquill99=USERNAME</code>), otherwise it is <code>REDACTED</code>.</p>
    <textarea id="rule-redact" rows="2" bind:value={redact} aria-describedby="redact-hint" spellcheck="false"></textarea>
    <label for="rule-ignore">Add values that should not be redacted (one per line)</label>
    <textarea id="rule-ignore" rows="2" bind:value={ignore}></textarea>
    <button type="submit" disabled={busy}>Add to the rules</button>
  </form>
</section>

<section aria-labelledby="run-heading">
  <h2 id="run-heading">Anonymise</h2>
  <p>Anonymises every imported submission and the brief. An approval is kept only if its text is unchanged.</p>
  <button type="button" onclick={anonymise} disabled={busy}>Anonymise now</button>
</section>

{#if records.length}
  <section aria-labelledby="records-heading">
    <h2 id="records-heading">Review and approve</h2>
    <table>
      <caption>Each text, and whether it is anonymised and approved</caption>
      <thead><tr><th scope="col">Text</th><th scope="col">Anonymised</th><th scope="col">Approved</th><th scope="col"><span class="visually-hidden">Action</span></th></tr></thead>
      <tbody>
        {#each records as record (record.id)}
          <tr>
            <th scope="row">{record.label}</th>
            <td class={record.anonymised ? "done" : "missing"}>{record.anonymised ? "Done" : "Not yet"}</td>
            <td class={record.approved ? "done" : "missing"}>{record.approved ? "Approved" : "Not yet"}</td>
            <td><button type="button" onclick={() => open(record.id)} disabled={!record.anonymised || busy} aria-label={`Review ${record.label}`}>Review</button></td>
          </tr>
          {#if record.problem}
            <tr><td colspan="4" class="error">{record.label}: {record.problem}</td></tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </section>
{/if}

{#if reviewing}
  <section aria-labelledby="review-heading">
    <h2 id="review-heading" tabindex="-1" bind:this={reviewHeading}>Review {reviewing.label}</h2>
    <p>{reviewing.approvedAt ? `Approved ${reviewing.approvedAt}.` : "Not approved yet."} {reviewing.replacements.length} replacement(s).</p>

    <h3>Anonymised text</h3>
    <!-- Scrollable, so it must be reachable from the keyboard. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <pre class="text" tabindex="0" aria-label={`The anonymised text of ${reviewing.label}`}>{reviewing.text}</pre>

    <h3>Replacements</h3>
    <label class="check"><input type="checkbox" checked={showValues} onchange={(e) => toggleValues((e.currentTarget as HTMLInputElement).checked)} /> Show the real values</label>
    {#if showValues}
      <p class="warning" role="note">These are real names and details. Look, but don't copy, paste or share them anywhere.</p>
    {/if}
    <table>
      <caption>What was replaced, in order</caption>
      <thead><tr><th scope="col">Token</th><th scope="col">Kind</th>{#if showValues}<th scope="col">Real value</th>{/if}</tr></thead>
      <tbody>
        {#each reviewing.replacements as r, i (i)}
          <tr><td><code>{r.replacement}</code></td><td>{r.reason}</td>{#if showValues}<td>{r.original}</td>{/if}</tr>
        {/each}
      </tbody>
    </table>

    <button type="button" onclick={approveCurrent} disabled={busy || reviewing.approvedAt !== null}>
      {reviewing.approvedAt ? "Approved" : "Approve this text for the AI reading"}
    </button>
  </section>
{/if}
