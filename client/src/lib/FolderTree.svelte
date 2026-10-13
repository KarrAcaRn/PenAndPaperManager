<script lang="ts" module>
  /** Was rechts gerade angezeigt wird: ein Ordner oder ein Artikel */
  export type TreeSelection = { folder: string } | { article: number };
</script>

<script lang="ts">
  import {
    MAX_SEGMENT_LENGTH,
    SECTION_LABELS,
    baseName,
    joinPath,
    normalizePathOrRaw,
    parentPath,
    pathPrefixes,
    type ArticleSummary,
    type Folder,
    type Group,
    type Section,
  } from '@pnp/shared';
  import { tick, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { api } from './api.ts';
  import { contentChanges, notifyContentChanged } from './content.svelte.ts';
  import { href, navigate } from './router.svelte.ts';
  import { createTask } from './task.svelte.ts';
  import ArticleIcon from './ArticleIcon.svelte';

  let { group, section, current }: { group: Group; section: Section; current: TreeSelection } = $props();

  let folders = $state<Folder[]>([]);
  let articles = $state<ArticleSummary[]>([]);
  let loaded = $state(false);
  const expanded = new SvelteSet<string>();
  const task = createTask();

  const byName = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

  function groupBy<T>(items: T[], key: (item: T) => string, name: (item: T) => string): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const item of [...items].sort((a, b) => byName.compare(name(a), name(b)))) {
      const list = map.get(key(item)) ?? [];
      list.push(item);
      map.set(key(item), list);
    }
    return map;
  }

  const childFolders = $derived(groupBy(folders, (f) => parentPath(f.path), (f) => baseName(f.path)));
  const childArticles = $derived(groupBy(articles, (a) => a.path, (a) => a.title));
  const hasChildren = (path: string) => childFolders.has(path) || childArticles.has(path);

  const currentArticle = $derived('article' in current ? current.article : null);
  const currentFolder = $derived('folder' in current ? normalizePathOrRaw(current.folder) : null);
  /** Ordner, der aufgeklappt sein muss, damit die Auswahl sichtbar ist */
  const revealPath = $derived(currentFolder ?? articles.find((a) => a.id === currentArticle)?.path ?? '');

  $effect(() => {
    const prefixes = pathPrefixes(revealPath);
    untrack(() => prefixes.forEach((prefix) => expanded.add(prefix)));
  });

  // Neu laden nach Änderungen; veraltete Antworten verwerfen, falls schneller nacheinander geändert wurde
  let requestNo = 0;
  $effect(() => {
    void contentChanges.version;
    const no = ++requestNo;
    task.run(async () => {
      const [f, a] = await Promise.all([api.folders(group.id, section), api.articles(group.id, section)]);
      if (no !== requestNo) return;
      folders = f;
      articles = a;
      loaded = true;
    });
  });

  function toggle(path: string) {
    if (expanded.has(path)) expanded.delete(path);
    else expanded.add(path);
  }

  // Werkzeuge am gewählten Ordner: Stift (umbenennen) und Plus (Unterordner oder Artikel anlegen)
  let navEl = $state<HTMLElement>();
  /** Ordner, dessen Plus-Menü offen ist */
  let menuFor = $state<string | null>(null);
  /**
   * Lage des Menüs: fest am Fenster, weil der Baum scrollt und ein darin liegendes Menü abschneiden würde.
   * Reicht der Platz unter dem Knopf nicht, klappt es nach oben.
   */
  let menuPos = $state<{ top?: number; bottom?: number; right: number }>({ right: 0 });
  const MENU_HEIGHT_PX = 90;

  /** Eingabefeld im Baum: Ordner umbenennen oder Unterordner anlegen */
  let editing = $state<{ kind: 'rename' | 'create'; path: string } | null>(null);
  let editName = $state('');
  let saving = $state(false);
  let actionError = $state('');
  let destroyed = false;
  $effect(() => () => {
    destroyed = true;
  });

  // Andere Auswahl (auch per Zurück im Browser): offenes Menü, Eingabefeld und Fehler gehören zum alten Ordner
  $effect(() => {
    void currentFolder;
    void currentArticle;
    untrack(() => {
      menuFor = null;
      editing = null;
      actionError = '';
    });
  });

  const toolButton = (selector: string) => navEl?.querySelector<HTMLElement>(`.node.current ${selector}`);

  function toggleMenu(path: string, button: HTMLElement) {
    if (menuFor === path) {
      menuFor = null;
      return;
    }
    const rect = button.getBoundingClientRect();
    const right = document.documentElement.clientWidth - rect.right;
    menuPos =
      window.innerHeight - rect.bottom < MENU_HEIGHT_PX
        ? { bottom: window.innerHeight - rect.top + 4, right }
        : { top: rect.bottom + 4, right };
    menuFor = path;
  }

  function closeMenu() {
    menuFor = null;
    toolButton('.tree-add > button')?.focus();
  }

  function startRename(path: string) {
    menuFor = null;
    actionError = '';
    editing = { kind: 'rename', path };
    editName = baseName(path);
  }

  function startCreate(path: string) {
    menuFor = null;
    actionError = '';
    if (path !== '') expanded.add(path);
    editing = { kind: 'create', path };
    editName = '';
  }

  function newArticle(path: string) {
    menuFor = null;
    navigate(href.newArticle(group.id, section, path));
  }

  /** Eingabe schließen, Fokus zurück an den gewählten Ordner (sonst landet er im Nichts) */
  async function cancelEdit() {
    const kind = editing?.kind;
    editing = null;
    actionError = '';
    await tick();
    toolButton(kind === 'rename' ? '.icon.rename' : '.tree-add > button')?.focus();
  }

  /** Nur Enter speichert (Verlassen des Felds bricht ab); leer oder unverändert bricht ebenfalls ab */
  async function commit() {
    if (!editing || saving) return;
    const current = editing;
    const name = editName.trim().normalize('NFC');
    if (!name || (current.kind === 'rename' && name === baseName(current.path).normalize('NFC'))) {
      cancelEdit();
      return;
    }
    if (name.includes('/')) {
      actionError = 'Ein Ordnername darf kein „/“ enthalten.';
      return;
    }
    saving = true;
    actionError = '';
    try {
      const saved =
        current.kind === 'rename'
          ? await api.renameFolder(group.id, section, current.path, joinPath(parentPath(current.path), name))
          : await api.createFolder(group.id, section, joinPath(current.path, name));
      notifyContentChanged();
      // Inzwischen abgebrochen, woanders hin gewechselt oder Baum abgebaut: dann nicht mehr springen
      if (destroyed || editing !== current) return;
      editing = null;
      // Zum (neuen) Ordner: die Ansicht rechts wird dabei frisch geladen
      navigate(href.folder(group.id, section, saved.path));
    } catch (err) {
      if (editing === current) actionError = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  /** Klick daneben bricht ab - ohne den Fokus umzulenken, der Nutzer hat ja woanders hingeklickt */
  function blurEdit() {
    if (saving) return;
    editing = null;
    actionError = '';
  }

  function editKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      cancelEdit();
    }
  }

  /** Plus-Menü schließt bei Klick daneben und mit Escape */
  function windowClick(event: MouseEvent) {
    if (menuFor === null) return;
    const inside = event.target instanceof Node && navEl?.querySelector('.tree-add')?.contains(event.target);
    if (!inside) menuFor = null;
  }
  function windowKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || menuFor === null) return;
    event.stopPropagation();
    closeMenu();
  }

  // Beim Scrollen (auch im Baum selbst) stünde das fest platzierte Menü neben seinem Knopf - also schließen
  $effect(() => {
    if (menuFor === null) return;
    const close = () => (menuFor = null);
    window.addEventListener('scroll', close, { capture: true, once: true });
    window.addEventListener('resize', close, { once: true });
    return () => {
      window.removeEventListener('scroll', close, { capture: true });
      window.removeEventListener('resize', close);
    };
  });
