<script lang="ts">
  import { briefTakeFailure, moduleBriefState, takeModuleBriefIfNew, useModuleBrief, type ModuleBriefState, type Workspace } from "../../core/index.ts";
  import { problemsOf } from "../forms.ts";
  import { done, type Message } from "../messages.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";

  /**
   * An assessment's brief from its module (ADR 0010): the module holds the brief whole, and the assessment takes it and chooses its own
   * section, so only that is anonymised, approved and sent.
   */
  let { workspace, onChanged }: { workspace: Workspace; onChanged: () => void | Promise<void> } = $props();

  let briefState = $state<ModuleBriefState | null>(null);
  let failure = $state<string | null>(null); // the take when the assessment was opened didn't complete: said here too, and offered again, even where the brief looks taken
  let busy = $state(false);
  let problems: string[] = $state([]);
  let message: Message | null = $state(null);

  async function read() {
    try {
      // The assessment starts with the module's brief, taken as it is opened: if that is still under way, wait for it, so this says what is so.
      if (await takeModuleBriefIfNew(workspace).catch(() => false)) await onChanged(); // taken only now: the step is read again, as when it is taken by hand
      briefState = await moduleBriefState(workspace);
    } catch (err) {
      briefState = null;
      problems = problemsOf(err);
    }
    failure = briefTakeFailure(workspace);
  }
  $effect(() => {
    void read();
  });

  async function take() {
    if (busy) return; // the button stays enabled while busy, so focus isn't lost from it
    busy = true;
    problems = [];
    message = null;
    try {
      await useModuleBrief(workspace);
      await onChanged();
      await read();
      message = done("Took the module's brief. Choose the part that applies to this assessment, then anonymise and approve it.");
    } catch (err) {
      problems = problemsOf(err);
      failure = briefTakeFailure(workspace);
    } finally {
      busy = false;
    }
  }

  const WORDS: Record<ModuleBriefState["state"], string> = {
    none: "The module has no brief yet. Import it in the module, and every assessment can take it from there.",
    "not-taken": "The module has a brief, and this assessment has not taken it yet.",
    current: "This assessment has the module's brief, taken from the module when it was opened, without importing it again. Choose the part that applies to it below.",
    different: "This assessment's brief is not the module's current one.",
  };
</script>

{#if briefState}
  <section class="module-brief" aria-labelledby="module-brief-heading">
    <h2 id="module-brief-heading">The module's brief</h2>
    <p>{WORDS[briefState.state]}</p>
    {#if failure}<Problems problems={[failure]} title="The module's brief wasn't taken, or the workspace confirmed, when this assessment was opened:" />{/if}
    {#if briefState.state === "not-taken" || briefState.state === "different" || failure}
      <button type="button" aria-disabled={busy} onclick={take}>{briefState.state === "different" || failure ? "Take the module's brief again" : "Use the module's brief"}</button>
      {#if briefState.state === "different" || failure}<p class="hint">Taking it replaces this assessment's brief, and clears its section and approval.</p>{/if}
    {/if}
    <Status {message} />
    <Problems {problems} />
  </section>
{/if}
