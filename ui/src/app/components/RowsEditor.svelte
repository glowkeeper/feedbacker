<script lang="ts">
  /**
   * A short list entered row by row, each with its own labelled boxes (or a
   * choice), instead of lines of KEY=VALUE text. Rows can be added and
   * removed; an empty row is ignored when the form is read.
   */
  import { tick } from "svelte";

  export interface Column {
    key: string;
    label: string; // shown above the column, and read out with each box's row
    options?: { value: string; label: string }[]; // a choice instead of a box
    inputmode?: "text" | "numeric" | "decimal";
  }

  let {
    id,
    legend,
    hint = null,
    columns,
    rows = $bindable(),
    addLabel,
    rowName,
  }: {
    id: string;
    legend: string;
    hint?: string | null;
    columns: Column[];
    rows: Record<string, string>[];
    addLabel: string;
    rowName: string; // e.g. "band": "Remove band 2"
  } = $props();

  const blank = () => Object.fromEntries(columns.map((c) => [c.key, c.options?.[0]?.value ?? ""]));

  async function add() {
    rows.push(blank());
    await tick();
    document.getElementById(`${id}-${rows.length - 1}-${columns[0].key}`)?.focus(); // straight into the new row
  }

  async function remove(i: number) {
    rows.splice(i, 1);
    if (!rows.length) rows.push(blank());
    await tick();
    document.getElementById(`${id}-${Math.min(i, rows.length - 1)}-${columns[0].key}`)?.focus(); // focus stays in the list
  }
</script>

<fieldset class="rows" aria-describedby={hint ? `${id}-hint` : undefined}>
  <legend>{legend}</legend>
  {#if hint}<p class="hint" id={`${id}-hint`}>{hint}</p>{/if}
  <div class="rows-grid" style={`--columns: ${columns.length}`}>
    {#each columns as c (c.key)}<span class="rows-heading" aria-hidden="true">{c.label}</span>{/each}
    <span aria-hidden="true"></span>
    {#each rows as row, i (i)}
      {#each columns as c (c.key)}
        {@const boxId = `${id}-${i}-${c.key}`}
        <label class="visually-hidden" for={boxId}>{c.label}, {rowName} {i + 1}</label>
        {#if c.options}
          <select id={boxId} bind:value={row[c.key]}>
            {#each c.options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
          </select>
        {:else}
          <input id={boxId} type="text" inputmode={c.inputmode ?? "text"} bind:value={row[c.key]} spellcheck="false" />
        {/if}
      {/each}
      <button type="button" class="remove" onclick={() => remove(i)}>Remove<span class="visually-hidden"> {rowName} {i + 1}</span></button>
    {/each}
  </div>
  <button type="button" onclick={add}>{addLabel}</button>
</fieldset>
