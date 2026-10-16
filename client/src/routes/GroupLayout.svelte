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
  import GmSkills from './GmSkills.svelte';
  import Rules from './Rules.svelte';

  type ContentRoute = Exclude<Route, { name: 'groups' | 'manage' | 'skills' | 'rules' | 'admin' | 'settings' }>;

  let { route }: { route: Exclude<Route, { name: 'groups' | 'admin' | 'settings' }> } = $props();

  const group = $derived(session.groups.find((g) => g.id === route.gid));
  // Verwalten und Fertigkeiten sind Reiter des SL-Bereichs; das Regelwerk gehört zu keinem Bereich
  const gmTab = $derived(route.name === 'manage' || route.name === 'skills');
  const activeSection = $derived('section' in route ? route.section : gmTab ? 'gm' : null);
  const allowed = $derived(group !== undefined && (activeSection === null || canAccessSection(group.role, activeSection)));
  const selection = (r: ContentRoute): TreeSelection =>
    r.name === 'article' ? { article: r.id } : { folder: r.path, newArticle: r.name === 'new' };
  /** Unterpunkte des SL-Bereichs erscheinen als zweite Zeile in der Navigation */
  const showGmTabs = $derived(activeSection === 'gm' && allowed);

  // Die Unterpunkte beginnen unter dem Schriftzug "Spielleiter", damit die Zugehörigkeit sichtbar ist -
  // aber nie so weit rechts, dass sie aus dem Kasten ragen (schmale Bildschirme).
  let navRow = $state<HTMLElement>();
  let gmLink = $state<HTMLElement>();
  let gmTabs = $state<HTMLElement>();
  let gmTabsOffset = $state(0);

  function alignGmTabs() {
    if (!navRow || !gmLink || !gmTabs) return;
    const linkLeft = gmLink.getBoundingClientRect().left - navRow.getBoundingClientRect().left;
    gmTabsOffset = Math.max(0, Math.min(linkLeft, navRow.clientWidth - gmTabs.offsetWidth));
  }

  $effect(() => {
    if (showGmTabs) alignGmTabs();
  });
</script>

<svelte:window onresize={alignGmTabs} />

{#if !group}
  <main>
    <p class="error">Diese Gruppe gibt es nicht oder du bist kein Mitglied.</p>
    <a href={href.groups()}>Zur Gruppenauswahl</a>
  </main>
{:else}
  <header class="no-print">
    <div class="bar vine-frame">
      <div class="row" bind:this={navRow}>
        <a class="name" href={href.groups()} title="Gruppe wechseln">{group.name}</a>
        <nav class="row" aria-label="Bereiche">
          {#each accessibleSections(group.role) as section}
            {#if section === 'gm'}
              <a bind:this={gmLink} href={href.folder(group.id, section)} class:active={section === activeSection}>{SECTION_LABELS[section]}</a>
            {:else}
              <a href={href.folder(group.id, section)} class:active={section === activeSection}>{SECTION_LABELS[section]}</a>
            {/if}
          {/each}
          <a href={href.rules(group.id)} class:active={route.name === 'rules'}>Regelwerk</a>
        </nav>
        <span class="spacer"></span>
        <UserMenu />
      </div>
      {#if showGmTabs}
        <nav class="row subnav" aria-label="Spielleiter" bind:this={gmTabs} style:margin-left="{gmTabsOffset}px">
          <a href={href.folder(group.id, 'gm')} class:active={!gmTab}>Artikel</a>
          <a href={href.skills(group.id)} class:active={route.name === 'skills'}>Fertigkeiten</a>
          <a href={href.manage(group.id)} class:active={route.name === 'manage'}>Gruppe verwalten</a>
        </nav>
      {/if}
    </div>
  </header>

  <main class="wide">
    {#if !allowed}
      <p class="error">Dieser Bereich ist nur für Spielleiter.</p>
    {:else}
      <!-- Seiten laden ihre Daten einmal beim Erzeugen: bei Gruppenwechsel per Link alles neu aufbauen -->
      {#key group.id}
        {#if route.name === 'manage'}
          <GmManage {group} />
        {:else if route.name === 'skills'}
          <GmSkills {group} />
        {:else if route.name === 'rules'}
          <Rules />
        {:else}
          <div class="split">
            <aside class="card vine-frame no-print">
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
  /* Gleiche Breite, Zentrierung und Seitenabstände wie main, damit Navigation und Inhalt bündig stehen */
  /* Alle Seiten einer Gruppe gleich breit (Platz für Ordnerbaum + Inhalt), auch Fertigkeiten/Verwalten */
  /* Seitenabstand --vine-gap: die Zweigrahmen ragen nach außen und dürfen nicht am Bildrand abgeschnitten werden */
  header { max-width: 90rem; margin: 0 auto; padding: var(--vine-gap) var(--vine-gap) 0; }
  main.wide { max-width: 90rem; padding-left: var(--vine-gap); padding-right: var(--vine-gap); }
  .bar { background: var(--surface); border-radius: var(--radius); }
  /* Abstand, damit sich die Rahmen von Navigation und Ordnerbaum nicht berühren */
  main { padding-top: calc(var(--vine-width) + 0.75rem); }
  .name { font-weight: 700; font-size: 1.1rem; text-decoration: none; margin-right: 1rem; }
  nav a { text-decoration: none; padding: 0.3rem 0.7rem; border-radius: var(--radius); color: var(--text); }
  nav a.active { background: var(--accent); color: var(--accent-text); }
  /* Unterpunkte: kleiner, aktiver Punkt nur unterstrichen - eine Ebene unter den Bereichen */
  .subnav { margin-top: 0.35rem; gap: 0.25rem; font-size: 0.9rem; width: max-content; max-width: 100%; }
  .subnav a { padding: 0.15rem 0.7rem; color: var(--muted); }
  .subnav a.active { background: none; color: var(--accent); font-weight: 600; text-decoration: underline; text-underline-offset: 0.3em; }
</style>
