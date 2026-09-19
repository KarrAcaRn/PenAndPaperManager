<script lang="ts">
  import { SECTION_LABELS, baseName, pathPrefixes, type Section } from '@pnp/shared';
  import { href } from './router.svelte.ts';

  let { gid, section, path }: { gid: number; section: Section; path: string } = $props();
</script>

<nav class="breadcrumb" aria-label="Pfad">
  <a href={href.folder(gid, section)}>{SECTION_LABELS[section]}</a>
  {#each pathPrefixes(path) as prefix}
    <span class="muted">/</span>
    <a href={href.folder(gid, section, prefix)}>{baseName(prefix)}</a>
  {/each}
</nav>

<style>
  .breadcrumb { display: flex; gap: 0.4rem; flex-wrap: wrap; font-weight: 600; }
  .breadcrumb a { text-decoration: none; }
</style>
