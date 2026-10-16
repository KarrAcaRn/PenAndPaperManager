<script lang="ts">
  import {
    MAX_BODY_LENGTH,
    MAX_PATH_LENGTH,
    MAX_TITLE_LENGTH,
    SECTION_LABELS,
    VISIBILITIES,
    VISIBILITY_LABELS,
    accessibleSections,
    canAccessSection,
    canHaveSheet,
    emptySheet,
    emptySheetState,
    normalizeSheet,
    normalizeSheetState,
    type Article,
    type Folder,
    type Group,
    type Member,
    type Section,
    type SheetData,
    type SheetState,
    type Skill,
    type Visibility,
  } from '@pnp/shared';
  import { untrack } from 'svelte';
  import { ApiFailure, api } from '../lib/api.ts';
  import { notifyContentChanged } from '../lib/content.svelte.ts';
  import { href, navigate } from '../lib/router.svelte.ts';
  import { session } from '../lib/session.svelte.ts';
  import { createTask } from '../lib/task.svelte.ts';
  import { showNotice } from '../lib/notice.svelte.ts';
  import { sheetSavesSettled } from '../lib/sheetSaves.ts';
  import CharacterSheet from '../lib/CharacterSheet.svelte';

  let { group, section, path = '', id }: { group: Group; section: Section; path?: string; id?: number } = $props();

  /**
   * FATE-Bogen im Formular; gespeichert wird er erst mit "Speichern". version null: noch nicht auf dem Server.
   * Der Zustand (Stress, Konsequenztexte) wird nur angezeigt - geändert wird er in der Artikelansicht.
   */
  interface SheetDraft {
    data: SheetData;
    state: SheetState;
    version: number | null;
  }

  // Die Komponente wird pro Artikel neu erzeugt ({#key} in GroupLayout), Props dienen nur als Startwerte
  const initialForm = () => ({ section, path, title: '', bodyMd: '', visibility: 'private_gm' as Visibility });
  let form = $state(initialForm());
  let isAuthor = $state(true);
  // Besitzer (Autor) lässt sich hier an ein anderes Mitglied geben - wird nach dem Artikel gespeichert, siehe save()
  const me = untrack(() => session.user?.id ?? 0);
  let owner = $state(me);
  let savedOwner = $state(me);
  /** Mitglieder zur Auswahl; bleibt leer, wenn sie nicht laden - dann gibt es keine Auswahl */
  let members = $state<Member[]>([]);
  let membersFailed = $state(false);
  let ready = $state(false);
  let folders = $state<Folder[]>([]);
  /** Gespeicherter Stand des Artikels (nur beim Bearbeiten) */
  let article = $state<Article | null>(null);
  let sheet = $state<SheetDraft | null>(null);
  let skills = $state<Skill[]>([]);
  /** Vorhandener Bogen, den "Speichern" löschen soll ("Doch behalten" stellt ihn wieder her) */
  let removedSheet = $state<SheetDraft | null>(null);
  /** Jemand anderes hat den Bogen inzwischen bearbeitet - Speichern würde das überschreiben */
  let sheetConflict = $state(false);
  /** Vorhandener Bogen ließ sich nicht laden - Speichern bleibt gesperrt, sonst ginge er verloren */
  let sheetLoadFailed = $state(false);
  /** Bereich, in dem der Artikel gespeichert ist (für Abbrechen) */
  let savedSection = $state<Section>(untrack(() => section));
  /** Ordner beim Laden bzw. Speichern - unverändert schicken wir ihn nicht mit (siehe ArticleUpdate) */
  let savedPath = '';
  // Stand beim Laden bzw. Speichern - weicht das Formular davon ab, warnt das Schließen des Tabs.
  // Getrennt, weil "Bogen neu laden" nur den Bogen zurücksetzt, nicht den Text.
  let formBaseline = $state('');
  let sheetBaseline = $state('');
  const loading = createTask();
  const saving = createTask();
  const sheetTask = createTask();

  const formSnapshot = () => JSON.stringify({ form, owner });
  const sheetSnapshot = () => JSON.stringify({ sheet: sheet?.data ?? null, removed: removedSheet !== null });
  const dirty = $derived(ready && (formSnapshot() !== formBaseline || sheetSnapshot() !== sheetBaseline));

  async function loadSheet(articleId: number) {
    // Speichert die Ansicht diesen Bogen gerade noch (Stress angeklickt, dann "Bearbeiten"), erst danach laden
    await sheetSavesSettled(articleId);
    const [loaded, groupSkills] = await Promise.all([api.sheet(group.id, articleId), api.skills(group.id)]);
    const data = normalizeSheet(loaded.data);
    sheet = { data, state: normalizeSheetState(loaded.state, data), version: loaded.version };
    skills = groupSkills;
    sheetConflict = false;
  }

  /** Lädt den vorhandenen Bogen; scheitert das, bleibt der Artikel bearbeitbar, nur Speichern ist gesperrt */
  const reloadSheet = (articleId: number) =>
    sheetTask.run(async () => {
      try {
        await loadSheet(articleId);
        sheetLoadFailed = false;
      } catch (err) {
        sheetLoadFailed = sheet === null && removedSheet === null;
        throw err;
      }
      sheetBaseline = sheetSnapshot();
    });

  loading.run(async () => {
    if (id !== undefined) {
      const a = await api.article(group.id, id);
      if (!a.canEdit) throw new Error('Du darfst diesen Artikel nicht bearbeiten');
      form = { section: a.section, path: a.path, title: a.title, bodyMd: a.bodyMd, visibility: a.visibility };
      isAuthor = a.authorId === me;
      owner = savedOwner = a.authorId;
      article = a;
      savedSection = a.section;
      savedPath = a.path;
      if (a.hasSheet) reloadSheet(a.id);
    }
    formBaseline = formSnapshot();
    sheetBaseline = sheetSnapshot();
    ready = true;
  });
  untrack(() => api.members(group.id))
    .then((m) => (members = m))
    .catch(() => (membersFailed = true));

  const roleOf = (userId: number) => (userId === me ? group.role : members.find((m) => m.userId === userId)?.role);
  const ownerRole = $derived(roleOf(owner));
  /** Bisheriger Besitzer, falls er kein Mitglied mehr ist - sonst stünde die Auswahl leer da */
  const formerOwner = $derived(
    article && !members.some((m) => m.userId === savedOwner) ? { userId: savedOwner, email: article.authorEmail } : null,
  );
  const formerOwnerName = $derived(
    members.find((m) => m.userId === savedOwner)?.email ?? formerOwner?.email ?? 'Der bisherige Besitzer',
  );
  /** Was der bisherige Besitzer nach dem Wechsel noch darf (nur wenn ich ihm den Artikel wegnehme bzw. weitergebe) */
  const formerKeeps = $derived.by(() => {
    const role = roleOf(savedOwner) ?? 'player';
    if (form.visibility === 'public') return role === 'gm' ? 'edit' : 'see';
    if (form.visibility === 'private_gm' && role === 'gm') return 'edit';
    return 'none';
  });
  /** Was nach dem Speichern gilt: kann ich ihn noch sehen bzw. bearbeiten? */
  const keepsAccess = $derived.by(() => {
    if (owner === me) return 'edit';
    if (form.visibility === 'public') return group.role === 'gm' ? 'edit' : 'see';
    if (form.visibility === 'private_gm' && group.role === 'gm') return 'edit';
    return 'none';
  });

  // Fremde Artikel darf man weder auf "Privat" stellen noch in einen Bereich schieben,
  // den der Besitzer nicht sieht - der Server lehnt beides ab. Maßgeblich ist der gewählte Besitzer.
  // Gebe ich einen fremden Artikel weiter, speichere ich ihn noch unter dem bisherigen Besitzer - dann muss auch der
  // den Bereich sehen (der Server prüft das beim Speichern).
  const sections = $derived(
    accessibleSections(group.role).filter(
      (s) =>
        canAccessSection(ownerRole ?? 'player', s) &&
        (owner === me || savedOwner === me || canAccessSection(roleOf(savedOwner) ?? 'player', s)),
    ),
  );
  /** "Privat" nur für eigene Artikel - oder solche, die man gerade abgibt (der Wechsel kommt nach dem Speichern) */
  const privateAllowed = $derived(isAuthor || owner === me);
  // Wechselt der Besitzer so, dass "Privat" nicht mehr erlaubt ist, nicht stillschweigend gewählt lassen
  $effect(() => {
    if (form.visibility === 'private' && !privateAllowed) form.visibility = 'private_gm';
  });
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

  const cancelHref = $derived(id === undefined ? href.folder(group.id, section, path) : href.article(group.id, savedSection, id));

  /** Ungespeicherte Eingaben (Text oder Bogen) beim Schließen/Neuladen des Tabs nicht still verwerfen */
  function beforeUnload(event: BeforeUnloadEvent) {
    // Auch während des Speicherns: Artikel ggf. schon gespeichert, der Bogen noch nicht
    if (dirty || saving.busy) event.preventDefault();
  }

  /** Enter in einzeiligen Feldern des Bogens soll nicht gleich den ganzen Artikel speichern */
  function blockEnter(event: KeyboardEvent) {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
  }

  function addSheet() {
    if (removedSheet) {
      // Den vorhandenen Bogen zurückholen statt einen zweiten anzulegen
      sheet = removedSheet;
      removedSheet = null;
      return;
    }
    sheetTask.run(async () => {
      skills = await api.skills(group.id);
      sheet = { data: emptySheet(form.title), state: emptySheetState(), version: null };
    });
  }

  function removeSheet() {
    if (!sheet) return;
    if (sheet.version === null) {
      sheet = null;
      return;
    }
    if (!confirm('Den FATE-Bogen beim Speichern löschen? Alle Eintragungen gehen verloren.')) return;
    removedSheet = sheet;
    sheet = null;
  }

  async function saveSheet(articleId: number, draft: SheetDraft) {
    const data = $state.snapshot(draft.data) as SheetData;
    if (!data.name.trim()) data.name = form.title.trim();
    try {
      const saved =
        draft.version === null
          ? await api.createSheet(group.id, articleId, data, $state.snapshot(draft.state) as SheetState)
          : await api.saveSheet(group.id, articleId, data, draft.version);
      draft.version = saved.version;
    } catch (err) {
      const status = err instanceof ApiFailure ? err.status : 0;
      // 409: geändert (PUT) bzw. inzwischen von jemandem angelegt (POST) - neu laden zeigt den aktuellen Stand
      sheetConflict = status === 409;
      if (status === 404 && draft.version !== null) {
        draft.version = null; // anderswo gelöscht: erneutes Speichern legt ihn neu an
        throw new Error('Der Bogen wurde inzwischen gelöscht. Erneutes Speichern legt ihn mit deinen Eingaben neu an.');
      }
      throw err;
    }
  }

  function save(event: SubmitEvent) {
    event.preventDefault();
    saving.run(async () => {
      if (sheet && !canHaveSheet(form.section)) {
        throw new Error(`Im Bereich ${SECTION_LABELS[form.section]} gibt es keine FATE-Bögen – Bogen entfernen oder anderen Bereich wählen.`);
      }
      if (sheetLoadFailed) throw new Error('Der FATE-Bogen ist nicht geladen – bitte erst „Bogen neu laden“.');
      // Ein Artikel mit Bogen darf nicht in einen Bereich ohne Bögen: dann muss der Bogen vorher weg. Sonst erst
      // den Artikel speichern - scheitert das, ist der Bogen noch da.
      const deleteFirst = !canHaveSheet(form.section);
      // Übernehme ich einen fremden Artikel, zuerst den Besitzer wechseln: dann gelten beim Speichern meine Rechte
      // (z.B. "Privat"). Gebe ich ihn ab, erst ganz am Ende - sonst dürfte ich Text und Bogen nicht mehr speichern.
      let tookOver = false;
      if (id !== undefined && owner === me && owner !== savedOwner) {
        await api.setArticleAuthor(group.id, id, me);
        savedOwner = me;
        isAuthor = true;
        tookOver = true;
        if (article) article.authorId = me;
      }
      // Scheitert danach etwas, ist die Übernahme schon gespeichert - das soll die Meldung sagen
      try {
        await saveRest(deleteFirst);
      } catch (err) {
        if (tookOver) throw new Error(`${(err as Error).message} (Der Artikel gehört bereits dir.)`, { cause: err });
        throw err;
      }
    });
  }

  async function saveRest(deleteFirst: boolean) {
    /** Text, Bogen und ggf. Abgabe an einen anderen Besitzer speichern (Teil von save) */
    const deleteSheet = async () => {
      if (!removedSheet || !article) return;
      await api.deleteSheet(group.id, article.id);
      removedSheet = null;
    };
    if (deleteFirst) await deleteSheet();
    let saved: Article;
    try {
      if (id === undefined) saved = await api.createArticle(group.id, form);
      else {
        const { path: formPath, ...rest } = form;
        const moved = form.section !== savedSection || formPath !== savedPath;
        saved = await api.updateArticle(group.id, id, moved ? form : rest);
      }
    } catch (err) {
      if (deleteFirst && article) {
        throw new Error(`${(err as Error).message} (Der FATE-Bogen ist bereits entfernt.)`, { cause: err });
      }
      throw err;
    }
    savedSection = saved.section;
    savedPath = saved.path;
    formBaseline = formSnapshot(); // Text ist gespeichert, auch wenn danach der Bogen scheitert
    notifyContentChanged();
    if (!deleteFirst) {
      await deleteSheet().catch((err: Error) => {
        throw new Error(`Artikel gespeichert, der FATE-Bogen aber nicht entfernt: ${err.message}`, { cause: err });
      });
    }
    if (sheet && id === undefined) {
      // Scheitert nur der Bogen, ist der Artikel trotzdem angelegt: nicht im Formular bleiben (ein zweites
      // Speichern legte ihn doppelt an) - in der Artikelansicht lässt sich der Bogen nachholen.
      await saveSheet(saved.id, sheet).catch((err: Error) =>
        showNotice(`Artikel angelegt, der FATE-Bogen aber nicht (${err.message}). Er lässt sich unter „Bearbeiten“ nachholen.`),
      );
    } else if (sheet) {
      // Bleibt bei einem Fehler im Formular - der Artikel selbst ist schon gespeichert
      await saveSheet(saved.id, sheet).catch((err: Error) => {
        throw new Error(`Artikel gespeichert, der FATE-Bogen aber nicht: ${err.message}`, { cause: err });
      });
    }
    if (owner !== savedOwner) {
      try {
        const { article: after } = await api.setArticleAuthor(group.id, saved.id, owner);
        savedOwner = owner;
        if (!after) {
          // Gehört jetzt jemand anderem und ich sehe ihn nicht mehr: in seinen Ordner
          notifyContentChanged();
          formBaseline = formSnapshot();
          sheetBaseline = sheetSnapshot();
          navigate(href.folder(group.id, saved.section, saved.path));
          return;
        }
      } catch (err) {
        const message = `Artikel gespeichert, der Besitzer aber nicht geändert: ${(err as Error).message}`;
        // Neuer Artikel: trotzdem weiter (ein zweites Speichern legte ihn doppelt an), Besitzer per „Bearbeiten“ nachholen
        if (id !== undefined) throw new Error(message, { cause: err });
        showNotice(message);
      }
    }
    notifyContentChanged();
    formBaseline = formSnapshot();
    sheetBaseline = sheetSnapshot();
    navigate(href.article(group.id, saved.section, saved.id));
  }
