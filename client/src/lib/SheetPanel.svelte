<script lang="ts">
  import { emptySheet, type Article, type Group, type SheetData, type Skill } from '@pnp/shared';
  import { ApiFailure, api } from './api.ts';
  import { createTask } from './task.svelte.ts';
  import CharacterSheet from './CharacterSheet.svelte';

  // Lädt und speichert den FATE-Bogen eines Artikels; mit Bearbeitungsrecht wird automatisch gespeichert.
  let { group, article, onremoved }: { group: Group; article: Article; onremoved: () => void } = $props();

  const SAVE_DELAY_MS = 400;

  let data = $state<SheetData | null>(null);
  let skills = $state<Skill[]>([]);
  let savedAt = $state('');
  /** Jemand anderes hat den Bogen geändert - weiterspeichern würde dessen Stand überschreiben */
  let conflict = $state(false);
  /** Solange bzw. nachdem der Bogen entfernt wird, darf nichts mehr gespeichert werden */
  let removing = $state(false);
  const loading = createTask();
  const saving = createTask();

  // Version des zuletzt geladenen/gespeicherten Stands, siehe Sheet in shared
  let version = 0;
  /** gesetzt, solange ungespeicherte Änderungen auf ihr entprelltes Speichern warten */
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Änderungen, die während eines laufenden Speicherns dazukamen */
  let changedWhileSaving = false;

  const load = () =>
    loading.run(async () => {
      const [sheet, groupSkills] = await Promise.all([api.sheet(group.id, article.id), api.skills(group.id)]);
      // Felder der obersten Ebene, die ein älterer Bogen noch nicht kennt, mit den Vorgaben auffüllen
      data = { ...emptySheet(), ...sheet.data };
      version = sheet.version;
      skills = groupSkills;
      conflict = false;
    });
  load();

  function cancelPendingSave() {
    clearTimeout(timer);
    timer = undefined;
  }

  async function save() {
    cancelPendingSave();
    if (removing || conflict) return;
    // Nie zwei Speichervorgänge gleichzeitig: der zweite trüge noch die alte Version und liefe in einen Konflikt
    if (saving.busy) {
      changedWhileSaving = true;
      return;
    }
    changedWhileSaving = false;
    const ok = await saving.run(async () => {
      try {
        version = (await api.saveSheet(group.id, article.id, { data: $state.snapshot(data!), version })).version;
        savedAt = new Date().toLocaleTimeString('de-DE');
      } catch (err) {
        conflict = err instanceof ApiFailure && err.status === 409;
        throw err;
      }
    });
    if (ok && changedWhileSaving) await save();
  }

  function scheduleSave() {
    if (removing || conflict) return;
    cancelPendingSave();
    timer = setTimeout(save, SAVE_DELAY_MS);
  }

  // Beim Verlassen nichts verlieren: ausstehende Änderungen sofort speichern
  $effect(() => () => {
    if (timer !== undefined) save();
  });

  function remove() {
    if (!confirm('Den FATE-Bogen dieses Artikels löschen? Alle Eintragungen gehen verloren.')) return;
    cancelPendingSave();
    removing = true;
    saving.run(async () => {
      try {
        await api.deleteSheet(group.id, article.id);
      } catch (err) {
        removing = false;
        throw err;
      }
      onremoved();
    });
  }
</script>

{#if loading.error}<p class="error">{loading.error}</p>{/if}

{#if data}
  <div class="row toolbar no-print">
    <button onclick={() => window.print()}>Drucken / als PDF speichern</button>
    {#if article.canEdit}
      <button class="danger" disabled={saving.busy || removing} onclick={remove}>Bogen entfernen</button>
      <span class="muted" role="status">
        {#if conflict}
          <span class="error">Der Bogen wurde inzwischen von jemand anderem geändert. Deine letzten Eingaben sind nicht gespeichert.</span>
          <button disabled={loading.busy} onclick={load}>Neu laden</button>
        {:else if saving.error}<span class="error">Nicht gespeichert: {saving.error}</span>
        {:else if saving.busy}Speichere …
        {:else if savedAt}Gespeichert {savedAt}
        {:else}Änderungen werden automatisch gespeichert.{/if}
      </span>
    {/if}
  </div>
  <CharacterSheet bind:data {skills} readonly={!article.canEdit || removing || conflict} onchange={scheduleSave} />
{/if}

<style>
  .toolbar { margin: 1rem 0; }
</style>
