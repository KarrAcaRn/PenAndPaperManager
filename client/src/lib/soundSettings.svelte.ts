// Einstellungen je Sound (Kachel): eigene Lautstärke und Endlosschleife, wie in der Effekt-Liste der Referenz
// (board.js `setEffectItemVolume`, `toggleEffectLoop`). Anders als dort merkt sie sich der Browser über das
// Neuladen hinaus – gespeichert werden nur Abweichungen vom Standard, Schlüssel ist der Sound-key.

export const SOUND_SETTINGS_KEY = 'pnp.soundboard.sounds';

export interface SoundOptions {
  /** 0…1, wird mit der Gesamtlautstärke multipliziert */
  volume: number;
  /** Endlosschleife (wirkt auch während der Wiedergabe) */
  loop: boolean;
}

export const DEFAULT_SOUND_OPTIONS: Readonly<SoundOptions> = { volume: 1, loop: false };

const clamp = (v: number) => Math.min(1, Math.max(0, v));

function load(): Record<string, SoundOptions> {
  try {
    const stored = JSON.parse(localStorage.getItem(SOUND_SETTINGS_KEY) ?? '{}') as Record<string, Partial<SoundOptions>>;
    if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {};
    const result: Record<string, SoundOptions> = {};
    for (const [key, value] of Object.entries(stored)) {
      if (typeof value !== 'object' || value === null) continue;
      result[key] = {
        volume: typeof value.volume === 'number' && Number.isFinite(value.volume) ? clamp(value.volume) : DEFAULT_SOUND_OPTIONS.volume,
        loop: typeof value.loop === 'boolean' ? value.loop : DEFAULT_SOUND_OPTIONS.loop,
      };
    }
    return result;
  } catch {
    return {};
  }
}

export function createSoundSettings() {
  const entries = $state<Record<string, SoundOptions>>(load());

  const save = () => {
    try {
      localStorage.setItem(SOUND_SETTINGS_KEY, JSON.stringify(entries));
    } catch {
      // ohne localStorage gelten die Einstellungen nur bis zum Neuladen
    }
  };

  function update(key: string, change: Partial<SoundOptions>): void {
    const next = { ...DEFAULT_SOUND_OPTIONS, ...entries[key], ...change };
    if (next.volume === DEFAULT_SOUND_OPTIONS.volume && next.loop === DEFAULT_SOUND_OPTIONS.loop) delete entries[key];
    else entries[key] = next;
    save();
  }

  return {
    get: (key: string): SoundOptions => entries[key] ?? { ...DEFAULT_SOUND_OPTIONS },
    setVolume: (key: string, volume: number) => update(key, { volume: clamp(volume) }),
    setLoop: (key: string, loop: boolean) => update(key, { loop }),
    /** z.B. nach dem Löschen der Datei */
    forget(key: string): void {
      if (!(key in entries)) return;
      delete entries[key];
      save();
    },
  };
}
export type SoundSettings = ReturnType<typeof createSoundSettings>;
