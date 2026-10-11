<script lang="ts" module>
  /** Was rechts gerade angezeigt wird: ein Ordner oder ein Artikel */
  export type TreeSelection = { folder: string } | { article: number };
</script>

<script lang="ts">
  import {
    SECTION_LABELS,
    baseName,
    normalizePath,
    parentPath,
    pathPrefixes,
    type ArticleSummary,
    type Folder,
    type Group,
    type Section,
  } from '@pnp/shared';
  import { untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { api } from './api.ts';
  import { contentChanges } from './content.svelte.ts';
  import { href } from './router.svelte.ts';
  import { createTask } from './task.svelte.ts';

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
  const currentFolder = $derived.by(() => {
    if (!('folder' in current)) return null;
    try {
      return normalizePath(current.folder);
    } catch {
      return current.folder;
    }
  });
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
</script>

<nav class="tree" aria-label="Ordnerbaum">
  <a class="node root" href={href.folder(group.id, section)} aria-current={currentFolder === '' ? 'page' : undefined}>
    {SECTION_LABELS[section]}
  </a>
  {#if task.error}<p class="error">{task.error}</p>{/if}
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
          <a
            href={href.folder(group.id, section, folder.path)}
            aria-current={folder.path === currentFolder ? 'page' : undefined}
            onclick={() => expanded.add(folder.path)}><span aria-hidden="true">📁</span> {baseName(folder.path)}</a
          >
        </div>
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
            ><span aria-hidden="true">📄</span> {article.title}</a
          >
        </div>
      </li>
    {/each}
  </ul>
{/snippet}

<style>
  .tree { font-size: 0.95rem; }
  ul { list-style: none; margin: 0; padding: 0 0 0 0.9rem; }
  .tree > ul { padding-left: 0; }
  .node { display: flex; align-items: center; gap: 0.15rem; border-radius: var(--radius); }
  .node a { flex: 1; min-width: 0; padding: 0.15rem 0.35rem; text-decoration: none; color: var(--text); overflow-wrap: anywhere; }
  .node:hover { background: var(--bg); }
  .node.current, .root[aria-current='page'] { background: var(--accent); }
  .node.current a, .root[aria-current='page'] { color: var(--accent-text); }
  .root { display: block; font-weight: 700; padding: 0.15rem 0.35rem; margin-bottom: 0.25rem; text-decoration: none; color: var(--text); }
  .toggle { flex: none; width: 1.3rem; padding: 0; border: none; background: none; color: inherit; text-align: center; }
  .node.current .toggle { color: var(--accent-text); }
</style>
