import type { SoundType } from '@pnp/shared';
import type { BoardSound } from './soundboard.ts';

// Wiedergabe im Soundboard mit zwei Kanälen wie im Referenz-Soundboard:
// - Musik: immer nur ein Titel; ein neuer Titel ersetzt den laufenden (harter Wechsel wie in der Referenz),
//   auf Wunsch in Schleife.
// - Effekte: beliebig viele gleichzeitig, auch über der Musik.
// Je Sound ein eigenes Audio-Element; die Lautstärke eines Sounds ist Gesamt- × Kanallautstärke.
// Lautstärken und Schleife merkt sich der Browser (localStorage), ebenso die vom Nutzer gewählten Typen der Sounds.

/** Kanal = Typ des Sounds */
export type Channel = SoundType;
export const CHANNELS: readonly Channel[] = ['music', 'sfx'];

const SETTINGS_KEY = 'pnp.soundboard';
const TYPES_KEY = 'pnp.soundboard.types';

export interface PlayerSettings {
  /** Gesamtlautstärke 0…1 (hieß schon vor den Kanälen so, alte Einstellungen gelten weiter) */
  volume: number;
  /** Lautstärke des Musikkanals 0…1 */
  musicVolume: number;
  /** Lautstärke des Effektkanals 0…1 */
  sfxVolume: number;
  /** Musiktitel in Schleife abspielen */
  musicLoop: boolean;
}

/** Vorgaben wie in der Referenz: Musik 70 %, Effekte 100 % */
export const DEFAULT_SETTINGS: PlayerSettings = { volume: 0.8, musicVolume: 0.7, sfxVolume: 1, musicLoop: true };

export type VolumeTarget = 'master' | Channel;
const VOLUME_FIELD = { master: 'volume', music: 'musicVolume', sfx: 'sfxVolume' } as const;

const isUnit = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= 1;

function readJson(key: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ohne localStorage (z.B. privater Modus) gelten die Einstellungen nur bis zum Neuladen
  }
}

/** Liest die Einstellungen; ungültige oder fehlende Werte (auch aus älteren Fassungen) bekommen die Vorgabe */
export function loadSettings(): PlayerSettings {
  const stored = readJson(SETTINGS_KEY);
  return {
    volume: isUnit(stored.volume) ? stored.volume : DEFAULT_SETTINGS.volume,
    musicVolume: isUnit(stored.musicVolume) ? stored.musicVolume : DEFAULT_SETTINGS.musicVolume,
    sfxVolume: isUnit(stored.sfxVolume) ? stored.sfxVolume : DEFAULT_SETTINGS.sfxVolume,
    musicLoop: typeof stored.musicLoop === 'boolean' ? stored.musicLoop : DEFAULT_SETTINGS.musicLoop,
  };
}

/**
 * Typ je Sound, wie ihn der Nutzer gewählt hat (Schlüssel = `BoardSound.key`). Ohne eigene Wahl gilt die Vorgabe
 * des Sounds (`BoardSound.type`: Manifest bzw. Effekt). Gespeichert werden nur Abweichungen von der Vorgabe.
 */
export function createSoundTypes() {
  const stored = readJson(TYPES_KEY);
  const overrides = $state<Record<string, Channel>>(
    Object.fromEntries(Object.entries(stored).filter(([, v]) => v === 'music' || v === 'sfx')) as Record<string, Channel>,
  );
  return {
    typeOf: (sound: BoardSound): Channel => overrides[sound.key] ?? sound.type,
    set(sound: BoardSound, type: Channel): void {
      if (type === sound.type) delete overrides[sound.key];
      else overrides[sound.key] = type;
      writeJson(TYPES_KEY, overrides);
    },
    /** z.B. nach dem Löschen einer Datei */
    forget(key: string): void {
      if (!(key in overrides)) return;
      delete overrides[key];
      writeJson(TYPES_KEY, overrides);
    },
  };
}
export type SoundTypes = ReturnType<typeof createSoundTypes>;

