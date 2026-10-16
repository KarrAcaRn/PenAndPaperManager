// Soundboard: gemeinsame Typen und Grenzen für die Standardbibliothek des Betreibers
// und die Dateien aus den Storages der Nutzer.

// Endungen und MIME-Typen (AUDIO_EXTENSIONS, AUDIO_MIME_TYPES, audioExtension) stehen in storage.ts.

export const MAX_SOUND_ID_LENGTH = 64;
export const MAX_SOUND_TITLE_LENGTH = 120;
export const MAX_SOUND_CATEGORY_LENGTH = 40;
export const MAX_SOUND_TAGS = 10;
export const MAX_SOUND_TAG_LENGTH = 40;
export const MAX_SOUND_LICENSE_LENGTH = 300;
/** IDs der Standard-Sounds: klein, ohne Leerzeichen, damit sie stabil in URLs und Einstellungen stehen können */
export const SOUND_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Art eines Sounds und damit der Kanal, auf dem er läuft: `sfx` (Effekt, mehrere gleichzeitig) oder `music`
 * (Hintergrundmusik, immer nur ein Titel). Die Referenz kennt nur diese beiden; „Ambience“ gibt es dort nicht.
 */
export const SOUND_TYPES = ['sfx', 'music'] as const;
export type SoundType = (typeof SOUND_TYPES)[number];
/** Gilt für Sounds ohne Angabe (ältere Manifeste, Dateien aus dem eigenen Speicher) */
export const DEFAULT_SOUND_TYPE: SoundType = 'sfx';
export const isSoundType = (value: unknown): value is SoundType => SOUND_TYPES.includes(value as SoundType);

/**
 * Gemeinsame Form aller Sounds im Soundboard. `source` ist `builtin` für die Standardbibliothek,
 * für Nutzer-Dateien die Kennung des Storages. `url` fehlt, wenn sie erst geholt werden muss
 * (kurzlebige Playback-URL eines Storages).
 */
export interface SoundEntry {
  source: string;
  id: string;
  title: string;
  url?: string;
}

/** Ein Sound der Standardbibliothek, wie ihn GET /api/sounds/builtin liefert */
export interface BuiltinSound extends SoundEntry {
  source: 'builtin';
  url: string;
  /** z.B. „Musik“ oder „Effekte“ */
  category: string;
  /** Vorgabe des Betreibers; im Soundboard kann jeder Nutzer das für sich ändern */
  type: SoundType;
  /** Dauer in Sekunden, null wenn im Manifest nicht angegeben */
  durationSec: number | null;
  tags: string[];
  /** Lizenz- bzw. Quellenhinweis, null wenn im Manifest nicht angegeben */
  license: string | null;
  mimeType: string;
}

export interface BuiltinSoundList {
  sounds: BuiltinSound[];
}
