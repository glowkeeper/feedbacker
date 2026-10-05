<script lang="ts">
  import { tick } from "svelte";
  import { approveSubmission, criterionText, exportMarking, exportMarkingReidentified, feedbackText, type Workspace } from "../../core/index.ts";
  import { pyFormatG } from "../../core/pytext.ts";
  import { problemsOf } from "../forms.ts";
  import { approvalRows, STATUS_TEXT, type ApprovalRow } from "../markingExportView.ts";
  import { done, info, type Message } from "../messages.ts";
  import type { StepState } from "../steps.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";
  import StepScreen from "./StepScreen.svelte";
  import TableRegion from "./TableRegion.svelte";

  let { workspace, step, onChanged }: { workspace: Workspace; step: StepState | undefined; onChanged: () => void | Promise<void> } = $props();

  let rows: ApprovalRow[] = $state([]);
  let open = $state<string | null>(null); // the submission being read and approved
  let busy = $state(false);
  let message = $state<Message | null>(null);
  let problems: string[] = $state([]);
  /** Where an action's outcome is shown: beside the button that did it, so it is seen where it was asked for. */
  type Place = "approve" | "export" | "reidentify";
  let place = $state<Place>("approve");
  let copied: string | null = $state(null);
  let confirming = $state(false);
  let openHeading: HTMLHeadingElement | undefined = $state();
  let confirmHeading: HTMLHeadingElement | undefined = $state();
  let reidentifyButton: HTMLButtonElement | undefined = $state();

  async function read() {
    try {
      rows = await approvalRows(workspace);
    } catch (err) {
      problems = problemsOf(err);
    }
  }
  $effect(() => {
    void read();
  });

  const current = $derived(rows.find((r) => r.id === open) ?? null);

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
    } finally {
      busy = false;
    }
  }

  async function show(id: string) {
    open = id;
    copied = null;
    await tick();
    openHeading?.focus();
  }

  const approveIt = (id: string) =>
    run(async () => {
      await approveSubmission(workspace, id);
      return `Approved ${id}: exactly what is shown is what its student receives. Any later change clears the approval.`;
    });

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
    <section aria-labelledby="approve-heading">
      <h2 id="approve-heading">Approve</h2>
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
                {#if r.status === "approved"}<button type="button" onclick={() => copy(`the feedback on ${c.title}`, criterionText(c))}>Copy<span class="visually-hidden"> the feedback on {c.title}</span></button>{/if}
              </div>
            {/each}
            <div class="receive-part">
              <h4>Overall</h4>
              <p class="feedback-text">{f.overall}</p>
            </div>
            <div class="actions">
              {#if r.status === "approved"}
                <button type="button" onclick={() => copy("all the feedback", feedbackText(f))}>Copy all the feedback</button>
              {:else}
                <button type="button" aria-disabled={busy} onclick={() => approveIt(r.id)}>Approve exactly this</button>
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
