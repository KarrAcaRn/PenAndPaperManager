<script lang="ts">
  import { SECTION_LABELS, accessibleSections, canAccessSection } from '@pnp/shared';
  import { href, type Route } from '../lib/router.svelte.ts';
  import { session } from '../lib/session.svelte.ts';
  import UserMenu from '../lib/UserMenu.svelte';
  import FolderView from './FolderView.svelte';
  import ArticleView from './ArticleView.svelte';
  import ArticleEdit from './ArticleEdit.svelte';
  import GmManage from './GmManage.svelte';

  let { route }: { route: Exclude<Route, { name: 'groups' }> } = $props();

  const group = $derived(session.groups.find((g) => g.id === route.gid));
  const activeSection = $derived(route.name === 'manage' ? 'gm' : route.section);
  const allowed = $derived(group !== undefined && canAccessSection(group.role, activeSection));
</script>

{#if !group}
  <main>
    <p class="error">Diese Gruppe gibt es nicht oder du bist kein Mitglied.</p>
    <a href={href.groups()}>Zur Gruppenauswahl</a>
  </main>
{:else}
  <header>
    <div class="row bar">
      <a class="name" href={href.groups()} title="Gruppe wechseln">{group.name}</a>
      <nav class="row">
        {#each accessibleSections(group.role) as section}
          <a href={href.folder(group.id, section)} class:active={section === activeSection}>{SECTION_LABELS[section]}</a>
        {/each}
      </nav>
      <span class="spacer"></span>
      <UserMenu />
    </div>
  </header>

  <main>
    {#if !allowed}
      <p class="error">Dieser Bereich ist nur für Spielleiter.</p>
    {:else}
      {#if activeSection === 'gm'}
        <div class="row tabs">
          <a href={href.folder(group.id, 'gm')} class:active={route.name !== 'manage'}>Artikel</a>
          <a href={href.manage(group.id)} class:active={route.name === 'manage'}>Gruppe verwalten</a>
        </div>
      {/if}

      {#if route.name === 'manage'}
        <GmManage {group} />
      {:else if route.name === 'folder'}
        {#key `${route.section}/${route.path}`}
          <FolderView {group} section={route.section} path={route.path} />
        {/key}
      {:else if route.name === 'new'}
        {#key `${route.section}/${route.path}`}<ArticleEdit {group} section={route.section} path={route.path} />{/key}
      {:else if route.edit}
        {#key route.id}<ArticleEdit {group} section={route.section} id={route.id} />{/key}
      {:else}
        {#key route.id}<ArticleView {group} id={route.id} />{/key}
      {/if}
    {/if}
  </main>
{/if}

<style>
  header { background: var(--surface); border-bottom: 1px solid var(--border); }
  .bar { max-width: 60rem; margin: 0 auto; padding: 0.6rem 1rem; }
  .name { font-weight: 700; font-size: 1.1rem; text-decoration: none; margin-right: 1rem; }
  nav a, .tabs a { text-decoration: none; padding: 0.3rem 0.7rem; border-radius: var(--radius); color: var(--text); }
  nav a.active, .tabs a.active { background: var(--accent); color: var(--accent-text); }
  .tabs { margin-bottom: 1rem; }
</style>
