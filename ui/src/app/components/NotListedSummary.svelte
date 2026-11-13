<script lang="ts">
  /**
   * What a list that acts on many submissions at once says about those it leaves out: each reason in a sentence, with how many, and what to do where there is something to do. A
   * submission left out is usually nothing wrong, so the reasons that need nothing are said quietly (as any neutral message) and the ones that need the educator are set apart, as a
   * note to check is, with the submissions named.
   */
  import type { NotListedGroup } from "../notListed.ts";

  let { groups }: { groups: NotListedGroup[] } = $props();
  const SHOWN = 12;
</script>

{#each groups as g (g.kind)}
  <div class={g.needsYou ? "notes-box" : "message info"}>
    <p>{g.text}</p>
    {#if g.needsYou}
      <ul>
        {#each g.labels.slice(0, SHOWN) as label (label)}<li>{label}{g.details[label] ? `: ${g.details[label]}` : ""}</li>{/each}
      </ul>
      {#if g.labels.length > SHOWN}
        <details>
          <summary>The other {g.labels.length - SHOWN}</summary>
          <ul>
            {#each g.labels.slice(SHOWN) as label (label)}<li>{label}{g.details[label] ? `: ${g.details[label]}` : ""}</li>{/each}
          </ul>
        </details>
      {/if}
    {:else if g.labels.length <= 5}
      <p class="hint">{g.labels.join(", ")}.</p>
    {/if}
  </div>
{/each}
