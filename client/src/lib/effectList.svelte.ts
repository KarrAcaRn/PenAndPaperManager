import type { BoardSound } from './soundboard.ts';
import type { Player } from './soundPlayer.svelte.ts';
import { moveItem } from './playlistQueue.ts';
import { clean, isObject, isText, newId } from './playlists.svelte.ts';

// Effekt-Liste („Szene“) wie die Effects-Playlist der Referenz (board.js `addToEffectsPlaylist`,
// `toggleEffectPlayback`, `toggleEffectLoop`, `setEffectItemVolume`, `removeEffectItem`, `reorderEffectsPlaylist`):
// Effekte per „+“ zusammenstellen; ein neuer Eintrag startet sofort bei Lautstärke 0 in Schleife und wird per Regler
// eingeblendet. Jeder Eintrag läuft als eigener Sound auf dem Effektkanal des Players (Gesamt × Effekte × Regler des
// Eintrags), auch wenn derselbe Sound mehrfach in der Liste steht oder gleichzeitig per Kachel läuft.
// Anders als in der Referenz merkt sich der Browser die Liste samt Reglern und Schleife (localStorage) – nach dem
// Neuladen läuft aber nichts von selbst.

export const EFFECT_LIST_KEY = 'pnp.soundboard.effects';
export const MAX_EFFECT_ENTRIES = 100;

export interface EffectEntry {
  /** eigene ID je Eintrag – derselbe Effekt darf mehrfach vorkommen (wie in der Referenz) */
  id: string;
  /** `BoardSound.key` */
  sound: string;
  /** Titel beim Hinzufügen; angezeigt, solange der Sound (noch) nicht geladen ist */
  title: string;
  /** 0…1, ersetzt beim Abspielen die eigene Lautstärke des Sounds (Kachel) */
  volume: number;
  /** Endlosschleife, Vorgabe an (wie in der Referenz) */
  loop: boolean;
}

/** Schlüssel im Player für einen Eintrag – getrennt vom Sound-key der Kachel */
const KEY_PREFIX = 'effect-list:';
export const entryKey = (entryId: string) => `${KEY_PREFIX}${entryId}`;
export const entryIdOf = (key: string): string | null => (key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : null);

const isUnit = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= 1;
const clampUnit = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/** Liest die gespeicherte Liste; Kaputtes wird verworfen, doppelte IDs bekommen neue */
export function loadEffectList(): EffectEntry[] {
  let raw: unknown = null;
  try {
    raw = JSON.parse(localStorage.getItem(EFFECT_LIST_KEY) ?? 'null');
  } catch {
    raw = null;
  }
  const entries = isObject(raw) && Array.isArray(raw.entries) ? raw.entries : [];
  const seen = new Set<string>();
  return entries
    .filter((e): e is Record<string, unknown> => isObject(e) && isText(e.sound))
    .slice(0, MAX_EFFECT_ENTRIES)
    .map((e) => {
      const id = isText(e.id) && !seen.has(e.id) ? e.id : newId();
      seen.add(id);
      const sound = e.sound as string;
      return {
        id,
        sound,
        title: clean(isText(e.title) ? e.title : sound),
        volume: isUnit(e.volume) ? e.volume : 0,
        loop: typeof e.loop === 'boolean' ? e.loop : true,
      };
    });
}

