<script lang="ts">
  import { tick } from 'svelte';
  import { MAX_EFFECT_ENTRIES, type EffectList, type EffectListPlayer } from '../effectList.svelte.ts';
  import type { BoardSound } from '../soundboard.ts';

  // Effekt-Liste („Szene“) wie in der Referenz: Einträge starten bei Lautstärke 0 in Schleife und werden per Regler
  // eingeblendet; je Eintrag Start/Stopp, Schleife, Entfernen. Umsortieren per Drag & Drop nur am Griff (die Zeile
  // trägt Regler und Knöpfe, Referenz `bindEffectDrag`) oder per Pfeil hoch/runter auf dem Griff.

  interface Props {
    list: EffectList;
    effects: EffectListPlayer;
    /** alle bekannten Sounds nach key – die Liste speichert nur den key */
    soundsByKey: ReadonlyMap<string, BoardSound>;
  }

  let { list, effects, soundsByKey }: Props = $props();

  /** Zeile, deren Griff gedrückt ist – nur sie ist ziehbar */
  let armed = $state<string | null>(null);
  /** ID des Eintrags, der gerade gezogen wird (nicht der Index: die Liste kann sich währenddessen ändern) */
  let dragId = $state<string | null>(null);
  let listEl = $state<HTMLOListElement | null>(null);

  /** eigener Typ beim Ziehen, damit Textfelder, die Upload-Fläche und die Playlisten die Zeile nicht annehmen */
  const DRAG_TYPE = 'application/x-pnp-effect-entry';
  const indexOf = (id: string) => list.entries.findIndex((e) => e.id === id);

  /** verschiebt einen Eintrag an die Stelle eines anderen (Referenz `movePlaylistItem` mit IDs) */
  function moveTo(fromId: string, toIndex: number): void {
    const from = indexOf(fromId);
    if (from === -1 || toIndex < 0 || toIndex >= list.entries.length) return;
    effects.move(from, toIndex);
  }

  function onDragStart(event: DragEvent, id: string): void {
    // nur am Griff: ein Ziehen, das woanders in der Zeile beginnt (Regler, Text), verschiebt nichts
    if (armed !== id) return;
    dragId = id;
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(DRAG_TYPE, id);
  }

  function onDragOver(event: DragEvent): void {
    if (dragId === null) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  function onDrop(event: DragEvent, targetId: string): void {
    if (dragId === null) return;
    event.preventDefault();
    moveTo(dragId, indexOf(targetId));
    endDrag();
  }

  function endDrag(): void {
    dragId = null;
    armed = null;
  }

  /** Pfeil hoch/runter auf dem Griff verschiebt den Eintrag; der Griff behält den Fokus */
  async function onHandleKeydown(event: KeyboardEvent, id: string): Promise<void> {
    const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (step === 0) return;
    // nicht zusätzlich die Musik-Lautstärke (Pfeiltasten des Soundboards) ändern
    event.preventDefault();
    event.stopPropagation();
    moveTo(id, indexOf(id) + step);
    await tick();
    [...(listEl?.querySelectorAll<HTMLLIElement>('li') ?? [])].find((li) => li.dataset.id === id)?.querySelector<HTMLElement>('.handle')?.focus();
  }
</script>

<!-- wie `ensureDragDisarm` der Referenz: Loslassen ohne Ziehen macht die Zeile wieder unziehbar -->
<svelte:window onmouseup={() => (armed = null)} />

<section class="effect-list card" aria-labelledby="sb-effects">
  <div class="row">
    <h2 id="sb-effects">Effekt-Liste</h2>
    <span class="muted">{list.entries.length > 0 ? `${list.entries.length} Effekt${list.entries.length === 1 ? '' : 'e'}` : ''}</span>
  </div>

  {#if list.full}<p class="muted">Die Effekt-Liste ist voll (höchstens {MAX_EFFECT_ENTRIES} Effekte).</p>{/if}

  {#if list.entries.length === 0}
    <p class="muted">Noch keine Effekte. Füge sie über „+“ auf einer Effekt-Kachel hinzu – sie starten bei Lautstärke 0 in Schleife, mit dem Regler blendest du sie ein.</p>
  {:else}
    <ol class="entries" aria-label="Effekte der Effekt-Liste" bind:this={listEl}>
      {#each list.entries as entry (entry.id)}
        {@const sound = soundsByKey.get(entry.sound)}
        {@const title = sound?.title ?? entry.title}
        {@const state = effects.state(entry.id)}
        {@const message = effects.error(entry.id)}
        <li
          data-id={entry.id}
          class:playing={state === 'playing'}
          class:dragging={dragId === entry.id}
          draggable={armed === entry.id ? 'true' : 'false'}
          ondragstart={(e) => onDragStart(e, entry.id)}
          ondragover={onDragOver}
          ondrop={(e) => onDrop(e, entry.id)}
          ondragend={endDrag}
        >
          <div class="line">
            <!-- kein <button>: aus Knöpfen heraus beginnt manch ein Browser (Firefox) kein Ziehen der Zeile -->
            <span
              class="handle"
              role="button"
              tabindex="0"
              aria-label="„{title}“ verschieben"
              aria-keyshortcuts="ArrowUp ArrowDown"
              title="Zum Verschieben ziehen oder Pfeil hoch/runter"
              onmousedown={() => (armed = entry.id)}
              onkeydown={(e) => onHandleKeydown(e, entry.id)}>⠿</span
            >
            <button
              class="small"
              class:active={state !== undefined}
              aria-label="„{title}“ in der Effekt-Liste {state ? 'stoppen' : 'abspielen'}"
              title={state ? 'Stoppen' : 'Abspielen'}
              disabled={!sound && !state}
              onclick={() => effects.toggle(entry.id)}>{state === 'playing' ? '■' : state === 'loading' ? '…' : '▶'}</button
            >
            <button
              class="small"
              aria-pressed={entry.loop}
              aria-label="Endlosschleife für „{title}“ in der Effekt-Liste"
              title={entry.loop ? 'Endlosschleife an' : 'Endlosschleife aus'}
              onclick={() => effects.setLoop(entry.id, !entry.loop)}>⟳</button
            >
            <span class="name" title={title}>{title}</span>
            {#if !sound}<span class="muted">(nicht verfügbar)</span>{/if}
            <span class="spacer"></span>
            <button class="small" aria-label="„{title}“ aus der Effekt-Liste entfernen" title="Entfernen (stoppt den Effekt)" onclick={() => effects.remove(entry.id)}>✕</button>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            aria-label="Lautstärke von „{title}“ in der Effekt-Liste"
            title="Lautstärke {Math.round(entry.volume * 100)} %"
            value={entry.volume}
            oninput={(e) => effects.setVolume(entry.id, Number((e.currentTarget as HTMLInputElement).value))}
          />
          {#if message}<p class="error" role="alert">{message}</p>{/if}
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  h2 { margin: 0; }
  .row { margin-bottom: 0.5rem; align-items: baseline; }
  ol.entries { list-style: none; padding: 0; margin: 0; }
  ol.entries li { padding: 0.3rem 0.4rem; border-bottom: var(--border); }
  ol.entries li.playing { background: var(--color-surface-muted); }
  ol.entries li.dragging { opacity: 0.5; }
  .line { display: flex; gap: 0.4rem; align-items: center; }
  .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  button.small { padding: 0.05rem 0.4rem; font-size: 0.85em; }
  button[aria-pressed='true'], button.active { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-accent-text); }
  .handle { cursor: grab; color: var(--color-text-muted); padding: 0.05rem 0.4rem; border: var(--border); border-radius: var(--border-radius-small); user-select: none; }
  input[type='range'] { width: 100%; margin: 0.25rem 0 0; padding: 0; }
  .error { margin: 0.25rem 0 0; font-size: 0.85em; }
</style>
