<script lang="ts">
  import type { Player } from '../soundPlayer.svelte.ts';
  import { MAX_PLAYLIST_NAME, type Playlist, type PlaylistPlayer, type Playlists } from '../playlists.svelte.ts';
  import type { RepeatMode } from '../playlistQueue.ts';
  import { formatPlayTime, type BoardSound } from '../soundboard.ts';

  // Musik-Playlisten im Soundboard: Auswahl, Steuerung, Fortschritt und Titelliste (Drag & Drop, ↑/↓).

  interface Props {
    player: Player;
    playlists: Playlists;
    playlistPlayer: PlaylistPlayer;
    /** alle bekannten Sounds nach key – Playlisten speichern nur den key */
    soundsByKey: ReadonlyMap<string, BoardSound>;
    /** Meldung vom Hinzufügen per „+“ an einer Kachel */
    error: string;
  }

  let { player, playlists, playlistPlayer, soundsByKey, error }: Props = $props();

  /** Index des Eintrags, der gerade gezogen wird (Reihenfolge per Drag & Drop) */
  let dragFrom = $state<number | null>(null);
  const selectedPlaylist = $derived(playlists.selected);
  /** läuft die gewählte Playlist (bzw. ist sie angehalten)? */
  const selectedIsActive = $derived(selectedPlaylist !== undefined && playlistPlayer.playlistId === selectedPlaylist.id);
  const activePlaylist = $derived(playlistPlayer.playlistId ? playlists.get(playlistPlayer.playlistId) : undefined);
  const REPEAT_LABELS: Record<RepeatMode, string> = { off: 'aus', all: 'alle', one: 'einen Titel' };
  const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' };

  /** Fortschritt des laufenden Playlist-Titels, alle 250 ms wie in der Referenz */
  let progress = $state<{ current: number; duration: number } | null>(null);
  /** Stelle, auf die der Nutzer gerade zieht; solange überschreibt der Fortschritt den Regler nicht */
  let seeking = $state<number | null>(null);
  $effect(() => {
    const status = playlistPlayer.status;
    const key = playlistPlayer.entry?.sound;
    // neuer Titel: ein abgebrochenes Ziehen am alten Regler gilt nicht mehr
    void playlistPlayer.entry?.id;
    seeking = null;
    if (!key || (status !== 'playing' && status !== 'paused' && status !== 'loading')) {
      progress = null;
      return;
    }
    const update = () => (progress = player.position(key));
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  });

  /** Klick auf einen Titel der Liste: dorthin springen; der angehaltene aktuelle Titel läuft einfach weiter */
  function jumpTo(playlist: Playlist, entryId: string): void {
    if (playlistPlayer.playlistId === playlist.id && playlistPlayer.entry?.id === entryId && playlistPlayer.status === 'paused') {
      playlistPlayer.toggle();
      return;
    }
    playlistPlayer.play(playlist.id, entryId);
  }

  /** Doppelklick auf die Zeile springt (wie in der Referenz), nicht aber auf ihre Knöpfe */
  function onRowDblclick(event: MouseEvent, playlist: Playlist, entryId: string): void {
    if ((event.target as Element | null)?.closest('button')) return;
    jumpTo(playlist, entryId);
  }

  /** eigener Typ beim Ziehen, damit Textfelder und die Upload-Fläche gezogene Zeilen nicht annehmen */
  const ENTRY_DRAG_TYPE = 'application/x-pnp-playlist-entry';

  function onEntryDragStart(event: DragEvent, index: number, entryId: string): void {
    dragFrom = index;
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(ENTRY_DRAG_TYPE, entryId);
  }

  function onEntryDragOver(event: DragEvent): void {
    if (dragFrom === null) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  function onEntryDrop(event: DragEvent, playlist: Playlist, index: number): void {
    if (dragFrom === null) return;
    event.preventDefault();
    moveEntry(playlist, dragFrom, index);
    dragFrom = null;
  }

  function togglePlaylist(playlist: Playlist): void {
    if (playlistPlayer.playlistId === playlist.id) playlistPlayer.toggle();
    else playlistPlayer.play(playlist.id);
  }

  function deletePlaylist(playlist: Playlist): void {
    if (!confirm(`Playlist „${playlist.name}“ löschen? Die Sounds selbst bleiben erhalten.`)) return;
    playlistPlayer.removePlaylist(playlist.id);
  }

  function renamePlaylist(playlist: Playlist, input: HTMLInputElement): void {
    playlists.rename(playlist.id, input.value);
    // leerer Name: alten Namen wieder anzeigen
    input.value = playlist.name;
  }

  function moveEntry(playlist: Playlist, from: number, to: number): void {
    if (to < 0 || to >= playlist.tracks.length) return;
    playlists.move(playlist.id, from, to);
  }

  function seek(event: Event): void {
    const key = playlistPlayer.entry?.sound;
    seeking = null;
    if (key) player.seek(key, Number((event.currentTarget as HTMLInputElement).value));
  }
</script>

<section class="playlists card" aria-labelledby="sb-playlists">
  <div class="row">
    <h2 id="sb-playlists">Playlisten</h2>
    {#if playlists.list.length > 0}
      <label class="inline">
        Playlist
        <select value={playlists.selectedId} onchange={(e) => playlists.select((e.currentTarget as HTMLSelectElement).value)}>
          {#each playlists.list as p (p.id)}<option value={p.id}>{p.name} ({p.tracks.length})</option>{/each}
        </select>
      </label>
    {/if}
    <span class="spacer"></span>
    <button onclick={() => playlists.create()} disabled={playlists.full}>Neue Playlist</button>
  </div>

  {#if activePlaylist && playlistPlayer.entry}
    {@const position = seeking ?? progress?.current ?? 0}
    <div class="row">
      <p class="now-playing" role="status">
        {playlistPlayer.status === 'playing' ? 'Läuft' : playlistPlayer.status === 'loading' ? 'Lädt' : playlistPlayer.status === 'paused' ? 'Angehalten' : 'Gestoppt'}:
        <strong>{soundsByKey.get(playlistPlayer.entry.sound)?.title ?? playlistPlayer.entry.title}</strong>
        <span class="muted">· Titel {playlistPlayer.index + 1} von {activePlaylist.tracks.length} aus „{activePlaylist.name}“</span>
      </p>
      {#if !selectedIsActive}
        <button class="link" onclick={() => playlists.select(activePlaylist.id)}>Zur laufenden Playlist</button>
      {/if}
    </div>
    {#if progress}
      <div class="progress row">
        <input
          type="range"
          min="0"
          max={progress.duration || 0}
          step="0.1"
          value={position}
          disabled={!progress.duration}
          aria-label="Position im Titel"
          aria-valuetext="{formatPlayTime(position)} von {formatPlayTime(progress.duration)}"
          oninput={(e) => (seeking = Number((e.currentTarget as HTMLInputElement).value))}
          onchange={seek}
        />
        <span class="muted time">{formatPlayTime(position)} / {formatPlayTime(progress.duration)}</span>
      </div>
    {/if}
  {/if}

  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#if !selectedPlaylist}
    <p class="muted">Noch keine Playlist. Lege eine an oder füge Musik über „+“ auf einer Musik-Kachel hinzu.</p>
  {:else}
    {@const pl = selectedPlaylist}
    {@const status = selectedIsActive ? playlistPlayer.status : 'stopped'}
    <div class="row">
      <label class="inline name">
        Name
        <input
          value={pl.name}
          maxlength={MAX_PLAYLIST_NAME}
          onchange={(e) => renamePlaylist(pl, e.currentTarget as HTMLInputElement)}
          onkeydown={(e) => e.key === 'Enter' && renamePlaylist(pl, e.currentTarget as HTMLInputElement)}
        />
      </label>
      <button class="danger" onclick={() => deletePlaylist(pl)}>Playlist löschen</button>
    </div>
    <div class="row transport" role="group" aria-label="Steuerung der Playlist">
      <button aria-label="Vorheriger Titel" title="Vorheriger Titel" onclick={() => playlistPlayer.previous()} disabled={!selectedIsActive}>|◀</button>
      <button
        aria-label={status === 'playing' || status === 'loading' ? 'Anhalten' : 'Abspielen'}
        title={status === 'playing' || status === 'loading' ? 'Anhalten' : 'Abspielen'}
        onclick={() => togglePlaylist(pl)}
        disabled={pl.tracks.length === 0}>{status === 'playing' || status === 'loading' ? '❚❚' : '▶'}</button
      >
      <button aria-label="Nächster Titel" title="Nächster Titel" onclick={() => playlistPlayer.next()} disabled={!selectedIsActive}>▶|</button>
      <button aria-label="Playlist stoppen" title="Playlist stoppen" onclick={() => playlistPlayer.stop()} disabled={!selectedIsActive}>■</button>
      <button aria-pressed={playlists.shuffle} title="Zufällige Reihenfolge" onclick={() => playlists.setShuffle(!playlists.shuffle)}>Zufall</button>
      <button
        aria-label="Wiederholen: {REPEAT_LABELS[playlists.repeat]}"
        title="Wiederholen: aus → alle → einen Titel"
        aria-pressed={playlists.repeat !== 'off'}
        onclick={() => playlists.setRepeat(NEXT_REPEAT[playlists.repeat])}>⟳ {REPEAT_LABELS[playlists.repeat]}</button
      >
    </div>
    {#if pl.tracks.length === 0}
      <p class="muted">Noch keine Titel. Füge Musik über „+“ auf einer Musik-Kachel hinzu.</p>
    {:else}
      <ol class="tracks" aria-label="Titel von „{pl.name}“">
        {#each pl.tracks as track, i (track.id)}
          {@const sound = soundsByKey.get(track.sound)}
          {@const title = sound?.title ?? track.title}
          {@const current = selectedIsActive && playlistPlayer.entry?.id === track.id}
          <li
            class:current
            class:dragging={dragFrom === i}
            aria-current={current ? 'true' : undefined}
            draggable="true"
            ondragstart={(e) => onEntryDragStart(e, i, track.id)}
            ondragover={onEntryDragOver}
            ondrop={(e) => onEntryDrop(e, pl, i)}
            ondragend={() => (dragFrom = null)}
            ondblclick={(e) => onRowDblclick(e, pl, track.id)}
          >
            <span class="handle" aria-hidden="true">⠿</span>
            <button class="jump link" aria-label="„{title}“ abspielen" title="Ab hier abspielen (Doppelklick auf die Zeile)" onclick={() => jumpTo(pl, track.id)}>
              {#if current}<span aria-hidden="true">{status === 'playing' ? '♪' : status === 'loading' ? '…' : '❚❚'}</span>{/if}
              {title}
            </button>
            {#if !sound}<span class="muted">(nicht verfügbar)</span>{/if}
            {#if current && sound && player.errors[sound.key]}<span class="error" role="alert">{player.errors[sound.key]}</span>{/if}
            <span class="spacer"></span>
            <button class="small" aria-label="„{title}“ nach oben" title="Nach oben" disabled={i === 0} onclick={() => moveEntry(pl, i, i - 1)}>↑</button>
            <button class="small" aria-label="„{title}“ nach unten" title="Nach unten" disabled={i === pl.tracks.length - 1} onclick={() => moveEntry(pl, i, i + 1)}>↓</button>
            <button class="small" aria-label="„{title}“ aus der Playlist entfernen" title="Entfernen" onclick={() => playlistPlayer.removeEntry(pl.id, track.id)}>✕</button>
          </li>
        {/each}
      </ol>
    {/if}
  {/if}
</section>

<style>
  h2 { margin: 0; }
  label { margin-bottom: 0; }
  label.inline { display: flex; gap: 0.4rem; align-items: center; font-weight: 400; }
  label.inline input { width: auto; margin: 0; }
  label.name { flex: 1; min-width: 12rem; }
  label.name input { flex: 1; min-width: 0; }
  .row { margin-bottom: 0.5rem; }
  .now-playing { margin: 0; }
  input[type='range'] { padding: 0; }
  .transport button[aria-pressed='true'] { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-accent-text); }
  .progress input { flex: 1; min-width: 8rem; margin: 0; }
  .progress .time { font-family: var(--font-mono); font-size: 0.85em; }
  ol.tracks { list-style: none; padding: 0; margin: 0; }
  ol.tracks li { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; padding: 0.2rem 0.4rem; border-bottom: var(--border); }
  ol.tracks li.current { background: var(--color-surface-muted); font-weight: 600; }
  ol.tracks li.dragging { opacity: 0.5; }
  ol.tracks .handle { cursor: grab; color: var(--color-text-muted); }
  ol.tracks .jump { text-align: left; }
  ol.tracks button.small { padding: 0.05rem 0.4rem; font-size: 0.85em; }
</style>
