import {
  AUDIO_EXTENSIONS,
  AUDIO_MIME_TYPES,
  DEFAULT_SOUND_TYPE,
  MAX_STORAGE_UPLOAD_BYTES,
  audioExtension,
  uploadMatchesAudio,
  type BuiltinSound,
  type PlaybackUrl,
  type SoundType,
  type StorageFile,
} from '@pnp/shared';
import { ApiFailure } from './api.ts';

// Soundboard: Logik ohne Oberfläche – gemeinsame Kachel-Form für Standard-Sounds und Nutzer-Dateien, Filter,
// Upload-Prüfung, Cache für Playback-URLs und verständliche Fehlermeldungen.

/** Eine Kachel im Soundboard */
export interface BoardSound {
  /** eindeutig über alle Quellen, z.B. „builtin:glocke“ oder „3:musik/kampf.mp3“ */
  key: string;
  /** 'builtin' oder die ID der Speicher-Verbindung */
  source: 'builtin' | number;
  /** ID innerhalb der Quelle (Manifest-ID bzw. Datei-ID des Anbieters) */
  id: string;
  title: string;
  /** Standard-Sounds: Kategorie aus dem Manifest; Nutzer-Dateien: Unterordner („packs / regen“), sonst null */
  category: string | null;
  /** Vorgabe für den Typ (Manifest bzw. Effekt); der Nutzer kann ihn ändern, siehe `createSoundTypes` */
  type: SoundType;
  /** Schlagwörter aus dem Manifest (werden mit durchsucht); Nutzer-Dateien haben keine */
  tags: string[];
  /** feste URL (Standard-Sounds); Nutzer-Dateien holen ihre URL erst bei Bedarf */
  url: string | null;
  /** Nutzer-Dateien dürfen gelöscht werden, Standard-Sounds nicht */
  deletable: boolean;
}

export const builtinToBoard = (sound: BuiltinSound): BoardSound => ({
  key: `builtin:${sound.id}`,
  source: 'builtin',
  id: sound.id,
  title: sound.title,
  category: sound.category,
  type: sound.type ?? DEFAULT_SOUND_TYPE,
  tags: sound.tags,
  url: sound.url,
  deletable: false,
});

/** Titel einer Nutzer-Datei: Dateiname ohne Ordner und ohne Audio-Endung */
export function fileTitle(name: string): string {
  const base = name.split('/').pop()!;
  return audioExtension(base) ? base.slice(0, base.lastIndexOf('.')) : base;
}

/**
 * Kategorie einer Nutzer-Datei wie in der Referenz aus dem Ordner (`packs/regen/x.mp3` → „packs / regen“);
 * Dateien direkt im verbundenen Ordner haben keine.
 */
export function fileCategory(name: string): string | null {
  const folders = name.split('/').slice(0, -1).filter(Boolean);
  return folders.length > 0 ? folders.join(' / ') : null;
}

export const fileToBoard = (cid: number, file: StorageFile): BoardSound => ({
  key: `${cid}:${file.id}`,
  source: cid,
  id: file.id,
  title: fileTitle(file.name),
  category: fileCategory(file.name),
  type: DEFAULT_SOUND_TYPE,
  tags: [],
  url: null,
  deletable: true,
});

export const SOUND_TYPE_LABELS: Record<SoundType, string> = { music: 'Musik', sfx: 'Effekt' };

/**
 * Die Kachel einer gerade hochgeladenen Datei in der neu geladenen Liste: über die Datei-ID, wenn der Anbieter sie
 * vorab genannt hat (S3), sonst über den Dateinamen (Google Drive vergibt die ID erst beim Upload). Beim Namen
 * zählen nur Dateien, die vor dem Upload noch nicht in der Liste standen (`before` = deren Keys) – Drive erlaubt
 * doppelte Namen, und `a.mp3`/`a.wav` haben denselben Titel.
 */
export function uploadedSound(
  sounds: readonly BoardSound[],
  upload: { name: string; fileId: string | null },
  before: ReadonlySet<string> = new Set(),
): BoardSound | undefined {
  if (upload.fileId !== null) return sounds.find((s) => s.id === upload.fileId);
  const title = fileTitle(upload.name);
  const fresh = sounds.filter((s) => s.title === title && !before.has(s.key));
  return fresh.length === 1 ? fresh[0] : undefined;
}

const normalize = (text: string) => text.toLocaleLowerCase('de').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

/** Durchsuchter Text eines Sounds: Titel, Kategorie (bzw. Ordner) und Schlagwörter – wie in der Referenz der ganze Pfad */
const searchText = (s: BoardSound) => normalize([s.title, s.category ?? '', ...s.tags].join(' '));

/**
 * Suche ohne Groß-/Kleinschreibung und Akzente; mehrere Wörter müssen alle vorkommen (in Titel, Kategorie oder
 * Schlagwörtern). Optional nur eine Kategorie.
 */
export function filterSounds(sounds: readonly BoardSound[], query: string, category = ''): BoardSound[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return sounds.filter((s) => (category === '' || s.category === category) && words.every((w) => searchText(s).includes(w)));
}

