<script lang="ts">
  import { loadAssessment, type AssessmentDetails, type Workspace } from "../../core/index.ts";
  import { loadOverview, type Overview } from "../overview.ts";
  import Status from "./Status.svelte";
  import { asFailed } from "../messages.ts";
  import StepScreen from "./StepScreen.svelte";

  /** How far the workspace has got, in the words the home screen uses (null while it is read). */
  let { workspace, progress = null }: { workspace: Workspace; progress?: string | null } = $props();

  let assessment = $state<AssessmentDetails | null>(null);
  let overview = $state<Overview | null>(null);
  let problem: string | null = $state(null);
  let read = $state(false);

  $effect(() => {
    Promise.all([loadAssessment(workspace), loadOverview(workspace)]).then(
      ([a, o]) => {
        assessment = a;
        overview = o;
        read = true;
      },
      (err: Error) => (problem = err.message),
    );
  });
  const label = { done: "Done", missing: "Not yet", attention: "Needs attention" } as const;
  const rows = $derived(overview?.submissions ?? []);
  const imported = $derived(rows.filter((r) => r.original === "done").length);
  // Every text that is anonymised and approved, as the Anonymisation step counts them: the submissions, and the brief if there is one.
  const texts = $derived(rows.length + (overview?.brief.imported === "done" ? 1 : 0));
  const approved = $derived(rows.filter((r) => r.approved === "done").length + (overview?.brief.approved === "done" ? 1 : 0));
</script>

<StepScreen title="Marking overview" step={undefined} recorded={read}>
  {#snippet how()}
    <p>
      The marking at a glance. So far that is the assessment, what it is marked against, and the cohort's submissions and their anonymisation; the AI's
      suggested levels, your marks and the feedback appear here as each of those steps is built. The steps above say what each still needs.
    </p>
  {/snippet}
  {#snippet messages()}
    {#if progress}<p class="progress">{progress}</p>{/if}
    <Status message={asFailed(problem)} />
    {#if !read && !problem}<p>Reading the workspace…</p>{/if}
  {/snippet}
  {#snippet record()}
    <dl class="steps">
      <dt>Assessment</dt>
      <dd class={assessment ? "" : "missing"}>{assessment ? `${assessment.title}${assessment.module ? `, ${assessment.module}` : ""}` : "Not recorded yet"}</dd>
      <dt>Rubric</dt>
      <dd class={overview?.rubric ?? "missing"}>{overview ? label[overview.rubric] : "—"}{overview?.rubric === "done" ? ` (${overview.criteria} criteria)` : ""}</dd>
      <dt>Brief</dt>
      <dd class={overview?.brief.imported ?? "missing"}>
        {overview ? (overview.brief.imported === "done" ? "Imported" : label[overview.brief.imported]) : "—"}
      </dd>
      <dt>Submissions</dt>
      <dd class={overview?.problem ? "attention" : rows.length ? (imported === rows.length ? "done" : "attention") : "missing"}>
        {overview?.problem ? `Needs attention: ${overview.problem}` : rows.length ? `${imported} of ${rows.length} imported` : "None imported yet"}
      </dd>
      <dt>Anonymisation</dt>
      <dd class={texts ? (approved === texts ? "done" : approved ? "attention" : "missing") : "missing"}>
        {texts ? `${approved} of ${texts} texts approved` : "—"}
      </dd>
    </dl>
  {/snippet}
</StepScreen>
