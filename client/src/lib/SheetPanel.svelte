<script lang="ts">
  import { untrack } from 'svelte';
  import { normalizeSheet, type Article, type Group, type SheetData, type Skill } from '@pnp/shared';
  import { ApiFailure, api } from './api.ts';
  import { createTask } from './task.svelte.ts';
  import { showNotice } from './notice.svelte.ts';
  import CharacterSheet from './CharacterSheet.svelte';
  import { sheetSavesSettled, trackSheetSave } from './sheetSaves.ts';

  // FATE-Bogen in der Artikelansicht: Mit Bearbeitungsrecht lässt sich hier nur der Zustand (Stress,
  // Konsequenzen) ändern - das wird sofort gespeichert. Alles andere bearbeitet ArticleEdit mit dem Artikel.
  let { group, article }: { group: Group; article: Article } = $props();

  const SAVE_DELAY_MS = 400;

  // Beim Erzeugen festhalten: ein Nachspeichern nach dem Abbau (z.B. Gruppenwechsel per Link) sähe sonst
  // schon die Props der nächsten Seite und ginge an die falsche Gruppe bzw. den falschen Artikel.
  const { gid, articleId, title } = untrack(() => ({ gid: group.id, articleId: article.id, title: article.title }));

  let data = $state<SheetData | null>(null);
  let skills = $state<Skill[]>([]);
  let savedAt = $state('');
  /** Jemand anderes hat den Bogen geändert - weiterspeichern würde dessen Stand überschreiben */
  let conflict = $state(false);
  const loading = createTask();
  const saving = createTask();

  // Version des zuletzt geladenen/gespeicherten Stands, siehe Sheet in shared
  let version = 0;
  /** Es gibt Eingaben, die der Server noch nicht hat (auch nach einem fehlgeschlagenen Speichern) */
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Komponente ist weg (Seitenwechsel) - Fehler beim Nachspeichern sähe sonst niemand */
  let destroyed = false;

  const load = () =>
    loading.run(async () => {
      // Speichert die vorige Seite (z.B. Bearbeiten) diesen Bogen gerade nach, erst danach laden
      await sheetSavesSettled(articleId);
      const [sheet, groupSkills] = await Promise.all([api.sheet(gid, articleId), api.skills(gid)]);
      data = normalizeSheet(sheet.data);
      version = sheet.version;
      skills = groupSkills;
      conflict = false;
      dirty = false;
    });
  load();

  function cancelPendingSave() {
    clearTimeout(timer);
    timer = undefined;
  }

  const save = (): Promise<void> => trackSheetSave(articleId, saveNow());

  async function saveNow() {
    cancelPendingSave();
    // Nie zwei Speichervorgänge gleichzeitig: der zweite trüge noch die alte Version und liefe in einen
    // Konflikt. Was währenddessen dazukommt, bleibt dirty und wird unten nachgereicht.
    if (conflict || saving.busy) return;
    dirty = false;
    const ok = await saving.run(async () => {
      try {
        version = (await api.saveSheet(gid, articleId, { data: $state.snapshot(data!), version })).version;
        savedAt = new Date().toLocaleTimeString('de-DE');
      } catch (err) {
        conflict = err instanceof ApiFailure && err.status === 409;
        dirty = true;
        if (destroyed) showNotice(`FATE-Bogen „${title}“: letzte Eingaben nicht gespeichert (${(err as Error).message})`);
        throw err;
      }
    });
    if (ok && dirty) await save();
  }

  function scheduleSave() {
    if (conflict) return;
    dirty = true;
    cancelPendingSave();
    timer = setTimeout(save, SAVE_DELAY_MS);
  }

  // Beim Verlassen nichts verlieren: Ungespeichertes sofort speichern - auch nach einem fehlgeschlagenen
  // Versuch. Läuft gerade ein Speichern, reicht es den Rest danach selbst nach.
  $effect(() => () => {
    destroyed = true;
    if (dirty && conflict) showNotice(`FATE-Bogen „${title}“: letzte Eingaben nicht gespeichert, er wurde inzwischen von jemand anderem geändert`);
    else if (dirty) save();
  });

  /** Tab schließen/neu laden: sofort speichern und, solange noch etwas offen ist, nachfragen */
  function beforeUnload(event: BeforeUnloadEvent) {
    if (!dirty && !saving.busy) return;
    if (dirty) save();
    event.preventDefault();
  }

</script>

<svelte:window onbeforeunload={beforeUnload} />

{#if loading.error}<p class="error">{loading.error}</p>{/if}

{#if data}
  <div class="row toolbar no-print">
    <button onclick={() => window.print()}>Drucken / als PDF speichern</button>
    {#if article.canEdit}
      <span class="muted" role="status">
        {#if conflict}
          <span class="error">Der Bogen wurde inzwischen von jemand anderem geändert. Deine letzten Eingaben sind nicht gespeichert.</span>
          <button disabled={loading.busy} onclick={load}>Neu laden</button>
        {:else if saving.error}<span class="error">Nicht gespeichert: {saving.error}</span>
        {:else if saving.busy}Speichere …
        {:else if savedAt}Gespeichert {savedAt}
        {:else}Stress und Konsequenzen werden automatisch gespeichert, alles andere unter „Bearbeiten“.{/if}
      </span>
    {/if}
  </div>
  <CharacterSheet
    bind:data
    {skills}
    editable={!article.canEdit || conflict ? 'none' : 'condition'}
    onchange={scheduleSave}
  />
{/if}

<style>
  .toolbar { margin: 1rem 0; }
</style>
