import { randomBytes } from 'node:crypto';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  AUDIO_MIME_TYPES,
  MAX_STORAGE_FOLDER_LENGTH,
  audioExtension,
  type StorageFile,
  type StorageFilePage,
} from '@pnp/shared';
import { StorageProviderError, type ListFilesOptions, type StorageProvider, type StorageProviderDefinition } from './provider.ts';

// S3 und S3-kompatible Dienste (MinIO, Wasabi, Cloudflare R2, …) als Speicher fürs Soundboard.
// Der Server spricht S3 nur für Prüfen, Auflisten und Löschen an; Abspielen und Hochladen laufen per presigned URL
// direkt zwischen Browser und Bucket. Nutzer-Anleitung (Rechte, CORS): docs/soundboard-storage.md

/** Nicht geheim: wird unverschlüsselt gespeichert und an den Client geliefert. */
export interface S3Config {
  [key: string]: unknown;
  bucket: string;
  region: string;
  /** eigener Endpunkt für S3-kompatible Dienste (z.B. https://<konto>.r2.cloudflarestorage.com); null = AWS */
  endpoint: string | null;
  /** Ordner im Bucket ohne '/' am Anfang und Ende; '' = ganzer Bucket */
  prefix: string;
}

export interface S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

/** Gültigkeit der presigned URLs fürs Abspielen und Hochladen */
export const S3_URL_TTL_SECONDS = 15 * 60;
/** Höchstzahl ListObjectsV2-Aufrufe je Seite (überspringt Nicht-Audio-Dateien, ohne endlos zu laufen) */
const MAX_LIST_REQUESTS = 5;
/** S3 begrenzt Objektschlüssel auf 1024 Bytes (UTF-8) */
const MAX_KEY_BYTES = 1024;

/** Teil von S3Client, den der Adapter nutzt – in Tests durch einen Mock ersetzbar */
export interface S3ClientLike {
  send(command: object): Promise<unknown>;
}

export interface S3ProviderOptions {
  /**
   * Endpunkte im lokalen/privaten Netz (localhost, 10.x, 192.168.x, …) und http:// erlauben. Aus, damit Nutzer
   * den Server nicht auf interne Dienste zeigen lassen (SSRF); an für selbst gehostetes MinIO im LAN und Tests.
   */
  allowPrivateEndpoints?: boolean;
  /** Client für S3-Aufrufe; Vorgabe: echter S3Client. Presigned URLs baut immer ein echter Client (offline). */
  createClient?: (config: S3Config, credentials: S3Credentials) => S3ClientLike;
  now?: () => Date;
}

// --- Private Netze (SSRF-Schutz) ---------------------------------------------------------------------------------

const PRIVATE_NETWORKS = (() => {
  const list = new BlockList();
  const v4: [string, number][] = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ];
  const v6: [string, number][] = [
    ['::', 96], // ::, ::1 und IPv4-kompatible Adressen
    // IPv4-gemappte Adressen (::ffff:0:0/96) prüft isPrivateAddress selbst – als Regel hier träfe sie jede IPv4
    ['64:ff9b::', 96], // NAT64
    ['64:ff9b:1::', 48],
    ['100::', 64],
    ['2001:db8::', 32],
    ['2002::', 16], // 6to4 (enthält eine IPv4-Adresse)
    ['fc00::', 7],
    ['fe80::', 10],
    ['fec0::', 10],
    ['ff00::', 8],
  ];
  for (const [net, bits] of v4) list.addSubnet(net, bits, 'ipv4');
  for (const [net, bits] of v6) list.addSubnet(net, bits, 'ipv6');
  return list;
})();

