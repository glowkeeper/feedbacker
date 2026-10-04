<script lang="ts">
  import { loadAssessment, recordAssessment, type AssessmentDetails, type Workspace } from "../../core/index.ts";
  import { problemsOf } from "../forms.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";
  import { asDone } from "../messages.ts";
  import type { StepState } from "../steps.ts";
  import StepScreen from "./StepScreen.svelte";

  let { workspace, step, onChanged }: { workspace: Workspace; step: StepState | undefined; onChanged: () => void | Promise<void> } = $props();

  let title = $state("");
  let module = $state("");
  let programme = $state("");
  let recorded = $state<AssessmentDetails | null>(null);
  let readProblem: string | null = $state(null);
  let busy = $state(false);
  let problems: string[] = $state([]);
  let message: string | null = $state(null);
  let screen: StepScreen;

  $effect(() => {
    read();
  });

  /** Read what is recorded, and start the form from it, so changing it starts from what is there. */
  async function read() {
    try {
      recorded = await loadAssessment(workspace);
      readProblem = null;
      if (recorded) ({ title, module, programme } = { title: recorded.title, module: recorded.module ?? "", programme: recorded.programme ?? "" });
    } catch (err) {
      recorded = null;
      readProblem = err instanceof Error ? err.message : String(err);
    }
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return; // the button stays enabled while busy, so focus isn't lost from it
    busy = true;
    problems = [];
    message = null;
    try {
      const saved = await recordAssessment(workspace, { title, module, programme });
      await onChanged(); // the status is read again, so it changes with what is recorded
      await read();
      // Everything changes together: the message and what is recorded appear, and focus moves to it.
      message = `Recorded the assessment: ${saved.title}.`;
      await screen.shown();
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      busy = false;
    }
  }
</script>

<StepScreen bind:this={screen} title="The assessment" {step} recorded={recorded !== null} change="Change the assessment">
  {#snippet how()}
    <p>
      Record what you are marking: the assessment's title, and its module and programme if you wish. Nothing here identifies a student. The rubric and the
      brief come next; the cohort's submissions follow once that step is built.
    </p>
  {/snippet}
  {#snippet messages()}
    <Status message={asDone(message)} />
    <Problems {problems} />
    {#if readProblem}<Problems problems={[readProblem]} title="The recorded assessment can't be read:" />{/if}
  {/snippet}
  {#snippet record()}
    {@const a = recorded!}
    <dl class="steps">
      <dt>Title</dt><dd>{a.title}</dd>
      <dt>Module</dt><dd class={a.module ? "" : "missing"}>{a.module ?? "Not recorded"}</dd>
      <dt>Programme</dt><dd class={a.programme ? "" : "missing"}>{a.programme ?? "Not recorded"}</dd>
    </dl>
  {/snippet}
  {#snippet actions()}
    <form onsubmit={submit}>
      <label for="assessment-title">Title</label>
      <input id="assessment-title" type="text" bind:value={title} required />
      <label for="assessment-module">Module (optional)</label>
      <input id="assessment-module" type="text" bind:value={module} />
      <label for="assessment-programme">Programme (optional)</label>
      <input id="assessment-programme" type="text" bind:value={programme} />
      <button type="submit" aria-disabled={busy}>Record the assessment</button>
    </form>
  {/snippet}
</StepScreen>
