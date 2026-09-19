<script lang="ts">
  import {
    MAX_BODY_LENGTH,
    MAX_PATH_LENGTH,
    MAX_TITLE_LENGTH,
    SECTION_LABELS,
    VISIBILITIES,
    VISIBILITY_LABELS,
    accessibleSections,
    type Folder,
    type Group,
    type Section,
    type Visibility,
  } from '@pnp/shared';
  import { api } from '../lib/api.ts';
  import { renderMarkdown } from '../lib/markdown.ts';
  import { href, navigate } from '../lib/router.svelte.ts';
  import { session } from '../lib/session.svelte.ts';
  import { createTask } from '../lib/task.svelte.ts';

  let { group, section, path = '', id }: { group: Group; section: Section; path?: string; id?: number } = $props();

  // Die Komponente wird pro Artikel neu erzeugt ({#key} in GroupLayout), Props dienen nur als Startwerte
  const initialForm = () => ({ section, path, title: '', bodyMd: '', visibility: 'private_gm' as Visibility });
  let form = $state(initialForm());
  let isAuthor = $state(true);
  let ready = $state(false);
  let folders = $state<Folder[]>([]);
  let preview = $state(false);
  const loading = createTask();
  const saving = createTask();

  loading.run(async () => {
    if (id !== undefined) {
      const a = await api.article(group.id, id);
      if (!a.canEdit) throw new Error('Du darfst diesen Artikel nicht bearbeiten');
      form = { section: a.section, path: a.path, title: a.title, bodyMd: a.bodyMd, visibility: a.visibility };
      isAuthor = a.authorId === session.user?.id;
    }
    ready = true;
  });

  // Fremde Artikel darf man weder auf "Privat" stellen noch in einen Bereich schieben,
  // den der Autor nicht sieht - der Server lehnt beides ab.
  const sections = $derived(isAuthor ? accessibleSections(group.role) : accessibleSections('player'));
  const sectionOptions = $derived(sections.includes(form.section) ? sections : [form.section, ...sections]);

  $effect(() => {
    let stale = false;
    api
      .folders(group.id, form.section)
      .then((f) => !stale && (folders = f))
      .catch(() => !stale && (folders = []));
    // Bei schnellem Bereichswechsel darf eine ältere Antwort die neuere nicht überschreiben
    return () => {
      stale = true;
    };
  });

  const cancelHref = $derived(id === undefined ? href.folder(group.id, section, path) : href.article(group.id, section, id));

  function save(event: SubmitEvent) {
    event.preventDefault();
    saving.run(async () => {
      const saved = id === undefined ? await api.createArticle(group.id, form) : await api.updateArticle(group.id, id, form);
      navigate(href.article(group.id, saved.section, saved.id));
    });
  }
</script>

<h1>{id === undefined ? 'Neuer Artikel' : 'Artikel bearbeiten'}</h1>

{#if loading.error}
  <p class="error">{loading.error}</p>
  <a class="button" href={cancelHref}>Zurück</a>
{:else if !ready}
  <p class="muted">Lade …</p>
{:else}
  <form onsubmit={save}>
    <label>
      Titel
      <input bind:value={form.title} required maxlength={MAX_TITLE_LENGTH} />
    </label>

    <div class="grid">
      <label>
        Bereich
        <select bind:value={form.section}>
          {#each sectionOptions as s}
            <option value={s}>{SECTION_LABELS[s]}</option>
          {/each}
        </select>
      </label>
      <label>
        Ordner
        <input bind:value={form.path} list="folder-options" placeholder="z.B. bar/foo – leer = oberste Ebene" maxlength={MAX_PATH_LENGTH} />
        <datalist id="folder-options">
          {#each folders as folder}<option value={folder.path}></option>{/each}
        </datalist>
      </label>
      <label>
        Sichtbarkeit
        <select bind:value={form.visibility}>
          {#each VISIBILITIES as v}
            <option value={v} disabled={v === 'private' && !isAuthor}>{VISIBILITY_LABELS[v]}</option>
          {/each}
        </select>
      </label>
    </div>

    <div class="row">
      <strong>Text (Markdown)</strong>
      <span class="spacer"></span>
      <button type="button" onclick={() => (preview = !preview)}>{preview ? 'Bearbeiten' : 'Vorschau'}</button>
    </div>
    {#if preview}
      <!-- renderMarkdown liefert durch DOMPurify bereinigtes HTML -->
      <div class="card markdown preview">{@html renderMarkdown(form.bodyMd)}</div>
    {:else}
      <textarea bind:value={form.bodyMd} maxlength={MAX_BODY_LENGTH} aria-label="Text (Markdown)"></textarea>
    {/if}

    {#if saving.error}<p class="error">{saving.error}</p>{/if}
    <div class="row actions">
      <button class="primary" disabled={saving.busy}>Speichern</button>
      <a class="button" href={cancelHref}>Abbrechen</a>
    </div>
  </form>
{/if}

<style>
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: 0 1rem; }
  .row { margin-bottom: 0.5rem; }
  .preview { min-height: 20rem; }
  .actions { margin-top: 1rem; }
</style>
