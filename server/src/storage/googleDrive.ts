import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  isAudioFile,
  type PlaybackUrl,
  type StorageFile,
  type StorageFilePage,
  type UploadRequest,
  type UploadTarget,
} from '@pnp/shared';
import { StorageProviderError, type ListFilesOptions, type ProviderConnection, type StorageProvider, type StorageProviderDefinition } from './provider.ts';

// Google Drive als externer Speicher fürs Soundboard (docs/soundboard-storage.md, Abschnitt „Google Drive“).
// - OAuth 2.0 (Authorization Code mit PKCE), Scope nur drive.file: die App sieht ausschließlich Ordner und Dateien,
//   die sie selbst angelegt hat (bzw. die der Nutzer ihr per Google Picker freigibt).
// - Tokens liegen nur verschlüsselt in user_storage_connections.credentials; Access-Tokens werden bei Bedarf mit dem
//   Refresh-Token erneuert. Kein Token steht je in einer URL, einer API-Antwort oder einer Fehlermeldung.
// - Upload: Resumable-Session, deren URL der Browser direkt nutzt. Wiedergabe: Drive kennt keine signierten
//   Download-URLs, darum streamt unser Server die Datei mit kurzlebiger, eigener Signatur (siehe Doku).

export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const DRIVE_API = 'https://www.googleapis.com/drive/v3';
export const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Wie lange eine Wiedergabe-URL gilt; danach holt der Client eine neue */
export const PLAYBACK_URL_TTL_MS = 60 * 60 * 1000;
/** Google hält Resumable-Sessions eine Woche offen */
const UPLOAD_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Access-Token so viel vor Ablauf erneuern */
const TOKEN_LEEWAY_MS = 60 * 1000;
/** Tiefe, bis zu der beim Prüfen einer Datei-ID nach dem verbundenen Ordner gesucht wird */
const MAX_FOLDER_DEPTH = 10;
/** Unterordner-Ebenen unter dem gelisteten Ordner, die listFiles noch durchsucht (Kategorien wie bei S3) */
export const LIST_MAX_DEPTH = 5;
/** Höchstzahl Ordner (einschließlich des gelisteten) je listFiles; hält die Drive-Suchanfrage kurz */
export const LIST_MAX_FOLDERS = 50;
/** Elternordner je Suchanfrage beim Einlesen des Ordnerbaums */
const LIST_PARENTS_PER_QUERY = 25;
/** Pfad des Streaming-Endpunkts (routes/googleDrive.ts) */
export const STREAM_PATH = '/api/storage/google-drive/stream';

export interface GoogleDriveOptions {
  clientId: string;
  clientSecret: string;
  /** muss exakt so in der Google Cloud Console eingetragen sein */
  redirectUri: string;
  /** Origin der Seite, von der aus der Browser hochlädt (CORS der Upload-Session); Vorgabe: Origin der redirectUri */
  appOrigin?: string;
  /** für Tests: gemockte Google-APIs */
  fetch?: typeof fetch;
  now?: () => number;
}

/** Nicht geheim, geht an den Client */
export interface GoogleDriveConfig {
  [key: string]: unknown;
  folderId: string | null;
  folderName: string | null;
  accountEmail: string | null;
}

/** Geheim, nur verschlüsselt gespeichert */
export interface GoogleDriveCredentials {
  refreshToken: string;
  accessToken: string | null;
  /** ms seit 1970 */
  expiresAt: number;
}

export interface DriveFolder {
  id: string;
  name: string;
}

export interface DriveMedia {
  status: number;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array> | null;
}

export interface StreamTarget {
  userId: number;
  connectionId: number;
  fileId: string;
}

/** Liest die Konfiguration aus der Umgebung; null, wenn Google Drive auf diesem Server nicht eingerichtet ist. */
export function googleDriveOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): GoogleDriveOptions | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = env.GOOGLE_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  const appOrigin = env.GOOGLE_APP_ORIGIN?.trim();
  return { clientId, clientSecret, redirectUri, ...(appOrigin ? { appOrigin } : {}) };
}

