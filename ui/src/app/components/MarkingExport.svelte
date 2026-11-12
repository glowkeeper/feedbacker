<script lang="ts">
  import { tick } from "svelte";
  import { approveFeedbackSet, approveSubmission, criterionText, exportMarking, exportMarkingReidentified, feedbackExceptions, feedbackText, waitingOf, type WaitingFeedback, type Workspace } from "../../core/index.ts";
  import { pyFormatG } from "../../core/pytext.ts";
  import { problemsOf } from "../forms.ts";
  import type { EditRequest } from "../feedbackWork.ts";
  import { approvalRows, STATUS_TEXT, type ApprovalRow } from "../markingExportView.ts";
  import { done, info, type Message } from "../messages.ts";
  import type { StepState } from "../steps.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";
  import StepScreen from "./StepScreen.svelte";
  import TableRegion from "./TableRegion.svelte";

  let {
    workspace,
    step,
    onChanged,
    onEdit,
  }: { workspace: Workspace; step: StepState | undefined; onChanged: () => void | Promise<void>; onEdit: (request: EditRequest) => void } = $props();

  const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  let rows: ApprovalRow[] = $state([]);
  // The submissions ready to approve, as the set lists them (with why each is flagged, if it is).
  let waiting: WaitingFeedback[] = $state([]);
  let loaded = $state(false); // until the first read is done, nothing is said of what is waiting
  // What the educator has read, by submission, with the digest of what they were shown: a submission that changed since isn't counted as read.
  let seen: Record<string, string> = $state({});
  // Their confirmation that they skimmed the submissions that are not flagged: those, as they were listed, by digest. It lapses when they change.
  let skimmed: Record<string, string> | null = $state(null);
  let setHeading: HTMLHeadingElement | undefined = $state();
  let open = $state<string | null>(null); // the submission being read and approved
  let busy = $state(false);
  let message = $state<Message | null>(null);
  let problems: string[] = $state([]);
  /** Where an action's outcome is shown: beside the button that did it, so it is seen where it was asked for. */
  type Place = "approve" | "set" | "export" | "reidentify";
  let place = $state<Place>("approve");
  let copied: string | null = $state(null);
  let confirming = $state(false);
  let openHeading: HTMLHeadingElement | undefined = $state();
  let confirmHeading: HTMLHeadingElement | undefined = $state();
  let reidentifyButton: HTMLButtonElement | undefined = $state();

  async function read() {
    try {
      // Both together, so the screen never shows one of them read again and not the other (a button pressed between would approve what isn't listed).
      const [now, exceptions] = await Promise.all([approvalRows(workspace), feedbackExceptions(workspace)]);
      rows = now;
      waiting = waitingOf(now, exceptions); // from the states just read: each submission is read once, not twice
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      loaded = true;
    }
  }
  $effect(() => {
    void read();
  });

  const current = $derived(rows.find((r) => r.id === open) ?? null);

  const flagged = $derived(waiting.filter((w) => w.exceptions.length));
  const flaggedOpened = $derived(flagged.filter((w) => seen[w.id] === w.digest));
  /** The submissions that are not flagged, as the list now shows them, each with the digest of what is shown. */
  const unflagged = $derived(Object.fromEntries(waiting.filter((w) => !w.exceptions.length).map((w) => [w.id, w.digest])));
  $effect(() => {
    if (skimmed !== null && JSON.stringify(skimmed) !== JSON.stringify(unflagged)) skimmed = null;
  });

  async function run(what: () => Promise<string>, at: Place = "approve") {
    if (busy) return; // buttons stay enabled while busy, so focus isn't lost from them
    busy = true;
    problems = [];
    message = null;
    place = at;
    try {
      const said = await what();
      await read();
      await onChanged();
      message = done(said); // once everything has changed with it
    } catch (err) {
      problems = problemsOf(err);
      await read(); // what is shown may be why it failed: show what there is now
    } finally {
      busy = false;
    }
  }

  async function show(id: string) {
    open = id;
    // What is shown is what is read: the digest of what its student would receive now.
    const digest = rows.find((r) => r.id === id)?.state?.digest;
    if (digest) seen[id] = digest;
    copied = null;
    await tick();
    openHeading?.focus();
  }

  // Approved on what was shown: if it changed since (a record finishing late, say), nothing is approved, and what is shown is read again.
  // Once approved, the next submission that is ready is shown, so each is one action: read it, approve it, and on to the next.
  async function approveIt(id: string, shown: string | null) {
    await run(async () => {
      await approveSubmission(workspace, id, new Date(), shown ?? undefined);
      return `Approved ${id}: exactly what is shown is what its student receives. Any later change clears the approval.`;
    });
    if (rows.find((r) => r.id === id)?.status !== "approved") return; // not approved (it changed, or couldn't be): stay and read it
    const here = rows.findIndex((r) => r.id === id);
    const following = [...rows.slice(here + 1), ...rows.slice(0, here)].find((r) => r.state?.feedback && r.status !== "approved");
    if (!following) return;
    await show(following.id);
    if (message) message = done(`${message.text} ${following.label} is shown next, to read and approve.`);
  }

  /** Approve the set: what the educator has read, and the rest once skimmed. The rest are said. */
  async function approveReviewed() {
    await run(async () => {
      const result = await approveFeedbackSet(workspace, { opened: { ...seen }, skimmed: skimmed ? { ...skimmed } : null });
      skimmed = null;
      const held = result.skipped.map((k) => `${k.label}: ${k.why}`);
      const already = result.alreadyApproved.length ? ` ${count(result.alreadyApproved.length, "submission you were shown was", "submissions you were shown were")} approved already, on what ${result.alreadyApproved.length === 1 ? "it is" : "they are"} now.` : "";
      return `Approved ${count(result.approved.length, "submission")} of ${result.size} waiting${held.length ? `; not approved: ${held.join("; ")}` : ""}.${already}`;
    }, "set");
    if (!waiting.length) {
      await tick();
      setHeading?.focus(); // the last one waiting was approved: focus goes to the heading, not lost with the button
    }
  }

  /** Copy to the clipboard, to paste into the marking platform. */
  async function copy(what: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = `Copied ${what} to the clipboard.`;
    } catch {
      copied = `Couldn't copy ${what}: select it and copy it instead.`;
    }
  }

  const exportIt = () =>
    run(async () => {
      const { paths, submissions } = await exportMarking(workspace);
      return `Exported ${submissions.length} approved submission(s), pseudonymous: ${paths.join(", ")}.`;
    }, "export");

  /** Ask before making the copy: what it will contain, and why that is personal data. Asked each time. */
  async function askToReidentify() {
    if (busy) return;
    confirming = true;
    message = null;
    problems = [];
    place = "reidentify";
    await tick();
    confirmHeading?.focus();
  }
  async function dontReidentify() {
    if (busy) return;
    confirming = false;
    place = "reidentify";
    message = info("No re-identified copy was made.");
    await tick();
    reidentifyButton?.focus();
  }
  const reidentify = () =>
    run(async () => {
      const { paths } = await exportMarkingReidentified(workspace, { confirmed: true });
      confirming = false;
      await tick();
      reidentifyButton?.focus();
      return `Wrote the re-identified copy: ${paths.join(", ")}. It contains personal data: each student's platform ID, which identifies them. It is kept only in this workspace and deleted with it.`;
    }, "reidentify");
