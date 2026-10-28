<script lang="ts">
  /**
   * What looks like an identifier, with the text around each and where it is, and one action to add them all to the anonymisation rules. Shown on the
   * moderator's own screen only: the matches are never sent or logged. The same list is shown in the review of a text and before a reading is sent.
   */
  import TableRegion from "./TableRegion.svelte";
  import Status from "./Status.svelte";
  import { asDone } from "../messages.ts";
  import type { IdentifierMatch } from "../../core/index.ts";

  let {
    id,
    groups,
    what,
    advice,
    added,
    busy,
    onAdd,
  }: {
    id: string;
    /** Each text's label and its matches. */
    groups: [string, IdentifierMatch[]][];
    /** What a group is: "Submission", "Text". */
    what: string;
    /** What to do with the rules afterwards. */
    advice: string;
    added: string | null;
    busy: boolean;
    onAdd: () => void;
  } = $props();

  const SHOWN = 30; // matches shown for a text: the rest are counted
  const asPercent = (position: number) => `${Math.round(position * 100)}%`;
</script>

{#if groups.some(([, matches]) => matches.length)}
  <section aria-labelledby={`${id}-heading`}>
    <h3 id={`${id}-heading`}>What looks like an identifier</h3>
    <p>
      The AI is only sent text that doesn't look like it identifies someone. {advice} They are shown here on this screen only: they are not sent, and not logged. A row of
      decimals can look like a phone number: if what is shown isn't an identifier, adding it to the rules only hides those numbers from the AI.
    </p>
    <TableRegion label="What looks like an identifier">
      <table>
        <caption>What looks like an identifier, in which {what.toLowerCase()}, and where</caption>
        <thead><tr><th scope="col">{what}</th><th scope="col">Where</th><th scope="col">It looks like</th><th scope="col">Found, with the text around it</th></tr></thead>
        <tbody>
          {#each groups as [label, matches] (label)}
            {#each matches.slice(0, SHOWN) as m, i (i)}
              <tr>
                <th scope="row">{label}</th>
                <td>The {m.where}, about {asPercent(m.position)} of the way through</td>
                <td>{m.kind}</td>
                <td>…{m.before}<mark>{m.value}</mark>{m.after}…</td>
              </tr>
            {/each}
            {#if matches.length > SHOWN}<tr><th scope="row">{label}</th><td colspan="3">and {matches.length - SHOWN} more</td></tr>{/if}
          {/each}
        </tbody>
      </table>
    </TableRegion>
    <div class="actions">
      <button type="button" onclick={onAdd} aria-disabled={busy}>Add these to the anonymisation rules</button>
    </div>
    <Status message={asDone(added)} />
  </section>
{/if}
