import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import {
  AUDIO_EXTENSIONS,
  AUDIO_MIME_TYPES,
  MAX_SOUND_CATEGORY_LENGTH,
  MAX_SOUND_ID_LENGTH,
  MAX_SOUND_LICENSE_LENGTH,
  MAX_SOUND_TAG_LENGTH,
  MAX_SOUND_TAGS,
  MAX_SOUND_TITLE_LENGTH,
  SOUND_ID_PATTERN,
  audioExtension,
  hasControlChars,
  hasVisibleText,
  type BuiltinSound,
} from '@pnp/shared';

// Standardbibliothek des Betreibers: Audio-Dateien plus Manifest `sounds.json` in einem Ordner, der nur auf dem
// Server gepflegt wird (Pflege siehe README). Die Web-App lädt nichts dorthin hoch.

export const SOUND_MANIFEST = 'sounds.json';
/** Unter diesem Pfad liefert der Server die Dateien selbst aus */
export const BUILTIN_SOUND_PREFIX = '/sounds/default/';

/** Ein Eintrag, wie er im Manifest steht (Pfad relativ zum Ordner des Manifests) */
export interface SoundManifestEntry {
  id: string;
  title: string;
  category: string;
  file: string;
  durationSec: number | null;
  tags: string[];
  license: string | null;
}

export class SoundManifestError extends Error {}

