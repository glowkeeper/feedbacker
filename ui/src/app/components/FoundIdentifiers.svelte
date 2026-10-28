<script lang="ts">
  /**
   * What looks like an identifier in what an AI request would send, with each match to tick for redacting, for a screen that has only the matches (a request
   * that couldn't be planned) and the workspace: it adds the ticked ones to the anonymisation rules itself, and says what to do next.
   */
  import { addIdentifiersToRules, type IdentifierMatch, type Workspace } from "../../core/index.ts";
  import { asFailed } from "../messages.ts";
  import IdentifierMatches from "./IdentifierMatches.svelte";
  import Status from "./Status.svelte";
  import { problemsOf } from "../forms.ts";

  let { id, workspace, groups, what }: { id: string; workspace: Workspace; groups: [string, IdentifierMatch[]][]; what: string } = $props();

  let busy = $state(false);
  let added: string | null = $state(null);
  let problem: string | null = $state(null);

  async function add(matches: IdentifierMatch[]) {
    if (busy) return;
    busy = true;
    problem = null;
    added = null;
    try {
      const n = await addIdentifiersToRules(workspace, matches);
      added = `Added ${n} value${n === 1 ? "" : "s"} to the anonymisation rules. Nothing is changed in the texts until you go to Anonymisation, press Anonymise now, and review and approve each affected text again; then ask again.`;
    } catch (err) {
      problem = problemsOf(err).join(" ");
    } finally {
      busy = false;
    }
  }
</script>

<IdentifierMatches {id} {groups} {what} advice="These were found in what would be sent." {added} {busy} onAdd={add} />
<Status message={asFailed(problem)} />
