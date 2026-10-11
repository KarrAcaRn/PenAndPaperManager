<script lang="ts">
  import MarkdownEditor from '../src/lib/MarkdownEditor.svelte';

  // Testhilfe: zeigt den gebundenen Wert an, damit Tests ihn nach Eingaben auslesen können
  let { value = $bindable('') }: { value?: string } = $props();
</script>

<MarkdownEditor bind:value label="Text" />
<output data-testid="value">{value}</output>
