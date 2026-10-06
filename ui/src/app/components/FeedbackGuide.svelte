<script lang="ts">
  import { approveGuide, loadGuide, saveGuide, type FeedbackGuide, type Workspace } from "../../core/index.ts";
  import { loadedText, problemsOf } from "../forms.ts";
  import { asDone } from "../messages.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";

  let { workspace, onChanged }: { workspace: Workspace; onChanged: () => void | Promise<void> } = $props();

  let guide = $state<FeedbackGuide | null>(null);
  let text = $state("");
  let busy = $state(false);
  let note: string | null = $state(null);
  let problems: string[] = $state([]);
  let typed = false; // since the saved guide began loading
  let loads = 0; // a load still running when another begins, or an action, is out of date: its result is dropped

  $effect(() => {
    typed = false;
    const load = ++loads;
    loadGuide(workspace).then(
      (g) => {
        if (load !== loads) return;
        guide = g;
        text = loadedText(g?.text, text, typed);
      },
      (err) => {
        if (load === loads) problems = problemsOf(err);
      },
    );
  });

  async function act(what: () => Promise<string>) {
    if (busy) return; // the buttons stay enabled while busy, so focus isn't lost from them
    busy = true;
    loads++;
    note = null;
    problems = [];
    try {
      const done = await what();
      await onChanged();
      note = done; // said once everything has changed with it, so the next press isn't ignored as busy
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      busy = false;
    }
  }
  const save = (event: SubmitEvent) => {
    event.preventDefault();
    return act(async () => {
      guide = await saveGuide(workspace, text);
      text = guide.text;
      return `Saved version ${guide.version} of the guide, anonymised. Read it as it will be sent, then approve it.`;
    });
  };
  const approve = () =>
    act(async () => {
      guide = await approveGuide(workspace);
      return `Approved version ${guide.version} of the guide: it is sent with every draft from now on.`;
    });
</script>

<section aria-labelledby="guide-heading">
  <h2 id="guide-heading">Feedback guide</h2>
  <p class={guide?.approval ? "done" : guide ? "attention" : "missing"}>
    {guide ? `Version ${guide.version}, ${guide.approval ? "approved: it is sent with every draft" : "not yet approved: approve it before drafting, or untick Include the approved feedback guide to draft without it"}` : "No guide yet: drafts are made from each submission's marks alone"}
  </p>
  <p class="hint">
    Write what each level of each criterion typically needs to hear, and the common next steps. Sent with every draft, it starts every student's feedback
    from the same place, so similar work gets similar feedback. It is anonymised when it is saved, and sent only once you approve it; it never overrides
    your marks or comments.
  </p>
  <form onsubmit={save}>
    <label for="guide-text">The guide</label>
    <textarea id="guide-text" rows="8" bind:value={text} oninput={() => (typed = true)}></textarea>
    <div class="actions">
      <button type="submit" aria-disabled={busy}>Save the guide</button>
      {#if guide && !guide.approval && text === guide.text}<button type="button" aria-disabled={busy} onclick={approve}>Approve this guide for the AI</button>{/if}
    </div>
  </form>
  <Status message={asDone(note)} />
  <Problems {problems} />
</section>