const base64url = (data: Buffer | string) => Buffer.from(data).toString('base64url');

/** PKCE (RFC 7636): Verifier bleibt beim Server, Google bekommt nur den Hash */
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) };
}

/** Drive-IDs bestehen aus Buchstaben, Ziffern, '_' und '-'; alles andere wird gar nicht erst angefragt. */
const DRIVE_ID = /^[\w-]{1,200}$/;
export const isDriveId = (id: string) => DRIVE_ID.test(id);

function checkId(id: string, what = 'Datei'): string {
  if (!isDriveId(id)) throw new StorageProviderError('invalid', `Ungültige ${what}-ID`);
  return id;
}

/** Literal in einer Drive-Suchanfrage (q) */
const q = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
/** „liegt direkt in einem dieser Ordner“ */
const inParents = (ids: string[]) =>
  ids.length === 1 ? `${q(ids[0]!)} in parents` : `(${ids.map((id) => `${q(id)} in parents`).join(' or ')})`;

const notConnectedFolder = () => new StorageProviderError('invalid', 'Bitte zuerst einen Google-Drive-Ordner wählen');
const revoked = () =>
  new StorageProviderError('auth', 'Der Zugriff auf Google Drive wurde widerrufen oder ist abgelaufen – bitte neu verbinden');
const unreachable = () => new StorageProviderError('unavailable', 'Google Drive ist nicht erreichbar');

interface DriveFileResource {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  parents?: string[];
  trashed?: boolean;
  capabilities?: { canAddChildren?: boolean; canListChildren?: boolean };
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
}

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Fehlerantwort der Drive-API → StorageProviderError (ohne Antworttext von Google, der kann Details enthalten) */
async function driveError(res: Response, notFoundMessage: string): Promise<StorageProviderError> {
  const body = await readJson<{ error?: { errors?: { reason?: string }[]; status?: string } }>(res);
  const reason = body?.error?.errors?.[0]?.reason ?? '';
  if (res.status === 401) return revoked();
  if (res.status === 403 || res.status === 429) {
    if (/rateLimit|dailyLimit/i.test(reason) || res.status === 429) {
      return new StorageProviderError('unavailable', 'Google Drive meldet zu viele Anfragen – bitte später erneut versuchen');
    }
    if (/insufficient(Permissions|Scopes)|authError/i.test(reason)) return revoked();
    if (reason === 'storageQuotaExceeded') return new StorageProviderError('permission', 'Der Google-Drive-Speicher ist voll');
    return new StorageProviderError('permission', 'Keine Berechtigung für diesen Ordner bzw. diese Datei in Google Drive');
  }
  if (res.status === 404) return new StorageProviderError('not_found', notFoundMessage);
  if (res.status === 400) return new StorageProviderError('invalid', 'Google Drive hat die Anfrage abgelehnt');
  return new StorageProviderError('unavailable', `Google Drive antwortet nicht wie erwartet (HTTP ${res.status})`);
}

/** Token-Endpunkt von Google: Code einlösen bzw. Access-Token erneuern */
async function tokenRequest(options: GoogleDriveOptions, params: Record<string, string>): Promise<TokenResponse> {
  const doFetch = options.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: options.clientId, client_secret: options.clientSecret, ...params }),
    });
  } catch {
    throw unreachable();
  }
  const body = await readJson<TokenResponse>(res);
  if (res.ok && body?.access_token) return body;
  // invalid_grant: Refresh-Token widerrufen/abgelaufen bzw. Code verbraucht → Nutzer muss neu verbinden
  if (body?.error === 'invalid_grant') throw revoked();
  if (body?.error === 'invalid_client' || body?.error === 'unauthorized_client') {
    throw new StorageProviderError('unavailable', 'Die Google-Anmeldung ist auf diesem Server falsch eingerichtet');
  }
  if (res.status >= 500 || !body) throw unreachable();
  throw new StorageProviderError('invalid', 'Google hat die Anmeldung abgelehnt');
}

