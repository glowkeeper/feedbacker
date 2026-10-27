<script lang="ts">
  import { bandDistributionOf, bandFor, DEFAULT_BOUNDARY_DISTANCE, DEFAULT_PASS_MARK, DEFAULT_SAMPLE_PERCENT, describeSample, isExternalId, contextOfModule, keepRequestCohort, sampleSize, SCHEMES, suggest, type Scheme, loadRequestCohort, readRequestDocument, recordRequest, REQUEST, studentsOf, type CohortRow, type RequestFindings, type Workspace } from "../../core/index.ts";
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
  let exists = $state(false); // a request file is there, even one that can't be read, so replacing it must stay possible
  let screen: StepScreen;
  let busy = $state(false);
  let problems: string[] = $state([]);
  let message: string | null = $state(null);

  // The request document, read for the moderator to check: what it found, which assessment this moderation is of, and which students are ticked as the sample.
  let documentFiles: FileList | null = $state(null);
  let findings = $state<RequestFindings | null>(null);
  let documentMessage: string | null = $state(null);
  let documentProblems: string[] = $state([]);
  let documentNotes: string[] = $state([]);
  let assessment = $state("");
  let ticked: string[] = $state([]); // student IDs, as the document gives them
  let reading = $state(false);
  let differs = $state(false); // this document isn't the one the recorded cohort was read from
  // Choosing the sample by a scheme: a suggestion to adjust, never a choice made for the moderator.
  let percent = $state(String(DEFAULT_SAMPLE_PERCENT));
  let scheme: Scheme = $state("spread");
  let passMark = $state(String(DEFAULT_PASS_MARK));
  let distance = $state(String(DEFAULT_BOUNDARY_DISTANCE));
  const newSeed = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");
  let seed = $state(newSeed());
  let suggestProblems: string[] = $state([]);
  let suggestNotes: string[] = $state([]);
  let suggested: string[] | null = $state(null); // the students the scheme chose, to say whether the sample was then adjusted by hand
  let schemeNote = ""; // how the scheme says the sample was chosen: the note, until it is edited
  const ADJUSTED = " Then adjusted by hand.";
  const PERCENT_KEY = "feedbacker.samplePercent";
  $effect(() => {
    try {
      const saved = localStorage.getItem(PERCENT_KEY); // the percentage last used, for convenience only
      if (saved && Number(saved) > 0) percent = saved;
    } catch {
      /* no storage: the default stands */
    }
  });
  let generated = ""; // the sample as the ticks made it: if it is still that when another document is read, it belonged to the last one

  $effect(() => {
    read();
  });

  /** Read what is recorded, and start the form from it, so changing the request starts from what is there. */
  async function read() {
    exists = await workspace.exists(REQUEST);
    try {
      recorded = await requestRecorded(workspace);
      readProblem = null;
      if (recorded) ({ sample, programme, module, roles, cohort, groups, bands, note } = requestFormValues(recorded));
      else if (workspace.module) {
        // In a module, the programme and module are the module's, entered once.
        const held = await contextOfModule(workspace);
        if (held) (programme = programme || (held.programme ?? "")), (module = module || (held.module ?? ""));
      }
    } catch (err) {
      recorded = null;
      readProblem = err instanceof Error ? err.message : String(err);
    }
  }

  const assessments: string[] = $derived([...new Set(findings?.cohort.map((r) => r.assessment) ?? [])]);
  const students: CohortRow[] = $derived(findings?.cohort.filter((r) => r.assessment === assessment) ?? []);
  const submitted: CohortRow[] = $derived(students.filter((r) => r.submitted));
  const bandOfRow = (initial: number | null) => (initial === null || !findings ? "" : (bandFor(initial, findings.bands) ?? ""));

  /** The sample rows the ticked students make: a row per band, in the order the document lists them. */
  function sampleOfTicks(): Record<string, string>[] {
    const byBand = new Map<string, string[]>();
    for (const r of students.filter((r) => ticked.includes(r.student_id))) {
      const band = bandOfRow(r.initial);
      byBand.set(band, [...(byBand.get(band) ?? []), r.student_id]);
    }
    const rows = [...byBand].map(([band, ids]) => ({ band, ids: ids.join(", ") }));
    return rows.length ? rows : [{ band: "", ids: "" }];
  }

  function sampleFromTicks() {
    sample = sampleOfTicks();
    generated = JSON.stringify(sample);
  }

  function tick(id: string, on: boolean) {
    ticked = on ? [...ticked, id] : ticked.filter((t) => t !== id);
    sampleFromTicks();
  }

  /** The suggestion belonged to a cohort that is no longer in view: forget it, and drop its note unless the moderator has edited it. */
  function dropSuggestion() {
    if (note === schemeNote || note === schemeNote + ADJUSTED) note = "";
    schemeNote = "";
    suggested = null;
    suggestNotes = [];
  }

  function chooseAssessment(value: string) {
    assessment = value;
    ticked = [];
    dropSuggestion();
    sampleFromTicks();
  }

  const wanted = $derived(sampleSize(submitted.length, Number(percent)));

  /** Keep the note saying how the sample was chosen true to the sample that will be recorded, however it was edited: adjusted by hand once its IDs differ from the scheme's. */
  function noteAdjustment() {
    if (suggested === null || !schemeNote) return;
    const ids = sample.flatMap((r) => (r.ids ?? "").split(/[\s,;]+/).filter(Boolean));
    const same = suggested.length === ids.length && suggested.every((id) => ids.includes(id));
    if (note === schemeNote || note === schemeNote + ADJUSTED) note = same ? schemeNote : schemeNote + ADJUSTED;
  }

  // The sample can be edited directly in its table, not only by ticking, so follow it.
  $effect(() => {
    void sample.map((r) => r.ids);
    noteAdjustment();
  });

  function suggestNow() {
    suggestProblems = [];
    suggestNotes = [];
    const pct = Number(percent);
    if (!(pct > 0) || pct > 100) {
      suggestProblems = ["The percentage must be above 0 and at most 100."];
      return;
    }
    const pass = Number(passMark);
    const dist = Number(distance);
    if (scheme === "spread" && !(pass >= 0 && pass <= 100)) {
      suggestProblems = ["The pass mark must be a mark from 0 to 100."];
      return;
    }
    if (scheme === "boundary" && !(dist >= 0)) {
      suggestProblems = ["The distance must be a number of marks, 0 or more."];
      return;
    }
    if (scheme === "random" && !seed.trim()) {
      suggestProblems = ["A random sample needs a seed (it is recorded, so that anyone can repeat it)."];
      return;
    }
    const size = sampleSize(submitted.length, pct);
    // Only students who submitted and whose ID can be recorded can be picked; their row is their place in the table.
    const candidates = students.flatMap((r, i) => (r.submitted && isExternalId(r.student_id) ? [{ row: i + 1, initial: r.initial, agreed: r.agreed }] : []));
    const result = suggest(scheme, candidates, { size, bands: findings?.bands ?? [], passMark: pass, distance: dist, seed: seed.trim() });
    suggestNotes = result.notes;
    let caveats = result.notes;
    if (scheme !== "hand") {
      ticked = result.rows.map((row) => students[row - 1].student_id);
      sampleFromTicks();
      if (result.rows.length < size) {
        caveats = [...result.notes, `The scheme found ${result.rows.length} of the ${size} wanted; tick more by hand if you want them.`];
        suggestNotes = caveats;
      }
    }
    schemeNote = describeSample({ scheme, percent: pct, submitted: submitted.length, size, found: scheme === "hand" ? undefined : result.rows.length, caveats: scheme === "hand" ? [] : caveats, seed: seed.trim(), passMark: pass, distance: dist });
    suggested = scheme === "hand" ? null : [...ticked];
    note = schemeNote;
    try {
      localStorage.setItem(PERCENT_KEY, String(pct));
    } catch {
      /* no storage: not remembered */
    }
  }

  async function readDocument(event: SubmitEvent) {
    event.preventDefault();
    if (reading) return; // the button stays enabled while busy, so focus isn't lost from it
    const file = documentFiles?.[0];
    if (!file) {
      documentProblems = ["Choose the request document first."];
      return;
    }
    reading = true;
    documentProblems = [];
    documentNotes = [];
    documentMessage = null;
    try {
      const found = await readRequestDocument(file.name, new Uint8Array(await file.arrayBuffer()));
      findings = found;
      const earlier = await loadRequestCohort(workspace).catch(() => null);
      differs = earlier !== null && earlier.source_sha256 !== found.source_sha256;
      // In a module, the document is the module's: a different one would give a cohort the module does not show.
      const moduleCohort = workspace.module ? await loadRequestCohort(workspace.module).catch(() => null) : null;
      const notModules = moduleCohort !== null && moduleCohort.source_sha256 !== found.source_sha256;
      const filled: string[] = [];
      if (found.programme) (programme = found.programme), filled.push("programme");
      if (found.module) (module = found.module), filled.push("module");
      if (found.cohort_size !== null) (cohort = String(found.cohort_size)), filled.push("cohort size");
      if (found.multiple_groups !== null) (groups = found.multiple_groups ? "multiple" : "single"), filled.push("marked in groups");
      const distribution = bandDistributionOf(found);
      if (distribution.length) (bands = distribution.map((b) => ({ label: b.label, count: String(b.count) }))), filled.push("band distribution");
      // The students ticked from the last document aren't in this one: the sample they made goes too, unless it has since been edited by hand.
      const hadGenerated = JSON.stringify(sample) === generated;
      ticked = [];
      dropSuggestion();
      suggestProblems = [];
      assessment = found.cohort[0]?.assessment ?? "";
      if (hadGenerated) sampleFromTicks();
      const flagged = found.cohort.filter((r) => r.flags.length).length;
      documentNotes = [...(notModules ? ["This isn't the document the module's cohort was read from, so this assessment's sample would be drawn from a cohort the module does not show. Read the module's document, or read this one in the module first."] : []), ...(differs ? ["This isn't the document the recorded cohort was read from, so recording from it replaces that cohort."] : []), ...found.flags, ...(flagged ? [`${flagged} student row(s) have something to check; see the Check column below.`] : [])];
      documentMessage =
        `Read the request document: ${found.cohort.length} student row(s) in ${new Set(found.cohort.map((r) => r.assessment)).size} assessment(s)` +
        (filled.length ? `; filled in ${filled.join(", ")}` : "") +
        `. Check it, then record the request below; nothing is recorded until you do.`;
    } catch (err) {
      findings = null;
      documentProblems = problemsOf(err);
    } finally {
      reading = false;
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
      // The students' names, from the request document, go only to the private pseudonym key.
      const names = new Map(findings?.cohort.filter((r) => r.name).map((r) => [r.student_id, [r.name]]));
      // The marks the document listed for them: kept with the request, to check a marked view's grade against. With no document read, the marks already recorded are kept.
      const marks = new Map(findings?.cohort.filter((r) => r.assessment === assessment).map((r) => [r.student_id, r]));
      const request = await recordRequest(
        workspace,
        form.sample.map((e) => ({ ...e, names: names.get(e.external_id), initial_mark: findings ? (marks.get(e.external_id)?.initial ?? null) : undefined, agreed_mark: findings ? (marks.get(e.external_id)?.agreed ?? null) : undefined })),
        { ...form.options, replace },
      );
      // The cohort the document listed is kept too, without its students (no name or ID), with which rows are in the sample.
      // The request is already recorded by now, so if the cohort can't be kept that is said, beside the success, and not reported as the request's failure.
      const kept = await keepRequestCohort(workspace, findings, { assessment, externalIds: form.sample.map((e) => e.external_id), submissionIds: request.sample.map((s) => s.submission_id) });
      const cohortProblem = kept.error ? problemsOf(kept.error).join("; ") : null;
      replace = false;
      await onChanged(); // the status is read again, so it changes with what is recorded
      await read();
      // Everything changes together: the message and what is recorded appear, and focus moves to it.
      message = `Recorded the request: ${request.sample.length} sampled submissions, ${request.sample.map((s) => `${s.submission_id} ${s.pseudonym}`).join(", ")}. Their real IDs are kept in the private pseudonym key, and shown only on this screen.${cohortProblem ? ` The cohort the document listed could not be kept, so the Overview won't show it (${cohortProblem}); read the document again and record the request again to keep it.` : ""}`;
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
              <td class={row.realId ? "" : "attention"}>{row.realId ?? "Not in the pseudonym key"}{row.realId && row.platformId ? ` (matched to the platform's ${row.platformId})` : ""}</td>
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
    <section aria-labelledby="document-heading">
      <h2 id="document-heading">Read it from the request document (optional)</h2>
      <p class="hint" id="document-hint">
        Choose the request document (Word, or a PDF with text, not a scan). Its module details and the students it lists are read on this computer, for you to check; staff names in it are
        never read, and nothing is kept of the document itself. A student's name goes only into the private pseudonym key.
      </p>
      <form onsubmit={readDocument}>
        <label for="request-document">Request document (docx)</label>
        <input id="request-document" type="file" accept=".docx,.pdf" aria-describedby="document-hint" onchange={(e) => (documentFiles = (e.currentTarget as HTMLInputElement).files)} />
        <button type="submit" aria-disabled={reading}>Read the document</button>
      </form>
      <Status message={asDone(documentMessage)} />
      <Problems problems={documentProblems} />
      {#if documentNotes.length}<Problems problems={documentNotes} title="Please check what was read:" kind="note" />{/if}
      {#if findings && findings.cohort.length}
        {#if assessments.length > 1}
          <label for="request-assessment">The assessment this moderation is of</label>
          <select id="request-assessment" value={assessment} onchange={(e) => chooseAssessment(e.currentTarget.value)}>
            {#each assessments as a (a)}<option value={a}>{a || "(not named)"}</option>{/each}
          </select>
          <p class="hint">Each moderation is of one assessment; moderate the others in their own workspaces.</p>
        {/if}
        <p class="hint">The initial mark is the marker's. The agreed mark, where the document gives one, is as it lists it: the mark after the partner's internal moderation.</p>
        <TableRegion label="The students the request document lists">
          <table>
            <caption>The students listed{assessment ? ` for ${assessment}` : ""}: tick those in the sample (real IDs, shown on this screen only)</caption>
            <thead>
              <tr><th scope="col">Sample</th><th scope="col">Row</th><th scope="col">Student ID</th><th scope="col">Initial mark</th><th scope="col">Agreed mark</th><th scope="col">Band</th><th scope="col">Check</th></tr>
            </thead>
            <tbody>
              {#each students as r, i (r.student_id)}
                <tr>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`In the sample: row ${i + 1}`}
                      checked={ticked.includes(r.student_id)}
                      disabled={!r.submitted || !isExternalId(r.student_id)}
                      onchange={(e) => tick(r.student_id, e.currentTarget.checked)}
                    />
                  </td>
                  <th scope="row">{i + 1}</th>
                  <td>{r.student_id}</td>
                  <td>{r.submitted ? (r.initial ?? "—") : "No submission"}</td>
                  <td>{r.agreed ?? "—"}</td>
                  <td>{bandOfRow(r.initial) || "—"}</td>
                  <td class={r.flags.length ? "attention" : ""}>{r.flags.length ? r.flags.join("; ") : "None"}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </TableRegion>
        <fieldset class="choose-sample">
          <legend>Choose the sample</legend>
          <p class="hint" id="choose-hint">
            A scheme suggests a sample from the marks, and you can tick or untick students by hand afterwards. The size is a percentage of those who submitted, always rounded up.
          </p>
          <label for="sample-percent">Percentage of those who submitted</label>
          <input id="sample-percent" type="text" inputmode="decimal" bind:value={percent} aria-describedby="choose-hint" />
          <p aria-live="polite">Sample size: {wanted} of the {submitted.length} who submitted.</p>
          <label for="sample-scheme">Scheme</label>
          <select id="sample-scheme" bind:value={scheme}>
            {#each SCHEMES as s (s.scheme)}<option value={s.scheme}>{s.label}</option>{/each}
          </select>
          <p class="hint">{SCHEMES.find((s) => s.scheme === scheme)?.about}</p>
          {#if scheme === "spread"}
            <label for="sample-pass">Pass mark (every mark below it is a fail)</label>
            <input id="sample-pass" type="text" inputmode="decimal" bind:value={passMark} />
          {:else if scheme === "boundary"}
            <label for="sample-distance">How near a boundary, in marks</label>
            <input id="sample-distance" type="text" inputmode="decimal" bind:value={distance} />
          {:else if scheme === "random"}
            <label for="sample-seed">Seed (recorded, so the choice can be repeated)</label>
            <input id="sample-seed" type="text" bind:value={seed} />
            <button type="button" onclick={() => (seed = newSeed())}>Use a new seed</button>
          {/if}
          <button type="button" onclick={suggestNow}>Suggest a sample</button>
          <Problems problems={suggestProblems} />
          {#if suggestNotes.length}<Problems problems={suggestNotes} title="Please note:" kind="note" />{/if}
        </fieldset>
        <p class="hint" aria-live="polite">
          {ticked.length} of the {submitted.length} who submitted ticked{submitted.length ? ` (${Math.round((100 * ticked.length) / submitted.length)}%)` : ""}. The ticked students' IDs are in the form below.
        </p>
      {/if}
    </section>

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
  {/snippet}
</StepScreen>
