<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * A table that scrolls sideways within the page when it is wider than the
   * screen (WCAG 1.4.10), in a named region that the keyboard can focus to
   * scroll it (2.1.1).
   */
  let { label, children }: { label: string; children: Snippet } = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="scroll" role="region" aria-label={label} tabindex="0">
  {@render children()}
</div>