export class GoogleDriveStorageProvider implements StorageProvider {
  readonly #options: GoogleDriveOptions;
  readonly #connection: ProviderConnection<GoogleDriveConfig, GoogleDriveCredentials>;
  readonly #sign: (target: StreamTarget, expiresAt: number) => string;
  #credentials: GoogleDriveCredentials;

  constructor(
    options: GoogleDriveOptions,
    connection: ProviderConnection<GoogleDriveConfig, GoogleDriveCredentials>,
    sign: (target: StreamTarget, expiresAt: number) => string,
  ) {
    this.#options = options;
    this.#connection = connection;
    this.#sign = sign;
    this.#credentials = connection.credentials;
  }

  get #now() {
    return (this.#options.now ?? Date.now)();
  }

  get #folderId(): string {
    const id = this.#connection.config.folderId;
    if (typeof id !== 'string' || !isDriveId(id)) throw notConnectedFolder();
    return id;
  }

  /** Gültiges Access-Token; erneuert es bei Bedarf und speichert das neue verschlüsselt. */
  async #accessToken(forceRefresh = false): Promise<string> {
    const current = this.#credentials;
    if (!forceRefresh && current.accessToken && current.expiresAt - TOKEN_LEEWAY_MS > this.#now) return current.accessToken;
    const tokens = await tokenRequest(this.#options, { grant_type: 'refresh_token', refresh_token: current.refreshToken });
    this.#credentials = {
      // Google liefert normalerweise kein neues Refresh-Token; falls doch (Rotation), das neue behalten
      refreshToken: tokens.refresh_token ?? current.refreshToken,
      accessToken: tokens.access_token!,
      expiresAt: this.#now + (tokens.expires_in ?? 3600) * 1000,
    };
    this.#connection.saveCredentials(this.#credentials);
    return this.#credentials.accessToken!;
  }

  /**
   * Anfrage an Google mit Bearer-Token. Antwortet Google mit 401 (Token vorzeitig ungültig), wird das Token einmal
   * erneuert und die Anfrage wiederholt. Fehler werden zu StorageProviderError.
   */
  async #request(url: string, init: RequestInit = {}, notFoundMessage = 'Datei nicht gefunden', okStatuses: number[] = []): Promise<Response> {
    const doFetch = this.#options.fetch ?? fetch;
    const send = async (token: string) => {
      try {
        return await doFetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
      } catch {
        throw unreachable();
      }
    };
    let res = await send(await this.#accessToken());
    if (res.status === 401) {
      await res.body?.cancel();
      res = await send(await this.#accessToken(true));
    }
    if (!res.ok && !okStatuses.includes(res.status)) throw await driveError(res, notFoundMessage);
    return res;
  }

  async #json<T>(url: string, init?: RequestInit, notFoundMessage?: string): Promise<T> {
    const res = await this.#request(url, init, notFoundMessage);
    const body = await readJson<T>(res);
    if (body === null) throw new StorageProviderError('unavailable', 'Google Drive antwortet nicht wie erwartet');
    return body;
  }

  #fileUrl(id: string, fields: string) {
    return `${DRIVE_API}/files/${encodeURIComponent(id)}?${new URLSearchParams({ fields, supportsAllDrives: 'true' })}`;
  }

  async #list(query: string, fields: string, pageSize: number, pageToken?: string, orderBy = 'name_natural') {
    const params = new URLSearchParams({ q: query, fields, pageSize: String(pageSize), orderBy, spaces: 'drive' });
    if (pageToken) params.set('pageToken', pageToken);
    return this.#json<{ files?: DriveFileResource[]; nextPageToken?: string }>(`${DRIVE_API}/files?${params}`);
  }

  /** Konto des verbundenen Nutzers (für den Anzeigenamen); prüft zugleich das Token. */
  async accountEmail(): Promise<string | null> {
    const about = await this.#json<{ user?: { emailAddress?: string } }>(`${DRIVE_API}/about?fields=user(emailAddress)`);
    return about.user?.emailAddress ?? null;
  }

  async validate(): Promise<void> {
    if (this.#connection.config.folderId === null || this.#connection.config.folderId === undefined) {
      // Ordner noch nicht gewählt (direkt nach dem OAuth-Callback): nur das Token prüfen
      await this.accountEmail();
      return;
    }
    await this.getFolder(this.#folderId, 'permission');
  }

  /** Ordner, auf den die App Zugriff hat und in den sie schreiben darf */
  async getFolder(id: string, missingKind: 'permission' | 'not_found' = 'not_found'): Promise<DriveFolder> {
    checkId(id, 'Ordner');
    let folder: DriveFileResource;
    try {
      folder = await this.#json<DriveFileResource>(this.#fileUrl(id, 'id,name,mimeType,trashed,capabilities(canAddChildren,canListChildren)'), {}, 'Ordner nicht gefunden');
    } catch (err) {
      if (err instanceof StorageProviderError && err.kind === 'not_found') {
        throw new StorageProviderError(missingKind, 'Der Google-Drive-Ordner existiert nicht mehr oder ist für diese App nicht freigegeben');
      }
      throw err;
    }
    if (folder.mimeType !== DRIVE_FOLDER_MIME || folder.trashed) {
      throw new StorageProviderError(missingKind, 'Der Google-Drive-Ordner existiert nicht mehr oder ist für diese App nicht freigegeben');
    }
    if (folder.capabilities?.canAddChildren === false || folder.capabilities?.canListChildren === false) {
      throw new StorageProviderError('permission', 'Keine Schreibrechte im gewählten Google-Drive-Ordner');
    }
    return { id: folder.id, name: folder.name };
  }

  /**
   * Ordner zur Auswahl. Mit drive.file sind das nur Ordner, die die App selbst angelegt hat oder die der Nutzer ihr
   * per Google Picker freigegeben hat.
   */
  async listFolders(cursor?: string): Promise<{ folders: DriveFolder[]; nextCursor: string | null }> {
    const page = await this.#list(`mimeType = ${q(DRIVE_FOLDER_MIME)} and trashed = false`, 'nextPageToken, files(id, name)', 100, cursor);
    return { folders: (page.files ?? []).map((f) => ({ id: f.id, name: f.name })), nextCursor: page.nextPageToken ?? null };
  }

  /** Legt einen Ordner in „Meine Ablage“ an (z.B. „Soundboard“) */
  async createFolder(name: string): Promise<DriveFolder> {
    const folder = await this.#json<DriveFileResource>(`${DRIVE_API}/files?fields=id,name&supportsAllDrives=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name, mimeType: DRIVE_FOLDER_MIME }),
    });
    return { id: folder.id, name: folder.name };
  }

  /** Unterordner (Pfad relativ zum verbundenen Ordner, Namen per '/') zur Drive-ID auflösen */
  async #resolveFolder(path: string): Promise<string> {
    let parent = this.#folderId;
    if (path === '') return parent;
    for (const name of path.split('/')) {
      const page = await this.#list(
        `${q(parent)} in parents and name = ${q(name)} and mimeType = ${q(DRIVE_FOLDER_MIME)} and trashed = false`,
        'files(id)',
        1,
      );
      const next = page.files?.[0]?.id;
      if (!next) throw new StorageProviderError('not_found', 'Ordner nicht gefunden');
      parent = next;
    }
    return parent;
  }

  /** Datei-ID vom Client: muss existieren, nicht im Papierkorb sein und im verbundenen Ordner (oder darunter) liegen. */
  async #fileInFolder(fileId: string): Promise<DriveFileResource> {
    checkId(fileId);
    const fields = 'id,name,mimeType,size,modifiedTime,parents,trashed';
    const file = await this.#json<DriveFileResource>(this.#fileUrl(fileId, fields));
    const root = this.#folderId;
    if (file.trashed) throw new StorageProviderError('not_found', 'Datei nicht gefunden');
    let parents = file.parents ?? [];
    for (let depth = 0; depth < MAX_FOLDER_DEPTH && parents.length > 0; depth++) {
      if (parents.includes(root)) return file;
      // Eltern weiter oben nachschlagen; nicht zugängliche Ordner (404/403) heißen: liegt nicht bei uns
      const next: string[] = [];
      for (const parent of parents) {
        try {
          const folder = await this.#json<DriveFileResource>(this.#fileUrl(parent, 'id,parents'));
          next.push(...(folder.parents ?? []));
        } catch (err) {
          if (!(err instanceof StorageProviderError) || (err.kind !== 'not_found' && err.kind !== 'permission')) throw err;
        }
      }
      parents = next;
    }
    throw new StorageProviderError('not_found', 'Datei nicht gefunden');
  }

  /**
   * Ordnerbaum unter `root` (Breitensuche, eine Anfrage je Ebene und Block von Elternordnern): Drive-ID → Pfad
   * relativ zu `root` ('' = root selbst, Namen per '/'). Begrenzt auf LIST_MAX_DEPTH Ebenen und LIST_MAX_FOLDERS
   * Ordner; was darüber hinausgeht, wird nicht gelistet. Reihenfolge nach Namen, damit der Baum (und damit die
   * Dateianfrage, an die Drives pageToken gebunden ist) zwischen zwei Seiten gleich bleibt.
   */
  async #folderTree(root: string): Promise<Map<string, string>> {
    const paths = new Map<string, string>([[root, '']]);
    let level = [root];
    for (let depth = 0; depth < LIST_MAX_DEPTH && level.length > 0 && paths.size < LIST_MAX_FOLDERS; depth++) {
      const next: string[] = [];
      for (let i = 0; i < level.length && paths.size < LIST_MAX_FOLDERS; i += LIST_PARENTS_PER_QUERY) {
        const chunk = level.slice(i, i + LIST_PARENTS_PER_QUERY);
        let pageToken: string | undefined;
        do {
          const page = await this.#list(
            `${inParents(chunk)} and mimeType = ${q(DRIVE_FOLDER_MIME)} and trashed = false`,
            'nextPageToken, files(id, name, parents)',
            1000,
            pageToken,
          );
          for (const folder of page.files ?? []) {
            if (paths.size >= LIST_MAX_FOLDERS) break;
            const parent = folder.parents?.find((p) => paths.has(p));
            if (parent === undefined || paths.has(folder.id) || !isDriveId(folder.id)) continue;
            // '/' trennt im Pfad die Ebenen (Kategorien im Client), darf also nicht im Ordnernamen stehen
            const name = folder.name.replace(/\//g, '-');
            const parentPath = paths.get(parent)!;
            paths.set(folder.id, parentPath ? `${parentPath}/${name}` : name);
            next.push(folder.id);
          }
          pageToken = paths.size < LIST_MAX_FOLDERS ? page.nextPageToken : undefined;
        } while (pageToken);
      }
      level = next;
    }
    return paths;
  }

  /**
   * Audiodateien im Ordner und seinen Unterordnern (wie bei S3): `name` ist der Pfad relativ zum angefragten Ordner
   * (`packs/regen/tropfen.mp3`), der Client macht aus den Ordnern die Kategorie. Eine einzige Dateianfrage über alle
   * Ordner des Baums, darum bleibt der Cursor Drives pageToken.
   */
  async listFiles(options: ListFilesOptions): Promise<StorageFilePage> {
    const folder = await this.#resolveFolder(options.folder);
    const paths = await this.#folderTree(folder);
    // Drive filtert serverseitig nach Audio-MIME-Types; Dateien ohne erkannten Typ (application/octet-stream) fehlen.
    const page = await this.#list(
      `${inParents([...paths.keys()])} and trashed = false and (mimeType contains 'audio/' or mimeType = 'application/ogg')`,
      'nextPageToken, files(id, name, mimeType, size, modifiedTime, parents)',
      options.limit,
      options.cursor,
    );
    const files: StorageFile[] = (page.files ?? []).map((f) => {
      const dir = paths.get(f.parents?.find((p) => paths.has(p)) ?? folder) ?? '';
      return {
        id: f.id,
        name: dir ? `${dir}/${f.name}` : f.name,
        size: f.size === undefined ? null : Number(f.size),
        mimeType: f.mimeType ?? null,
        updatedAt: f.modifiedTime ?? null,
      };
    });
    return { files: files.filter(isAudioFile), nextCursor: page.nextPageToken ?? null };
  }

  /**
   * Drive hat keine signierten Download-URLs: webContentLink braucht ein Google-Login im Browser (und zeigt bei großen
   * Dateien eine Virenscan-Seite), access_token als Query-Parameter nimmt die API seit 2020 nicht mehr an, und das
   * Token an den Browser zu geben, würde den Zugriff auf alle App-Dateien des Nutzers preisgeben. Deshalb zeigt die
   * URL auf unseren Streaming-Endpunkt, signiert und kurzlebig (siehe docs/soundboard-storage.md).
   */
  async getPlaybackUrl(fileId: string): Promise<PlaybackUrl> {
    const file = await this.#fileInFolder(fileId);
    if (!isAudioFile({ name: file.name, mimeType: file.mimeType ?? null })) throw new StorageProviderError('invalid', 'Keine Audiodatei');
    if (this.#connection.id === null) throw new Error('Verbindung ist noch nicht gespeichert');
    const expiresAt = this.#now + PLAYBACK_URL_TTL_MS;
    const token = this.#sign({ userId: this.#connection.userId, connectionId: this.#connection.id, fileId: file.id }, expiresAt);
    return { url: `${STREAM_PATH}?t=${encodeURIComponent(token)}`, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Inhalt einer Datei für den Streaming-Endpunkt; Range wird an Google durchgereicht (Spulen im Player). */
  async openMedia(fileId: string, range?: string): Promise<DriveMedia> {
    checkId(fileId);
    const res = await this.#request(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
      range ? { headers: { Range: range } } : {},
      'Datei nicht gefunden',
      [416],
    );
    const headers: Record<string, string> = {};
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = res.headers.get(name);
      if (value) headers[name] = value;
    }
    return { status: res.status, headers, body: res.body };
  }

  /**
   * Startet eine Resumable-Upload-Session (Datei landet im verbundenen Ordner). Die Session-URL enthält kein Token,
   * sie berechtigt nur zum Hochladen genau dieser Datei; der Browser schickt die Datei per PUT direkt an Google.
   * Typ und Größe sind in der Session festgelegt (X-Upload-Content-Type/-Length).
   */
  async upload(request: UploadRequest): Promise<UploadTarget> {
    const origin = this.#options.appOrigin ?? new URL(this.#options.redirectUri).origin;
    const res = await this.#request(`${DRIVE_UPLOAD_API}?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,size`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': request.contentType,
        'X-Upload-Content-Length': String(request.size),
        // Google erlaubt den Upload aus dem Browser (CORS) nur von dem Origin, mit dem die Session angelegt wurde
        Origin: origin,
      },
      body: JSON.stringify({ name: request.fileName, parents: [this.#folderId], mimeType: request.contentType }),
    }, 'Ordner nicht gefunden');
    await res.body?.cancel();
    const location = res.headers.get('location');
    if (!location?.startsWith('https://')) throw new StorageProviderError('unavailable', 'Google Drive hat keine Upload-Adresse geliefert');
    return {
      method: 'PUT',
      url: location,
      headers: { 'Content-Type': request.contentType },
      fields: {},
      fileId: null,
      expiresAt: new Date(this.#now + UPLOAD_SESSION_TTL_MS).toISOString(),
    };
  }

  /** Verschiebt die Datei in den Papierkorb des Nutzers (dort 30 Tage wiederherstellbar). */
  async delete(fileId: string): Promise<void> {
    const file = await this.#fileInFolder(fileId);
    const res = await this.#request(this.#fileUrl(file.id, 'id'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ trashed: true }),
    });
    await res.body?.cancel();
  }
}