</script>

<svelte:window onclick={windowClick} onkeydown={windowKeydown} />

<nav class="tree" aria-label="Ordnerbaum" bind:this={navEl}>
  <div class="node root" class:current={currentFolder === ''}>
    <a href={href.folder(group.id, section)} aria-current={currentFolder === '' ? 'page' : undefined}>
      {SECTION_LABELS[section]}
    </a>
    {#if currentFolder === ''}{@render tools('', SECTION_LABELS[section], false)}{/if}
  </div>
  {#if editing?.kind === 'create' && editing.path === ''}{@render nameField('Neuer Ordner')}{/if}
  {#if task.error}<p class="error">{task.error}</p>{/if}
  {#if actionError}<p class="error">{actionError}</p>{/if}
  {#if loaded}
    {@render branch('')}
  {:else if task.busy}
    <p class="muted">Lade …</p>
  {/if}
</nav>

{#snippet branch(parent: string)}
  <ul>
    {#each childFolders.get(parent) ?? [] as folder (folder.path)}
      {@const open = expanded.has(folder.path)}
      <li>
        <div class="node" class:current={folder.path === currentFolder}>
          {#if hasChildren(folder.path)}
            <button
              class="toggle"
              aria-expanded={open}
              aria-label={`${baseName(folder.path)} ${open ? 'zuklappen' : 'aufklappen'}`}
              onclick={() => toggle(folder.path)}>{open ? '▾' : '▸'}</button
            >
          {:else}
            <span class="toggle"></span>
          {/if}
          {#if editing?.kind === 'rename' && editing.path === folder.path}
            {@render nameField(`${baseName(folder.path)} umbenennen`)}
          {:else}
            <a
              href={href.folder(group.id, section, folder.path)}
              aria-current={folder.path === currentFolder ? 'page' : undefined}
              onclick={() => expanded.add(folder.path)}><span aria-hidden="true">📁</span> {baseName(folder.path)}</a
            >
            {#if folder.path === currentFolder}{@render tools(folder.path, baseName(folder.path), folder.canManage)}{/if}
          {/if}
        </div>
        {#if editing?.kind === 'create' && editing.path === folder.path}
          <div class="indent">{@render nameField(`Neuer Ordner in ${baseName(folder.path)}`)}</div>
        {/if}
        {#if open}{@render branch(folder.path)}{/if}
      </li>
    {/each}
    {#each childArticles.get(parent) ?? [] as article (article.id)}
      <li>
        <div class="node" class:current={article.id === currentArticle}>
          <span class="toggle"></span>
          <a
            href={href.article(group.id, section, article.id)}
            aria-current={article.id === currentArticle ? 'page' : undefined}
            ><ArticleIcon {article} /> {article.title}</a
          >
        </div>
      </li>
    {/each}
  </ul>
{/snippet}

{#snippet tools(path: string, name: string, canRename: boolean)}
  <span class="tools">
    {#if canRename}
      <button class="icon rename" title="Umbenennen" aria-label="{name} umbenennen" onclick={() => startRename(path)}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11 2.5 13.5 5 6 12.5H3.5V10Z M9.5 4 12 6.5" /></svg>
      </button>
    {/if}
    <span class="tree-add">
      <button
        class="icon"
        title="Neu …"
        aria-label="In {name} anlegen"
        aria-controls="tree-add-menu"
        aria-expanded={menuFor === path}
        onclick={(event) => toggleMenu(path, event.currentTarget)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
      </button>
      {#if menuFor === path}
        <!-- Einfaches Aufklappmenü (Disclosure): zwei Knöpfe, per Tab erreichbar -->
        <span
          class="menu"
          id="tree-add-menu"
          style:top={menuPos.top === undefined ? null : `${menuPos.top}px`}
          style:bottom={menuPos.bottom === undefined ? null : `${menuPos.bottom}px`}
          style:right="{menuPos.right}px"
        >
          <button onclick={() => startCreate(path)}><span aria-hidden="true">📁</span> Ordner</button>
          <button onclick={() => newArticle(path)}><span aria-hidden="true">📄</span> Artikel</button>
        </span>
      {/if}
    </span>
  </span>
{/snippet}

{#snippet nameField(label: string)}
  <!-- svelte-ignore a11y_autofocus -->
  <input
    class="name-field"
    aria-label={label}
    title="Enter speichert, Escape bricht ab"
    placeholder="Ordnername – Enter speichert"
    maxlength={MAX_SEGMENT_LENGTH}
    readonly={saving}
    bind:value={editName}
    onkeydown={editKeydown}
    onblur={blurEdit}
    autofocus
  />
{/snippet}

<style>
  .tree { font-size: 0.95rem; }
  ul { list-style: none; margin: 0; padding: 0 0 0 0.9rem; }
  .tree > ul { padding-left: 0; }
  .node { display: flex; align-items: center; gap: 0.15rem; border-radius: var(--radius); }
  .node a { flex: 1; min-width: 0; padding: 0.15rem 0.35rem; text-decoration: none; color: var(--text); overflow-wrap: anywhere; }
  .node:hover { background: var(--bg); }
  .node.current { background: var(--accent); }
  .node.current a { color: var(--accent-text); }
  .root { font-weight: 700; margin-bottom: 0.25rem; }
  .root.current { background: var(--accent); }
  .root.current a { color: var(--accent-text); }
  .toggle { flex: none; width: 1.3rem; padding: 0; border: none; background: none; color: inherit; text-align: center; }
  .node.current .toggle { color: var(--accent-text); }

  /* Werkzeuge am gewählten Ordner */
  .tools { flex: none; display: flex; align-items: center; gap: 0.1rem; padding-right: 0.15rem; font-weight: 400; }
  .icon {
    width: 1.5rem; height: 1.5rem; padding: 0.2rem; border: none; border-radius: var(--radius);
    background: none; color: var(--accent-text); display: flex; align-items: center; justify-content: center;
  }
  .icon:hover, .icon[aria-expanded='true'] { background: rgba(255, 255, 255, 0.2); }
  .icon svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .menu {
    position: fixed; z-index: 10; min-width: 8rem;
    display: flex; flex-direction: column; padding: 0.25rem;
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  }
  .menu button { width: 100%; text-align: left; border: none; background: none; color: var(--text); padding: 0.3rem 0.5rem; border-radius: var(--radius); }
  .menu button:hover, .menu button:focus-visible { background: var(--bg); }
  .name-field { flex: 1; min-width: 0; width: auto; padding: 0.1rem 0.35rem; font: inherit; font-weight: 400; }
  .indent { display: flex; padding: 0.15rem 0 0.15rem 1.45rem; }
  .tree > .name-field { display: block; width: 100%; margin-bottom: 0.25rem; }
</style>
