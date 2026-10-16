import type { BoardSound } from './soundboard.ts';
import type { Player } from './soundPlayer.svelte.ts';
import { REPEAT_MODES, afterRemove, firstTrack, moveItem, nextTrack, previousTrack, startAt, type Queue, type QueueMode, type RepeatMode } from './playlistQueue.ts';

// Musik-Playlisten des Soundboards. Anders als in der Referenz (genau eine Liste „Background music“, nur im
// Speicher der Seite) gibt es mehrere benannte Playlisten, und der Browser merkt sie sich (localStorage) samt
// Zufall, Wiederhol-Modus und gewählter Playlist. Gespielt wird über den Musikkanal des Players – Effekte laufen
// also wie gewohnt darüber, und ein Musiktitel per Kachel ersetzt den Playlist-Titel.

export const PLAYLISTS_KEY = 'pnp.soundboard.playlists';
export const MAX_PLAYLIST_NAME = 80;
export const MAX_PLAYLIST_TRACKS = 500;
export const MAX_PLAYLISTS = 100;

export interface PlaylistEntry {
  /** eigene ID je Eintrag – derselbe Sound darf mehrfach vorkommen (wie in der Referenz) */
  id: string;
  /** `BoardSound.key` */
  sound: string;
  /** Titel beim Hinzufügen; angezeigt, solange der Sound (noch) nicht geladen ist */
  title: string;
}

export interface Playlist {
  id: string;
  name: string;
  tracks: PlaylistEntry[];
}

interface Stored {
  playlists: Playlist[];
  selected: string | null;
  shuffle: boolean;
  repeat: RepeatMode;
}

/** getRandomValues statt randomUUID: das gibt es auch, wenn die Seite über unverschlüsseltes HTTP läuft */
export const newId = (): string => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
/** Name bzw. Titel: ohne Leerraum außen, höchstens MAX_PLAYLIST_NAME Zeichen (auch für die Effekt-Liste) */
export const clean = (text: string) => text.trim().slice(0, MAX_PLAYLIST_NAME);

/** Liest die gespeicherten Playlisten; Kaputtes wird verworfen, doppelte IDs bekommen neue */
export function loadPlaylists(): Stored {
  let raw: unknown = null;
  try {
    raw = JSON.parse(localStorage.getItem(PLAYLISTS_KEY) ?? 'null');
  } catch {
    raw = null;
  }
  const stored = isObject(raw) ? raw : {};
  const seen = new Set<string>();
  const unique = (id: unknown) => {
    const result = isText(id) && !seen.has(id) ? id : newId();
    seen.add(result);
    return result;
  };
  const playlists: Playlist[] = (Array.isArray(stored.playlists) ? stored.playlists : [])
    .filter(isObject)
    .slice(0, MAX_PLAYLISTS)
    .map((p, i) => ({
      id: unique(p.id),
      name: isText(p.name) ? clean(p.name) : `Playlist ${i + 1}`,
      tracks: (Array.isArray(p.tracks) ? p.tracks : [])
        .filter((t): t is Record<string, unknown> => isObject(t) && isText(t.sound))
        .slice(0, MAX_PLAYLIST_TRACKS)
        .map((t) => ({ id: unique(t.id), sound: t.sound as string, title: clean(isText(t.title) ? t.title : (t.sound as string)) })),
    }));
  const selected = isText(stored.selected) && playlists.some((p) => p.id === stored.selected) ? stored.selected : (playlists[0]?.id ?? null);
  return {
    playlists,
    selected,
    shuffle: stored.shuffle === true,
    repeat: REPEAT_MODES.includes(stored.repeat as RepeatMode) ? (stored.repeat as RepeatMode) : 'all',
  };
}

