<script lang="ts">
  /**
   * A step's form: shown as it is until the step has something recorded; after that, behind one disclosure
   * ("Change the request", "Import the rubric again"), since what is recorded comes first and changing it is occasional.
   */
  import type { Snippet } from "svelte";

  let { recorded, summary, open = $bindable(false), children }: { recorded: boolean; summary: string; open?: boolean; children: Snippet } = $props();
</script>

{#if recorded}
  <details class="step-form" bind:open>
    <summary>{summary}</summary>
    {@render children()}
  </details>
{:else}
  {@render children()}
{/if}
