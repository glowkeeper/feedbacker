<script lang="ts">
  /**
   * A step's status under its screen's heading: the same word as the navigation shows, and why. Both come from
   * the step's state, so the screen and the navigation always agree. Said in words; the colour only goes with them.
   * Under it, what to do now where the step says (its state's `next`), with a button to the step it points to.
   */
  import { getContext } from "svelte";
  import { statusWord, type StepId, type StepState } from "../steps.ts";

  let { step, optional = false }: { step: StepState | undefined; optional?: boolean } = $props();
  const word = $derived(statusWord(step, optional));
  /** Opens another step of the workspace, when the screen is in one (the workspace gives it). */
  const goTo = getContext<((id: StepId) => void) | undefined>("go-to-step");
</script>

{#if step && word}
  <p class="step-line"><strong class={step.status ?? ""}>{word}</strong>{step.reason ? `: ${step.reason}` : ""}.</p>
{/if}
{#if step?.next}
  {@const next = step.next}
  <div class="message info next-step">
    <p>What to do now: {next.text}</p>
    {#if next.goTo && goTo}<div class="actions"><button type="button" onclick={() => goTo(next.goTo!)}>{next.goLabel}</button></div>{/if}
  </div>
{/if}
