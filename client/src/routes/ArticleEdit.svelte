<script lang="ts">
  import {
    MAX_BODY_LENGTH,
    MAX_PATH_LENGTH,
    MAX_TITLE_LENGTH,
    SECTION_LABELS,
    VISIBILITIES,
    VISIBILITY_LABELS,
    accessibleSections,
    canHaveSheet,
    emptySheet,
    type Folder,
    type Group,
    type Section,
    type Visibility,
  } from '@pnp/shared';
  import { api } from '../lib/api.ts';
  import { notifyContentChanged } from '../lib/content.svelte.ts';
  import { href, navigate } from '../lib/router.svelte.ts';
  import { session } from '../lib/session.svelte.ts';
  import { createTask } from '../lib/task.svelte.ts';
  import { showNotice } from '../lib/notice.svelte.ts';

  let { group, section, path = '', id }: { group: Group; section: Section; path?: string; id?: number } = $props();

  // Die Komponente wird pro Artikel neu erzeugt ({#key} in GroupLayout), Props dienen nur als Startwerte
  const initialForm = () => ({ section, path, title: '', bodyMd: '', visibility: 'private_gm' as Visibility });
  let form = $state(initialForm());
  let isAuthor = $state(true);
  let ready = $state(false);
  let folders = $state<Folder[]>([]);
  let withSheet = $state(false);
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

  // Der Editor (TipTap/ProseMirror) ist groß und wird nur beim Bearbeiten gebraucht, daher eigenes Bundle
  const editorModule = import('../lib/MarkdownEditor.svelte');

  const cancelHref = $derived(id === undefined ? href.folder(group.id, section, path) : href.article(group.id, section, id));

  function save(event: SubmitEvent) {
    event.preventDefault();
    saving.run(async () => {
      const saved = id === undefined ? await api.createArticle(group.id, form) : await api.updateArticle(group.id, id, form);
      if (id === undefined && withSheet && canHaveSheet(saved.section)) {
        // Scheitert nur der Bogen, ist der Artikel trotzdem angelegt: nicht im Formular bleiben (ein zweites
        // Speichern legte ihn doppelt an) - in der Artikelansicht lässt sich der Bogen nachholen.
        await api
          .createSheet(group.id, saved.id, emptySheet(saved.title))
          .catch((err: Error) => showNotice(`Artikel angelegt, der FATE-Bogen aber nicht (${err.message}). Er lässt sich hier nachholen.`));
      }
      notifyContentChanged();
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

    {#if id === undefined && canHaveSheet(form.section)}
      <label class="check"><input type="checkbox" bind:checked={withSheet} /> Mit FATE-Bogen (Aspekte, Stunts, Fertigkeiten …)</label>
    {/if}

    {#await editorModule}
      <p class="muted">Lade Editor …</p>
    {:then { default: MarkdownEditor }}
      <MarkdownEditor bind:value={form.bodyMd} label="Text" maxlength={MAX_BODY_LENGTH} placeholder="Schreib los …" />
    {:catch}
      <p class="error">Editor konnte nicht geladen werden. Bitte Seite neu laden.</p>
    {/await}

    {#if saving.error}<p class="error">{saving.error}</p>{/if}
    <div class="row actions">
      <button class="primary" disabled={saving.busy}>Speichern</button>
      <a class="button" href={cancelHref}>Abbrechen</a>
    </div>
  </form>
{/if}

<style>
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: 0 1rem; }
  .actions { margin-top: 1rem; }
  .check { display: flex; align-items: center; gap: 0.5rem; font-weight: 400; }
  .check input { width: auto; margin: 0; }
</style>
