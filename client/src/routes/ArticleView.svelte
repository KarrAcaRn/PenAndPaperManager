<script lang="ts">
  import { VISIBILITY_LABELS, type Article, type Group } from '@pnp/shared';
  import { api } from '../lib/api.ts';
  import { renderMarkdown } from '../lib/markdown.ts';
  import { href, navigate } from '../lib/router.svelte.ts';
  import { createTask } from '../lib/task.svelte.ts';
  import Breadcrumb from '../lib/Breadcrumb.svelte';

  let { group, id }: { group: Group; id: number } = $props();

  let article = $state<Article | null>(null);
  const task = createTask();

  // Die Komponente wird pro Artikel neu erzeugt ({#key} in GroupLayout), daher einmaliges Laden
  task.run(async () => {
    article = await api.article(group.id, id);
  });

  function remove(a: Article) {
    if (!confirm(`Artikel "${a.title}" wirklich löschen?`)) return;
    task.run(async () => {
      await api.deleteArticle(group.id, a.id);
      navigate(href.folder(group.id, a.section, a.path));
    });
  }
</script>

{#if task.error}<p class="error">{task.error}</p>{/if}

{#if article}
  {@const a = article}
  <Breadcrumb gid={group.id} section={a.section} path={a.path} />

  <div class="row">
    <h1>{a.title}</h1>
    <span class="badge {a.visibility}">{VISIBILITY_LABELS[a.visibility]}</span>
    <span class="spacer"></span>
    {#if a.canEdit}
      <a class="button" href={href.edit(group.id, a.section, a.id)}>Bearbeiten</a>
      <button class="danger" disabled={task.busy} onclick={() => remove(a)}>Löschen</button>
    {/if}
  </div>
  <p class="muted">von {a.authorEmail} · zuletzt geändert {new Date(a.updatedAt + 'Z').toLocaleString('de-DE')}</p>

  <!-- renderMarkdown liefert durch DOMPurify bereinigtes HTML -->
  <article class="card markdown">{@html renderMarkdown(a.bodyMd)}</article>
{/if}

<style>
  h1 { margin: 0.5rem 0; }
</style>
