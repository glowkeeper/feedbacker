<script lang="ts">
  /**
   * Every step's screen, laid out the same way, in this order, so no screen can differ:
   *
   * 1. its heading, which takes focus when the screen opens;
   * 2. its status, in the navigation's word and why (StepStatus);
   * 3. "How this step works", folded away;
   * 4. messages: what the last action did, and problems;
   * 5. "What's recorded", once something is;
   * 6. what an action has produced and waits on you (for example the rubric to check before saving it);
   * 7. the step's ongoing work, where it has some that is neither recorded nor an action (Review's two panes), never folded;
   * 8. the actions: shown as they are until the step is complete, then behind one disclosure (StepForm).
   *
   * A screen leaves out a section it has no use for (the Overview has no status or actions), but never reorders them.
   *
   * After an action records something, `shown()` folds the actions away and moves focus to what is recorded.
   */
  import { tick, type Snippet } from "svelte";
  import type { StepState } from "../steps.ts";
  import StepForm from "./StepForm.svelte";
  import StepStatus from "./StepStatus.svelte";

  let {
    title,
    step,
    optional = false,
    recorded = false,
    complete,
    change,
    how,
    messages,
    record,
    outcome,
    work,
    actions,
  }: {
    title: string;
    step: StepState | undefined;
    optional?: boolean;
    recorded?: boolean; // whether there is anything recorded to show
    complete?: boolean; // whether the step needs nothing more, which folds the actions away; by default, once anything is recorded
    change?: string; // the disclosure the actions sit behind once the step is complete, e.g. "Change the request"
    how: Snippet;
    messages?: Snippet;
    record?: Snippet;
    outcome?: Snippet;
    work?: Snippet;
    actions?: Snippet;
  } = $props();

  let heading: HTMLHeadingElement;
  let recordedHeading: HTMLHeadingElement | undefined = $state();
  let open = $state(false);
  // A prop's default isn't kept up to date, so the default (complete once anything is recorded) is derived.
  const folds = $derived(complete ?? recorded);

  $effect(() => heading?.focus());

  /** Focus the screen's heading (e.g. when what had focus has gone). */
  export function focusHeading() {
    heading?.focus();
  }

  /** Something was just recorded: fold the actions away, and move focus to what is recorded. */
  export async function shown() {
    open = false;
    await tick();
    (recordedHeading ?? heading)?.focus();
  }
</script>

<h1 tabindex="-1" bind:this={heading}>{title}</h1>
<StepStatus {step} {optional} />
<details class="about">
  <summary>How this step works</summary>
  {@render how()}
</details>

{@render messages?.()}

{#if recorded && record}
  <section aria-labelledby="recorded-heading">
    <h2 id="recorded-heading" tabindex="-1" bind:this={recordedHeading}>What's recorded</h2>
    {@render record()}
  </section>
{/if}

{@render outcome?.()}

{@render work?.()}

{#if actions}
  <StepForm recorded={folds} summary={change ?? "Change it"} bind:open>
    {@render actions()}
  </StepForm>
{/if}
