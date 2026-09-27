<script lang="ts">
  import { recordRequest, REQUEST, type Workspace } from "../../core/index.ts";
  import { parseBands, parseCount, parseList, parseSample, problemsOf } from "../forms.ts";
  import Problems from "./Problems.svelte";
  import Status from "./Status.svelte";

  let { workspace, onChanged }: { workspace: Workspace; onChanged: () => void } = $props();

  let sample = $state("");
  let programme = $state("");
  let module = $state("");
  let roles = $state("");
  let cohort = $state("");
  let groups = $state("unknown");
  let bands = $state("");
  let note = $state("");
  let replace = $state(false);
  let exists = $state(false);
  let busy = $state(false);
  let problems: string[] = $state([]);
  let message: string | null = $state(null);
  let heading: HTMLHeadingElement;

  $effect(() => {
    heading?.focus();
    workspace.exists(REQUEST).then((e) => (exists = e));
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    problems = [];
    message = null;
    try {
      const request = await recordRequest(workspace, parseSample(sample), {
        programme,
        module,
        staff_roles: parseList(roles),
        cohort_size: parseCount(cohort, "the cohort size"),
        multiple_groups: groups === "unknown" ? null : groups === "multiple",
        band_distribution: parseBands(bands),
        sample_note: note,
        replace,
      });
      message = `Recorded the request: ${request.sample.length} sampled submissions, ${request.sample.map((s) => `${s.submission_id} ${s.pseudonym}`).join(", ")}. Their identifiers are kept only in the private pseudonym key.`;
      exists = true;
      replace = false;
      onChanged();
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      busy = false;
    }
  }
</script>

<h1 tabindex="-1" bind:this={heading}>Moderation request</h1>
<p>Record the sample you were asked to moderate, and the module's context. Identifiers are replaced by pseudonyms everywhere except the private pseudonym key.</p>

<Status {message} />
<Problems {problems} />

<form onsubmit={submit}>
  <label for="sample">Sampled submissions</label>
  <p class="hint" id="sample-hint">One band per line, as <code>BAND:ID,ID</code> (for example <code>60-69:100200301,100200302</code>), or just <code>ID,ID</code>.</p>
  <textarea id="sample" rows="5" bind:value={sample} required aria-describedby="sample-hint" spellcheck="false"></textarea>

  <label for="programme">Programme (optional)</label>
  <input id="programme" type="text" bind:value={programme} />

  <label for="module">Module (optional)</label>
  <input id="module" type="text" bind:value={module} />

  <label for="roles">Staff roles involved (optional)</label>
  <p class="hint" id="roles-hint">One per line, for example <code>module convener</code>. Roles only, never names.</p>
  <textarea id="roles" rows="2" bind:value={roles} aria-describedby="roles-hint"></textarea>

  <label for="cohort">Cohort size (optional)</label>
  <input id="cohort" type="text" inputmode="numeric" bind:value={cohort} />

  <label for="groups">Marked in groups?</label>
  <select id="groups" bind:value={groups}>
    <option value="unknown">Not recorded</option>
    <option value="single">One group</option>
    <option value="multiple">Several groups</option>
  </select>

  <label for="bands">The cohort's band distribution (optional)</label>
  <p class="hint" id="bands-hint">One band per line, as <code>LABEL=COUNT</code>, for example <code>60-69=12</code>.</p>
  <textarea id="bands" rows="3" bind:value={bands} aria-describedby="bands-hint" spellcheck="false"></textarea>

  <label for="note">How the sample was chosen (optional)</label>
  <input id="note" type="text" bind:value={note} />

  {#if exists}
    <label class="check"><input type="checkbox" bind:checked={replace} /> Replace the request already recorded (pseudonyms are kept)</label>
  {/if}
  <button type="submit" disabled={busy}>Record the request</button>
</form>
