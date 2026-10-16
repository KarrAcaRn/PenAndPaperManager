<script lang="ts">
  import { clearNotice, notice } from './notice.svelte.ts';
</script>

{#if notice.text}
  <p class="row card notice no-print" role="status">
    {notice.text}
    <span class="spacer"></span>
    <button class="link" onclick={clearNotice}>Ausblenden</button>
  </p>
{/if}

<style>
  .notice { max-width: 60rem; margin: 1rem auto 0; padding: 0.5rem 0.75rem; border-color: var(--color-accent); }
</style>
