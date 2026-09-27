<script lang="ts">
  /**
   * Every problem found, together, announced to screen readers. A failure
   * ("error") is red and an alert; a note to check, where the step still
   * succeeded ("note"), is amber and announced politely. Both say so in words.
   */
  let { problems, title, kind = "error" }: { problems: string[]; title?: string; kind?: "error" | "note" } = $props();
</script>

<div role={kind === "error" ? "alert" : "status"}>
  {#if problems.length}
    <div class={kind === "error" ? "problems" : "notes-box"}>
      <p><strong>{title ?? (kind === "error" ? "This couldn't be done:" : "Please check:")}</strong></p>
      <ul>
        {#each problems as problem, i (i)}<li>{problem}</li>{/each}
      </ul>
    </div>
  {/if}
</div>
