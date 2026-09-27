<script lang="ts">
  /** A polite live region: status messages are announced to screen readers as well as shown. */
  let { message, kind = "info" }: { message: string | null; kind?: "info" | "error" } = $props();
</script>

<div class="status" role={kind === "error" ? "alert" : "status"} aria-live={kind === "error" ? "assertive" : "polite"}>
  {#if message}<p class={kind}>{message}</p>{/if}
</div>
