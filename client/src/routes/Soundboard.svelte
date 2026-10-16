<script lang="ts">
  import { STORAGE_PROVIDER_LABELS, MAX_STORAGE_UPLOAD_BYTES, type StorageConnection } from '@pnp/shared';
  import { ApiFailure, api } from '../lib/api.ts';
  import { href } from '../lib/router.svelte.ts';
  import { session } from '../lib/session.svelte.ts';
  import { createTask } from '../lib/task.svelte.ts';
  import UserMenu from '../lib/UserMenu.svelte';
  import { createPlayer, createSoundTypes, type Channel } from '../lib/soundPlayer.svelte.ts';
  import { createSoundSettings } from '../lib/soundSettings.svelte.ts';
  import { assignHotkeys, hotkeyAction, stepCategory } from '../lib/soundHotkeys.ts';
  import { createPlaylistPlayer, createPlaylists, MAX_PLAYLIST_NAME, type Playlist } from '../lib/playlists.svelte.ts';
  import type { RepeatMode } from '../lib/playlistQueue.ts';
  import { UploadError, uploadDirect } from '../lib/upload.ts';
  import {
    ACCEPT_AUDIO,
    SOUND_TYPE_LABELS,
    builtinToBoard,
    categoriesOf,
    checkUploadFile,
    createPlaybackUrlCache,
    describeStorageError,
    fileToBoard,
    filterSounds,
    formatBytes,
    formatPlayTime,
    groupByCategory,
    uploadedSound,
    type BoardSound,
  } from '../lib/soundboard.ts';

  interface FileList_ {
    sounds: BoardSound[];
    nextCursor: string | null;
    loading: boolean;
    error: string;
  }

  interface UploadEntry {
    id: number;
    name: string;
    cid: number;
    /** gewählter Typ; wird nach dem Neuladen der Liste der neuen Datei zugeordnet */
    type: Channel;
    /** ID der Datei, falls der Anbieter sie vorab nennt (S3) */
    fileId: string | null;
    progress: number;
    error: string;
    done: boolean;
  }

  let builtin = $state<BoardSound[]>([]);
  let connections = $state<StorageConnection[]>([]);
  let files = $state<Record<number, FileList_>>({});
  let query = $state('');
  /** '' = alle Quellen, 'builtin' oder die ID einer Verbindung */
  let source = $state('');
  let category = $state('');
  /** Ansicht: alle Sounds oder nur Musik bzw. nur Effekte */
  let view = $state<'' | Channel>('');
  let uploadCid = $state<number | null>(null);
  let uploadType = $state<Channel>('sfx');
  let uploads = $state<UploadEntry[]>([]);
  let dragging = $state(false);
  let deleteError = $state('');
  let searchInput = $state<HTMLInputElement | null>(null);
  let nextUploadId = 0;

  const builtinTask = createTask();
  const connectionsTask = createTask();

  const urls = createPlaybackUrlCache((cid, fileId) => api.playbackUrl(cid, fileId));
  const types = createSoundTypes();

  /** 409 heißt: Verbindung getrennt oder Rechte fehlen – dann den gespeicherten Status neu laden */
  function afterStorageError(err: unknown): string {
    if (err instanceof ApiFailure && err.status === 409) reloadConnections();
    return describeStorageError(err);
  }

  const soundSettings = createSoundSettings();

  const player = createPlayer({
    typeOf: types.typeOf,
    soundOptions: (key) => soundSettings.get(key),
    // Titelende: die Playlist schaltet weiter
    onEnded: (sound, channel) => playlistPlayer.ended(sound, channel),
    resolveUrl: async (sound, retry) => {
      if (sound.source === 'builtin') return sound.url!;
      if (retry) urls.invalidate(sound.source, sound.id);
      try {
        return await urls.get(sound.source, sound.id);
      } catch (err) {
        throw new Error(afterStorageError(err));
      }
    },
  });

  builtinTask.run(async () => {
    builtin = (await api.builtinSounds()).sounds.map(builtinToBoard);
  });

  async function loadFiles(cid: number, more = false): Promise<void> {
    const previous = files[cid];
    // beim Neuladen bleibt die alte Liste stehen, bis die neue da ist – sonst fehlen laufenden Playlisten
    // in der Zwischenzeit die Titel dieses Speichers und würden übersprungen
    files[cid] = { sounds: previous?.sounds ?? [], nextCursor: null, loading: true, error: '' };
    try {
      const page = await api.storageFiles(cid, more ? (previous?.nextCursor ?? undefined) : undefined);
      const list = files[cid];
      const loaded = page.files.map((f) => fileToBoard(cid, f));
      list.sounds = more ? [...list.sounds, ...loaded] : loaded;
      list.nextCursor = page.nextCursor;
    } catch (err) {
      files[cid].sounds = more ? files[cid].sounds : [];
      files[cid].error = afterStorageError(err);
    } finally {
      files[cid].loading = false;
    }
  }

  async function reloadConnections(): Promise<void> {
    connections = await api.storageConnections();
  }

  if (session.user) {
    connectionsTask.run(async () => {
      await reloadConnections();
      uploadCid = connections.find((c) => c.status !== 'disconnected')?.id ?? connections[0]?.id ?? null;
      await Promise.all(connections.map((c) => loadFiles(c.id)));
    });
  }

  $effect(() => () => player.stopAll());

  /** alle bekannten Sounds nach key – Playlisten speichern nur den key */
  const soundsByKey = $derived(
    new Map([...builtin, ...Object.values(files).flatMap((f) => f.sounds)].map((s) => [s.key, s] as const)),
  );
  const playlists = createPlaylists();
  const playlistPlayer = createPlaylistPlayer({ player, playlists, findSound: (key) => soundsByKey.get(key) });
  let playlistError = $state('');
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

  function addToPlaylist(sound: BoardSound): void {
    playlistError = '';
    const target = selectedPlaylist ?? playlists.create();
    if (!target) {
      playlistError = 'Es gibt schon zu viele Playlisten.';
      return;
    }
    const wasEmpty = target.tracks.length === 0;
    if (!playlists.add(target.id, sound)) {
      playlistError = `„${target.name}“ ist voll.`;
      return;
    }
    // wie in der Referenz startet der erste Titel sofort – aber nur, wenn gerade keine Musik läuft
    if (wasEmpty && !player.isChannelActive('music')) playlistPlayer.play(target.id);
  }

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

  /** Upload-Fläche: nur Dateien annehmen */
  const draggingFiles = (event: DragEvent) => [...(event.dataTransfer?.types ?? [])].includes('Files');

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

  function stopMusic(): void {
    playlistPlayer.stop();
    player.stopChannel('music');
  }

  function stopAll(): void {
    playlistPlayer.stop();
    player.stopAll();
  }

  const showsBuiltin = $derived(source === '' || source === 'builtin');
  const visibleConnections = $derived(connections.filter((c) => source === '' || source === String(c.id)));
  /** Kategorien aller angezeigten Quellen: Manifest-Kategorien und Unterordner der Speicher */
  const categories = $derived(
    categoriesOf([...(showsBuiltin ? builtin : []), ...visibleConnections.flatMap((c) => files[c.id]?.sounds ?? [])]),
  );
  /** Wie in der Referenz: wer sucht, sucht über alle Kategorien (Bereich „Suche“) */
  const searching = $derived(query.trim() !== '');
  const activeCategory = $derived(searching || !categories.includes(category) ? '' : category);
  /** Umschalter „Alle / Hintergrundmusik / Effekte“: nur Sounds der gewählten Art */
  const ofView = (sounds: BoardSound[]) => (view === '' ? sounds : sounds.filter((s) => types.typeOf(s) === view));
  const builtinGroups = $derived(groupByCategory(ofView(filterSounds(builtin, query, activeCategory))));
  const connectionViews = $derived(
    visibleConnections.map((c) => ({
      c,
      list: files[c.id],
      groups: groupByCategory(ofView(filterSounds(files[c.id]?.sounds ?? [], query, activeCategory))),
    })),
  );
  const noMatch = $derived(view === 'music' ? 'Keine Musik in dieser Auswahl.' : view === 'sfx' ? 'Keine Effekte in dieser Auswahl.' : 'Keine Treffer.');
  const viewTabs: { value: '' | Channel; label: string }[] = [
    { value: '', label: 'Alle' },
    { value: 'music', label: 'Hintergrundmusik' },
    { value: 'sfx', label: 'Effekte' },
  ];
  /** Sichtbare Kacheln in Anzeigereihenfolge, für die Tasten 0–9, a–z, A–Z */
  const visibleSounds = $derived([
    ...(showsBuiltin ? builtinGroups.flatMap((g) => g.sounds) : []),
    ...connectionViews.flatMap((v) => v.groups.flatMap((g) => g.sounds)),
  ]);
  const hotkeys = $derived(assignHotkeys(visibleSounds.map((s) => s.key)));

  /** Klick auf eine Kachel oder ihre Taste */
  function activate(sound: BoardSound): void {
    // Musik per Kachel ersetzt den Playlist-Titel; dessen Ende schaltet dann nicht mehr weiter
    if (types.typeOf(sound) === 'music' || playlistPlayer.entry?.sound === sound.key) playlistPlayer.release();
    player.toggle(sound);
  }

  function selectCategory(next: string): void {
    category = next;
    query = '';
  }

  function onKeydown(event: KeyboardEvent): void {
    const action = hotkeyAction(event, hotkeys);
    if (!action) return;
    if (action.kind !== 'search') event.preventDefault();
    if (action.kind === 'search') searchInput?.focus();
    else if (action.kind === 'category') selectCategory(stepCategory(categories, activeCategory, action.step));
    // wie in der Referenz: Pfeil hoch/runter regelt die Musik
    else if (action.kind === 'volume') player.setVolume('music', Math.round((player.settings.musicVolume + action.step) * 100) / 100);
    else {
      const sound = visibleSounds.find((s) => s.key === action.soundKey);
      if (sound) activate(sound);
    }
  }

  function setSoundVolume(sound: BoardSound, volume: number): void {
    soundSettings.setVolume(sound.key, volume);
    player.refreshSound(sound.key);
  }

  function toggleLoop(sound: BoardSound): void {
    soundSettings.setLoop(sound.key, !soundSettings.get(sound.key).loop);
    player.refreshSound(sound.key);
  }

  async function remove(sound: BoardSound): Promise<void> {
    if (sound.source === 'builtin' || !sound.deletable) return;
    if (!confirm(`„${sound.title}“ endgültig aus deinem Speicher löschen?`)) return;
    const cid = sound.source;
    deleteError = '';
    try {
      await api.deleteStorageFile(cid, sound.id);
      // erst aus den Playlisten nehmen (dort läuft ggf. der nächste Titel an), dann stoppen
      playlistPlayer.forgetSound(sound.key);
      player.stop(sound.key);
      types.forget(sound.key);
      soundSettings.forget(sound.key);
      urls.invalidate(cid, sound.id);
      files[cid].sounds = files[cid].sounds.filter((s) => s.key !== sound.key);
    } catch (err) {
      deleteError = `Löschen fehlgeschlagen: ${afterStorageError(err)}`;
    }
  }

  async function uploadOne(file: File, cid: number, type: Channel): Promise<void> {
    const entry: UploadEntry = { id: nextUploadId++, name: file.name, cid, type, fileId: null, progress: 0, error: '', done: false };
    uploads.push(entry);
    const live = uploads.find((u) => u.id === entry.id)!;
    const checked = checkUploadFile(file);
    if ('error' in checked) {
      live.error = checked.error;
      return;
    }
    const request = { fileName: file.name, contentType: checked.contentType, size: file.size };
    try {
      for (let attempt = 0; ; attempt++) {
        const target = await api.requestUpload(cid, request);
        live.fileId = target.fileId;
        try {
          await uploadDirect(target, file, checked.contentType, { onProgress: (p) => (live.progress = p) });
          break;
        } catch (err) {
          // abgelaufener Upload-Link: einmal mit neuem Link versuchen
          if (err instanceof UploadError && err.kind === 'expired' && attempt === 0) continue;
          throw err;
        }
      }
      live.done = true;
    } catch (err) {
      live.error = err instanceof UploadError ? err.message : afterStorageError(err);
    }
  }

  async function uploadFiles(list: FileList | File[] | null): Promise<void> {
    const cid = uploadCid;
    const type = uploadType;
    if (!list || cid === null) return;
    const selected = [...list];
    if (selected.length === 0) return;
    const started = nextUploadId;
    const before = new Set((files[cid]?.sounds ?? []).map((s) => s.key));
    await Promise.all(selected.map((file) => uploadOne(file, cid, type)));
    const finished = uploads.filter((u) => u.id >= started && u.cid === cid && u.done);
    if (finished.length === 0) return;
    await loadFiles(cid);
    // gewählten Typ den neuen Dateien zuordnen (bei mehrdeutigem Namen bleibt die Vorgabe)
    for (const u of finished) {
      const sound = uploadedSound(files[cid]?.sounds ?? [], u, before);
      if (sound) types.set(sound, u.type);
    }
  }

  /** Neuer Typ für einen Sound; läuft er gerade auf dem anderen Kanal, wird er gestoppt */
  function changeType(sound: BoardSound, type: Channel): void {
    // ein Playlist-Titel läuft immer auf dem Musikkanal und bleibt dort
    if (player.isActive(sound.key) && player.channels[sound.key] !== type && !playlistPlayer.owns(sound.key)) player.stop(sound.key);
    types.set(sound, type);
  }

  function onDrop(event: DragEvent): void {
    event.preventDefault();
    dragging = false;
    uploadFiles(event.dataTransfer?.files ?? null);
  }

  function onPick(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    uploadFiles(input.files).finally(() => (input.value = ''));
  }

  const statusLabel: Record<StorageConnection['status'], string> = { connected: 'verbunden', error: 'Störung', disconnected: 'getrennt' };