/** Kategorien in der Reihenfolge des Manifests (bzw. der Dateiliste) */
export function categoriesOf(sounds: readonly BoardSound[]): string[] {
  return [...new Set(sounds.map((s) => s.category).filter((c): c is string => c !== null))];
}

/** Sounds nach Kategorie gruppiert, Reihenfolge wie im Manifest; Sounds ohne Kategorie (null) kommen zuerst */
export function groupByCategory(sounds: readonly BoardSound[]): { category: string | null; sounds: BoardSound[] }[] {
  const loose = sounds.filter((s) => s.category === null);
  const groups = categoriesOf(sounds).map((category) => ({ category, sounds: sounds.filter((s) => s.category === category) }));
  return loose.length > 0 ? [{ category: null, sounds: loose }, ...groups] : groups;
}

export const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toLocaleString('de', { maximumFractionDigits: 1 })} MB` : `${Math.ceil(bytes / 1024)} kB`;

export const ACCEPT_AUDIO = [...AUDIO_EXTENSIONS.map((e) => `.${e}`), ...new Set(Object.values(AUDIO_MIME_TYPES).flat())].join(',');

/**
 * Prüft eine Datei vor dem Upload (dieselben Regeln wie der Server) und liefert den Content-Type, mit dem sie
 * hochgeladen wird. Browser melden manche Audio-Typen gar nicht oder anders – dann gilt der übliche Typ der Endung.
 */
export function checkUploadFile(file: { name: string; type: string; size: number }): { contentType: string } | { error: string } {
  const ext = audioExtension(file.name);
  if (!ext) return { error: `„${file.name}“ ist keine Audiodatei (erlaubt: ${AUDIO_EXTENSIONS.join(', ')})` };
  if (file.size === 0) return { error: `„${file.name}“ ist leer` };
  if (file.size > MAX_STORAGE_UPLOAD_BYTES) {
    return { error: `„${file.name}“ ist zu groß (${formatBytes(file.size)}, höchstens ${formatBytes(MAX_STORAGE_UPLOAD_BYTES)})` };
  }
  const type = file.type.toLowerCase();
  if (uploadMatchesAudio(file.name, type)) return { contentType: type };
  if (type === '' || type.startsWith('audio/')) return { contentType: AUDIO_MIME_TYPES[ext][0] };
  return { error: `„${file.name}“ ist keine Audiodatei (Typ ${file.type})` };
}

/** Reserve, damit eine URL nicht während des Ladens abläuft */
export const PLAYBACK_URL_MARGIN_MS = 30_000;

/**
 * Merkt sich Playback-URLs je Datei bis kurz vor ihrem Ablauf; danach (oder nach invalidate, z.B. bei einem
 * Ladefehler) wird eine neue geholt. Gleichzeitige Anfragen für dieselbe Datei teilen sich einen Abruf.
 */
export function createPlaybackUrlCache(fetchUrl: (cid: number, fileId: string) => Promise<PlaybackUrl>, now = () => Date.now()) {
  const cache = new Map<string, Promise<PlaybackUrl>>();
  const keyOf = (cid: number, fileId: string) => `${cid}:${fileId}`;
  const fresh = (entry: PlaybackUrl) => {
    const expires = Date.parse(entry.expiresAt);
    return Number.isNaN(expires) || expires - now() > PLAYBACK_URL_MARGIN_MS;
  };
  return {
    async get(cid: number, fileId: string): Promise<string> {
      const key = keyOf(cid, fileId);
      const cached = cache.get(key);
      if (cached) {
        const entry = await cached.catch(() => null);
        if (entry && fresh(entry)) return entry.url;
      }
      // abgelaufen oder fehlgeschlagen: neu holen – außer ein anderer Aufruf hat das inzwischen schon getan
      let pending = cache.get(key);
      if (!pending || pending === cached) {
        pending = fetchUrl(cid, fileId);
        cache.set(key, pending);
      }
      try {
        return (await pending).url;
      } catch (err) {
        if (cache.get(key) === pending) cache.delete(key);
        throw err;
      }
    },
    invalidate(cid: number, fileId: string): void {
      cache.delete(keyOf(cid, fileId));
    },
    clear(): void {
      cache.clear();
    },
  };
}
export type PlaybackUrlCache = ReturnType<typeof createPlaybackUrlCache>;

/** Meldung für Fehler der Speicher-Endpunkte (Dateiliste, Playback-/Upload-URL, Löschen) */
export function describeStorageError(err: unknown): string {
  if (err instanceof ApiFailure) {
    if (err.status === 401) return 'Deine Anmeldung ist abgelaufen – bitte neu anmelden.';
    // 409: Zugangsdaten widerrufen/abgelaufen (Verbindung getrennt) oder Rechte fehlen
    if (err.status === 409) return `${err.message}. Bitte den Speicher in den Kontoeinstellungen prüfen bzw. neu verbinden.`;
    if (err.status === 502) return `Der Speicher-Anbieter ist gerade nicht erreichbar: ${err.message}`;
    return err.message;
  }
  // fetch wirft TypeError, wenn unser Server gar nicht antwortet
  if (err instanceof TypeError) return 'Keine Verbindung zum Server – bitte die Internetverbindung prüfen.';
  return (err as Error)?.message ?? String(err);
}
