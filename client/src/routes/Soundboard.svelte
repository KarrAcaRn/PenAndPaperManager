<script lang="ts">
  import { STORAGE_PROVIDER_LABELS, MAX_STORAGE_UPLOAD_BYTES, type StorageConnection } from '@pnp/shared';
  import { ApiFailure, api } from '../lib/api.ts';
  import { href } from '../lib/router.svelte.ts';
  import { session } from '../lib/session.svelte.ts';
  import { createTask } from '../lib/task.svelte.ts';
  import UserMenu from '../lib/UserMenu.svelte';
  import { createPlayer } from '../lib/soundPlayer.svelte.ts';
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
  let nextUploadId = 0;

  const builtinTask = createTask();
  const connectionsTask = createTask();

  const urls = createPlaybackUrlCache((cid, fileId) => api.playbackUrl(cid, fileId));

  /** 409 heißt: Verbindung getrennt oder Rechte fehlen – dann den gespeicherten Status neu laden */
  function afterStorageError(err: unknown): string {
    if (err instanceof ApiFailure && err.status === 409) reloadConnections();
    return describeStorageError(err);
  }

  const player = createPlayer({
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
  const categories = $derived(categoriesOf(builtin));
  const visibleBuiltin = $derived(filterSounds(builtin, query, category));
  const visibleConnections = $derived(connections.filter((c) => source === '' || source === String(c.id)));

  async function remove(sound: BoardSound): Promise<void> {
    if (sound.source === 'builtin' || !sound.deletable) return;
    if (!confirm(`„${sound.title}“ endgültig aus deinem Speicher löschen?`)) return;
    const cid = sound.source;
    deleteError = '';
    try {
      await api.deleteStorageFile(cid, sound.id);
      player.stop(sound.key);
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
  <li class="tile" class:playing={state === 'playing'} class:loading={state === 'loading'}>
    <button class="play" aria-pressed={state !== undefined} onclick={() => player.toggle(sound)} title={state ? 'Stoppen' : 'Abspielen'}>
      <span class="icon" aria-hidden="true">{state === 'playing' ? '■' : state === 'loading' ? '…' : '▶'}</span>
      <span class="name">{sound.title}</span>
    </button>
    {#if sound.deletable}
      <button class="delete danger" aria-label="„{sound.title}“ löschen" title="Löschen" onclick={() => remove(sound)}>✕</button>
    {/if}
    {#if player.errors[sound.key]}<p class="error" role="alert">{player.errors[sound.key]}</p>{/if}
  </li>
{/snippet}

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
      <input type="search" placeholder="Titel suchen …" bind:value={query} />
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
    {#if showsBuiltin && categories.length > 1}
      <label>
        Kategorie
        <select bind:value={category}>
          <option value="">Alle</option>
          {#each categories as c (c)}<option value={c}>{c}</option>{/each}
        </select>
      </label>
    {/if}
    <label>
      Lautstärke
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
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
      {:else if visibleBuiltin.length === 0}
        <p class="muted">{builtin.length === 0 ? 'Keine Standard-Sounds vorhanden.' : 'Keine Treffer.'}</p>
      {:else}
        {#each groupByCategory(visibleBuiltin) as group (group.category)}
          <h3>{group.category}</h3>
          <ul class="tiles">
            {#each group.sounds as sound (sound.key)}{@render tile(sound)}{/each}
          </ul>
        {/each}
      {/if}
    </section>
  {/if}

  {#each visibleConnections as c (c.id)}
    {@const list = files[c.id]}
    {@const visible = filterSounds(list?.sounds ?? [], query)}
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
      {:else if visible.length === 0 && !list.error}
        <p class="muted">{list.sounds.length === 0 ? 'Noch keine Sounds in diesem Speicher.' : 'Keine Treffer.'}</p>
      {:else}
        <ul class="tiles">
          {#each visible as sound (sound.key)}{@render tile(sound)}{/each}
        </ul>
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
  .upload.dragging { border-color: var(--accent); background: var(--bg); }
  .upload label { margin-bottom: 0; }
  label.file { position: relative; overflow: hidden; }
  label.file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
  .uploads { list-style: none; padding: 0; margin: 0.75rem 0 0; }
  .uploads li { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; padding: 0.2rem 0; }
  .uploads progress { flex: 1; min-width: 8rem; max-width: 20rem; }
  ul.tiles { list-style: none; padding: 0; margin: 0 0 1rem; display: grid; grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr)); gap: 0.5rem; }
  .tile { position: relative; }
  .tile .play { width: 100%; min-height: 4.5rem; display: flex; flex-direction: column; align-items: flex-start; gap: 0.25rem; text-align: left; padding-right: 2rem; }
  .tile.playing .play { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
  .tile.loading .play { border-color: var(--accent); }
  .tile .icon { font-size: 0.85em; opacity: 0.8; }
  .tile .name { font-weight: 600; overflow-wrap: anywhere; }
  .tile .delete { position: absolute; top: 0.25rem; right: 0.25rem; padding: 0.1rem 0.4rem; font-size: 0.8em; }
  .tile .error { font-size: 0.85em; }
</style>
