<script lang="ts">
  /** Every problem found, together, announced to screen readers. */
  let { problems, title = "This couldn't be done:" }: { problems: string[]; title?: string } = $props();
</script>

<div role="alert">
  {#if problems.length}
    <div class="problems">
      <p><strong>{title}</strong></p>
      <ul>
        {#each problems as problem, i (i)}<li>{problem}</li>{/each}
      </ul>
    </div>
  {/if}
</div>