/** IP-Adresse in einem lokalen, privaten oder reservierten Netz */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').toLowerCase();
  // IPv4-gemappt (::ffff:127.0.0.1 bzw. ::ffff:7f00:1) hat bei S3-Endpoints nichts zu suchen
  if (/^(0{0,4}:){0,5}:?ffff:/.test(ip) && isIP(ip) === 6) return true;
  const version = isIP(ip);
  if (version === 4) return PRIVATE_NETWORKS.check(ip, 'ipv4');
  if (version === 6) return PRIVATE_NETWORKS.check(ip, 'ipv6');
  return false;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.+$/, '');
  if (isIP(host)) return isPrivateAddress(host);
  if (host === 'localhost' || /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(host)) return true;
  // Einteilige Namen (z.B. "minio") lösen nur im internen Netz auf
  return !host.includes('.');
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
type LookupFn = (hostname: string, options: { all?: boolean; [key: string]: unknown }, callback: LookupCallback) => void;

/**
 * DNS-Auflösung, die nur öffentliche Adressen zulässt. Greift bei jeder Verbindung, also auch bei Namen, die
 * (absichtlich oder per DNS-Rebinding) auf interne Adressen zeigen.
 */
export function publicOnlyLookup(resolve: LookupFn = dnsLookup as unknown as LookupFn): LookupFn {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true }, (err, result) => {
      if (err) return callback(err, options.all ? [] : '', 0);
      const addresses = result as LookupAddress[];
      if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
        const blocked = Object.assign(new Error(`${hostname} zeigt auf eine Adresse im privaten Netz`), { code: 'EPRIVATEADDRESS' });
        return callback(blocked, options.all ? [] : '', 0);
      }
      if (options.all) return callback(null, addresses);
      return callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  };
}

/**
 * Client-Einstellungen: explizite Zugangsdaten (nie aus Umgebung/~/.aws), keine Endpoint-Vorgaben aus der Umgebung
 * des Servers, kurze Timeouts, Prüfsummen nur wo nötig, ohne `allowPrivate` nur öffentliche Adressen.
 */
export function s3ClientConfig(config: S3Config, credentials: S3Credentials, allowPrivate = false): S3ClientConfig {
  return {
    region: config.region,
    credentials: { accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey },
    ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
    // AWS_ENDPOINT_URL(_S3), FIPS/Dualstack aus Umgebung oder ~/.aws/config würden Nutzeranfragen umleiten
    ignoreConfiguredEndpointUrls: true,
    useFipsEndpoint: false,
    useDualstackEndpoint: false,
    // Sonst hängt das SDK CRC32-Prüfsummen an presigned PUTs, die der Browser nicht liefert und R2/MinIO teils ablehnen
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 2,
    requestHandler: {
      connectionTimeout: 5_000,
      requestTimeout: 15_000,
      ...(allowPrivate ? {} : { httpsAgent: { keepAlive: true, lookup: publicOnlyLookup() as never } }),
    },
  };
}

// --- Eingaben prüfen ---------------------------------------------------------------------------------------------

const invalid = (message: string) => new StorageProviderError('invalid', message);

function text(value: unknown, field: string, max: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw invalid(`${field} muss ein Text sein`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw invalid(`${field} ist zu lang (höchstens ${max} Zeichen)`);
  return trimmed;
}

/** Bucket-Namen nach S3-Regeln (gilt so auch bei MinIO, Wasabi, R2) */
const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const REGION_RE = /^[a-z0-9-]{1,32}$/;

export function parseEndpoint(raw: string, allowPrivate: boolean): string | null {
  if (raw === '') return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalid('Endpoint ist keine gültige URL (z.B. https://s3.eu-central-1.wasabisys.com)');
  }
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) throw invalid('Endpoint muss mit https:// beginnen');
  if (url.username || url.password) throw invalid('Endpoint darf keine Zugangsdaten enthalten – dafür gibt es eigene Felder');
  if (url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw invalid('Endpoint darf nur aus Protokoll, Host und ggf. Port bestehen – den Bucket bitte im eigenen Feld angeben');
  }
  if (!allowPrivate && isPrivateHost(url.hostname)) throw invalid('Endpoints im lokalen oder privaten Netz sind auf diesem Server nicht erlaubt');
  return url.origin;
}