</script>

<svelte:window onbeforeunload={beforeUnload} />

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
            <option value={v} disabled={v === 'private' && !privateAllowed}>{VISIBILITY_LABELS[v]}</option>
          {/each}
        </select>
      </label>
      {#if members.length > 0}
        <label>
          Besitzer
          <select bind:value={owner}>
            {#if formerOwner}
              <option value={formerOwner.userId}>{formerOwner.email} (kein Mitglied mehr)</option>
            {/if}
            {#each members as m (m.userId)}
              <!-- Nur wer den Bereich sieht, kann den Artikel besitzen (der bisherige bleibt wählbar) -->
              <option value={m.userId} disabled={m.userId !== savedOwner && !canAccessSection(m.role, form.section)}>
                {m.email}{m.userId === me ? ' (du)' : ''}
              </option>
            {/each}
          </select>
        </label>
      {:else if membersFailed}
        <p class="muted">Der Besitzer lässt sich gerade nicht ändern (Mitglieder nicht geladen).</p>
      {/if}
    </div>
    {#if owner !== savedOwner && savedOwner !== me && formerKeeps !== 'edit'}
      <p class="muted">
        {formerOwnerName}
        {formerKeeps === 'none' ? 'sieht den Artikel danach nicht mehr.' : 'kann den Artikel danach nicht mehr bearbeiten.'}
      </p>
    {/if}
    {#if owner !== savedOwner && keepsAccess !== 'edit'}
      <p class="muted">
        {keepsAccess === 'none'
          ? 'Nach dem Speichern gehört der Artikel dem neuen Besitzer – du siehst ihn dann nicht mehr.'
          : 'Nach dem Speichern gehört der Artikel dem neuen Besitzer – du kannst ihn dann nicht mehr bearbeiten.'}
      </p>
    {/if}

    <!-- Bogen vor dem Text, wie in der Artikelansicht. Er wird mit dem Artikel gespeichert;
         während des Speicherns gesperrt, damit nichts nach dem Absenden Eingegebene verloren geht. -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions (fängt nur Enter ab, keine eigene Bedienung) -->
    <fieldset class="sheet-area" disabled={saving.busy} onkeydown={blockEnter}>
    {#if sheet}
      <div class="row sheet-bar">
        <h2>FATE-Bogen</h2>
        <button type="button" class="danger" disabled={saving.busy} onclick={removeSheet}>Bogen entfernen</button>
      </div>
      {#if !canHaveSheet(form.section)}
        <p class="error">Im Bereich {SECTION_LABELS[form.section]} gibt es keine FATE-Bögen – zum Verschieben erst den Bogen entfernen.</p>
      {/if}
      {#if sheetConflict && article}
        {@const a = article}
        <p class="error">
          Der Bogen wurde inzwischen von jemand anderem bearbeitet. Neu laden verwirft deine Änderungen am Bogen.
          <button type="button" disabled={sheetTask.busy} onclick={() => reloadSheet(a.id)}>Bogen neu laden</button>
        </p>
      {/if}
      <p class="muted">Stress und Konsequenzen trägst du in der Artikelansicht ein, sie werden dort sofort gespeichert.</p>
      <CharacterSheet bind:data={sheet.data} bind:state={sheet.state} {skills} editable="data" />
    {:else if article?.hasSheet && !removedSheet && (sheetTask.busy || sheetLoadFailed)}
      {@const a = article}
      {#if sheetLoadFailed}
        <p class="error">
          Der FATE-Bogen konnte nicht geladen werden{sheetTask.error ? `: ${sheetTask.error}` : ''}.
          <button type="button" disabled={sheetTask.busy} onclick={() => reloadSheet(a.id)}>Bogen neu laden</button>
        </p>
      {:else}
        <p class="muted">Lade FATE-Bogen …</p>
      {/if}
    {:else if removedSheet}
      <p class="row muted">
        Der FATE-Bogen wird beim Speichern entfernt.
        <button type="button" onclick={addSheet}>Doch behalten</button>
      </p>
    {:else if canHaveSheet(form.section)}
      <p><button type="button" disabled={sheetTask.busy} onclick={addSheet}>FATE-Bogen hinzufügen</button></p>
    {/if}
    {#if sheetTask.error && !sheetLoadFailed}<p class="error">{sheetTask.error}</p>{/if}
    </fieldset>

    {#await editorModule}
      <p class="muted">Lade Editor …</p>
    {:then { default: MarkdownEditor }}
      <MarkdownEditor bind:value={form.bodyMd} label="Text" maxlength={MAX_BODY_LENGTH} placeholder="Schreib los …" />
    {:catch}
      <p class="error">Editor konnte nicht geladen werden. Bitte Seite neu laden.</p>
    {/await}

    {#if saving.error}<p class="error">{saving.error}</p>{/if}
    <div class="row actions">
      <button class="primary" disabled={saving.busy || sheetTask.busy}>Speichern</button>
      <a class="button" href={cancelHref}>Abbrechen</a>
    </div>
  </form>
{/if}

<style>
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: 0 1rem; }
  .actions { margin-top: 1rem; }
  .sheet-area { border: 0; padding: 0; margin: 0; min-width: 0; }
  .sheet-bar { margin: 0.5rem 0 1rem; }
  .sheet-bar h2 { margin: 0; font-size: 1.1rem; }
</style>