export interface PlayOptions {
  /** Kanal abweichend vom Typ des Sounds */
  channel?: Channel;
  /** Schleife abweichend von der Vorgabe (Musik: Einstellung `musicLoop`, Effekte: aus) */
  loop?: boolean;
}

export interface PlayerOptions {
  /** URL eines Sounds; für Nutzer-Dateien wird sie bei Bedarf (neu) geholt */
  resolveUrl: (sound: BoardSound, retry: boolean) => Promise<string>;
  /** Kanal eines Sounds (Standard: `sound.type`), z.B. mit den Typen des Nutzers */
  typeOf?: (sound: BoardSound) => Channel;
  /** Ein Sound ist von selbst zu Ende gelaufen (nicht bei Stopp oder Schleife) – z.B. für eine Playlist */
  onEnded?: (sound: BoardSound, channel: Channel) => void;
  /** für Tests austauschbar */
  createAudio?: () => HTMLAudioElement;
  /** Lautstärke (0…1, Faktor zu Gesamt × Kanal) und Schleife je Sound; ohne: 1 und keine Schleife */
  soundOptions?: (key: string) => { volume: number; loop: boolean };
}

/** MediaError.MEDIA_ERR_NETWORK (als Zahl, weil nicht jede Umgebung MediaError kennt) */
const MEDIA_ERR_NETWORK = 2;

function mediaErrorMessage(audio: HTMLAudioElement): string {
  return audio.error?.code === MEDIA_ERR_NETWORK
    ? 'Die Verbindung ist beim Laden abgebrochen.'
    : 'Die Datei ließ sich nicht laden – sie ist nicht mehr abrufbar oder das Format wird vom Browser nicht unterstützt.';
}

const clampUnit = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

