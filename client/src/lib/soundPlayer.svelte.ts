import type { BoardSound } from './soundboard.ts';

// Wiedergabe im Soundboard: je Kachel ein eigenes Audio-Element, damit mehrere Sounds gleichzeitig laufen können.
// Im exklusiven Modus stoppt ein neuer Sound alle anderen. Lautstärke und Modus merkt sich der Browser.

const SETTINGS_KEY = 'pnp.soundboard';

export interface PlayerSettings {
  /** 0…1 */
  volume: number;
  /** true: nur ein Sound zur Zeit */
  exclusive: boolean;
}

const DEFAULT_SETTINGS: PlayerSettings = { volume: 0.8, exclusive: false };

function loadSettings(): PlayerSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<PlayerSettings>;
    return {
      volume: typeof stored.volume === 'number' && stored.volume >= 0 && stored.volume <= 1 ? stored.volume : DEFAULT_SETTINGS.volume,
      exclusive: typeof stored.exclusive === 'boolean' ? stored.exclusive : DEFAULT_SETTINGS.exclusive,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export interface PlayerOptions {
  /** URL eines Sounds; für Nutzer-Dateien wird sie bei Bedarf (neu) geholt */
  resolveUrl: (sound: BoardSound, retry: boolean) => Promise<string>;
  /** für Tests austauschbar */
  createAudio?: () => HTMLAudioElement;
  /** Lautstärke (0…1, Faktor zur Gesamtlautstärke) und Schleife je Sound; ohne: 1 und keine Schleife */
  soundOptions?: (key: string) => { volume: number; loop: boolean };
}

/** MediaError.MEDIA_ERR_NETWORK (als Zahl, weil nicht jede Umgebung MediaError kennt) */
const MEDIA_ERR_NETWORK = 2;

function mediaErrorMessage(audio: HTMLAudioElement): string {
  return audio.error?.code === MEDIA_ERR_NETWORK
    ? 'Die Verbindung ist beim Laden abgebrochen.'
    : 'Die Datei ließ sich nicht laden – sie ist nicht mehr abrufbar oder das Format wird vom Browser nicht unterstützt.';
}

export function createPlayer(options: PlayerOptions) {
  const createAudio = options.createAudio ?? (() => new Audio());
  const settings = $state<PlayerSettings>(loadSettings());
  /** Zustand je Kachel (key): lädt, spielt oder Fehlermeldung */
  const states = $state<Record<string, 'loading' | 'playing'>>({});
  const errors = $state<Record<string, string>>({});
  const audios = new Map<string, HTMLAudioElement>();
  /** Zählt Starts je Kachel, damit ein später fertig gewordener alter Start nichts mehr anrichtet */
  const generation = new Map<string, number>();

  const soundOptions = options.soundOptions ?? (() => ({ volume: 1, loop: false }));

  /** Gesamtlautstärke × Lautstärke des Sounds, dazu die Schleife */
  function applyOptions(key: string, audio: HTMLAudioElement): void {
    const own = soundOptions(key);
    audio.volume = settings.volume * own.volume;
    audio.loop = own.loop;
  }

  const save = () => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // ohne localStorage (z.B. privater Modus) gelten die Einstellungen nur bis zum Neuladen
    }
  };

  function stop(key: string): void {
    generation.set(key, (generation.get(key) ?? 0) + 1);
    const audio = audios.get(key);
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audios.delete(key);
    }
    delete states[key];
  }

  function stopAll(): void {
    for (const key of new Set([...audios.keys(), ...Object.keys(states)])) stop(key);
  }

  async function play(sound: BoardSound): Promise<void> {
    if (settings.exclusive) stopAll();
    else stop(sound.key);
    const gen = (generation.get(sound.key) ?? 0) + 1;
    generation.set(sound.key, gen);
    const current = () => generation.get(sound.key) === gen;
    delete errors[sound.key];
    states[sound.key] = 'loading';

    const start = async (retry: boolean): Promise<void> => {
      const url = await options.resolveUrl(sound, retry);
      if (!current()) return;
      const audio = createAudio();
      audios.set(sound.key, audio);
      applyOptions(sound.key, audio);
      audio.preload = 'auto';
      audio.onended = () => current() && stop(sound.key);
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
    isActive: (key: string) => key in states,
    toggle(sound: BoardSound): Promise<void> {
      if (sound.key in states) {
        stop(sound.key);
        return Promise.resolve();
      }
      return play(sound);
    },
    play,
    stop,
    stopAll,
    setVolume(volume: number): void {
      settings.volume = Math.min(1, Math.max(0, volume));
      for (const [key, audio] of audios) applyOptions(key, audio);
      save();
    },
    /** Lautstärke/Schleife eines Sounds geändert: gilt sofort, auch während er läuft */
    refreshSound(key: string): void {
      const audio = audios.get(key);
      if (audio) applyOptions(key, audio);
    },
    setExclusive(exclusive: boolean): void {
      settings.exclusive = exclusive;
      save();
    },
    clearError(key: string): void {
      delete errors[key];
    },
  };
}
export type Player = ReturnType<typeof createPlayer>;