/** Die Playlisten samt Zufall/Wiederholen; jede Änderung wird sofort gespeichert */
export function createPlaylists() {
  const state = $state<Stored>(loadPlaylists());

  const save = () => {
    try {
      localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(state));
    } catch {
      // ohne localStorage gelten die Playlisten nur bis zum Neuladen
    }
  };
  const get = (id: string | null) => state.playlists.find((p) => p.id === id);

  /** Vorschlag für eine neue Playlist: „Playlist 1“, „Playlist 2“ … (erster freier Name) */
  function freeName(): string {
    for (let i = 1; ; i++) if (!state.playlists.some((p) => p.name === `Playlist ${i}`)) return `Playlist ${i}`;
  }

  return {
    get list(): Playlist[] {
      return state.playlists;
    },
    /** Höchstzahl an Playlisten erreicht? */
    get full(): boolean {
      return state.playlists.length >= MAX_PLAYLISTS;
    },
    get selectedId(): string | null {
      return state.selected;
    },
    get selected(): Playlist | undefined {
      return get(state.selected);
    },
    get shuffle(): boolean {
      return state.shuffle;
    },
    get repeat(): RepeatMode {
      return state.repeat;
    },
    get,
    select(id: string): void {
      if (!get(id)) return;
      state.selected = id;
      save();
    },
    /** legt eine Playlist an und wählt sie aus; null, wenn es schon MAX_PLAYLISTS gibt */
    create(name = ''): Playlist | null {
      if (state.playlists.length >= MAX_PLAYLISTS) return null;
      const playlist: Playlist = { id: newId(), name: clean(name) || freeName(), tracks: [] };
      state.playlists.push(playlist);
      state.selected = playlist.id;
      save();
      return get(playlist.id)!;
    },
    /** leerer Name wird ignoriert */
    rename(id: string, name: string): void {
      const playlist = get(id);
      const cleaned = clean(name);
      if (!playlist || !cleaned) return;
      playlist.name = cleaned;
      save();
    },
    remove(id: string): void {
      const index = state.playlists.findIndex((p) => p.id === id);
      if (index === -1) return;
      state.playlists.splice(index, 1);
      if (state.selected === id) state.selected = state.playlists[Math.min(index, state.playlists.length - 1)]?.id ?? null;
      save();
    },
    /** hängt einen Sound an (Duplikate erlaubt); null, wenn die Playlist voll ist */
    add(id: string, sound: BoardSound): PlaylistEntry | null {
      const playlist = get(id);
      if (!playlist || playlist.tracks.length >= MAX_PLAYLIST_TRACKS) return null;
      const entry: PlaylistEntry = { id: newId(), sound: sound.key, title: clean(sound.title) || sound.key };
      playlist.tracks.push(entry);
      save();
      return entry;
    },
    removeEntry(id: string, entryId: string): void {
      const playlist = get(id);
      if (!playlist) return;
      playlist.tracks = playlist.tracks.filter((t) => t.id !== entryId);
      save();
    },
    move(id: string, from: number, to: number): void {
      const playlist = get(id);
      if (!playlist) return;
      playlist.tracks = moveItem(playlist.tracks, from, to);
      save();
    },
    setShuffle(shuffle: boolean): void {
      state.shuffle = shuffle;
      save();
    },
    setRepeat(repeat: RepeatMode): void {
      state.repeat = repeat;
      save();
    },
    /** Sound gelöscht: aus allen Playlisten nehmen; liefert die entfernten Einträge */
    forgetSound(key: string): { playlistId: string; entryId: string }[] {
      const removed: { playlistId: string; entryId: string }[] = [];
      for (const playlist of state.playlists) {
        if (!playlist.tracks.some((t) => t.sound === key)) continue;
        for (const t of playlist.tracks) if (t.sound === key) removed.push({ playlistId: playlist.id, entryId: t.id });
        playlist.tracks = playlist.tracks.filter((t) => t.sound !== key);
      }
      if (removed.length > 0) save();
      return removed;
    },
    /** ist der Sound in irgendeiner Playlist? (Markierung auf der Kachel, Referenz `refreshLibraryMarks`) */
    contains(key: string): boolean {
      return state.playlists.some((p) => p.tracks.some((t) => t.sound === key));
    },
  };
}
export type Playlists = ReturnType<typeof createPlaylists>;

