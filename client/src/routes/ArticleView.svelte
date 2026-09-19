<script lang="ts">
  import { VISIBILITY_LABELS, canHaveSheet, emptySheet, type Article, type Group } from '@pnp/shared';
  import { api } from '../lib/api.ts';
  import { notifyContentChanged } from '../lib/content.svelte.ts';
  import { renderMarkdown } from '../lib/markdown.ts';
  import { href, navigate } from '../lib/router.svelte.ts';
  import { createTask } from '../lib/task.svelte.ts';
  import Breadcrumb from '../lib/Breadcrumb.svelte';
  import SheetPanel from '../lib/SheetPanel.svelte';

  let { group, id }: { group: Group; id: number } = $props();

  let article = $state<Article | null>(null);
  const task = createTask();

  // Die Komponente wird pro Artikel neu erzeugt ({#key} in GroupLayout), daher einmaliges Laden
  task.run(async () => {
    article = await api.article(group.id, id);
  });

  function addSheet(a: Article) {
    task.run(async () => {
      await api.createSheet(group.id, a.id, emptySheet(a.title));
      a.hasSheet = true;
    });
  }

  function remove(a: Article) {
    if (!confirm(`Artikel "${a.title}" wirklich löschen?`)) return;
    task.run(async () => {
      await api.deleteArticle(group.id, a.id);
      notifyContentChanged();
      navigate(href.folder(group.id, a.section, a.path));
    });
  }
</script>

{#if task.error}<p class="error">{task.error}</p>{/if}

{#if article}
  {@const a = article}
  <div class="row top no-print">
    <Breadcrumb gid={group.id} section={a.section} path={a.path} />
    <span class="spacer"></span>
    {#if a.canEdit}
      {#if !a.hasSheet && canHaveSheet(a.section)}
        <button disabled={task.busy} onclick={() => addSheet(a)}>FATE-Bogen hinzufügen</button>
      {/if}
      <a class="button primary" href={href.edit(group.id, a.section, a.id)}>Bearbeiten</a>
      <button class="danger" disabled={task.busy} onclick={() => remove(a)}>Löschen</button>
    {/if}
  </div>

  <div class="row no-print">
    <h1>{a.title}</h1>
    <span class="badge {a.visibility}">{VISIBILITY_LABELS[a.visibility]}</span>
  </div>
  <p class="muted no-print">von {a.authorEmail} · zuletzt geändert {new Date(a.updatedAt + 'Z').toLocaleString('de-DE')}</p>

  {#if a.hasSheet}
    <SheetPanel {group} article={a} onremoved={() => (a.hasSheet = false)} />
  {/if}

  {#if a.bodyMd.trim() || !a.hasSheet}
    <!-- renderMarkdown liefert durch DOMPurify bereinigtes HTML -->
    <article class="card markdown no-print">{@html renderMarkdown(a.bodyMd)}</article>
  {/if}
{/if}

<style>
  .top { min-height: 2.4rem; }
  h1 { margin: 0.5rem 0; }
</style>
