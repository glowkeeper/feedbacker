<script lang="ts">
  /**
   * A step's status under its screen's heading: the same word as the navigation shows, and why. Both come from
   * the step's state, so the screen and the navigation always agree. Said in words; the colour only goes with them.
   */
  import { statusWord, type StepState } from "../steps.ts";

  let { step, optional = false }: { step: StepState | undefined; optional?: boolean } = $props();
  const word = $derived(statusWord(step, optional));
</script>

{#if step && word}
  <p class="step-line"><strong class={step.status ?? ""}>{word}</strong>{step.reason ? `: ${step.reason}` : ""}.</p>
{/if}