export interface PlaylistPlayerOptions {
  player: Player;
  playlists: Playlists;
  /** Sound zu einem `BoardSound.key`; undefined, solange er (noch) nicht geladen oder nicht mehr da ist */
  findSound: (key: string) => BoardSound | undefined;
  /** für Tests */
  random?: () => number;
}

/** 'idle' = Playlist gewählt und Titel gemerkt, aber es läuft nichts (gestoppt, Fehler, Musik per Kachel) */
export type PlaylistStatus = 'stopped' | 'idle' | 'loading' | 'playing' | 'paused';

/**
 * Wiedergabe einer Playlist auf dem Musikkanal: automatisch weiter am Titelende, Weiter/Zurück, Zufall,
 * Wiederholen. Der Player meldet das Ende eines Titels über `ended` (an `createPlayer({ onEnded })` hängen).
 */
export function createPlaylistPlayer(options: PlaylistPlayerOptions) {
  const { player, playlists, findSound } = options;
  /** aktive Playlist und Stelle darin */
  let active = $state<{ playlistId: string; queue: Queue } | null>(null);
  /** der zuletzt von der Playlist gestartete Sound – nur dessen Ende schaltet weiter */
  let owned = $state<string | null>(null);

  const mode = (): QueueMode => ({ shuffle: playlists.shuffle, repeat: playlists.repeat, random: options.random });
  const playlist = () => (active ? playlists.get(active.playlistId) : undefined);
  const ids = () => playlist()?.tracks.map((t) => t.id) ?? [];
  const entry = () => playlist()?.tracks.find((t) => t.id === active?.queue.current);

  /** Spielt den aktuellen Eintrag; nicht verfügbare werden übersprungen (höchstens einmal rundum) */
  async function startCurrent(): Promise<void> {
    for (let attempts = ids().length; active && attempts > 0; attempts--) {
      const current = entry();
      if (!current) break;
      const sound = findSound(current.sound);
      if (sound) {
        owned = sound.key;
        await player.play(sound, { channel: 'music', loop: false });
        return;
      }
      const next = nextTrack(active.queue, ids(), mode());
      if (!next) break;
      active.queue = next;
    }
    halt();
  }

  /** Musik der Playlist aus; die Playlist bleibt gewählt, der Titel gemerkt */
  function halt(): void {
    if (owned && player.music?.key === owned) player.stop(owned);
    owned = null;
  }

  function go(queue: Queue | null): Promise<void> {
    if (!active) return Promise.resolve();
    if (!queue) {
      halt();
      active = null;
      return Promise.resolve();
    }
    active.queue = queue;
    return startCurrent();
  }

  const currentKey = () => {
    const current = entry();
    return current ? findSound(current.sound)?.key : undefined;
  };

  function status(): PlaylistStatus {
    if (!active) return 'stopped';
    const key = currentKey();
    return (key && owned === key ? player.states[key] : undefined) ?? 'idle';
  }

  function play(playlistId: string, entryId?: string): Promise<void> {
    const target = playlists.get(playlistId);
    if (!target || target.tracks.length === 0) return Promise.resolve();
    halt();
    const trackIds = target.tracks.map((t) => t.id);
    const queue = entryId && trackIds.includes(entryId) ? startAt(entryId) : firstTrack(trackIds, mode());
    active = { playlistId, queue: queue! };
    return startCurrent();
  }

  function stop(): void {
    halt();
    active = null;
  }

  return {
    get playlistId(): string | null {
      return active?.playlistId ?? null;
    },
    /** aktueller Eintrag der aktiven Playlist */
    get entry(): PlaylistEntry | undefined {
      return entry();
    },
    /** Position des aktuellen Eintrags (0-basiert) */
    get index(): number {
      return active ? ids().indexOf(active.queue.current) : -1;
    },
    get status(): PlaylistStatus {
      return status();
    },
    /** spielt (oder lädt bzw. pausiert) die Playlist gerade diesen Sound? */
    owns: (key: string) => owned === key && status() !== 'idle' && status() !== 'stopped',
    /** Playlist von vorn (bzw. bei Zufall zufällig) oder ab einem Eintrag abspielen (Doppelklick) */
    play,
    /** Play/Pause wie `toggleBackgroundPlayback` der Referenz; ohne aktive Playlist startet die gewählte */
    toggle(): Promise<void> {
      const key = currentKey();
      const now = status();
      if (now === 'playing' || now === 'loading') {
        player.pause(key!);
        return Promise.resolve();
      }
      if (now === 'paused') return player.resume(key!);
      if (now === 'idle') return startCurrent();
      return playlists.selectedId ? play(playlists.selectedId) : Promise.resolve();
    },
    next(): Promise<void> {
      return active ? go(nextTrack(active.queue, ids(), mode())) : Promise.resolve();
    },
    previous(): Promise<void> {
      return active ? go(previousTrack(active.queue, ids(), mode())) : Promise.resolve();
    },
    /** Stopp: Musik aus, keine aktive Playlist mehr */
    stop,
    /** Musik kommt jetzt von anderswo (Kachel, „Musik stoppen“): Ende dieses Titels schaltet nicht mehr weiter */
    release(): void {
      owned = null;
    },
    /** an `createPlayer({ onEnded })` hängen */
    ended(sound: BoardSound, channel: string): void {
      if (channel !== 'music' || !active || owned !== sound.key) return;
      owned = null;
      void go(nextTrack(active.queue, ids(), mode(), true));
    },
    /** Eintrag entfernen; war es der laufende, spielt der nächste (Referenz `removeBackgroundItem`) */
    removeEntry(playlistId: string, entryId: string): void {
      const before = playlists.get(playlistId)?.tracks.map((t) => t.id) ?? [];
      const wasStatus = status();
      playlists.removeEntry(playlistId, entryId);
      if (active?.playlistId === playlistId) adjust(entryId, before, wasStatus);
    },
    /** Sound gelöscht: aus allen Playlisten nehmen, laufende Wiedergabe sauber weiterführen */
    forgetSound(key: string): void {
      const lists = new Map<string, string[]>(playlists.list.map((p) => [p.id, p.tracks.map((t) => t.id)]));
      const wasStatus = status();
      const removed = playlists.forgetSound(key);
      if (!active) return;
      let before = lists.get(active.playlistId) ?? [];
      for (const r of removed) {
        if (r.playlistId !== active?.playlistId) continue;
        adjust(r.entryId, before, wasStatus, false);
        before = before.filter((id) => id !== r.entryId);
      }
      if (active && wasStatus !== 'paused' && wasStatus !== 'idle' && owned === null) void startCurrent();
    },
    /** Playlist gelöscht */
    removePlaylist(playlistId: string): void {
      if (active?.playlistId === playlistId) stop();
      playlists.remove(playlistId);
    },
  };

  /**
   * Nach dem Entfernen eines Eintrags: Stelle anpassen; traf es den aktuellen, kommt der nächste – er startet
   * nur, wenn vorher etwas lief (angehalten bleibt angehalten). `start = false`: Start übernimmt der Aufrufer.
   */
  function adjust(entryId: string, before: string[], wasStatus: PlaylistStatus, start = true): void {
    if (!active) return;
    const { queue, changed } = afterRemove(active.queue, entryId, before, mode());
    if (!changed) {
      active.queue = queue!;
      return;
    }
    halt();
    if (!queue) {
      active = null;
      return;
    }
    active.queue = queue;
    if (start && wasStatus !== 'paused' && wasStatus !== 'idle') void startCurrent();
  }
}
export type PlaylistPlayer = ReturnType<typeof createPlaylistPlayer>;
