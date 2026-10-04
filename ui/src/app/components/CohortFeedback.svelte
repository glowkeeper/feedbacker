<script lang="ts">
  import type { Workspace } from "../../core/index.ts";
  import { pyFormatG } from "../../core/pytext.ts";
  import { loadCohortFeedback, type CriterionView } from "../cohortFeedback.ts";
  import { problemsOf } from "../forms.ts";
  import Problems from "./Problems.svelte";
  import TableRegion from "./TableRegion.svelte";

  let { workspace, version, onEdit }: { workspace: Workspace; version: number; onEdit: (submissionId: string) => void } = $props();

  let views: CriterionView[] = $state([]);
  let problems: string[] = $state([]);

  // Read again whenever something is recorded (the parent bumps `version`).
  $effect(() => {
    void version;
    loadCohortFeedback(workspace).then(
      (v) => {
        views = v;
        problems = [];
      },
      (err) => (problems = problemsOf(err)),
    );
  });
</script>

<section aria-labelledby="cohort-feedback-heading">
  <h2 id="cohort-feedback-heading">Feedback across the cohort</h2>
  <p class="hint">
    For each criterion, the feedback recorded for each student, grouped by your level, so similar work can be seen to get similar feedback; then the
    overall feedback, by band. Feedback much shorter or longer than the rest at its level, and feedback nearly the same as another student's, are flagged.
  </p>
  <Problems {problems} />
  {#each views as v (v.target)}
    <details>
      <summary>{v.title}{v.outliers.length ? `: ${v.outliers.length === 1 ? "1 thing" : `${v.outliers.length} things`} to check` : ""}</summary>
      {#if v.outliers.length}
        <Problems problems={v.outliers.map((o) => o.message)} title="Check:" />
      {/if}
      {#if v.groups.length}
        <TableRegion label={`Feedback on ${v.title}, by level`}>
          <table>
            <caption>{v.title}: each student's feedback, grouped by {v.target === "overall" ? "the overall mark's band" : "your level"}</caption>
            <thead><tr><th scope="col">{v.target === "overall" ? "Band" : "Level"}</th><th scope="col">Submission</th><th scope="col">Mark</th><th scope="col">Feedback</th><th scope="col"><span class="visually-hidden">Edit</span></th></tr></thead>
            <tbody>
              {#each v.groups as g (g.key)}
                {#each g.entries as e (e.submissionId)}
                  <tr>
                    <td>{g.label}</td>
                    <th scope="row">{e.label}</th>
                    <td>{e.mark === null ? "—" : pyFormatG(e.mark)}</td>
                    <td class={e.text ? "" : "missing"}>{e.text ?? "No feedback recorded yet"}</td>
                    <td><button type="button" onclick={() => onEdit(e.submissionId)}>Edit<span class="visually-hidden"> {e.label}'s feedback</span></button></td>
                  </tr>
                {/each}
              {/each}
            </tbody>
          </table>
        </TableRegion>
      {/if}
      {#if v.unmarked.length}<p class="hint">Not marked yet: {v.unmarked.join(", ")}.</p>{/if}
    </details>
  {/each}
</section>
