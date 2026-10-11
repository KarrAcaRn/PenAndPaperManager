<script lang="ts">
  import { SECTION_LABELS, accessibleSections, canAccessSection } from '@pnp/shared';
  import { href, type Route } from '../lib/router.svelte.ts';
  import { session } from '../lib/session.svelte.ts';
  import { clearNotice, notice } from '../lib/notice.svelte.ts';
  import UserMenu from '../lib/UserMenu.svelte';
  import FolderTree, { type TreeSelection } from '../lib/FolderTree.svelte';
  import FolderView from './FolderView.svelte';
  import ArticleView from './ArticleView.svelte';
  import ArticleEdit from './ArticleEdit.svelte';
  import GmManage from './GmManage.svelte';
  import GmSkills from './GmSkills.svelte';

  type ContentRoute = Exclude<Route, { name: 'groups' | 'manage' | 'skills' | 'admin' }>;

  let { route }: { route: Exclude<Route, { name: 'groups' | 'admin' }> } = $props();

  const group = $derived(session.groups.find((g) => g.id === route.gid));
  // Routen ohne eigenen Bereich (Verwalten, Fertigkeiten) sind Reiter des SL-Bereichs
  const gmTab = $derived(!('section' in route));
  const activeSection = $derived('section' in route ? route.section : 'gm');
  const allowed = $derived(group !== undefined && canAccessSection(group.role, activeSection));
  /** Alle Artikelbereiche: Ordnerbaum links, Inhalt rechts, um schnell zwischen Artikeln zu springen */
  const withTree = $derived(route.name !== 'manage' && route.name !== 'skills');
  const selection = (r: ContentRoute): TreeSelection => (r.name === 'article' ? { article: r.id } : { folder: r.path });
</script>

{#if !group}
  <main>
    <p class="error">Diese Gruppe gibt es nicht oder du bist kein Mitglied.</p>
    <a href={href.groups()}>Zur Gruppenauswahl</a>
  </main>
{:else}
  <header class="no-print">
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
        <div class="row tabs no-print">
          <a href={href.folder(group.id, 'gm')} class:active={!gmTab}>Artikel</a>
          <a href={href.skills(group.id)} class:active={route.name === 'skills'}>Fertigkeiten</a>
          <a href={href.manage(group.id)} class:active={route.name === 'manage'}>Gruppe verwalten</a>
        </div>
      {/if}

      {#if notice.text}
        <p class="row card notice no-print" role="status">
          {notice.text}
          <span class="spacer"></span>
          <button class="link" onclick={clearNotice}>Ausblenden</button>
        </p>
      {/if}

      <!-- Seiten laden ihre Daten einmal beim Erzeugen: bei Gruppenwechsel per Link alles neu aufbauen -->
      {#key group.id}
        {#if route.name === 'manage'}
          <GmManage {group} />
        {:else if route.name === 'skills'}
          <GmSkills {group} />
        {:else}
          <div class="split">
            <aside class="card no-print">
              {#key route.section}<FolderTree {group} section={route.section} current={selection(route)} />{/key}
            </aside>
            <section class="pane">{@render content(route)}</section>
          </div>
        {/if}
      {/key}
    {/if}
  </main>
{/if}

{#snippet content(r: ContentRoute)}
  <!-- Jede Route (Ordner, Artikel, Bearbeiten …) bekommt eine frische Komponente -->
  {#if group}
    {#key JSON.stringify(r)}
      {#if r.name === 'folder'}
        <FolderView {group} section={r.section} path={r.path} />
      {:else if r.name === 'new'}
        <ArticleEdit {group} section={r.section} path={r.path} />
      {:else if r.edit}
        <ArticleEdit {group} section={r.section} id={r.id} />
      {:else}
        <ArticleView {group} id={r.id} />
      {/if}
    {/key}
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
  .notice { margin: 0 0 1rem; padding: 0.5rem 0.75rem; border-color: var(--accent); }
  .split { display: grid; grid-template-columns: minmax(14rem, 18rem) minmax(0, 1fr); gap: 1.5rem; align-items: start; }
  aside { position: sticky; top: 1rem; max-height: calc(100vh - 2rem); overflow-y: auto; padding: 0.6rem; }
  @media (max-width: 45rem) {
    .split { grid-template-columns: minmax(0, 1fr); }
    aside { position: static; max-height: 40vh; }
  }
</style>