</script>

{#snippet outcome(at: Place)}
  {#if place === at}
    <Status {message} />
    <Problems {problems} />
  {/if}
{/snippet}

<StepScreen title="Export" {step}>
  {#snippet how()}
    <p>
      Read what each student will receive, exactly as it will be pasted or exported, and approve it: their marks and feedback, criterion by criterion and
      overall. A submission can be approved once everything is marked, its feedback is current, and every flag is accepted with a reason; any later change
      clears the approval. For each approved submission, copy the mark and the feedback to paste into the marking platform, or export them all. Copies and
      exports are pseudonymous; a re-identified copy, with each student's platform ID, is a separate step, as in moderation.
    </p>
  {/snippet}
  {#snippet work()}
    <section aria-labelledby="set-heading">
      <h2 id="set-heading" tabindex="-1" bind:this={setHeading}>Approve many at once</h2>
      {#if waiting.length}
        <p>
          {count(waiting.length, "submission")} ready to approve. Open and read what each flagged submission's student will receive, and skim the rest in the list below,
          which shows each one's mark and full feedback. Then approve what you have reviewed in one action. Each submission is still approved on its own, on exactly what is
          shown, and its approval records that it was one of a set. A flagged submission you haven't opened is not approved by it, and one that changed after this list was shown is
          not approved either.
        </p>
        <p>
          {flagged.length} flagged{flagged.length ? `, of which ${flaggedOpened.length} ${flaggedOpened.length === 1 ? "has" : "have"} been opened` : ""}; {waiting.length - flagged.length} not flagged.
        </p>
        <TableRegion label="Submissions ready to approve">
          <table>
            <caption>Each submission ready to approve, with its mark and the feedback its student will receive</caption>
            <thead><tr><th scope="col">Submission</th><th scope="col">Mark</th><th scope="col">What its student will receive</th><th scope="col">Flagged</th><th scope="col">Opened</th><th scope="col"><span class="visually-hidden">Read it</span></th></tr></thead>
            <tbody>
              {#each waiting as w (w.id)}
                <tr>
                  <th scope="row">{w.label}</th>
                  <td>{pyFormatG(w.feedback.mark)}</td>
                  <td>
                    {#each w.feedback.criteria as c, i (i)}
                      <p><span>{c.title}{c.mark !== null ? ` (${pyFormatG(c.mark)})` : ""}:</span> {c.feedback}</p>
                    {/each}
                    <p><span>Overall:</span> {w.feedback.overall}</p>
                  </td>
                  <td class={w.exceptions.length ? "attention" : "done"}>{w.exceptions.length ? w.exceptions.join("; ") : "No"}</td>
                  <td class={seen[w.id] === w.digest ? "done" : w.exceptions.length ? "missing" : ""}>{seen[w.id] === w.digest ? "Opened" : w.exceptions.length ? "Not yet: open it" : "Not needed"}</td>
                  <td><button type="button" onclick={() => show(w.id)}>Open it<span class="visually-hidden">: {w.label}</span></button></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </TableRegion>
        <div class="fields">
          {#if waiting.length > flagged.length}
            <label class="check"
              ><input type="checkbox" checked={skimmed !== null} onchange={(e) => (skimmed = e.currentTarget.checked ? { ...unflagged } : null)} /> I have skimmed the submissions that are not flagged</label
            >
          {/if}
          <button type="button" aria-disabled={busy} onclick={approveReviewed}>Approve the reviewed set</button>
        </div>
      {:else if loaded}
        <p>Nothing is waiting to be approved.</p>
      {:else}
        <p>Reading what is ready to approve…</p>
      {/if}
      {@render outcome("set")}
    </section>

    <section aria-labelledby="approve-heading">
      <h2 id="approve-heading">Approve one at a time</h2>
      <TableRegion label="Each submission's approval">
        <table>
          <caption>Each submission, and whether what its student will receive is approved</caption>
          <thead><tr><th scope="col">Submission</th><th scope="col">Approval</th><th scope="col"><span class="visually-hidden">Read it</span></th></tr></thead>
          <tbody>
            {#each rows as r (r.id)}
              <tr>
                <th scope="row">{r.label}</th>
                <td class={r.status === "approved" ? "done" : r.status === "not ready" ? "missing" : "attention"}>
                  {r.problem ? `Not ready: ${r.problem}` : r.status === "not ready" ? `Not ready: ${r.state?.problems.length ?? 0} thing(s) to do` : STATUS_TEXT[r.status]}
                </td>
                <td><button type="button" aria-current={open === r.id ? "true" : undefined} onclick={() => show(r.id)}>Read what they receive<span class="visually-hidden">: {r.label}</span></button></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </TableRegion>

      {#if current}
        {@const r = current}
        {@const f = r.state?.feedback ?? null}
        <section aria-labelledby="receive-heading" class="receive">
          <h3 id="receive-heading" tabindex="-1" bind:this={openHeading}>What {r.label} will receive</h3>
          {#if r.problem}
            <Problems problems={[r.problem]} title="It can't be read yet:" />
          {:else if !f}
            <Problems problems={r.state?.problems ?? []} title="Not ready to approve:" />
          {:else}
            <p class={r.status === "approved" ? "done" : "attention"}>{STATUS_TEXT[r.status]}</p>
            <div class="receive-part">
              <p><strong>Overall mark: {pyFormatG(f.mark)}</strong></p>
              {#if r.status === "approved"}<button type="button" onclick={() => copy("the mark", pyFormatG(f.mark))}>Copy the mark</button>{/if}
            </div>
            {#each f.criteria as c, i (i)}
              <div class="receive-part">
                <h4>{c.title}{c.mark !== null ? `: ${pyFormatG(c.mark)}${c.outOf !== null ? ` out of ${pyFormatG(c.outOf)}` : ""}` : ""}</h4>
                <p class="feedback-text">{c.feedback}</p>
                <div class="actions">
                  <button type="button" onclick={() => onEdit({ submissionId: r.id, part: { criterion: i, title: c.title } })}>Edit this feedback<span class="visually-hidden"> on {c.title}</span></button>
                  {#if r.status === "approved"}<button type="button" onclick={() => copy(`the feedback on ${c.title}`, criterionText(c))}>Copy<span class="visually-hidden"> the feedback on {c.title}</span></button>{/if}
                </div>
              </div>
            {/each}
            <div class="receive-part">
              <h4>Overall</h4>
              <p class="feedback-text">{f.overall}</p>
              <div class="actions">
                <button type="button" onclick={() => onEdit({ submissionId: r.id, part: "overall" })}>Edit this feedback<span class="visually-hidden">: the overall feedback</span></button>
              </div>
            </div>
            {#if r.status !== "approved"}
              <p class="hint">Approving releases exactly this mark and feedback, to be copied or exported, and shows the next submission that is ready. Any later change clears the approval.</p>
            {/if}
            <div class="actions">
              {#if r.status === "approved"}
                <button type="button" onclick={() => copy("all the feedback", feedbackText(f))}>Copy all the feedback</button>
              {:else}
                <button type="button" aria-disabled={busy} onclick={() => approveIt(r.id, r.state?.digest ?? null)}>Approve<span class="visually-hidden">: {r.label}</span></button>
              {/if}
            </div>
            <p role="status" class="hint">{copied ?? ""}</p>
          {/if}
        </section>
      {/if}
      {@render outcome("approve")}
    </section>

    <section aria-labelledby="export-heading">
      <h2 id="export-heading">Export</h2>
      <p>
        Each approved submission's feedback as text, one file of them all, a marks table (CSV) and the structured record (JSON), into <code>exports</code>,
        pseudonymous. Only submissions approved on what they are now are included.
      </p>
      <button type="button" onclick={exportIt} aria-disabled={busy}>Export the approved feedback and marks</button>
      {@render outcome("export")}
    </section>

    <section aria-labelledby="reidentify-heading">
      <h2 id="reidentify-heading">Re-identified copy</h2>
      <p>
        To match each student in the marking platform: a copy of the feedback files and the marks table with each student's pseudonym replaced by their
        platform ID. Nothing else is restored: names and other anonymised details stay as they are. The record stays pseudonymous.
      </p>
      <div><button type="button" bind:this={reidentifyButton} onclick={askToReidentify} aria-disabled={busy} aria-expanded={confirming}>Make a re-identified copy</button></div>
      {#if confirming}
        <div class="confirm" role="group" aria-labelledby="confirm-reidentify-heading">
          <h3 id="confirm-reidentify-heading" tabindex="-1" bind:this={confirmHeading}>Make a re-identified copy?</h3>
          <p>
            It writes new files, beside the pseudonymous ones, with "-reidentified" in their names: each approved student's feedback, one file of them all,
            and the marks table, with each student's platform ID in place of their pseudonym. They contain personal data, which identifies each student;
            they are kept only in this workspace and deleted with it. The standard export is unchanged.
          </p>
          <div class="actions">
            <button type="button" onclick={reidentify} aria-disabled={busy}>Make the copy</button>
            <button type="button" onclick={dontReidentify} aria-disabled={busy}>Don't make it</button>
          </div>
        </div>
      {/if}
      {@render outcome("reidentify")}
    </section>
  {/snippet}
</StepScreen>