/** Prefix normalisieren: ohne '/' am Rand, keine leeren, '.'- oder '..'-Segmente */
export function parsePrefix(raw: string): string {
  const prefix = raw.replace(/^\/+|\/+$/g, '');
  if (prefix === '') return '';
  if (prefix.split('/').some((p) => p === '' || p === '.' || p === '..' || /[\\\u0000-\u001f\u007f]/.test(p))) {
    throw invalid('Prefix/Ordner ist ungültig (keine leeren Teile, kein "." oder "..", kein "\\")');
  }
  return prefix;
}

export function parseS3Input(
  config: Record<string, unknown>,
  credentials: Record<string, unknown>,
  allowPrivate: boolean,
): { config: S3Config; credentials: S3Credentials } {
  const bucket = text(config.bucket, 'Bucket', 63);
  if (!BUCKET_RE.test(bucket)) throw invalid('Bucket-Name ist ungültig (3–63 Zeichen: Kleinbuchstaben, Ziffern, "." und "-")');
  const region = text(config.region, 'Region', 32).toLowerCase() || 'us-east-1';
  if (!REGION_RE.test(region)) throw invalid('Region ist ungültig (z.B. eu-central-1, bei R2 "auto")');
  const endpoint = parseEndpoint(text(config.endpoint, 'Endpoint', 255), allowPrivate);
  const prefix = parsePrefix(text(config.prefix, 'Prefix', MAX_STORAGE_FOLDER_LENGTH));
  const accessKeyId = text(credentials.accessKeyId, 'Access Key ID', 128);
  const secretAccessKey = text(credentials.secretAccessKey, 'Secret Access Key', 256);
  if (accessKeyId === '') throw invalid('Access Key ID fehlt');
  if (secretAccessKey === '') throw invalid('Secret Access Key fehlt');
  return { config: { bucket, region, endpoint, prefix }, credentials: { accessKeyId, secretAccessKey } };
}

// --- Fehler übersetzen -------------------------------------------------------------------------------------------

const AUTH_CODES = new Set(['InvalidAccessKeyId', 'SignatureDoesNotMatch', 'InvalidToken', 'ExpiredToken', 'TokenRefreshRequired', 'InvalidClientTokenId', 'AccountProblem']);
const REGION_CODES = new Set(['PermanentRedirect', 'AuthorizationHeaderMalformed', 'IllegalLocationConstraintException', 'Redirect']);
/** Netz-/TLS-Fehler von Node (ECONNREFUSED, ENOTFOUND, CERT_HAS_EXPIRED, ERR_TLS_…, …) */
const NETWORK_CODE_RE = /^(E[A-Z_]+|ERR_TLS_\w+|ERR_SSL_\w+|CERT_\w+|UNABLE_TO_\w+|DEPTH_ZERO_\w+|SELF_SIGNED_\w+)$/;

/**
 * SDK-/Netzfehler → StorageProviderError mit eigenem Text. SDK-Meldungen werden bewusst nicht übernommen (können
 * Anfragedetails enthalten); nur der S3-Fehlercode geht als Hinweis mit. Andere Fehler (Programmierfehler) kommen
 * unverändert zurück, damit sie als 500 im Log landen.
 * `what` beschreibt die Aktion für Rechtefehler, z.B. "Dateien auflisten (s3:ListBucket)".
 */