export function createPlayer(options: PlayerOptions) {
  const createAudio = options.createAudio ?? (() => new Audio());
  const typeOf = options.typeOf ?? ((sound: BoardSound) => sound.type);
  const settings = $state<PlayerSettings>(loadSettings());
  /** Zustand je Kachel (key): lädt, spielt oder Fehlermeldung */
  const states = $state<Record<string, 'loading' | 'playing'>>({});
  const errors = $state<Record<string, string>>({});
  /** Kanal je laufendem oder ladendem Sound */
  const channels = $state<Record<string, Channel>>({});
  /** der Titel im Musikkanal (lädt oder spielt) */
  let music = $state<BoardSound | null>(null);
  const audios = new Map<string, HTMLAudioElement>();
  /** Sounds mit eigener Schleifen-Angabe beim Start; die Einstellungen ändern sie dann nicht mehr */
  const explicitLoop = new Map<string, boolean>();
  /** Zählt Starts je Kachel, damit ein später fertig gewordener alter Start nichts mehr anrichtet */
  const generation = new Map<string, number>();

  const save = () => writeJson(SETTINGS_KEY, settings);
  const volumeOf = (channel: Channel) => settings.volume * (channel === 'music' ? settings.musicVolume : settings.sfxVolume);
  const soundOptions = options.soundOptions ?? (() => ({ volume: 1, loop: false }));

  /**
   * Lautstärke = Gesamt × Kanal × eigene Lautstärke des Sounds. Schleife: Angabe beim Start, sonst die eigene
   * Schleife des Sounds, bei Musik zusätzlich „Musik wiederholen“.
   */
  function applyOptions(key: string, audio: HTMLAudioElement): void {
    const channel = channels[key] ?? 'sfx';
    const own = soundOptions(key);
    audio.volume = volumeOf(channel) * own.volume;
    audio.loop = explicitLoop.get(key) ?? (own.loop || (channel === 'music' && settings.musicLoop));
  }

  function applyAll(): void {
    for (const [key, audio] of audios) applyOptions(key, audio);
  }

  function stop(key: string): void {
    generation.set(key, (generation.get(key) ?? 0) + 1);
    const audio = audios.get(key);
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audios.delete(key);
    }
    delete states[key];
    delete channels[key];
    explicitLoop.delete(key);
    if (music?.key === key) music = null;
  }

  const keysIn = (channel: Channel) => Object.keys(channels).filter((key) => channels[key] === channel);

  function stopChannel(channel: Channel): void {
    for (const key of keysIn(channel)) stop(key);
  }

  function stopAll(): void {
    for (const key of new Set([...audios.keys(), ...Object.keys(states), ...Object.keys(channels)])) stop(key);
  }

  async function play(sound: BoardSound, playOptions: PlayOptions = {}): Promise<void> {
    const channel = playOptions.channel ?? typeOf(sound);
    stop(sound.key);
    // Musik: ein neuer Titel ersetzt den laufenden
    if (channel === 'music') stopChannel('music');
    const gen = (generation.get(sound.key) ?? 0) + 1;
    generation.set(sound.key, gen);
    const current = () => generation.get(sound.key) === gen;
    delete errors[sound.key];
    states[sound.key] = 'loading';
    channels[sound.key] = channel;
    if (playOptions.loop !== undefined) explicitLoop.set(sound.key, playOptions.loop);
    if (channel === 'music') music = sound;

    const start = async (retry: boolean): Promise<void> => {
      const url = await options.resolveUrl(sound, retry);
      if (!current()) return;
      const audio = createAudio();
      audios.set(sound.key, audio);
      applyOptions(sound.key, audio);
      audio.preload = 'auto';
      audio.onended = () => {
        if (!current() || audios.get(sound.key) !== audio) return;
        stop(sound.key);
        options.onEnded?.(sound, channel);
      };
      audio.onerror = () => {
        if (!current() || audios.get(sound.key) !== audio) return;
        audios.delete(sound.key);
        // Nutzer-Dateien: die URL ist vielleicht abgelaufen – einmal mit frischer URL versuchen
        if (!retry && sound.url === null) {
          start(true).catch(fail);
          return;
        }
        fail(new Error(mediaErrorMessage(audio)));
      };
      audio.src = url;
      try {
        await audio.play();
      } catch (err) {
        // Fehler beim Laden meldet onerror (samt Neuversuch); hier nur, was play() selbst ablehnt
        if ((err as DOMException)?.name === 'NotAllowedError') {
          throw new Error('Der Browser hat die Wiedergabe blockiert – bitte noch einmal klicken.');
        }
        if ((err as DOMException)?.name === 'AbortError') return;
        if (audio.error) return;
        throw err;
      }
      if (current() && audios.get(sound.key) === audio) states[sound.key] = 'playing';
    };

    const fail = (err: unknown) => {
      if (!current()) return;
      stop(sound.key);
      errors[sound.key] = (err as Error)?.message ?? String(err);
    };

    await start(false).catch(fail);
  }

  return {
    settings,
    states,
    errors,
    /** Kanal je laufendem oder ladendem Sound */
    channels,
    /** der aktuelle Musiktitel (lädt oder spielt), sonst null */
    get music(): BoardSound | null {
      return music;
    },
    isActive: (key: string) => key in states,
    /** läuft (oder lädt) etwas auf dem Kanal? */
    isChannelActive: (channel: Channel) => Object.values(channels).includes(channel),
    /** tatsächliche Lautstärke eines Kanals (Gesamt × Kanal) */
    volumeOf,
    toggle(sound: BoardSound, playOptions?: PlayOptions): Promise<void> {
      if (sound.key in states) {
        stop(sound.key);
        return Promise.resolve();
      }
      return play(sound, playOptions);
    },
    play,
    stop,
    stopChannel,
    stopAll,
    setVolume(target: VolumeTarget, volume: number): void {
      settings[VOLUME_FIELD[target]] = clampUnit(volume);
      applyAll();
      save();
    },
    /** Lautstärke/Schleife eines Sounds geändert: gilt sofort, auch während er läuft */
    refreshSound(key: string): void {
      const audio = audios.get(key);
      if (audio) applyOptions(key, audio);
    },
    /** wirkt auch auf den laufenden Musiktitel, außer er wurde mit eigener Schleifen-Angabe gestartet */
    setMusicLoop(loop: boolean): void {
      settings.musicLoop = loop;
      applyAll();
      save();
    },
    clearError(key: string): void {
      delete errors[key];
    },
  };
}
export type Player = ReturnType<typeof createPlayer>;
