<script lang="ts">
  import {
    MAX_SEGMENT_LENGTH,
    SECTION_LABELS,
    VISIBILITY_LABELS,
    baseName,
    joinPath,
    normalizePath,
    parentPath,
    type ArticleSummary,
    type Folder,
    type Group,
    type Section,
  } from '@pnp/shared';
  import { api } from '../lib/api.ts';
  import { href, navigate } from '../lib/router.svelte.ts';
  import { createTask } from '../lib/task.svelte.ts';
  import Breadcrumb from '../lib/Breadcrumb.svelte';

  let { group, section, path: rawPath }: { group: Group; section: Section; path: string } = $props();

  // Von Hand getippte oder eingefügte Links in dieselbe Form bringen, die der Server liefert.
  // Ungültige Pfade bleiben roh und enden als "Ordner gibt es nicht".
  const path = $derived.by(() => {
    try {
      return normalizePath(rawPath);
    } catch {
      return rawPath;
    }
  });

  let folders = $state<Folder[]>([]);
  let articles = $state<ArticleSummary[]>([]);
  let loaded = $state(false);
  let newFolder = $state<string | null>(null);
  const task = createTask();

  const subfolders = $derived(folders.filter((f) => parentPath(f.path) === path));
  const missing = $derived(path !== '' && !folders.some((f) => f.path === path) && articles.length === 0);

  async function load() {
    [folders, articles] = await Promise.all([api.folders(group.id, section), api.articles(group.id, section, path)]);
    loaded = true;
  }
  task.run(load);

  /** Aktion ausführen und danach die Ansicht aktualisieren */
  const runAndReload = (action: () => Promise<unknown>) =>
    task.run(async () => {
      await action();
      await load();
    });

  function createFolder(event: SubmitEvent) {
    event.preventDefault();
    const name = (newFolder ?? '').trim();
    if (!name) return;
    runAndReload(async () => {
      await api.createFolder(group.id, section, joinPath(path, name));
      newFolder = null;
    });
  }

  function rename(folder: Folder) {
    const name = prompt('Neuer Name (mit "/" lässt sich der Ordner auch verschieben):', folder.path);
    if (!name || name === folder.path) return;
    runAndReload(() => api.renameFolder(group.id, section, folder.path, name));
  }

  function remove(folder: Folder) {
    if (!confirm(`Ordner "${baseName(folder.path)}" löschen?`)) return;
    runAndReload(() => api.deleteFolder(group.id, section, folder.path));
  }
</script>

<div class="row head">
  <Breadcrumb gid={group.id} {section} {path} />
  <span class="spacer"></span>
  <button onclick={() => (newFolder = '')}>Neuer Ordner</button>
  <a class="button primary" href={href.newArticle(group.id, section, path)}>Neuer Artikel</a>
</div>

{#if task.error}<p class="error">{task.error}</p>{/if}

{#if newFolder !== null}
  <form class="row card new-folder" onsubmit={createFolder}>
    <!-- svelte-ignore a11y_autofocus -->
    <input bind:value={newFolder} placeholder="Ordnername" maxlength={MAX_SEGMENT_LENGTH} autofocus />
    <button class="primary">Anlegen</button>
    <button type="button" onclick={() => (newFolder = null)}>Abbrechen</button>
  </form>
{/if}

{#if !loaded}
  {#if task.busy}<p class="muted">Lade …</p>{/if}
{:else if missing}
  <p class="muted">Diesen Ordner gibt es nicht (mehr).</p>
  <button onclick={() => navigate(href.folder(group.id, section))}>Zurück zu {SECTION_LABELS[section]}</button>
{:else if subfolders.length === 0 && articles.length === 0}
  <p class="muted">Hier ist noch nichts. Lege einen Artikel oder Ordner an.</p>
{:else}
  <ul class="list card">
    {#each subfolders as folder (folder.path)}
      <li>
        <span aria-hidden="true">📁</span>
        <a class="title" href={href.folder(group.id, section, folder.path)}>{baseName(folder.path)}</a>
        <span class="spacer"></span>
        {#if folder.canManage}
          <button class="link" onclick={() => rename(folder)}>Umbenennen</button>
          <button class="link" onclick={() => remove(folder)}>Löschen</button>
        {/if}
      </li>
    {/each}
    {#each articles as article (article.id)}
      <li>
        <span aria-hidden="true">📄</span>
        <a class="title" href={href.article(group.id, section, article.id)}>{article.title}</a>
        <span class="badge {article.visibility}">{VISIBILITY_LABELS[article.visibility]}</span>
        <span class="spacer"></span>
        <span class="muted">{article.authorEmail}</span>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .head { margin-bottom: 1rem; font-size: 1.2rem; }
  .head > :global(:not(nav)) { font-size: 1rem; }
  .new-folder { margin-bottom: 1rem; }
  .new-folder input { flex: 1; width: auto; }
</style>
