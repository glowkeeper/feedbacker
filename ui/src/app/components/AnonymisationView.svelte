<script lang="ts">
  import TableRegion from "./TableRegion.svelte";
  import { anonymiseAll, approve, loadRules, setFigureExcluded, updateRules, type AnonymisationRules, type Workspace } from "../../core/index.ts";
  import { recordsToReview, redactionsFrom, REDACTION_KINDS, reviewOf, type RecordStatus, type RedactionRow, type Review, type ReviewFigure } from "../anonymisation.ts";
  import { parseList, problemsOf } from "../forms.ts";
  import Problems from "./Problems.svelte";
  import RowsEditor from "./RowsEditor.svelte";
  import Status from "./Status.svelte";
  import { asDone } from "../messages.ts";
  import type { StepState } from "../steps.ts";
  import StepScreen from "./StepScreen.svelte";

  let { workspace, step, onChanged }: { workspace: Workspace; step: StepState | undefined; onChanged: () => void | Promise<void> } = $props();

  let rules = $state<AnonymisationRules | null>(null);
  let rulesSummary: HTMLElement | undefined = $state(); // the rules form folds away once there are rules: focus goes to its summary
  let rulesOpen = $state(false); // opened when the rules are first read and there are none; never closed by reading, so it stays as the moderator left it
  let rulesRead = false;
  let records: RecordStatus[] = $state([]);
  let names = $state("");
  let organisations = $state("");
  const blankRedaction = () => [{ text: "", kind: REDACTION_KINDS[0].value }];
  let redact: Record<string, string>[] = $state(blankRedaction());
  let ignore = $state("");
  let busy = $state(false);
  let problems: string[] = $state([]);
  let message: string | null = $state(null);
  let reviewing: Review | null = $state(null);
  let showValues = $state(false);
  let screen: StepScreen;
  let reviewHeading: HTMLHeadingElement | undefined = $state();

  async function refresh() {
    rules = await loadRules(workspace);
    if (!rulesRead && rules.names.length + rules.organisations.length + Object.keys(rules.redact).length + rules.ignore.length === 0) rulesOpen = true; // no rules yet
    rulesRead = true;
    records = await recordsToReview(workspace);
  }

  $effect(() => {
    refresh().catch((err) => (problems = problemsOf(err)));
  });
  // Every text is anonymised and approved: nothing more to do here unless something changes.
  const complete = $derived(records.length > 0 && records.every((r) => r.anonymised && r.approved && !r.problem));

  async function run(what: () => Promise<string>) {
    if (busy) return; // buttons stay enabled while busy, so focus isn't lost from them
    busy = true;
    problems = [];
    message = null;
    try {
      const done = await what();
      await onChanged(); // the status is read again, so it changes with what is recorded
      await refresh();
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
      await updateRules(workspace, { names: parseList(names), organisations: parseList(organisations), redact: redactionsFrom(redact as unknown as RedactionRow[]), ignore: parseList(ignore) });
      names = organisations = ignore = "";
      redact = blankRedaction();
      rulesOpen = false; // there are rules now: the form folds away, and focus goes to its summary
      queueMicrotask(() => rulesSummary?.focus());
      return "Added to the rules. Anonymise again to apply them.";
    });
  };

  const anonymise = () =>
    run(async () => {
      const result = await anonymiseAll(workspace);
      reviewing = null;
      const lines = Object.entries(result.counts).map(([id, counts]) => {
        const total = Object.values(counts).reduce((n, c) => n + c, 0);
        return `${id}: ${total} redaction(s); ${result.approvalKept[id] ? "approval kept (the text is unchanged)" : "needs approval"}`;
      });
      // Comments stored earlier (the marker's, and yours) are brought up to the current rules too.
      const comments = result.commentsUpdated.length
        ? ` Comments anonymised again with the current rules, in ${result.commentsUpdated.length} record(s): ${result.commentsUpdated.join(", ")}.`
        : "";
      return `Anonymised. ${lines.join(". ")}.${comments}`;
    });

  async function open(id: string) {
    if (busy) return; // the button stays focusable while busy (aria-disabled), so it must not act
    problems = [];
    message = null;
    showValues = false;
    try {
      reviewing = await reviewOf(workspace, id, false);
      opened += 1;
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

  let opened = $state(0); // bumped when a text is opened, to move focus to it; not when it is reloaded (approving, showing values)
  $effect(() => {
    if (opened) reviewHeading?.focus();
  });

  // Each figure's image, shown from memory: made when a text is opened, and released when another is (or this screen closes).
  let figureUrls: Record<string, string> = $state({});
  $effect(() => {
    const urls: Record<string, string> = {};
    for (const f of reviewing?.figures ?? []) if (f.bytes && f.mediaType) urls[f.placeholder] = URL.createObjectURL(new Blob([f.bytes as BlobPart], { type: f.mediaType }));
    figureUrls = urls;
    return () => Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
  });
  let reasons: Record<string, string> = $state({});
  const figureOf = (placeholder: string) => reviewing?.figures.find((f) => f.placeholder === placeholder) ?? null;
  const figureName = (f: ReviewFigure) => `${f.placeholder}${f.page !== null ? `, page ${f.page}` : ""}`;

  /** Include or exclude a figure (with the reason typed, if any): a change to what is included clears the approval. */
  const setExcluded = (f: ReviewFigure, excluded: boolean) =>
    run(async () => {
      const id = reviewing!.id;
      const before = reviewing!.approvedAt;
      const updated = await setFigureExcluded(workspace, id, f.placeholder, excluded, excluded ? (reasons[f.placeholder] ?? f.reason) : null);
      reviewing = await reviewOf(workspace, id, showValues);
      const cleared = before !== null && updated.approval === null ? " The approval was cleared: approve the text and its figures again." : "";
      return `${excluded ? `${f.placeholder} won't be sent` : `${f.placeholder} will be sent with the text`}.${cleared}`;
    });
  const saveReason = (f: ReviewFigure) =>
    run(async () => {
      await setFigureExcluded(workspace, reviewing!.id, f.placeholder, true, reasons[f.placeholder] ?? null);
      reviewing = await reviewOf(workspace, reviewing!.id, showValues);
      return `Saved why ${f.placeholder} isn't sent.`;
    });

  const approveCurrent = () =>
    reviewing?.approvedAt ||
    run(async () => {
      const id = reviewing!.id;
      await approve(workspace, id);
      reviewing = await reviewOf(workspace, id, showValues);
      const included = reviewing!.figures.filter((f) => !f.excluded).length;
      return `Approved ${reviewing!.label}: exactly this text${included ? `, and its ${included} included figure(s),` : ""} may be sent to the AI.`;
    });
</script>

<StepScreen bind:this={screen} title="Anonymisation" {step} recorded={rules !== null} {complete} change="Change the rules or anonymise again">
  {#snippet how()}
    <p>
      Names, identifiers, emails, links and phone numbers are replaced with tokens such as <code>[STUDENT_A]</code> on this computer. Automated redaction can
      miss things, so review each text and approve it: only approved text is ever sent to a model. Add anything the redaction might miss to the rules first,
      then anonymise; rules added later still apply everywhere, but a text they change has to be approved again.
    </p>
  {/snippet}
  {#snippet messages()}
    <Status message={asDone(message)} />
    <Problems {problems} />
  {/snippet}
  {#snippet record()}
    {@const r = rules!}
    <dl class="steps">
      <dt>Other people's names</dt>
      <dd>{r.names.length}</dd>
      <dt>Organisations</dt>
      <dd>{r.organisations.length}</dd>
      <dt>Extra values</dt>
      <dd>{Object.keys(r.redact).length}</dd>
      <dt>Values kept</dt>
      <dd>{r.ignore.length}</dd>
    </dl>
    <p class="hint">The rules hold real values, so they are kept in the workspace's private folder and not shown here.</p>
    {#if records.length}
      <TableRegion label="Texts to anonymise and approve">
        <table>
          <caption>Each text, and whether it is anonymised and approved</caption>
          <thead><tr><th scope="col">Text</th><th scope="col">Anonymised</th><th scope="col">Approved</th><th scope="col"><span class="visually-hidden">Action</span></th></tr></thead>
          <tbody>
            {#each records as record (record.id)}
              <tr>
                <th scope="row">{record.label}</th>
                <td class={record.anonymised ? "done" : "missing"}>{record.anonymised ? "Done" : "Not yet"}</td>
                <td class={record.approved ? "done" : "missing"}>{record.approved ? "Approved" : "Not yet"}</td>
                <td><button type="button" onclick={() => open(record.id)} disabled={!record.anonymised} aria-disabled={busy} aria-label={`Review ${record.label}`}>Review</button></td>
              </tr>
              {#if record.problem}
                <tr><td colspan="4" class="error">{record.label}: {record.problem}</td></tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </TableRegion>
    {/if}
  {/snippet}
  {#snippet outcome()}
    {#if reviewing}
      <section aria-labelledby="review-heading">
        <h2 id="review-heading" tabindex="-1" bind:this={reviewHeading}>Review {reviewing.label}</h2>
        <p>
          {reviewing.approvedAt ? `Approved ${reviewing.approvedAt}.` : "Not approved yet."} {reviewing.replacements.length} replacement(s).{reviewing.figures.length
            ? ` ${reviewing.figures.length} figure(s), ${reviewing.figures.filter((f) => !f.excluded).length} to be sent.`
            : ""}
        </p>

        <h3>Anonymised text{reviewing.figures.length ? " and figures" : ""}</h3>
        {#if reviewing.figures.length}
          <p class="warning" role="note">
            Redaction can't see inside an image. Check each figure for a name, an email, a username, a file path, an organisation or a face; if one shows
            something that identifies anyone, don't send it. Every figure is sent with the text unless you say so.
          </p>
        {/if}
        <!-- Scrollable, so it must be reachable from the keyboard. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div class="text" tabindex="0" role="region" aria-label={`The anonymised text of ${reviewing.label}`}>
          {#each reviewing.segments as segment, i (i)}
            {#if segment.kind === "text"}<span class="text-run">{segment.text}</span>{:else}
              {@const f = figureOf(segment.placeholder)!}
              <figure class={["review-figure", f.excluded && "excluded"]}>
                <figcaption>{figureName(f)}{f.excluded ? " (not sent)" : ""}</figcaption>
                {#if figureUrls[f.placeholder]}
                  <img src={figureUrls[f.placeholder]} alt={`Figure ${figureName(f)}, from the submission`} />
                {:else}
                  <p class="hint">This figure can't be shown here: {f.problem}.</p>
                {/if}
                <label class="check"
                  ><input
                    type="checkbox"
                    checked={f.excluded}
                    aria-disabled={busy}
                    onchange={(e) => {
                      const box = e.currentTarget as HTMLInputElement;
                      if (busy) box.checked = f.excluded;
                      else setExcluded(f, box.checked);
                    }}
                  /> Don't send {f.placeholder}</label
                >
                {#if f.excluded}
                  <label for={`reason-${i}`}>Why not (optional)</label>
                  <input id={`reason-${i}`} type="text" value={reasons[f.placeholder] ?? f.reason ?? ""} oninput={(e) => (reasons[f.placeholder] = (e.currentTarget as HTMLInputElement).value)} />
                  <button type="button" aria-disabled={busy} onclick={() => saveReason(f)}>Save the reason<span class="visually-hidden"> for {f.placeholder}</span></button>
                {/if}
              </figure>
            {/if}
          {/each}
        </div>

        <h3>Replacements</h3>
        <label class="check"><input
            type="checkbox"
            checked={showValues}
            aria-disabled={busy}
            onchange={(e) => {
              const box = e.currentTarget as HTMLInputElement;
              if (busy) box.checked = showValues; // busy: it stays as it was, and nothing is loaded meanwhile
              else toggleValues(box.checked);
            }}
          /> Show the real values</label>
        {#if showValues}
          <p class="warning" role="note">These are real names and details. Look, but don't copy, paste or share them anywhere.</p>
        {/if}
        <TableRegion label="What was replaced">
          <table>
            <caption>What was replaced, in order</caption>
            <thead><tr><th scope="col">Token</th><th scope="col">Kind</th>{#if showValues}<th scope="col">Real value</th>{/if}</tr></thead>
            <tbody>
              {#each reviewing.replacements as r, i (i)}
                <tr><td><code>{r.replacement}</code></td><td>{r.reason}</td>{#if showValues}<td>{r.original}</td>{/if}</tr>
              {/each}
            </tbody>
          </table>
        </TableRegion>

        <button type="button" onclick={approveCurrent} aria-disabled={busy || reviewing.approvedAt !== null}>
          {reviewing.approvedAt ? "Approved" : reviewing.figures.some((f) => !f.excluded) ? "Approve this text and its figures for the AI" : "Approve this text for the AI"}
        </button>
      </section>
    {/if}
  {/snippet}
  {#snippet actions()}
    <details class="step-form" bind:open={rulesOpen}>
      <summary bind:this={rulesSummary}>Add to the rules</summary>
      <form onsubmit={addRules}>
        <label for="rule-names">Add other people's names (one per line)</label>
        <textarea id="rule-names" rows="2" bind:value={names}></textarea>
        <label for="rule-orgs">Add organisations (one per line)</label>
        <textarea id="rule-orgs" rows="2" bind:value={organisations}></textarea>
        <RowsEditor
          id="rule-redact"
          legend="Add extra values to redact"
          hint="Anything else that identifies someone, such as a username or project name, and what kind of thing it is: its token then says so, for example [USERNAME_1]."
          columns={[
            { key: "text", label: "Value" },
            { key: "kind", label: "Kind", options: REDACTION_KINDS },
          ]}
          bind:rows={redact}
          addLabel="Add another value"
          rowName="value"
        />
        <label for="rule-ignore">Add values that should not be redacted (one per line)</label>
        <textarea id="rule-ignore" rows="2" bind:value={ignore}></textarea>
        <button type="submit" aria-disabled={busy}>Add to the rules</button>
      </form>
    </details>
    <p>Anonymises every imported submission and the brief. An approval is kept only if its text is unchanged.</p>
    <button type="button" onclick={anonymise} aria-disabled={busy}>Anonymise now</button>
  {/snippet}
</StepScreen>
