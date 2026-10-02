<script lang="ts">
  /**
   * A message, shown and announced: what an action did ("done"), something neutral such as progress or nothing having
   * been done ("info"), or a failure ("error", an alert). Each kind has its own bar, as notes and problems do (Problems),
   * and the words say the same. The kind comes with the message, so it is always stated.
   */
  import type { Message } from "../messages.ts";

  let { message }: { message: Message | null } = $props();
  const error = $derived(message?.kind === "error");
</script>

<div class="status" role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"}>
  {#if message}<p class="message {message.kind}">{message.text}</p>{/if}
</div>
