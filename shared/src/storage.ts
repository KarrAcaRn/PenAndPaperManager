// Soundboard: externe Speicher der Nutzer (S3, Google Drive, …). Unser Server speichert keine Nutzer-Uploads,
// er vermittelt nur signierte URLs; Wiedergabe und Upload laufen direkt zwischen Browser und Anbieter.
// Architektur und Annahmen: docs/soundboard-storage.md

/** Bekannte Anbieter. Neue Anbieter hier ergänzen und im Server in der Registry eintragen (keine Migration nötig). */
export const STORAGE_PROVIDER_TYPES = ['s3', 'google_drive'] as const;
export type StorageProviderType = (typeof STORAGE_PROVIDER_TYPES)[number];

export const STORAGE_PROVIDER_LABELS: Record<StorageProviderType, string> = {
  s3: 'S3 (oder kompatibel)',
  google_drive: 'Google Drive',
};

/**
 * connected: zuletzt erfolgreich geprüft; error: letzte Prüfung fehlgeschlagen (z.B. Bucket fehlt, Anbieter nicht
 * erreichbar); disconnected: Zugangsdaten ungültig oder Zugriff widerrufen – Nutzer muss neu verbinden.
 */
export const STORAGE_CONNECTION_STATUSES = ['connected', 'error', 'disconnected'] as const;
export type StorageConnectionStatus = (typeof STORAGE_CONNECTION_STATUSES)[number];

/** Nicht geheime Einstellungen (Bucket, Region, Prefix, Drive-Ordner-ID, …); Aufbau legt der Anbieter fest. */
export type StorageConfig = Record<string, unknown>;

/** Verbindung, wie die API sie liefert – Zugangsdaten sind nie enthalten. */
export interface StorageConnection {
  id: number;
  providerType: StorageProviderType;
  displayName: string;
  config: StorageConfig;
  status: StorageConnectionStatus;
  /** Meldung der letzten fehlgeschlagenen Prüfung, sonst leer */
  statusMessage: string;
  createdAt: string;
  updatedAt: string;
}

/** Neue Verbindung mit eingegebenen Zugangsdaten (z.B. S3-Schlüssel). OAuth-Anbieter haben eigene Endpunkte. */
export interface StorageConnectionInput {
  providerType: StorageProviderType;
  displayName: string;
  config: StorageConfig;
  credentials: Record<string, unknown>;
}

export interface StorageProviderInfo {
  type: StorageProviderType;
  label: string;
  /** Verbindung per POST /api/storage/connections mit Zugangsdaten anlegbar (sonst eigener Flow, z.B. OAuth) */
  manualSetup: boolean;
}

export interface StorageFile {
  /** Undurchsichtige ID des Anbieters (S3: Objektschlüssel, Drive: Datei-ID) */
  id: string;
  name: string;
  size: number | null;
  mimeType: string | null;
  updatedAt: string | null;
}

export interface StorageFilePage {
  files: StorageFile[];
  /** Für die nächste Seite als cursor mitschicken; null = letzte Seite */
  nextCursor: string | null;
}

/** Kurzlebige URL, die der Browser direkt beim Anbieter abruft */
export interface PlaybackUrl {
  url: string;
  /** ISO-Zeitpunkt; danach eine neue URL holen */
  expiresAt: string;
}

export interface UploadRequest {
  fileName: string;
  contentType: string;
  /** Größe in Bytes */
  size: number;
}

/**
 * Anleitung für den direkten Upload vom Browser zum Anbieter.
 * PUT (S3 presigned PUT, Drive resumable session): Datei als Body, `headers` mitschicken.
 * POST (S3 presigned POST): multipart/form-data aus `fields` plus Datei im Feld "file" (als letztes).
 */
export interface UploadTarget {
  method: 'PUT' | 'POST';
  url: string;
  headers: Record<string, string>;
  fields: Record<string, string>;
  /** ID der Datei nach dem Upload, falls vorab bekannt (S3); sonst null (Drive vergibt sie erst beim Upload) */
  fileId: string | null;
  expiresAt: string;
}

export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'm4a'] as const;

/** Content-Types, die für Uploads erlaubt sind (Browser melden dieselbe Datei teils unterschiedlich) */
export const AUDIO_MIME_TYPES: Readonly<Record<(typeof AUDIO_EXTENSIONS)[number], readonly string[]>> = {
  mp3: ['audio/mpeg', 'audio/mp3'],
  wav: ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'],
  ogg: ['audio/ogg', 'application/ogg'],
  m4a: ['audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac'],
};

export const MAX_STORAGE_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_STORAGE_DISPLAY_NAME_LENGTH = 100;
export const MAX_STORAGE_FILE_NAME_LENGTH = 255;
export const MAX_STORAGE_FILE_ID_LENGTH = 1024;
export const MAX_STORAGE_FOLDER_LENGTH = 512;
/** Höchstzahl Dateien je Seite beim Auflisten */
export const MAX_STORAGE_PAGE_SIZE = 200;

/** Endung (klein, ohne Punkt) eines Dateinamens, falls es eine Audio-Endung ist */
export function audioExtension(fileName: string): (typeof AUDIO_EXTENSIONS)[number] | null {
  const ext = /\.([^./\\]+)$/.exec(fileName)?.[1]?.toLowerCase();
  return (AUDIO_EXTENSIONS as readonly string[]).includes(ext ?? '') ? (ext as (typeof AUDIO_EXTENSIONS)[number]) : null;
}

const baseMime = (mimeType: string) => mimeType.split(';')[0]!.trim().toLowerCase();

export function isAudioMimeType(mimeType: string): boolean {
  return Object.values(AUDIO_MIME_TYPES).some((types) => types.includes(baseMime(mimeType)));
}

/** Datei zählt als Audio, wenn Endung oder Content-Type passt (Drive-Dateien haben nicht immer eine Endung). */
export function isAudioFile(file: Pick<StorageFile, 'name' | 'mimeType'>): boolean {
  return audioExtension(file.name) !== null || (file.mimeType !== null && isAudioMimeType(file.mimeType));
}

/** Upload ist nur erlaubt, wenn Endung und Content-Type Audio sind und zueinander passen. */
export function uploadMatchesAudio(fileName: string, contentType: string): boolean {
  const ext = audioExtension(fileName);
  return ext !== null && AUDIO_MIME_TYPES[ext].includes(baseMime(contentType));
}
