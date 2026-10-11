<script lang="ts">
  import { SECTION_LABELS, accessibleSections, canAccessSection } from '@pnp/shared';
  import { href, type Route } from '../lib/router.svelte.ts';
  import { session } from '../lib/session.svelte.ts';
  import UserMenu from '../lib/UserMenu.svelte';
  import FolderTree, { type TreeSelection } from '../lib/FolderTree.svelte';
  import FolderView from './FolderView.svelte';
  import ArticleView from './ArticleView.svelte';
  import ArticleEdit from './ArticleEdit.svelte';
  import GmManage from './GmManage.svelte';

  type ContentRoute = Exclude<Route, { name: 'groups' } | { name: 'manage' }>;

  let { route }: { route: Exclude<Route, { name: 'groups' }> } = $props();

  const group = $derived(session.groups.find((g) => g.id === route.gid));
  const activeSection = $derived(route.name === 'manage' ? 'gm' : route.section);
  const allowed = $derived(group !== undefined && canAccessSection(group.role, activeSection));
  /** Alle Artikelbereiche: Ordnerbaum links, Inhalt rechts, um schnell zwischen Artikeln zu springen */
  const withTree = $derived(route.name !== 'manage');
  const selection = (r: ContentRoute): TreeSelection => (r.name === 'article' ? { article: r.id } : { folder: r.path });
</script>

{#if !group}
  <main>
    <p class="error">Diese Gruppe gibt es nicht oder du bist kein Mitglied.</p>
    <a href={href.groups()}>Zur Gruppenauswahl</a>
  </main>
{:else}
  <header>
    <div class="row bar" class:wide={withTree}>
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

  <main class:wide={withTree}>
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
      {:else}
        <div class="split">
          <aside class="card">
            {#key route.section}<FolderTree {group} section={route.section} current={selection(route)} />{/key}
          </aside>
          <section class="pane">{@render content(route)}</section>
        </div>
      {/if}
    {/if}
  </main>
{/if}

{#snippet content(r: ContentRoute)}
  {#if group}
    {#if r.name === 'folder'}
      {#key `${r.section}/${r.path}`}<FolderView {group} section={r.section} path={r.path} />{/key}
    {:else if r.name === 'new'}
      {#key `${r.section}/${r.path}`}<ArticleEdit {group} section={r.section} path={r.path} />{/key}
    {:else if r.edit}
      {#key r.id}<ArticleEdit {group} section={r.section} id={r.id} />{/key}
    {:else}
      {#key r.id}<ArticleView {group} id={r.id} />{/key}
    {/if}
  {/if}
{/snippet}

<style>
  header { background: var(--surface); border-bottom: 1px solid var(--border); }
  .bar { max-width: 60rem; margin: 0 auto; padding: 0.6rem 1rem; }
  .bar.wide, main.wide { max-width: 90rem; }
  .name { font-weight: 700; font-size: 1.1rem; text-decoration: none; margin-right: 1rem; }
  nav a, .tabs a { text-decoration: none; padding: 0.3rem 0.7rem; border-radius: var(--radius); color: var(--text); }
  nav a.active, .tabs a.active { background: var(--accent); color: var(--accent-text); }
  .tabs { margin-bottom: 1rem; }
  .split { display: grid; grid-template-columns: minmax(14rem, 18rem) minmax(0, 1fr); gap: 1.5rem; align-items: start; }
  aside { position: sticky; top: 1rem; max-height: calc(100vh - 2rem); overflow-y: auto; padding: 0.6rem; }
  @media (max-width: 45rem) {
    .split { grid-template-columns: minmax(0, 1fr); }
    aside { position: static; max-height: 40vh; }
  }
</style>
