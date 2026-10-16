<script lang="ts" module>
  /**
   * Was rechts gerade angezeigt wird: ein Ordner oder ein Artikel. newArticle: das Formular für einen neuen Artikel
   * in diesem Ordner ist offen - dann darf der Baum nicht wegnavigieren (ungespeicherte Eingaben).
   */
  export type TreeSelection = { folder: string; newArticle?: boolean } | { article: number };
</script>

<script lang="ts">
  import {
    MAX_SEGMENT_LENGTH,
    SECTION_LABELS,
    baseName,
    isWithin,
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
      let f: Folder[], a: ArticleSummary[];
      try {
        [f, a] = await Promise.all([api.folders(group.id, section), api.articles(group.id, section)]);
      } catch (err) {
        if (no !== requestNo) return; // überholte Anfrage: ihr Fehler zählt nicht mehr
        throw err;
      }
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

  // Drag & Drop: Ordner (mit Verwaltungsrecht) und Artikel (mit Bearbeitungsrecht) in einen anderen Ordner ziehen.
  // '' als Ziel ist die oberste Ebene (Bereichsname). Die Links im Baum sind nicht selbst ziehbar, sonst trüge der
  // Ziehvorgang deren URL (und ließe sich z.B. in den Editor fallen lassen) und auch gesperrte Einträge ließen sich ziehen.
  type Dragged = { kind: 'folder'; path: string } | { kind: 'article'; id: number; path: string };
  let dragged = $state<Dragged | null>(null);
  /** Ordner, über dem gerade etwas schwebt */
  let dropTarget = $state<string | null>(null);
  let expandTimer: ReturnType<typeof setTimeout> | undefined;
  /** Ordner, für den der Aufklapp-Timer läuft - damit kurzes Verlassen ihn nicht jedes Mal neu startet */
  let expandFor: string | null = null;
  const EXPAND_DELAY_MS = 700;
  $effect(() => () => clearTimeout(expandTimer));

  const canDrop = (target: string) => dragged !== null && !saving && canDropItem(dragged, target);

  function dragStart(event: DragEvent, item: Dragged, allowed: boolean, label: string) {
    if (!allowed || saving) {
      event.preventDefault();
      return;
    }
    menuFor = null;
    dragged = item;
    event.dataTransfer?.setData('text/plain', label);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function dragEnd() {
    dragged = null;
    dropTarget = null;
    clearTimeout(expandTimer);
    expandFor = null;
  }

  function dragOver(event: DragEvent, target: string) {
    if (!canDrop(target)) return;
    event.preventDefault();
    event.stopPropagation(); // nicht noch einmal im nav-Handler darunter
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dropTarget = target;
    // Länger über einem zugeklappten Ordner: aufklappen, damit man tiefer ablegen kann
    if (target !== '' && expandFor !== target) {
      clearTimeout(expandTimer);
      expandFor = target;
      expandTimer = setTimeout(() => expanded.add(target), EXPAND_DELAY_MS);
    }
  }

  /**
   * Alles im Baum, was kein gültiges Ziel ist (Artikel, Zwischenräume): Markierung weg. Fremde Ziehvorgänge
   * (z.B. eine Datei vom Desktop) werden hier abgefangen, sonst öffnete der Browser die Datei und verließe die Seite.
   */
  function navDragOver(event: DragEvent) {
    dropTarget = null;
    if (!dragged) event.preventDefault();
    if (!dragged && event.dataTransfer) event.dataTransfer.dropEffect = 'none';
  }
  function navDrop(event: DragEvent) {
    event.preventDefault();
    dragEnd();
  }
  function navDragLeave(event: DragEvent) {
    const into = event.relatedTarget;
    if (!(into instanceof Node && navEl?.contains(into))) dropTarget = null;
  }

  async function drop(event: DragEvent, target: string) {
    event.preventDefault();
    event.stopPropagation();
    const item = dragged;
    dragEnd();
    if (!item || saving || !canDropItem(item, target)) return;
    saving = true;
    actionError = '';
    try {
      if (item.kind === 'folder') {
        const moved = await api.renameFolder(group.id, section, item.path, joinPath(target, baseName(item.path)));
        const rebase = (path: string) => moved.path + path.slice(item.path.length);
        // Aufgeklappte Ordner bleiben aufgeklappt
        for (const path of [...expanded]) {
          if (isWithin(path, item.path)) {
            expanded.delete(path);
            expanded.add(rebase(path));
          }
        }
        // Lag die angezeigte Ordneransicht im verschobenen Ordner, mitwandern (nicht aus einem offenen Formular heraus)
        const follow = 'folder' in current && !current.newArticle;
        if (!destroyed && follow && currentFolder !== null && isWithin(currentFolder, item.path)) {
          navigate(href.folder(group.id, section, rebase(currentFolder)));
        }
      } else {
        await api.moveArticle(group.id, item.id, target);
      }
      if (target !== '') expanded.add(target);
      notifyContentChanged();
    } catch (err) {
      if (!destroyed) actionError = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  /** Nicht in sich selbst bzw. einen eigenen Unterordner, und nicht dorthin, wo es schon liegt */
  function canDropItem(item: Dragged, target: string): boolean {
    if (item.kind === 'article') return item.path !== target;
    return !isWithin(target, item.path) && parentPath(item.path) !== target;
  }
</script>

<svelte:window onclick={windowClick} onkeydown={windowKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<nav
  class="tree"
  aria-label="Ordnerbaum"
  bind:this={navEl}
  ondragover={navDragOver}
  ondragleave={navDragLeave}
  ondrop={navDrop}
>
  <!-- Ablageziel für Drag & Drop; ohne Maus verschiebt man über „Umbenennen“ in der Ordneransicht bzw. das Artikelformular -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="node root"
    class:current={currentFolder === ''}
    class:drop-target={dropTarget === ''}
    ondragover={(e) => dragOver(e, '')}
    ondrop={(e) => drop(e, '')}
  >
    <a href={href.folder(group.id, section)} draggable="false" aria-current={currentFolder === '' ? 'page' : undefined}>
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
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="node"
          class:current={folder.path === currentFolder}
          class:drop-target={dropTarget === folder.path}
          class:dragging={dragged?.kind === 'folder' && dragged.path === folder.path}
          draggable={folder.canManage && editing?.path !== folder.path}
          ondragstart={(e) =>
            dragStart(e, { kind: 'folder', path: folder.path }, folder.canManage && editing?.path !== folder.path, baseName(folder.path))}
          ondragend={dragEnd}
          ondragover={(e) => dragOver(e, folder.path)}
          ondrop={(e) => drop(e, folder.path)}
        >
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
              draggable="false"
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
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="node"
          class:current={article.id === currentArticle}
          class:dragging={dragged?.kind === 'article' && dragged.id === article.id}
          draggable={article.canEdit}
          ondragstart={(e) => dragStart(e, { kind: 'article', id: article.id, path: article.path }, article.canEdit, article.title)}
          ondragend={dragEnd}
        >
          <span class="toggle"></span>
          <a
            href={href.article(group.id, section, article.id)}
            draggable="false"
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
  .node { display: flex; align-items: center; gap: 0.15rem; border-radius: var(--border-radius); }
  .node a { flex: 1; min-width: 0; padding: 0.15rem 0.35rem; text-decoration: none; color: var(--color-text); overflow-wrap: anywhere; }
  .node:hover { background: var(--color-surface-muted); }
  .node.current { background: var(--color-accent); }
  .node.current a { color: var(--color-accent-text); }
  .root { font-weight: 700; margin-bottom: 0.25rem; }
  .root.current { background: var(--color-accent); }
  .root.current a { color: var(--color-accent-text); }
  .toggle { flex: none; width: 1.3rem; padding: 0; border: none; background: none; color: inherit; text-align: center; }
  .node.current .toggle { color: var(--color-accent-text); }

  /* Drag & Drop */
  .node[draggable='true'] { cursor: grab; }
  .node.dragging { opacity: 0.45; }
  .node.drop-target { outline: var(--outline-width) dashed var(--color-accent); outline-offset: calc(-1 * var(--outline-width)); background: var(--color-surface-muted); }
  .node.current.drop-target { background: var(--color-accent); }

  /* Werkzeuge am gewählten Ordner */
  .tools { flex: none; display: flex; align-items: center; gap: 0.1rem; padding-right: 0.15rem; font-weight: 400; }
  .icon {
    width: 1.5rem; height: 1.5rem; padding: 0.2rem; border: none; border-radius: var(--border-radius);
    background: none; color: var(--color-accent-text); display: flex; align-items: center; justify-content: center;
  }
  .icon:hover, .icon[aria-expanded='true'] { background: var(--color-accent-hover); }
  .icon svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .menu {
    position: fixed; z-index: 10; min-width: 8rem;
    display: flex; flex-direction: column; padding: 0.25rem;
    background: var(--color-surface); border: var(--border); border-radius: var(--border-radius);
    box-shadow: var(--shadow-popup);
  }
  .menu button { width: 100%; text-align: left; border: none; background: none; color: var(--color-text); padding: 0.3rem 0.5rem; border-radius: var(--border-radius); }
  .menu button:hover, .menu button:focus-visible { background: var(--color-surface-muted); }
  .name-field { flex: 1; min-width: 0; width: auto; padding: 0.1rem 0.35rem; font: inherit; font-weight: 400; }
  .indent { display: flex; padding: 0.15rem 0 0.15rem 1.45rem; }
  .tree > .name-field { display: block; width: 100%; margin-bottom: 0.25rem; }
</style>