export function translateS3Error(err: unknown, what: string, config: S3Config): unknown {
  if (err instanceof StorageProviderError) return err;
  const e = (err ?? {}) as { name?: unknown; Code?: unknown; code?: unknown; $metadata?: { httpStatusCode?: number } };
  const code = typeof e.Code === 'string' ? e.Code : typeof e.name === 'string' ? e.name : '';
  const sysCode = typeof e.code === 'string' ? e.code : '';
  const status = e.$metadata?.httpStatusCode;
  if (sysCode === 'EPRIVATEADDRESS') {
    return new StorageProviderError('permission', 'Der Endpoint zeigt auf eine Adresse im privaten Netz – das ist auf diesem Server nicht erlaubt');
  }
  if (AUTH_CODES.has(code)) {
    return new StorageProviderError('auth', 'Access Key ID oder Secret Access Key werden nicht akzeptiert – bitte prüfen bzw. neu verbinden');
  }
  if (code === 'NoSuchBucket') return new StorageProviderError('permission', `Bucket "${config.bucket}" existiert nicht (oder liegt bei einem anderen Endpoint)`);
  if (REGION_CODES.has(code) || status === 301) {
    return new StorageProviderError('permission', `Region "${config.region}" passt nicht zum Bucket "${config.bucket}"`);
  }
  if (code === 'AccessDenied' || code === 'AllAccessDisabled' || code === 'Forbidden' || status === 403) {
    return new StorageProviderError('permission', `Zugriff verweigert: Die Zugangsdaten dürfen ${what} nicht`);
  }
  if (code === 'NoSuchKey' || code === 'NotFound' || status === 404) return new StorageProviderError('not_found', 'Datei nicht gefunden');
  if (NETWORK_CODE_RE.test(sysCode) || code === 'TimeoutError' || code === 'RequestTimeout' || code === 'AbortError') {
    return new StorageProviderError('unavailable', config.endpoint ? `S3-Endpoint ${config.endpoint} ist nicht erreichbar` : 'S3 ist nicht erreichbar');
  }
  if (status !== undefined) {
    const hint = /^[A-Za-z0-9.]{1,64}$/.test(code) ? ` (${code})` : '';
    return new StorageProviderError('unavailable', `S3 meldet einen unerwarteten Fehler${hint}`);
  }
  return err;
}

// --- Anbieter ----------------------------------------------------------------------------------------------------

/** MIME-Type zur Endung, den S3-Listen nicht mitliefern */
function mimeTypeOf(key: string): string | null {
  const ext = audioExtension(key);
  return ext ? AUDIO_MIME_TYPES[ext][0]! : null;
}

const notFound = () => new StorageProviderError('not_found', 'Datei nicht gefunden');

interface ListPage {
  Contents?: { Key?: string; Size?: number; LastModified?: Date }[];
  IsTruncated?: boolean;
}

const LIST = 'Dateien auflisten (s3:ListBucket)';

export class S3StorageProvider implements StorageProvider {
  readonly #config: S3Config;
  readonly #credentials: S3Credentials;
  readonly #allowPrivate: boolean;
  readonly #client: S3ClientLike;
  readonly #now: () => Date;
  /** Prefix samt abschließendem '/' bzw. '' */
  readonly #root: string;
  #signer: S3Client | null = null;

  constructor(config: S3Config, credentials: S3Credentials, options: S3ProviderOptions = {}) {
    this.#config = config;
    this.#credentials = credentials;
    this.#allowPrivate = options.allowPrivateEndpoints ?? false;
    this.#client = options.createClient?.(config, credentials) ?? new S3Client(s3ClientConfig(config, credentials, this.#allowPrivate));
    this.#now = options.now ?? (() => new Date());
    this.#root = config.prefix ? `${config.prefix}/` : '';
  }

