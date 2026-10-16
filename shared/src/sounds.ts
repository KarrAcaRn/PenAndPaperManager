// Soundboard: gemeinsame Typen und Grenzen für die Standardbibliothek des Betreibers
// und die Dateien aus den Storages der Nutzer.

/** Erlaubte Audio-Endungen (klein geschrieben) mit ihrem MIME-Typ */
export const AUDIO_MIME_TYPES = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
} as const;
export type AudioExtension = keyof typeof AUDIO_MIME_TYPES;
export const AUDIO_EXTENSIONS = Object.keys(AUDIO_MIME_TYPES) as AudioExtension[];

/** Endung einer Datei, wenn sie eine erlaubte Audio-Datei ist, sonst null (Dotfiles wie `.wav` zählen nicht) */
export function audioExtension(fileName: string): AudioExtension | null {
  const base = fileName.split(/[\\/]/).pop()!;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  return Object.hasOwn(AUDIO_MIME_TYPES, ext) ? (ext as AudioExtension) : null;
}

export const MAX_SOUND_ID_LENGTH = 64;
export const MAX_SOUND_TITLE_LENGTH = 120;
export const MAX_SOUND_CATEGORY_LENGTH = 40;
export const MAX_SOUND_TAGS = 10;
export const MAX_SOUND_TAG_LENGTH = 40;
export const MAX_SOUND_LICENSE_LENGTH = 300;
/** IDs der Standard-Sounds: klein, ohne Leerzeichen, damit sie stabil in URLs und Einstellungen stehen können */
export const SOUND_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

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
