<script lang="ts">
  /**
   * What the anonymisation rules now redact in text that was anonymised earlier, with where it is and the text around it, when a check has stopped something
   * for that reason. Shown on the educator's own screen only: never sent, never logged. A match that isn't what the rules take it for (a metric such as
   * mAP@0.5 read as an address) can be kept, which adds it to the values not to redact; what isn't kept is redacted when the text is anonymised again.
   */
  import { anonymiseAll, keepValues, type RedactionField, type RedactionMatch, type Workspace } from "../../core/index.ts";
  import { asDone, asFailed } from "../messages.ts";
  import { problemsOf } from "../forms.ts";
  import TableRegion from "./TableRegion.svelte";
  import Status from "./Status.svelte";

  let {
    id,
    workspace,
    groups,
    onChanged,
    said,
    level = 3,
    sending = true,
  }: {
    id: string;
    workspace: Workspace;
    /** Each text's subject (a submission, say) and what was found in it. */
    groups: [string, RedactionMatch[]][];
    /** Called once something is changed, so the screen can read its state again. */
    onChanged?: () => void | Promise<void>;
    /** The level of its heading, for where it is on the screen (2 under a page heading, 3 within a section). */
    level?: 2 | 3;
    /** Told what was done, for a screen where what was found goes away once it is done, and this panel with it. */
    said?: (text: string) => void;
    /**
     * Whether the text is about to be sent to the AI. What a pattern found may be kept in a record that isn't sent, but not here if it looks like an identifier: the
     * check before a request, and the proxy's, would still refuse it, so it is redacted instead.
     */
    sending?: boolean;
  } = $props();

  /** Whether this match may be kept, here. */
  const offered = (m: RedactionMatch) => m.keepable && !(sending && m.refusedWhenSent);

  let busy = $state(false);
  let done: string | null = $state(null);
  let failed: string | null = $state(null);
  // What the educator keeps, by match: nothing is kept unless they say so, so what is found is redacted.
  const keyOf = (subject: string, m: RedactionMatch) => `${subject}|${m.where}|${m.position}|${m.value}`;
  let kept: Record<string, boolean> = $state({});
  const ticked = $derived(groups.flatMap(([subject, matches]) => matches.filter((m) => offered(m) && kept[keyOf(subject, m)])));
  const none = $derived(ticked.length === 0);

  /** What follows for a match that isn't kept, by the kind of text it is in. */
  const IF_NOT_KEPT: Record<RedactionField, string> = {
    text: "Anonymise now, then approve the text again",
    comment: "Anonymise now",
    reading: "A reading can't be changed: read it again",
    feedback: "Record the feedback again",
  };

  async function act(what: () => Promise<string>) {
    if (busy) return;
    busy = true;
    done = failed = null;
    try {
      const told = await what();
      await onChanged?.(); // the screen is read again first, so what is said is true of what is shown
      done = told;
      said?.(told);
    } catch (err) {
      failed = problemsOf(err).join(" ");
    } finally {
      busy = false;
    }
  }

  const keep = () =>
    act(async () => {
      const n = await keepValues(workspace, ticked);
      return sending
        ? `Kept ${n} value${n === 1 ? "" : "s"}: added to the values not to redact. Nothing needs to be anonymised or read again for ${n === 1 ? "it" : "them"}; ask again.`
        : `Kept ${n} value${n === 1 ? "" : "s"} in the record: added to the values not to redact. Nothing needs to be anonymised or read again for ${n === 1 ? "it" : "them"}. Text that is sent to the AI is still checked for anything that looks like an identifier.`;
    });

  const anonymise = () =>
    act(async () => {
      await anonymiseAll(workspace);
      return "Anonymised again with the current rules. A submission's text that changed needs approving again, on Anonymisation.";
    });
</script>

{#if groups.some(([, matches]) => matches.length)}
  <section aria-labelledby={`${id}-heading`} class="identifier-matches">
    <svelte:element this={`h${level}`} id={`${id}-heading`}>What the rules now redact</svelte:element>
    <p>
      These were found in text that was anonymised before a name or a rule was added that now covers them. They are shown here on this screen only: they are not sent,
      and not logged. If one isn't what the rules take it for (a metric such as mAP@0.5 read as an address, say), tick it to keep it: it is added to the values not
      to redact, and nothing needs to be anonymised or read again for it. Anything you don't keep is redacted when the text is anonymised again. A name, an
      organisation, an ID or another value that you or the key asked to redact is never offered to keep.
      {#if sending}Text that is about to be sent is also checked for anything that looks like an identifier, and that check doesn't take your kept values into account, so such a value isn't offered to keep here: it has to be redacted.{/if}
    </p>
    <TableRegion label="What the rules now redact">
      <table>
        <caption>What the rules now redact, in which text, and where</caption>
        <thead>
          <tr><th scope="col">Keep</th><th scope="col">Text</th><th scope="col">Where</th><th scope="col">It is</th><th scope="col">Found, with the text around it</th><th scope="col">If you don't keep it</th></tr>
        </thead>
        <tbody>
          {#each groups as [subject, matches] (subject)}
            {#each matches as m, i (i)}
              <tr>
                <td>
                  {#if offered(m)}
                    <input
                      type="checkbox"
                      aria-label={`Keep ${m.value}`}
                      checked={kept[keyOf(subject, m)] ?? false}
                      onchange={(e) => {
                        const box = e.currentTarget as HTMLInputElement;
                        if (busy) box.checked = kept[keyOf(subject, m)] ?? false;
                        else kept[keyOf(subject, m)] = box.checked;
                      }}
                    />
                  {:else}Not offered{#if m.keepable && sending && m.refusedWhenSent}: it would still be refused when sent{/if}{/if}
                </td>
                <th scope="row">{subject}</th>
                <td>{m.where}</td>
                <td>{m.kind}</td>
                <td>…{m.before}<mark>{m.value}</mark>{m.after}…</td>
                <td>{IF_NOT_KEPT[m.field]}</td>
              </tr>
            {/each}
          {/each}
        </tbody>
      </table>
    </TableRegion>
    <div class="actions">
      <button type="button" onclick={() => !busy && !none && keep()} aria-disabled={busy || none}>Keep the ticked ones</button>
      <button type="button" onclick={() => !busy && anonymise()} aria-disabled={busy}>Anonymise now: redact what isn't kept</button>
    </div>
    <Status message={asDone(done) ?? asFailed(failed)} />
  </section>
{/if}
