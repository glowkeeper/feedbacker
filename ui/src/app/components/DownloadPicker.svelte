<script lang="ts">
  // Bulk downloads, in whichever shape they arrived: zips, single files, or the folder they were unzipped into. The folder's own name makes no difference.
  // One choice at a time: choosing a folder replaces the files chosen, and the other way round, so a download is never in twice.
  let { id, label, accept, files = $bindable([]) }: { id: string; label: string; accept: string; files: File[] } = $props();

  let filesInput: HTMLInputElement;
  let folderInput: HTMLInputElement;

  const choose = (event: Event, other: HTMLInputElement) => {
    other.value = "";
    files = [...((event.currentTarget as HTMLInputElement).files ?? [])];
  };
</script>

<label for={id}>{label}</label>
<input {id} bind:this={filesInput} type="file" multiple {accept} onchange={(e) => choose(e, folderInput)} />
<label for={`${id}-folder`}>Or a folder of unzipped downloads</label>
<input id={`${id}-folder`} bind:this={folderInput} type="file" webkitdirectory onchange={(e) => choose(e, filesInput)} />
<p class="hint" aria-live="polite">{files.length ? `${files.length} file(s) chosen.` : "Nothing chosen yet."} Only the sampled students' files are opened.</p>