const KNOWN_FIELDS = new Set(['id', 'title', 'category', 'file', 'durationSec', 'tags', 'license']);
const RESERVED_URL_CHARS = /[;?:@&=+$,#]/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const text = (entry: Record<string, unknown>, field: string, max: number, where: string) =>
  textValue(entry[field], field, max, where);

function textValue(value: unknown, field: string, max: number, where: string): string {
  if (typeof value !== 'string' || !hasVisibleText(value)) throw new SoundManifestError(`${where}: „${field}“ fehlt oder ist leer`);
  const trimmed = value.trim();
  if (hasControlChars(trimmed)) throw new SoundManifestError(`${where}: „${field}“ enthält Steuerzeichen`);
  if (trimmed.length > max) throw new SoundManifestError(`${where}: „${field}“ ist länger als ${max} Zeichen`);
  return trimmed;
}

/** Relativer Pfad ohne `..`, ohne führenden Schrägstrich, mit erlaubter Audio-Endung */
function filePath(entry: Record<string, unknown>, where: string): string {
  const file = text(entry, 'file', 300, where);
  const segments = file.split('/');
  if (file.includes('\\') || segments.some((s) => s === '' || s === '.' || s === '..' || s.startsWith('.'))) {
    throw new SoundManifestError(`${where}: „file“ muss ein relativer Pfad im Sound-Ordner sein (${file})`);
  }
  // Reservierte URL-Zeichen dekodiert die statische Auslieferung nicht zurück (decodeURI) – solche Dateien wären
  // nie abrufbar.
  if (RESERVED_URL_CHARS.test(file)) {
    throw new SoundManifestError(`${where}: „file“ darf keines der Zeichen ; ? : @ & = + $ , # enthalten (${file})`);
  }
  if (!audioExtension(file)) {
    throw new SoundManifestError(`${where}: „file“ muss auf ${AUDIO_EXTENSIONS.map((e) => `.${e}`).join(', ')} enden (${file})`);
  }
  return file;
}

/**
 * Prüft den Inhalt von `sounds.json`. `exists` meldet, ob die Datei zu einem Pfad vorhanden ist;
 * fehlende Dateien sind ein Fehler, damit der Betreiber Tippfehler sofort beim Start sieht.
 */
export function parseSoundManifest(raw: unknown, exists: (file: string) => boolean = () => true): SoundManifestEntry[] {
  if (!isRecord(raw)) throw new SoundManifestError('Manifest muss ein JSON-Objekt sein');
  if (raw.version !== 1) throw new SoundManifestError('Manifest: „version“ muss 1 sein');
  if (!Array.isArray(raw.sounds)) throw new SoundManifestError('Manifest: „sounds“ muss eine Liste sein');
  const ids = new Set<string>();
  return raw.sounds.map((entry, i): SoundManifestEntry => {
    let where = `Sound ${i + 1}`;
    if (!isRecord(entry)) throw new SoundManifestError(`${where}: muss ein Objekt sein`);
    const id = text(entry, 'id', MAX_SOUND_ID_LENGTH, where);
    where = `Sound „${id}“`;
    if (!SOUND_ID_PATTERN.test(id)) throw new SoundManifestError(`${where}: „id“ darf nur a–z, 0–9, - und _ enthalten`);
    if (ids.has(id)) throw new SoundManifestError(`${where}: „id“ kommt doppelt vor`);
    ids.add(id);
    const unknown = Object.keys(entry).filter((k) => !KNOWN_FIELDS.has(k));
    if (unknown.length) throw new SoundManifestError(`${where}: unbekannte Felder ${unknown.join(', ')}`);

    const file = filePath(entry, where);
    if (!exists(file)) throw new SoundManifestError(`${where}: Datei ${file} nicht gefunden`);

    let durationSec: number | null = null;
    if (entry.durationSec !== undefined && entry.durationSec !== null) {
      if (typeof entry.durationSec !== 'number' || !Number.isFinite(entry.durationSec) || entry.durationSec <= 0) {
        throw new SoundManifestError(`${where}: „durationSec“ muss eine positive Zahl (Sekunden) sein`);
      }
      durationSec = entry.durationSec;
    }

    let tags: string[] = [];
    if (entry.tags !== undefined && entry.tags !== null) {
      if (!Array.isArray(entry.tags) || entry.tags.length > MAX_SOUND_TAGS) {
        throw new SoundManifestError(`${where}: „tags“ muss eine Liste mit höchstens ${MAX_SOUND_TAGS} Einträgen sein`);
      }
      tags = [...new Set(entry.tags.map((tag: unknown, t) => textValue(tag, `tags[${t}]`, MAX_SOUND_TAG_LENGTH, where)))];
    }

    const license = entry.license === undefined || entry.license === null ? null : text(entry, 'license', MAX_SOUND_LICENSE_LENGTH, where);
    return {
      id,
      title: text(entry, 'title', MAX_SOUND_TITLE_LENGTH, where),
      category: text(entry, 'category', MAX_SOUND_CATEGORY_LENGTH, where),
      file,
      durationSec,
      tags,
      license,
    };
  });
}

/**
 * Liest und prüft das Manifest im Ordner; null, wenn es kein Manifest gibt. Dateien zählen nur als vorhanden, wenn
 * sie – auch nach Auflösen von Symlinks – im Ordner liegen.
 */
export function loadSoundManifest(dir: string): SoundManifestEntry[] | null {
  let content: string;
  try {
    content = readFileSync(join(dir, SOUND_MANIFEST), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (err) {
    throw new SoundManifestError(`${SOUND_MANIFEST} ist kein gültiges JSON: ${(err as Error).message}`);
  }
  const root = realpathSync(dir) + sep;
  const isFile = (file: string) => {
    try {
      const real = realpathSync(join(dir, file));
      return real.startsWith(root) && statSync(real).isFile();
    } catch {
      return false;
    }
  };
  return parseSoundManifest(raw, isFile);
}

/** Basis-URL prüfen und normalisieren: Pfad ab Wurzel oder http(s)-URL, immer mit abschließendem Schrägstrich */
export const soundBaseUrl = (base: string | undefined) => {
  const url = base?.trim() || BUILTIN_SOUND_PREFIX;
  if (!/^(\/|https?:\/\/)/.test(url)) {
    throw new SoundManifestError(`SOUNDS_BASE_URL muss mit / oder http(s):// beginnen (${url})`);
  }
  return url.endsWith('/') ? url : `${url}/`;
};

export function toBuiltinSound(entry: SoundManifestEntry, baseUrl: string): BuiltinSound {
  return {
    source: 'builtin',
    id: entry.id,
    title: entry.title,
    url: baseUrl + entry.file.split('/').map(encodeURIComponent).join('/'),
    category: entry.category,
    durationSec: entry.durationSec,
    tags: entry.tags,
    license: entry.license,
    mimeType: AUDIO_MIME_TYPES[audioExtension(entry.file)!],
  };
}

export interface SoundLibrary {
  /** aktuelle Liste; ein geändertes Manifest wird beim nächsten Abruf neu eingelesen */
  list(): BuiltinSound[];
  /** steht die Datei (Pfad relativ zum Ordner) im aktuellen Manifest? Nur solche liefert der Server aus. */
  hasFile(file: string): boolean;
}

/**
 * Lädt das Manifest sofort (fehlender Ordner oder fehlerhaftes Manifest verhindern den Start; ohne Manifest ist die
 * Bibliothek leer) und danach erneut, sobald sich `sounds.json` ändert. Ist eine spätere Fassung fehlerhaft oder
 * fehlt sie, bleibt die letzte gültige Liste aktiv; der Fehler wird einmal je Fassung gemeldet und bei jedem Abruf
 * erneut versucht, damit z.B. eine nachgereichte Audio-Datei ohne weiteres Anfassen des Manifests wirkt.
 */
export function createSoundLibrary(dir: string, baseUrl: string, onError: (err: Error) => void): SoundLibrary {
  if (!existsSync(dir)) throw new SoundManifestError(`Sound-Ordner ${dir} nicht gefunden (SOUNDS_DIR)`);
  const manifest = join(dir, SOUND_MANIFEST);
  const stamp = () => {
    try {
      const s = statSync(manifest);
      return `${s.mtimeMs}:${s.size}`;
    } catch {
      return 'missing';
    }
  };
  let entries: SoundManifestEntry[] = [];
  let sounds: BuiltinSound[] = [];
  const adopt = (loaded: SoundManifestEntry[]) => {
    entries = loaded;
    sounds = loaded.map((e) => toBuiltinSound(e, baseUrl));
  };

  let loadedStamp = stamp();
  adopt(loadSoundManifest(dir) ?? []);
  let reportedStamp: string | null = null;

  const refresh = () => {
    const current = stamp();
    if (current === loadedStamp) return;
    try {
      const loaded = loadSoundManifest(dir);
      if (!loaded) throw new SoundManifestError(`${SOUND_MANIFEST} fehlt`);
      adopt(loaded);
      loadedStamp = current;
      reportedStamp = null;
    } catch (err) {
      if (reportedStamp !== current) onError(err as Error);
      reportedStamp = current;
    }
  };

  return {
    list() {
      refresh();
      return sounds;
    },
    hasFile(file) {
      refresh();
      return entries.some((e) => e.file === file);
    },
  };
}
