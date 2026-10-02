<script lang="ts">
  /**
   * A message, shown and announced: what an action did ("done", the usual case), something neutral such as progress or
   * nothing having been done ("info"), or a failure ("error", an alert). Each kind has its own bar, as notes and problems
   * do (Problems), and the words say the same.
   */
  let { message, kind = "done" }: { message: string | null; kind?: "done" | "info" | "error" } = $props();
</script>

<div class="status" role={kind === "error" ? "alert" : "status"} aria-live={kind === "error" ? "assertive" : "polite"}>
  {#if message}<p class="message {kind}">{message}</p>{/if}
</div>
