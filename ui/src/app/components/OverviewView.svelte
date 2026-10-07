<script lang="ts">
  import TableRegion from "./TableRegion.svelte";
  import type { Workspace } from "../../core/index.ts";
  import { describe, loadAgreement, type Agreement, type SubmissionAgreement } from "../agreement.ts";
  import { loadOverview, type Overview, type Step } from "../overview.ts";
  import Status from "./Status.svelte";
  import StepScreen from "./StepScreen.svelte";
  import { asFailed } from "../messages.ts";

  /** How far the workspace has got, in the words the home screen uses (null while it is read). */
  let { workspace, progress = null }: { workspace: Workspace; progress?: string | null } = $props();

  let overview: Overview | null = $state(null);
  let agreement: Agreement | null = $state(null);
  let problem: string | null = $state(null);

  $effect(() => {
    loadOverview(workspace).then(
      (o) => (overview = o),
      (err: Error) => (problem = err.message),
    );
    loadAgreement(workspace).then(
      (a) => (agreement = a),
      (err: Error) => (problem ??= err.message),
    );
  });

  const STATUS: Record<Exclude<SubmissionAgreement["status"], "compared">, string> = {
    hidden: "Hidden until the reveal (blind review)",
    "not judged": "Not yet judged",
    unavailable: "Not available: see the sample above",
  };
  const label: Record<Step, string> = { done: "Done", missing: "Not yet", attention: "Needs attention" };
</script>

<StepScreen title="Moderation overview" step={undefined} recorded={overview !== null || agreement !== null}>
  {#snippet how()}
    <p>
      The moderation at a glance: each sampled submission, how far it has got through the steps, and, once you have judged some criteria, how the original
      marking and the AI reading compare with your levels across the sample. The steps above say what each step still needs.
    </p>
  {/snippet}
  {#snippet messages()}
    {#if progress}<p class="progress">{progress}</p>{/if}
    <Status message={asFailed(problem ?? overview?.problem ?? null)} />
    {#if !overview && !problem}<p>Reading the workspace…</p>{/if}
  {/snippet}
  {#snippet record()}
    {#if overview}
      {#if overview.request}
        <p>
          {overview.request.module ?? "Module not recorded"}{overview.request.programme ? `, ${overview.request.programme}` : ""}{overview.request.cohortSize
            ? `; cohort of ${overview.request.cohortSize}`
            : ""}.
        </p>
      {:else}
        <p>No moderation request has been recorded yet.</p>
      {/if}

      {#if overview.rubricProblem}<p class="error">Rubric: {overview.rubricProblem}</p>{/if}
      {#if overview.brief.problem}<p class="error">Brief: {overview.brief.problem}</p>{/if}

      {#if overview.submissions.length}
        <h3>Sample</h3>
        <TableRegion label="The sample">
          <table>
            <caption>Each sampled submission, by pseudonym, and how far it has got</caption>
            <thead>
              <tr>
                <th scope="col">Submission</th>
                <th scope="col">Band</th>
                <th scope="col">Original</th>
                <th scope="col">Anonymised</th>
                <th scope="col">Approved</th>
                <th scope="col">Original marking</th>
                <th scope="col">AI reading</th>
                <th scope="col">Judged</th>
                <th scope="col">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {#each overview.submissions as row (row.id)}
                <tr>
                  <th scope="row">{row.id} {row.pseudonym}</th>
                  <td>{row.band ?? "—"}</td>
                  <td class={row.original}>{label[row.original]}</td>
                  <td class={row.anonymised}>{label[row.anonymised]}</td>
                  <td class={row.approved}>{label[row.approved]}</td>
                  <td class={row.marking}>{row.marking === "attention" ? "Not confirmed" : label[row.marking]}</td>
                  <td class={row.reading}>{label[row.reading]}</td>
                  <td class={row.judgedStep}>{row.judged || row.judgedStep !== "missing" ? `${row.judged} of ${overview.criteria || "?"} criteria` : label.missing}{row.review ? ` (${row.review})` : ""}</td>
                  <td class={row.verdictStale ? "attention" : row.verdict ? "done" : "missing"}>
                  {row.verdict ? `${row.verdict[0].toUpperCase()}${row.verdict.slice(1)}${row.verdictStale ? " (check it again)" : ""}` : label.missing}
                </td>
                </tr>
                {#if row.problem}
                  <tr><td colspan="9" class="error">{row.id}: {row.problem}</td></tr>
                {/if}
              {/each}
            </tbody>
          </table>
        </TableRegion>
      {/if}
    {/if}

    {#if agreement && agreement.submissions.length}
      <h3>Agreement across the sample</h3>
      <p>
        How the original marking and the AI suggestion compare with your level, for each criterion you have judged. A blind review counts once it is revealed; the
        counts are of each marker's mark, so a submission with two markers counts twice.
      </p>
      <TableRegion label="Agreement by submission">
        <table>
          <caption>Agreement by submission</caption>
          <thead>
            <tr>
              <th scope="col">Submission</th>
              <th scope="col">Criteria compared</th>
              <th scope="col">The original marking</th>
              <th scope="col">The AI suggestion</th>
              <th scope="col">Label flags</th>
              <th scope="col">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {#each agreement.submissions as row (row.id)}
              <tr>
                <th scope="row">{row.label}</th>
                {#if row.status === "compared"}
                  <td>{row.compared}{row.stale ? ` (${row.stale} more to check again)` : ""}</td>
                  <td class={row.marking.higher + row.marking.lower + row.marking.different ? "attention" : "done"}>{describe(row.marking, "marking")}</td>
                  <td class={row.ai.higher + row.ai.lower + row.ai.different ? "attention" : "done"}>{describe(row.ai, "ai")}</td>
                {:else}
                  <td colspan="3" class="missing">{STATUS[row.status]}{row.stale ? `; ${row.stale} judgement(s) to check again` : ""}</td>
                {/if}
                <td class={row.flags ? "attention" : ""}>{row.flags ? `${row.flags} to check` : "None"}</td>
                <td class={row.verdict ? "done" : "missing"}>{row.verdict ? row.verdict[0].toUpperCase() + row.verdict.slice(1) : "Not yet"}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </TableRegion>
      <TableRegion label="Agreement by criterion">
        <table>
          <caption>Agreement by criterion</caption>
          <thead>
            <tr>
              <th scope="col">Criterion</th>
              <th scope="col">Submissions compared</th>
              <th scope="col">The original marking</th>
              <th scope="col">The AI suggestion</th>
            </tr>
          </thead>
          <tbody>
            {#each agreement.criteria as row (row.id)}
              <tr>
                <th scope="row">{row.title}</th>
                <td>{row.compared}</td>
                <td class={row.marking.higher + row.marking.lower + row.marking.different ? "attention" : row.compared ? "done" : "missing"}>{describe(row.marking, "marking")}</td>
                <td class={row.ai.higher + row.ai.lower + row.ai.different ? "attention" : row.compared ? "done" : "missing"}>{describe(row.ai, "ai")}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </TableRegion>
    {/if}
  {/snippet}
</StepScreen>
