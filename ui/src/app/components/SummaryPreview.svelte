<script lang="ts">
  import type { SummaryBlock } from "../../core/index.ts";
  import TableRegion from "./TableRegion.svelte";

  /**
   * The summary's outline as the page shows it: the same headings, lists and
   * tables as the exported documents, with its headings moved down under the
   * screen's own (the summary's title becomes a level-3 heading).
   */
  let { blocks }: { blocks: SummaryBlock[] } = $props();
  const tag = (level: number) => `h${Math.min(level + 2, 6)}`;
</script>

<div class="summary-preview">
  {#each blocks as b, i (i)}
    {#if b.kind === "heading"}
      <svelte:element this={tag(b.level)}>{b.text}</svelte:element>
    {:else if b.kind === "paragraph"}
      <p>
        {#each b.lines as line, n (n)}{#if n}<br />{/if}{#each line as r, k (k)}{#if typeof r === "string"}{r}{:else}<code>{r.code}</code>{/if}{/each}{/each}
      </p>
    {:else if b.kind === "list"}
      <ul>
        {#each b.items as item, n (n)}<li>{item}</li>{/each}
      </ul>
    {:else}
      <TableRegion label={b.caption}>
        <table>
          <caption>{b.caption}</caption>
          <thead><tr>{#each b.head as h, n (n)}<th scope="col">{h}</th>{/each}</tr></thead>
          <tbody>
            {#each b.rows as row, r (r)}
              <tr>{#each row as cell, n (n)}{#if n === 0}<th scope="row">{cell}</th>{:else}<td>{cell}</td>{/if}{/each}</tr>
            {/each}
          </tbody>
        </table>
      </TableRegion>
    {/if}
  {/each}
</div>
