import type {
  PlaybackUrl,
  StorageConfig,
  StorageFilePage,
  StorageProviderType,
  UploadRequest,
  UploadTarget,
} from '@pnp/shared';

// Abstraktion externer Speicher fürs Soundboard (docs/soundboard-storage.md).
// Grundsatz: unser Server vermittelt nur. Er lädt keine Audiodaten herunter oder hoch, sondern gibt dem Browser
// kurzlebige, signierte URLs, mit denen er direkt beim Anbieter abspielt bzw. hochlädt.

/** Was ein Anbieter von einer gespeicherten Verbindung zu sehen bekommt (Zugangsdaten bereits entschlüsselt) */
export interface ProviderConnection<C extends StorageConfig = StorageConfig, S = unknown> {
  /** null, solange die Verbindung beim Anlegen erst geprüft und noch nicht gespeichert ist */
  id: number | null;
  userId: number;
  config: C;
  credentials: S;
  /** Geänderte Zugangsdaten verschlüsselt speichern, z.B. ein erneuertes OAuth-Token */
  saveCredentials(credentials: S): void;
}

export interface ListFilesOptions {
  /** Unterordner relativ zum verbundenen Ordner/Prefix ('' = der Ordner selbst); bereits geprüft, ohne '..' */
  folder: string;
  /** aus nextCursor der vorigen Seite */
  cursor?: string;
  limit: number;
}

/**
 * Eine Verbindung zu einem externen Speicher. Implementierungen müssen
 * - jede Datei-ID darauf prüfen, dass sie im verbundenen Ordner/Prefix liegt (IDs kommen vom Client),
 * - Fehler als StorageProviderError melden, deren Text keine Geheimnisse enthält (er geht an den Nutzer und ins Log),
 * - Zugangsdaten nie loggen oder in URLs/Fehlertexte schreiben, die an den Client gehen.
 */
export interface StorageProvider {
  /**
   * Prüft Verbindung und Rechte (lesen, auflisten, schreiben). Läuft beim Anlegen ("connect") und beim Testen.
   * Ungültige/widerrufene Zugangsdaten: kind 'auth'; fehlende Rechte oder falscher Bucket/Ordner: 'permission'.
   */
  validate(): Promise<void>;
  /** Nur Audiodateien (mp3, wav, ogg, m4a); der Server filtert zur Sicherheit nochmals. */
  listFiles(options: ListFilesOptions): Promise<StorageFilePage>;
  /** Kurzlebige URL (signiert bzw. mit kurzlebigem Token), die der Browser direkt beim Anbieter abspielt */
  getPlaybackUrl(fileId: string): Promise<PlaybackUrl>;
  /**
   * Bereitet einen direkten Upload vom Browser zum Anbieter vor (Presigned PUT/POST, Resumable-Session).
   * Name, Typ und Größe sind bereits geprüft (Audio, Größenlimit); der Anbieter soll Typ und Größe nach Möglichkeit
   * auch in der Signatur festschreiben.
   */
  upload(request: UploadRequest): Promise<UploadTarget>;
  delete(fileId: string): Promise<void>;
}

/** Bauplan eines Anbieters, eingetragen in der StorageProviderRegistry */
export interface StorageProviderDefinition<C extends StorageConfig = StorageConfig, S = unknown> {
  type: StorageProviderType;
  /**
   * Eingaben aus POST /api/storage/connections prüfen und normalisieren (wirft StorageProviderError 'invalid').
   * Fehlt die Methode, lässt sich der Anbieter nur über einen eigenen Flow verbinden (z.B. OAuth), der dann
   * createConnection() aus connections.ts aufruft.
   * Alles Geheime gehört in credentials – config wird unverschlüsselt gespeichert und an den Client geliefert.
   */
  parseInput?(config: StorageConfig, credentials: Record<string, unknown>): { config: C; credentials: S };
  create(connection: ProviderConnection<C, S>): StorageProvider;
}

/**
 * invalid: Eingabe passt nicht (400); not_found: Datei/Ordner fehlt (404);
 * auth: Zugangsdaten ungültig oder widerrufen → Verbindung "disconnected" (409);
 * permission: Rechte fehlen, Bucket/Ordner falsch → Verbindung "error" (409);
 * unavailable: Anbieter nicht erreichbar oder unerwartete Antwort → Verbindung "error" (502).
 */
export type StorageErrorKind = 'invalid' | 'not_found' | 'auth' | 'permission' | 'unavailable';

export class StorageProviderError extends Error {
  constructor(
    public kind: StorageErrorKind,
    message: string,
  ) {
    super(message);
  }
}
