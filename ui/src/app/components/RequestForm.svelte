<script lang="ts">
  import { recordRequest, REQUEST, type Workspace } from "../../core/index.ts";
  import { parseRequestForm, problemsOf, type BandRow, type SampleRow } from "../forms.ts";
  import Problems from "./Problems.svelte";
  import RowsEditor from "./RowsEditor.svelte";
  import Status from "./Status.svelte";
  import { asDone } from "../messages.ts";

  let { workspace, onChanged }: { workspace: Workspace; onChanged: () => void } = $props();

  let sample: Record<string, string>[] = $state([{ band: "", ids: "" }]);
  let programme = $state("");
  let module = $state("");
  let roles = $state("");
  let cohort = $state("");
  let groups = $state("unknown");
  let bands: Record<string, string>[] = $state([{ label: "", count: "" }]);
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
    if (busy) return; // the button stays enabled while busy, so focus isn't lost from it
    busy = true;
    problems = [];
    message = null;
    try {
      const form = parseRequestForm({ sample: sample as unknown as SampleRow[], programme, module, roles, cohort, groups: groups as "unknown" | "single" | "multiple", bands: bands as unknown as BandRow[], note });
      const request = await recordRequest(workspace, form.sample, { ...form.options, replace });
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

<Status message={asDone(message)} />
<Problems {problems} />

<form onsubmit={submit}>
  <RowsEditor
    id="sample"
    legend="Sampled submissions"
    hint="A row per grade band, with the band (for example 60-69) and its submission IDs (for example Turnitin's), separated by commas or spaces. Leave the band empty if the sample has none."
    columns={[
      { key: "band", label: "Band (optional)" },
      { key: "ids", label: "Submission IDs" },
    ]}
    bind:rows={sample}
    addLabel="Add another band of the sample"
    rowName="sampled band"
  />

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

  <RowsEditor
    id="bands"
    legend="The cohort's band distribution (optional)"
    hint="A row per band, with how many students in the whole cohort are in it."
    columns={[
      { key: "label", label: "Band" },
      { key: "count", label: "Number of students", inputmode: "numeric" },
    ]}
    bind:rows={bands}
    addLabel="Add another band of the cohort"
    rowName="cohort band"
  />

  <label for="note">How the sample was chosen (optional)</label>
  <input id="note" type="text" bind:value={note} />

  {#if exists}
    <label class="check"><input type="checkbox" bind:checked={replace} /> Replace the request already recorded (pseudonyms are kept)</label>
  {/if}
  <button type="submit" aria-disabled={busy}>Record the request</button>
</form>