/** Die Einträge der Effekt-Liste; jede Änderung wird sofort gespeichert */
export function createEffectList() {
  const state = $state<{ entries: EffectEntry[] }>({ entries: loadEffectList() });

  const save = () => {
    try {
      localStorage.setItem(EFFECT_LIST_KEY, JSON.stringify(state));
    } catch {
      // ohne localStorage gilt die Liste nur bis zum Neuladen
    }
  };
  const get = (id: string) => state.entries.find((e) => e.id === id);

  return {
    get entries(): EffectEntry[] {
      return state.entries;
    },
    get full(): boolean {
      return state.entries.length >= MAX_EFFECT_ENTRIES;
    },
    get,
    /** hängt einen Effekt an (Lautstärke 0, Schleife an); null, wenn die Liste voll ist */
    add(sound: BoardSound): EffectEntry | null {
      if (state.entries.length >= MAX_EFFECT_ENTRIES) return null;
      state.entries.push({ id: newId(), sound: sound.key, title: clean(sound.title) || sound.key, volume: 0, loop: true });
      save();
      return state.entries[state.entries.length - 1];
    },
    remove(id: string): void {
      state.entries = state.entries.filter((e) => e.id !== id);
      save();
    },
    move(from: number, to: number): void {
      state.entries = moveItem(state.entries, from, to);
      save();
    },
    setVolume(id: string, volume: number): void {
      const entry = get(id);
      if (!entry) return;
      entry.volume = clampUnit(volume);
      save();
    },
    setLoop(id: string, loop: boolean): void {
      const entry = get(id);
      if (!entry) return;
      entry.loop = loop;
      save();
    },
    /** Sound gelöscht: alle seine Einträge entfernen; liefert deren IDs */
    forgetSound(key: string): string[] {
      const removed = state.entries.filter((e) => e.sound === key).map((e) => e.id);
      if (removed.length === 0) return removed;
      state.entries = state.entries.filter((e) => e.sound !== key);
      save();
      return removed;
    },
    contains(key: string): boolean {
      return state.entries.some((e) => e.sound === key);
    },
  };
}
export type EffectList = ReturnType<typeof createEffectList>;

export interface EffectListPlayerOptions {
  player: Player;
  list: EffectList;
  /** Sound zu einem `BoardSound.key`; undefined, solange er (noch) nicht geladen oder nicht mehr da ist */
  findSound: (key: string) => BoardSound | undefined;
}

/**
 * Wiedergabe der Effekt-Liste über den Player. `soundOptions` gehört in `createPlayer({ soundOptions })`: für
 * Einträge liefert es deren Regler und Schleife (wirken sofort, auch während der Wiedergabe), sonst null.
 */
export function createEffectListPlayer({ player, list, findSound }: EffectListPlayerOptions) {
  function play(id: string): Promise<void> {
    const entry = list.get(id);
    const sound = entry && findSound(entry.sound);
    if (!entry || !sound) return Promise.resolve();
    // eigener key je Eintrag; Quelle und Datei bleiben die des Sounds (URL, Neuversuch)
    return player.play({ ...sound, key: entryKey(id) }, { channel: 'sfx' });
  }

  const stop = (id: string) => player.stop(entryKey(id));

  return {
    /** lädt oder spielt der Eintrag? */
    isPlaying: (id: string) => player.isActive(entryKey(id)),
    state: (id: string) => player.states[entryKey(id)],
    error: (id: string): string | undefined => player.errors[entryKey(id)],
    /** „+“ an der Kachel: anhängen und sofort (stumm) starten; null, wenn die Liste voll ist */
    add(sound: BoardSound): EffectEntry | null {
      const entry = list.add(sound);
      if (entry) void play(entry.id);
      return entry;
    },
    play,
    stop,
    toggle(id: string): Promise<void> {
      if (player.isActive(entryKey(id))) {
        stop(id);
        return Promise.resolve();
      }
      return play(id);
    },
    setVolume(id: string, volume: number): void {
      list.setVolume(id, volume);
      player.refreshSound(entryKey(id));
    },
    setLoop(id: string, loop: boolean): void {
      list.setLoop(id, loop);
      player.refreshSound(entryKey(id));
    },
    /** Entfernen stoppt den Eintrag (Referenz `removeEffectItem`) */
    remove(id: string): void {
      stop(id);
      player.clearError(entryKey(id));
      list.remove(id);
    },
    move: (from: number, to: number) => list.move(from, to),
    /** Sound gelöscht: seine Einträge stoppen und entfernen */
    forgetSound(key: string): void {
      for (const id of list.forgetSound(key)) {
        stop(id);
        player.clearError(entryKey(id));
      }
    },
    soundOptions(key: string): { volume: number; loop: boolean } | null {
      const id = entryIdOf(key);
      const entry = id === null ? undefined : list.get(id);
      return entry ? { volume: entry.volume, loop: entry.loop } : null;
    },
  };
}
export type EffectListPlayer = ReturnType<typeof createEffectListPlayer>;