  /** Echter Client nur zum Signieren (rechnet lokal, ohne Netz) */
  #presigner(): S3Client {
    if (this.#client instanceof S3Client) return this.#client;
    return (this.#signer ??= new S3Client(s3ClientConfig(this.#config, this.#credentials, this.#allowPrivate)));
  }

  async #send<T>(what: string, command: object): Promise<T> {
    try {
      return (await this.#client.send(command)) as T;
    } catch (err) {
      throw translateS3Error(err, what, this.#config);
    }
  }

  async #sign(sign: (client: S3Client) => Promise<string>): Promise<string> {
    try {
      return await sign(this.#presigner());
    } catch (err) {
      throw translateS3Error(err, 'URLs signieren', this.#config);
    }
  }

  #expiresAt(): string {
    return new Date(this.#now().getTime() + S3_URL_TTL_SECONDS * 1000).toISOString();
  }

  /**
   * Datei-IDs (= Objektschlüssel) kommen vom Client: müssen unter dem Prefix liegen, eine Audio-Endung haben und
   * dürfen keine Pfad-Tricks enthalten.
   */
  #checkKey(fileId: string): string {
    const rest = fileId.startsWith(this.#root) ? fileId.slice(this.#root.length) : null;
    if (rest === null || rest === '' || audioExtension(rest) === null) throw notFound();
    if (rest.split('/').some((p) => p === '' || p === '.' || p === '..') || /[\\\u0000-\u001f\u007f]/.test(rest)) throw notFound();
    return fileId;
  }

  /**
   * Gibt es das Objekt? Per ListObjectsV2 statt HeadObject: Ohne s3:ListBucket auf genau diesen Schlüssel antwortet
   * S3 auf HEAD fehlender Objekte mit 403 statt 404 – und Prefix-beschränkte Rechte gelten für HEAD nicht. Außerdem
   * hat eine HEAD-Antwort keinen Fehlercode, ungültige Schlüssel wären dann nicht von fehlenden Rechten zu
   * unterscheiden.
   */
  async #exists(Key: string): Promise<boolean> {
    const page = await this.#send<ListPage>(LIST, new ListObjectsV2Command({ Bucket: this.#config.bucket, Prefix: Key, MaxKeys: 1 }));
    return page.Contents?.[0]?.Key === Key;
  }

  async validate(): Promise<void> {
    const Bucket = this.#config.bucket;
    // Kein HeadBucket: es verlangt s3:ListBucket ohne Prefix-Bedingung und scheitert daher bei Zugangsdaten, die
    // (wie empfohlen) nur für ein Prefix freigegeben sind. ListObjectsV2 meldet fehlenden Bucket, falsche Region
    // und ungültige Schlüssel ebenso – mit aussagekräftigem Fehlercode.
    await this.#send(LIST, new ListObjectsV2Command({ Bucket, Prefix: this.#root, MaxKeys: 1 }));
    const Key = `${this.#root}.pnp-zugriffstest-${randomBytes(6).toString('hex')}.txt`;
    await this.#send('Dateien hochladen (s3:PutObject)', new PutObjectCommand({ Bucket, Key, Body: 'Zugriffstest des Pen & Paper Managers – darf gelöscht werden', ContentType: 'text/plain; charset=utf-8' }));
    try {
      // Das Objekt existiert gerade, HEAD ist hier also eine echte Leseprobe (s3:GetObject)
      await this.#send('Dateien lesen (s3:GetObject)', new HeadObjectCommand({ Bucket, Key }));
    } catch (err) {
      // Testdatei trotzdem wegräumen; der Lesefehler ist die eigentliche Meldung
      await this.#client.send(new DeleteObjectCommand({ Bucket, Key })).catch(() => {});
      throw err;
    }
    await this.#send('Dateien löschen (s3:DeleteObject)', new DeleteObjectCommand({ Bucket, Key }));
  }

  /**
   * Alle Audiodateien unter Prefix/Ordner, auch in Unterordnern; `name` ist der Pfad relativ zum Ordner.
   * Cursor = zuletzt gesehener Schlüssel (StartAfter), damit Seiten trotz übersprungener Nicht-Audio-Dateien
   * bis zu `limit` Einträge haben.
   */
  async listFiles({ folder, cursor, limit }: ListFilesOptions): Promise<StorageFilePage> {
    const Prefix = this.#root + (folder ? `${folder}/` : '');
    if (cursor !== undefined && !cursor.startsWith(Prefix)) throw invalid('Ungültiger Cursor – bitte die Liste neu laden');
    const files: StorageFile[] = [];
    let startAfter = cursor;
    for (let i = 0; i < MAX_LIST_REQUESTS; i++) {
      const page = await this.#send<ListPage>(
        LIST,
        new ListObjectsV2Command({ Bucket: this.#config.bucket, Prefix, MaxKeys: 1000, ...(startAfter ? { StartAfter: startAfter } : {}) }),
      );
      const contents = page.Contents ?? [];
      for (const [index, object] of contents.entries()) {
        const key = object.Key;
        if (!key) continue;
        startAfter = key;
        const name = key.slice(Prefix.length);
        if (name === '' || key.endsWith('/') || audioExtension(name) === null) continue;
        files.push({
          id: key,
          name,
          size: object.Size ?? null,
          mimeType: mimeTypeOf(name),
          updatedAt: object.LastModified ? object.LastModified.toISOString() : null,
        });
        if (files.length === limit) {
          const more = index < contents.length - 1 || page.IsTruncated === true;
          return { files, nextCursor: more ? key : null };
        }
      }
      if (!page.IsTruncated || contents.length === 0) return { files, nextCursor: null };
    }
    // Viele Nicht-Audio-Dateien am Stück: Teilseite liefern, beim nächsten Aufruf dahinter weitermachen
    return { files, nextCursor: startAfter ?? null };
  }

  async getPlaybackUrl(fileId: string) {
    const Key = this.#checkKey(fileId);
    const Bucket = this.#config.bucket;
    // Vorab prüfen, damit fehlende Dateien als verständlicher Fehler ankommen statt als Ladefehler im <audio>
    if (!(await this.#exists(Key))) throw notFound();
    const url = await this.#sign((client) => getSignedUrl(client, new GetObjectCommand({ Bucket, Key }), { expiresIn: S3_URL_TTL_SECONDS }));
    return { url, expiresAt: this.#expiresAt() };
  }

  /**
   * Presigned PUT (funktioniert auch bei R2, das kein presigned POST kennt). Signiert sind Content-Type,
   * Content-Length und `If-None-Match: *`: S3 lehnt Uploads mit anderem Typ oder anderer Größe als angemeldet ab
   * und überschreibt keine vorhandene Datei, auch nicht beim erneuten Benutzen derselben URL.
   */
  async upload(request: { fileName: string; contentType: string; size: number }) {
    const Bucket = this.#config.bucket;
    const Key = this.#checkKey(this.#root + request.fileName);
    if (Buffer.byteLength(Key, 'utf8') > MAX_KEY_BYTES) throw invalid('Dateiname ist für diesen Ordner zu lang');
    // Vorab prüfen für eine verständliche Meldung; verbindlich ist If-None-Match beim Upload selbst
    if (await this.#exists(Key)) {
      throw invalid(`Eine Datei "${request.fileName}" gibt es dort schon – bitte umbenennen oder die alte zuerst löschen`);
    }
    const url = await this.#sign((client) =>
      getSignedUrl(client, new PutObjectCommand({ Bucket, Key, ContentType: request.contentType, ContentLength: request.size, IfNoneMatch: '*' }), {
        expiresIn: S3_URL_TTL_SECONDS,
        signableHeaders: new Set(['content-type', 'content-length', 'if-none-match']),
      }),
    );
    return {
      method: 'PUT' as const,
      url,
      // Content-Length setzt der Browser selbst (aus der Dateigröße); er muss zur angemeldeten Größe passen
      headers: { 'Content-Type': request.contentType, 'If-None-Match': '*' },
      fields: {},
      fileId: Key,
      expiresAt: this.#expiresAt(),
    };
  }

  async delete(fileId: string): Promise<void> {
    const Key = this.#checkKey(fileId);
    // DeleteObject meldet auch bei fehlenden Dateien Erfolg – vorher prüfen, damit der Nutzer 404 bekommt
    if (!(await this.#exists(Key))) throw notFound();
    await this.#send('Dateien löschen (s3:DeleteObject)', new DeleteObjectCommand({ Bucket: this.#config.bucket, Key }));
  }

  /** Nie Zugangsdaten ausgeben, falls das Objekt doch einmal geloggt oder serialisiert wird */
  toJSON() {
    return { type: 's3', bucket: this.#config.bucket, prefix: this.#config.prefix };
  }
}

export function s3Provider(options: S3ProviderOptions = {}): StorageProviderDefinition<S3Config, S3Credentials> {
  const allowPrivate = options.allowPrivateEndpoints ?? false;
  return {
    type: 's3',
    parseInput: (config, credentials) => parseS3Input(config, credentials, allowPrivate),
    create: (connection) => new S3StorageProvider(connection.config, connection.credentials, options),
  };
}
