<script lang="ts">
  import { STORAGE_PROVIDER_LABELS, MAX_STORAGE_UPLOAD_BYTES, type StorageConnection } from '@pnp/shared';
  import { ApiFailure, api } from '../lib/api.ts';
  import { href } from '../lib/router.svelte.ts';
  import { session } from '../lib/session.svelte.ts';
  import { createTask } from '../lib/task.svelte.ts';
  import UserMenu from '../lib/UserMenu.svelte';
  import { createPlayer } from '../lib/soundPlayer.svelte.ts';
  import { createSoundSettings } from '../lib/soundSettings.svelte.ts';
  import { assignHotkeys, hotkeyAction, stepCategory } from '../lib/soundHotkeys.ts';
  import { UploadError, uploadDirect } from '../lib/upload.ts';
  import {
    ACCEPT_AUDIO,
    builtinToBoard,
    categoriesOf,
    checkUploadFile,
    createPlaybackUrlCache,
    describeStorageError,
    fileToBoard,
    filterSounds,
    formatBytes,
    groupByCategory,
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
  let uploadCid = $state<number | null>(null);
  let uploads = $state<UploadEntry[]>([]);
  let dragging = $state(false);
  let deleteError = $state('');
  let searchInput = $state<HTMLInputElement | null>(null);
  let nextUploadId = 0;

  const builtinTask = createTask();
  const connectionsTask = createTask();

  const urls = createPlaybackUrlCache((cid, fileId) => api.playbackUrl(cid, fileId));

  /** 409 heißt: Verbindung getrennt oder Rechte fehlen – dann den gespeicherten Status neu laden */
  function afterStorageError(err: unknown): string {
    if (err instanceof ApiFailure && err.status === 409) reloadConnections();
    return describeStorageError(err);
  }

  const soundSettings = createSoundSettings();

  const player = createPlayer({
    soundOptions: (key) => soundSettings.get(key),
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
    files[cid] = { sounds: more ? (previous?.sounds ?? []) : [], nextCursor: null, loading: true, error: '' };
    try {
      const page = await api.storageFiles(cid, more ? (previous?.nextCursor ?? undefined) : undefined);
      const list = files[cid];
      list.sounds = [...list.sounds, ...page.files.map((f) => fileToBoard(cid, f))];
      list.nextCursor = page.nextCursor;
    } catch (err) {
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

  const showsBuiltin = $derived(source === '' || source === 'builtin');
  const visibleConnections = $derived(connections.filter((c) => source === '' || source === String(c.id)));
  /** Kategorien aller angezeigten Quellen: Manifest-Kategorien und Unterordner der Speicher */
  const categories = $derived(
    categoriesOf([...(showsBuiltin ? builtin : []), ...visibleConnections.flatMap((c) => files[c.id]?.sounds ?? [])]),
  );
  /** Wie in der Referenz: wer sucht, sucht über alle Kategorien (Bereich „Suche“) */
  const searching = $derived(query.trim() !== '');
  const activeCategory = $derived(searching || !categories.includes(category) ? '' : category);
  const builtinGroups = $derived(groupByCategory(filterSounds(builtin, query, activeCategory)));
  const connectionViews = $derived(
    visibleConnections.map((c) => ({ c, list: files[c.id], groups: groupByCategory(filterSounds(files[c.id]?.sounds ?? [], query, activeCategory)) })),
  );
  /** Sichtbare Kacheln in Anzeigereihenfolge, für die Tasten 0–9, a–z, A–Z */
  const visibleSounds = $derived([
    ...(showsBuiltin ? builtinGroups.flatMap((g) => g.sounds) : []),
    ...connectionViews.flatMap((v) => v.groups.flatMap((g) => g.sounds)),
  ]);
  const hotkeys = $derived(assignHotkeys(visibleSounds.map((s) => s.key)));

  /** Klick auf eine Kachel oder ihre Taste */
  function activate(sound: BoardSound): void {
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
    else if (action.kind === 'volume') player.setVolume(Math.round((player.settings.volume + action.step) * 100) / 100);
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
      player.stop(sound.key);
      soundSettings.forget(sound.key);
      urls.invalidate(cid, sound.id);
      files[cid].sounds = files[cid].sounds.filter((s) => s.key !== sound.key);
    } catch (err) {
      deleteError = `Löschen fehlgeschlagen: ${afterStorageError(err)}`;
    }
  }

  async function uploadOne(file: File, cid: number): Promise<void> {
    const entry: UploadEntry = { id: nextUploadId++, name: file.name, cid, progress: 0, error: '', done: false };
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
    if (!list || cid === null) return;
    const selected = [...list];
    if (selected.length === 0) return;
    await Promise.all(selected.map((file) => uploadOne(file, cid)));
    if (uploads.some((u) => u.cid === cid && u.done)) await loadFiles(cid);
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
  {@const hotkey = hotkeys.get(sound.key)}
  {@const own = soundSettings.get(sound.key)}
  <li class="tile" class:playing={state === 'playing'} class:loading={state === 'loading'}>
    <button
      class="play"
      aria-pressed={state !== undefined}
      aria-keyshortcuts={hotkey}
      onclick={() => activate(sound)}
      title={(state ? 'Stoppen' : 'Abspielen') + (hotkey ? ` (Taste ${hotkey})` : '')}
    >
      <span class="top" aria-hidden="true">
        <span class="icon">{state === 'playing' ? '■' : state === 'loading' ? '…' : '▶'}</span>
        {#if hotkey}<kbd class="hotkey">{hotkey}</kbd>{/if}
      </span>
      <span class="name">{sound.title}</span>
    </button>
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
    <label>
      Lautstärke
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={player.settings.volume}
        oninput={(e) => player.setVolume(Number((e.currentTarget as HTMLInputElement).value))}
      />
    </label>
    <label class="inline">
      <input type="checkbox" checked={!player.settings.exclusive} onchange={(e) => player.setExclusive(!(e.currentTarget as HTMLInputElement).checked)} />
      Mehrere Sounds gleichzeitig
    </label>
    <button onclick={() => player.stopAll()} disabled={Object.keys(player.states).length === 0}>Alle stoppen</button>
  </div>

  {#if categories.length > 0}
    <div class="cats" role="group" aria-label="Kategorie">
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
    <kbd>←</kbd> <kbd>→</kbd> Kategorie · <kbd>↑</kbd> <kbd>↓</kbd> Lautstärke · <kbd>Alt</kbd> Suche
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
        <p class="muted">{builtin.length === 0 ? 'Keine Standard-Sounds vorhanden.' : 'Keine Treffer.'}</p>
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
        <p class="muted">{list.sounds.length === 0 ? 'Noch keine Sounds in diesem Speicher.' : 'Keine Treffer.'}</p>
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
</style>
