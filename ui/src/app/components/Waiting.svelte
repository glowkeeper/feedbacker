<script lang="ts">
  /**
   * Says that the AI is working, from the moment something is sent until the answer or an error arrives, and for how long it has been. The region is always
   * on the screen, so what is put into it is announced; the time goes on silently (each second would be read out), and it is the same on every screen that waits.
   * It looks like any other neutral message (Status).
   */
  import { elapsedText } from "../messages.ts";

  let { active, text }: { active: boolean; text: string } = $props();

  let seconds = $state(0);
  $effect(() => {
    if (!active) {
      seconds = 0;
      return;
    }
    const since = Date.now();
    seconds = 0;
    const timer = setInterval(() => (seconds = Math.floor((Date.now() - since) / 1000)), 1000);
    return () => clearInterval(timer);
  });
  const elapsed = $derived(elapsedText(seconds));
</script>

<div class="status" role="status" aria-live="polite">
  {#if active}<p class="message info">{text}<span aria-hidden="true">{elapsed}</span></p>{/if}
</div>