</script>

{#snippet tile(sound: BoardSound)}
  {@const state = player.states[sound.key]}
  {@const type = types.typeOf(sound)}
  {@const hotkey = hotkeys.get(sound.key)}
  {@const own = soundSettings.get(sound.key)}
  {@const listed = playlists.contains(sound.key)}
  <li class="tile" class:music={type === 'music'} class:playing={state === 'playing'} class:loading={state === 'loading'} class:in-playlist={listed}>
    <button
      class="play"
      aria-pressed={state !== undefined}
      aria-keyshortcuts={hotkey}
      onclick={() => activate(sound)}
      title={(state ? 'Stoppen' : 'Abspielen') + (hotkey ? ` (Taste ${hotkey})` : '') + (listed ? ' · in einer Playlist' : '')}
    >
      <span class="top" aria-hidden="true">
        <span class="icon">{state === 'playing' ? '■' : state === 'paused' ? '❚❚' : state === 'loading' ? '…' : type === 'music' ? '♪' : '▶'}</span>
        {#if hotkey}<kbd class="hotkey">{hotkey}</kbd>{/if}
        {#if listed}<span class="listed">☰</span>{/if}
      </span>
      <span class="name">{sound.title}</span>
    </button>
    <select
      class="type"
      aria-label="Typ von „{sound.title}“"
      title="Typ: Musik läuft allein und ersetzt die laufende Musik, Effekte laufen gleichzeitig"
      value={type}
      onchange={(e) => changeType(sound, (e.currentTarget as HTMLSelectElement).value as Channel)}
    >
      <option value="sfx">{SOUND_TYPE_LABELS.sfx}</option>
      <option value="music">{SOUND_TYPE_LABELS.music}</option>
    </select>
    {#if sound.deletable}
      <button class="delete danger" aria-label="„{sound.title}“ löschen" title="Löschen" onclick={() => remove(sound)}>✕</button>
    {/if}
    <div class="opts">
      <button
        class="loop"
        aria-pressed={own.loop}
        aria-label="Endlosschleife für „{sound.title}“"
        title={own.loop ? 'Endlosschleife an' : 'Endlosschleife aus'}
        onclick={() => toggleLoop(sound)}>⟳</button
      >
      {#if type === 'music'}
        <button
          class="add"
          aria-label={selectedPlaylist ? `„${sound.title}“ zu „${selectedPlaylist.name}“ hinzufügen` : `„${sound.title}“ zu einer neuen Playlist hinzufügen`}
          title={selectedPlaylist ? `Zur Playlist „${selectedPlaylist.name}“ hinzufügen` : 'Zu einer neuen Playlist hinzufügen'}
          onclick={() => addToPlaylist(sound)}>+</button
        >
      {/if}
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        aria-label="Lautstärke von „{sound.title}“"
        title="Lautstärke {Math.round(own.volume * 100)} %"
        value={own.volume}
        oninput={(e) => setSoundVolume(sound, Number((e.currentTarget as HTMLInputElement).value))}
      />
    </div>
    {#if player.errors[sound.key]}<p class="error" role="alert">{player.errors[sound.key]}</p>{/if}
  </li>
{/snippet}

<svelte:window onkeydown={onKeydown} />

<main class="soundboard">
  <div class="row">
    <h1>Soundboard</h1>
    <span class="spacer"></span>
    {#if session.user}
      <a href={href.groups()}>Gruppen</a>
      <UserMenu />
    {:else}
      <a class="button" href={href.login(href.sounds())}>Anmelden</a>
    {/if}
  </div>

  <div class="controls card row">
    <label class="search">
      Suche
      <input type="search" placeholder="Titel, Kategorie oder Schlagwort … (Alt)" bind:value={query} bind:this={searchInput} />
    </label>
    {#if connections.length > 0}
      <label>
        Quelle
        <select bind:value={source}>
          <option value="">Alle</option>
          <option value="builtin">Standard</option>
          {#each connections as c (c.id)}<option value={String(c.id)}>{c.displayName}</option>{/each}
        </select>
      </label>
    {/if}
  </div>

  {#snippet volume(target: 'master' | Channel, label: string)}
    <label class="volume">
      {label}
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={target === 'master' ? player.settings.volume : target === 'music' ? player.settings.musicVolume : player.settings.sfxVolume}
        oninput={(e) => player.setVolume(target, Number((e.currentTarget as HTMLInputElement).value))}
      />
    </label>
  {/snippet}

  <section class="mixer card" aria-label="Wiedergabe">
    <div class="row">
      {@render volume('master', 'Gesamt')}
      {@render volume('music', 'Musik')}
      {@render volume('sfx', 'Effekte')}
      <label class="inline">
        <input type="checkbox" checked={player.settings.musicLoop} onchange={(e) => player.setMusicLoop((e.currentTarget as HTMLInputElement).checked)} />
        Musik wiederholen
      </label>
    </div>
    <div class="row">
      <p class="now-playing" role="status">
        {#if player.music}
          <span aria-hidden="true">♪</span>
          {player.states[player.music.key] === 'loading' ? 'Lädt' : 'Läuft'}: <strong>{player.music.title}</strong>
        {:else}
          <span class="muted">Keine Musik</span>
        {/if}
      </p>
      <span class="spacer"></span>
      <button onclick={stopMusic} disabled={!player.isChannelActive('music') && playlistPlayer.status === 'stopped'}>Musik stoppen</button>
      <button onclick={() => player.stopChannel('sfx')} disabled={!player.isChannelActive('sfx')}>Effekte stoppen</button>
      <button onclick={stopAll} disabled={Object.keys(player.states).length === 0 && playlistPlayer.status === 'stopped'}>Alle stoppen</button>
    </div>
  </section>

  <!-- wie in der Referenz: Playlisten links, Bibliothek rechts (schmal untereinander) -->
  <div class="layout">
    <aside class="side">
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

        {#if playlistError}<p class="error" role="alert">{playlistError}</p>{/if}

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
    </aside>

    <div class="library">
      <div class="tabs" role="group" aria-label="Art der Sounds">
        <span class="group-label" aria-hidden="true">Art</span>
        {#each viewTabs as tab (tab.value)}
          <button class:active={view === tab.value} aria-pressed={view === tab.value} onclick={() => (view = tab.value)}>{tab.label}</button>
        {/each}
      </div>

      {#if categories.length > 0}
        <div class="cats" role="group" aria-label="Kategorie">
          <span class="group-label" aria-hidden="true">Kategorie</span>
          <button class="step" aria-label="Vorherige Kategorie" title="Vorherige Kategorie (Pfeil links)" onclick={() => selectCategory(stepCategory(categories, activeCategory, -1))}>‹</button>
          <button aria-pressed={!searching && activeCategory === ''} onclick={() => selectCategory('')}>Alle</button>
          {#each categories as c (c)}
            <button aria-pressed={!searching && activeCategory === c} onclick={() => selectCategory(c)}>{c}</button>
          {/each}
          {#if searching}<button aria-pressed="true" onclick={() => searchInput?.focus()}>Suche</button>{/if}
          <button class="step" aria-label="Nächste Kategorie" title="Nächste Kategorie (Pfeil rechts)" onclick={() => selectCategory(stepCategory(categories, activeCategory, 1))}>›</button>
        </div>
      {/if}
      <p class="muted keys">
        Tasten: <kbd>0</kbd>–<kbd>9</kbd>, <kbd>a</kbd>–<kbd>z</kbd>, <kbd>A</kbd>–<kbd>Z</kbd> spielen die markierten Sounds ·
        <kbd>←</kbd> <kbd>→</kbd> Kategorie · <kbd>↑</kbd> <kbd>↓</kbd> Musik-Lautstärke · <kbd>Alt</kbd> Suche
      </p>

      {#if !session.user}
        <p class="muted">Eigene Sounds aus deinem Speicher (S3, Google Drive) kannst du nach dem <a href={href.login(href.sounds())}>Anmelden</a> nutzen.</p>
      {:else if connectionsTask.error}
        <p class="error">Speicher konnten nicht geladen werden: {connectionsTask.error}</p>
      {:else if !connectionsTask.busy && connections.length === 0}
        <p class="hint card">
          Du hast noch keinen Speicher verbunden. Eigene Sounds lädst du in deinen eigenen Speicher (S3 oder Google Drive) –
          verbinde ihn in den <a href={href.settings()}>Kontoeinstellungen</a>.
        </p>
      {:else if connections.length > 0}
        <section
          class="upload card"
          class:dragging
          aria-label="Hochladen"
          ondragover={(e) => {
            if (!draggingFiles(e)) return;
            e.preventDefault();
            dragging = true;
          }}
          ondragleave={() => (dragging = false)}
          ondrop={onDrop}
        >
          <div class="row">
            <label>
              Ziel
              <select bind:value={uploadCid}>
                {#each connections as c (c.id)}
                  <option value={c.id} disabled={c.status === 'disconnected'}>{c.displayName} ({STORAGE_PROVIDER_LABELS[c.providerType]})</option>
                {/each}
              </select>
            </label>
            <label>
              Typ
              <select bind:value={uploadType}>
                <option value="sfx">{SOUND_TYPE_LABELS.sfx}</option>
                <option value="music">{SOUND_TYPE_LABELS.music}</option>
              </select>
            </label>
            <label class="button primary file">
              Dateien wählen …
              <input type="file" multiple accept={ACCEPT_AUDIO} onchange={onPick} disabled={uploadCid === null} />
            </label>
            <span class="muted">oder hierher ziehen · mp3, wav, ogg, m4a bis {formatBytes(MAX_STORAGE_UPLOAD_BYTES)}</span>
          </div>
          {#if uploads.length > 0}
            <ul class="uploads">
              {#each uploads as u (u.id)}
                <li>
                  <span>{u.name}</span>
                  {#if u.error}
                    <span class="error" role="alert">{u.error}</span>
                  {:else if u.done}
                    <span class="muted">hochgeladen</span>
                  {:else}
                    <progress max="1" value={u.progress} aria-label="Fortschritt {u.name}"></progress>
                    <span class="muted">{Math.round(u.progress * 100)} %</span>
                  {/if}
                </li>
              {/each}
            </ul>
            {#if uploads.every((u) => u.done || u.error)}
              <button class="link" onclick={() => (uploads = [])}>Liste leeren</button>
            {/if}
          {/if}
        </section>
      {/if}

      {#if deleteError}<p class="error" role="alert">{deleteError}</p>{/if}

      {#if showsBuiltin}
        <section aria-labelledby="sb-builtin">
          <h2 id="sb-builtin">Standard</h2>
          {#if builtinTask.error}
            <p class="error">Standard-Sounds konnten nicht geladen werden: {builtinTask.error}</p>
          {:else if builtinTask.busy}
            <p class="muted">Lade …</p>
          {:else if builtinGroups.length === 0}
            <p class="muted">{builtin.length === 0 ? 'Keine Standard-Sounds vorhanden.' : noMatch}</p>
          {:else}
            {#each builtinGroups as group (group.category)}
              <h3>{group.category}</h3>
              <ul class="tiles">
                {#each group.sounds as sound (sound.key)}{@render tile(sound)}{/each}
              </ul>
            {/each}
          {/if}
        </section>
      {/if}

      {#each connectionViews as { c, list, groups } (c.id)}
        <section aria-labelledby="sb-{c.id}">
          <div class="row">
            <h2 id="sb-{c.id}">{c.displayName}</h2>
            <span class="muted">{STORAGE_PROVIDER_LABELS[c.providerType]}</span>
            <span class="badge" class:private={c.status !== 'connected'}>{statusLabel[c.status]}</span>
            <span class="spacer"></span>
            <button onclick={() => loadFiles(c.id)} disabled={list?.loading}>Aktualisieren</button>
          </div>
          {#if c.status !== 'connected'}
            <p class="error">
              {c.statusMessage || 'Der Speicher meldet eine Störung.'}
              {#if c.status === 'disconnected'}Bitte in den <a href={href.settings()}>Kontoeinstellungen</a> neu verbinden.{/if}
            </p>
          {/if}
          {#if list?.error}
            <p class="error" role="alert">{list.error}</p>
          {/if}
          {#if !list || (list.loading && list.sounds.length === 0)}
            <p class="muted">Lade …</p>
          {:else if groups.length === 0 && !list.error}
            <p class="muted">{list.sounds.length === 0 ? 'Noch keine Sounds in diesem Speicher.' : noMatch}</p>
          {:else}
            {#each groups as group (group.category)}
              {#if group.category !== null}<h3>{group.category}</h3>{/if}
              <ul class="tiles">
                {#each group.sounds as sound (sound.key)}{@render tile(sound)}{/each}
              </ul>
            {/each}
          {/if}
          {#if list?.nextCursor}
            <button onclick={() => loadFiles(c.id, true)} disabled={list.loading}>Weitere laden</button>
          {/if}
        </section>
      {/each}
    </div>
  </div>
</main>

<style>
  .controls { align-items: flex-end; margin-bottom: 1rem; }
  .controls label { margin-bottom: 0; }
  .controls .search { flex: 1; min-width: 12rem; }
  label.inline { display: flex; gap: 0.4rem; align-items: center; font-weight: 400; }
  label.inline input { width: auto; margin: 0; }
  input[type='range'] { padding: 0; }
  .hint { margin: 1rem 0; }
  .upload { margin: 1rem 0; border-style: dashed; }
  .upload.dragging { border-color: var(--color-accent); background: var(--color-surface-muted); }
  .upload label { margin-bottom: 0; }
  label.file { position: relative; overflow: hidden; }
  label.file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
  .uploads { list-style: none; padding: 0; margin: 0.75rem 0 0; }
  .uploads li { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; padding: 0.2rem 0; }
  .uploads progress { flex: 1; min-width: 8rem; max-width: 20rem; }
  ul.tiles { list-style: none; padding: 0; margin: 0 0 1rem; display: grid; grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr)); gap: 0.5rem; }
  .tile { position: relative; }
  .tile .play { width: 100%; min-height: 4.5rem; display: flex; flex-direction: column; align-items: flex-start; gap: 0.25rem; text-align: left; padding-right: 2rem; }
  .tile.playing .play { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-accent-text); }
  .tile.loading .play { border-color: var(--color-accent); }
  .tile .top { display: flex; gap: 0.5rem; align-items: center; }
  .tile .icon { font-size: 0.85em; opacity: 0.8; }
  .tile .hotkey { font-size: 0.75em; padding: 0 0.35em; border: var(--border); border-radius: var(--border-radius-small); font-family: var(--font-mono); }
  .tile .name { font-weight: 600; overflow-wrap: anywhere; }
  .tile .opts { display: flex; gap: 0.4rem; align-items: center; margin-top: 0.25rem; }
  .tile .opts input { flex: 1; min-width: 0; margin: 0; }
  .tile .loop { padding: 0 0.45rem; font-size: 0.9em; }
  .tile .loop[aria-pressed='true'] { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-accent-text); }
  .cats { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-bottom: 0.5rem; }
  .cats button[aria-pressed='true'] { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-accent-text); }
  .keys { font-size: 0.85em; margin: 0 0 1rem; }
  .tile .delete { position: absolute; top: 0.25rem; right: 0.25rem; padding: 0.1rem 0.4rem; font-size: 0.8em; }
  .tile .error { font-size: 0.85em; }
  .tile .type { width: 100%; margin: 0.25rem 0 0; padding: 0.1rem 0.3rem; font-size: 0.8em; }
  .tile.music:not(.playing) .play { background: var(--color-surface-muted); }
  .mixer { margin-bottom: 1rem; }
  .mixer label { margin-bottom: 0; }
  .mixer .volume { flex: 1; min-width: 8rem; }
  .now-playing { margin: 0; }
  .tabs { display: flex; gap: 0.25rem; flex-wrap: wrap; align-items: center; margin-bottom: 0.5rem; }
  .group-label { min-width: 5.5rem; font-size: 0.85em; font-weight: 600; color: var(--color-text-muted); }
  .cats { align-items: center; }
  .tabs button.active { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-accent-text); }
  main.soundboard { max-width: 90rem; }
  .layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; align-items: start; }
  @media (min-width: 72rem) {
    .layout { grid-template-columns: minmax(22rem, 28rem) minmax(0, 1fr); }
    .side { position: sticky; top: 1rem; max-height: calc(100vh - 2rem); overflow-y: auto; }
  }
  .playlists h2 { margin: 0; }
  .playlists label { margin-bottom: 0; }
  .playlists label.name { flex: 1; min-width: 12rem; }
  .playlists label.name input { flex: 1; min-width: 0; }
  .playlists .row { margin-bottom: 0.5rem; }
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
  .tile .add { padding: 0 0.45rem; font-size: 0.9em; }
  .tile .listed { font-size: 0.8em; opacity: 0.8; }
  .tile.in-playlist:not(.playing) .play { border-color: var(--color-accent); }
</style>
