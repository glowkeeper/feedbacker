<script lang="ts">
  import { recordRequest, type Workspace } from "../../core/index.ts";
  import { parseRequestForm, problemsOf, type BandRow, type SampleRow } from "../forms.ts";
  import Problems from "./Problems.svelte";
  import RowsEditor from "./RowsEditor.svelte";
  import Status from "./Status.svelte";
  import { asDone } from "../messages.ts";
  import { requestFormValues, requestRecorded, type RequestRecorded } from "../recorded.ts";
  import type { StepState } from "../steps.ts";
  import StepScreen from "./StepScreen.svelte";
  import TableRegion from "./TableRegion.svelte";

  let { workspace, step, onChanged }: { workspace: Workspace; step: StepState | undefined; onChanged: () => void | Promise<void> } = $props();

  let sample: Record<string, string>[] = $state([{ band: "", ids: "" }]);
  let programme = $state("");
  let module = $state("");
  let roles = $state("");
  let cohort = $state("");
  let groups = $state("unknown");
  let bands: Record<string, string>[] = $state([{ label: "", count: "" }]);
  let note = $state("");
  let replace = $state(false);
  let recorded: RequestRecorded | null = $state(null);
  let readProblem: string | null = $state(null);
  let screen: StepScreen;
  let busy = $state(false);
  let problems: string[] = $state([]);
  let message: string | null = $state(null);

  $effect(() => {
    read();
  });

  /** Read what is recorded, and start the form from it, so changing the request starts from what is there. */
  async function read() {
    try {
      recorded = await requestRecorded(workspace);
      readProblem = null;
      if (recorded) ({ sample, programme, module, roles, cohort, groups, bands, note } = requestFormValues(recorded));
    } catch (err) {
      recorded = null;
      readProblem = err instanceof Error ? err.message : String(err);
    }
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return; // the button stays enabled while busy, so focus isn't lost from it
    busy = true;
    problems = [];
    message = null;
    try {
      const form = parseRequestForm({ sample: sample as unknown as SampleRow[], programme, module, roles, cohort, groups: groups as "unknown" | "single" | "multiple", bands: bands as unknown as BandRow[], note });
      const request = await recordRequest(workspace, form.sample, { ...form.options, replace });
      replace = false;
      await onChanged(); // the status is read again, so it changes with what is recorded
      await read();
      // Everything changes together: the message and what is recorded appear, and focus moves to it.
      message = `Recorded the request: ${request.sample.length} sampled submissions, ${request.sample.map((s) => `${s.submission_id} ${s.pseudonym}`).join(", ")}. Their real IDs are kept in the private pseudonym key, and shown only on this screen.`;
      await screen.shown();
    } catch (err) {
      problems = problemsOf(err);
    } finally {
      busy = false;
    }
  }
</script>

<StepScreen bind:this={screen} title="Moderation request" {step} recorded={recorded !== null} change="Change the request">
  {#snippet how()}
    <p>
      Record the sample you were asked to moderate, and the module's context. Each sampled submission gets a pseudonym, such as [STUDENT_A], which is how
      it appears everywhere else. Its real ID (for example Turnitin's) is kept in the private pseudonym key, and shown only here, beside its pseudonym, so
      you can match the two; it never leaves this computer.
    </p>
  {/snippet}
  {#snippet messages()}
    <Status message={asDone(message)} />
    <Problems {problems} />
    {#if readProblem}<Problems problems={[readProblem]} title="The recorded request can't be read:" />{/if}
  {/snippet}
  {#snippet record()}
    {@const c = recorded!.request.context}
    <TableRegion label="The sample">
      <table>
        <caption>The sample: each sampled submission, its pseudonym and its real ID (shown on this screen only)</caption>
        <thead>
          <tr><th scope="col">Submission</th><th scope="col">Pseudonym</th><th scope="col">Real ID</th><th scope="col">Band</th></tr>
        </thead>
        <tbody>
          {#each recorded!.rows as row (row.id)}
            <tr>
              <th scope="row">{row.id}</th>
              <td>{row.pseudonym}</td>
              <td class={row.realId ? "" : "attention"}>{row.realId ?? "Not in the pseudonym key"}</td>
              <td class={row.band ? "" : "missing"}>{row.band ?? "Not listed"}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </TableRegion>
    <dl class="steps">
      <dt>Module</dt><dd class={c.module ? "" : "missing"}>{c.module ?? "Not recorded"}</dd>
      <dt>Programme</dt><dd class={c.programme ? "" : "missing"}>{c.programme ?? "Not recorded"}</dd>
      <dt>Cohort size</dt><dd class={c.cohort_size === null ? "missing" : ""}>{c.cohort_size ?? "Not recorded"}</dd>
      <dt>Marked in groups</dt><dd class={c.multiple_groups === null ? "missing" : ""}>{c.multiple_groups === null ? "Not recorded" : c.multiple_groups ? "Several groups" : "One group"}</dd>
      <dt>Band distribution</dt>
      <dd class={c.band_distribution.length ? "" : "missing"}>{c.band_distribution.length ? c.band_distribution.map((b) => `${b.label}: ${b.count}`).join("; ") : "Not recorded"}</dd>
      <dt>How the sample was chosen</dt><dd class={c.sample_note ? "" : "missing"}>{c.sample_note ?? "Not recorded"}</dd>
      <dt>Staff roles</dt><dd class={c.staff_roles.length ? "" : "missing"}>{c.staff_roles.length ? c.staff_roles.join("; ") : "Not recorded"}</dd>
    </dl>
  {/snippet}
  {#snippet actions()}
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

      {#if recorded}
        <label class="check"><input type="checkbox" bind:checked={replace} /> Replace the request already recorded (pseudonyms are kept)</label>
      {/if}
      <button type="submit" aria-disabled={busy}>Record the request</button>
    </form>
  {/snippet}
</StepScreen>