export interface GoogleDriveDefinition extends StorageProviderDefinition<GoogleDriveConfig, GoogleDriveCredentials> {
  type: 'google_drive';
  options: GoogleDriveOptions;
  /** URL der Google-Anmeldung (Zustimmung zu drive.file) */
  authorizationUrl(state: string, codeChallenge: string): string;
  /** Code aus dem Callback einlösen; prüft, dass drive.file gewährt und ein Refresh-Token geliefert wurde */
  exchangeCode(code: string, codeVerifier: string): Promise<GoogleDriveCredentials>;
  /** Signiertes Wiedergabe-Ticket prüfen; null, wenn ungültig oder abgelaufen */
  verifyStreamToken(token: string): StreamTarget | null;
}

/** Bauplan des Anbieters `google_drive`; eingetragen in defaultStorageProviders(), sobald die Env-Variablen gesetzt sind. */
export function googleDriveProvider(options: GoogleDriveOptions): GoogleDriveDefinition {
  const now = () => (options.now ?? Date.now)();
  // Eigener Schlüssel für Wiedergabe-Tickets, abgeleitet vom Client-Secret (das nur der Server kennt)
  const streamKey = createHmac('sha256', options.clientSecret).update('pnp-google-drive-stream-v1').digest();
  const mac = (payload: string) => createHmac('sha256', streamKey).update(payload).digest();

  const sign = (target: StreamTarget, expiresAt: number) => {
    const payload = base64url(JSON.stringify({ u: target.userId, c: target.connectionId, f: target.fileId, e: expiresAt }));
    return `${payload}.${base64url(mac(payload))}`;
  };

  return {
    type: 'google_drive',
    options,
    create(connection) {
      return new GoogleDriveStorageProvider(options, connection, sign);
    },

    authorizationUrl(state, codeChallenge) {
      const params = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: options.redirectUri,
        response_type: 'code',
        scope: GOOGLE_DRIVE_SCOPE,
        // offline + consent: Google liefert bei jeder Verbindung ein Refresh-Token
        access_type: 'offline',
        prompt: 'consent',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });
      return `${GOOGLE_AUTH_URL}?${params}`;
    },

    async exchangeCode(code, codeVerifier) {
      const tokens = await tokenRequest(options, {
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: options.redirectUri,
      });
      // Bei granularer Zustimmung kann der Nutzer den Drive-Zugriff abwählen
      if (!(tokens.scope ?? '').split(' ').includes(GOOGLE_DRIVE_SCOPE)) {
        throw new StorageProviderError('invalid', 'Bitte den Zugriff auf Google Drive erlauben');
      }
      if (!tokens.refresh_token) {
        throw new StorageProviderError('invalid', 'Google hat kein Refresh-Token geliefert – bitte erneut verbinden');
      }
      return { refreshToken: tokens.refresh_token, accessToken: tokens.access_token!, expiresAt: now() + (tokens.expires_in ?? 3600) * 1000 };
    },

    verifyStreamToken(token) {
      const [payload, signature, ...rest] = token.split('.');
      if (!payload || !signature || rest.length > 0) return null;
      const expected = mac(payload);
      const given = Buffer.from(signature, 'base64url');
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
      let data: { u?: unknown; c?: unknown; f?: unknown; e?: unknown };
      try {
        data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      } catch {
        return null;
      }
      if (typeof data.u !== 'number' || typeof data.c !== 'number' || typeof data.f !== 'string' || typeof data.e !== 'number') return null;
      if (data.e < now() || !isDriveId(data.f)) return null;
      return { userId: data.u, connectionId: data.c, fileId: data.f };
    },
  };
}
