import { randomBytes } from 'node:crypto';
import { DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db.ts';
import { buildApp } from '../src/app.ts';
import { StorageProviderError } from '../src/storage/provider.ts';
import { StorageProviderRegistry } from '../src/storage/registry.ts';
import {
  S3StorageProvider,
  parseEndpoint,
  parseS3Input,
  s3Provider,
  translateS3Error,
  type S3ClientLike,
  type S3Config,
} from '../src/storage/s3.ts';
import { loginAs } from './helpers.ts';

// S3-Adapter gegen einen gemockten S3-Client: ein kleiner In-Memory-Bucket, der die genutzten Befehle versteht.
// Presigned URLs baut der echte SDK-Signierer (rechnet lokal, ohne Netz).

const ACCESS_KEY = 'AKIATESTZUGANG';
const SECRET_KEY = 'super-geheimer-schluessel-42';
const NOW = new Date('2026-10-16T12:00:00.000Z');

interface S3Object {
  size: number;
  lastModified: Date;
}

const s3Error = (name: string, status?: number) => Object.assign(new Error(`${name}: ${SECRET_KEY}`), { name, ...(status ? { $metadata: { httpStatusCode: status } } : {}) });

class FakeS3 implements S3ClientLike {
  objects = new Map<string, S3Object>();
  calls: { command: string; input: Record<string, any> }[] = [];
  /** Fehler je Befehl (z.B. { PutObjectCommand: s3Error('AccessDenied', 403) }) */
  failures: Record<string, Error> = {};
  /** Seitengröße, die der "Server" höchstens liefert (S3: 1000) */
  pageSize = 1000;

  constructor(public bucket = 'klang') {}

  add(key: string, size = 10) {
    this.objects.set(key, { size, lastModified: NOW });
  }

  async send(command: object): Promise<unknown> {
    const name = command.constructor.name;
    const input = (command as { input: Record<string, any> }).input;
    this.calls.push({ command: name, input });
    if (this.failures[name]) throw this.failures[name];
    if (input.Bucket !== this.bucket) throw s3Error('NoSuchBucket', 404);
    switch (name) {
      case 'ListObjectsV2Command': {
        const keys = [...this.objects.keys()].filter((k) => k.startsWith(input.Prefix ?? '') && (!input.StartAfter || k > input.StartAfter)).sort();
        const max = Math.min(input.MaxKeys ?? 1000, this.pageSize);
        const page = keys.slice(0, max);
        return {
          Contents: page.map((Key) => ({ Key, Size: this.objects.get(Key)!.size, LastModified: this.objects.get(Key)!.lastModified })),
          IsTruncated: keys.length > max,
          KeyCount: page.length,
        };
      }
      case 'PutObjectCommand':
        this.add(input.Key, String(input.Body ?? '').length);
        return {};
      case 'HeadObjectCommand': {
        const obj = this.objects.get(input.Key);
        if (!obj) throw s3Error('NotFound', 404);
        return { ContentLength: obj.size };
      }
      case 'DeleteObjectCommand':
        this.objects.delete(input.Key);
        return {};
      default:
        throw new Error(`unerwarteter Befehl ${name}`);
    }
  }
}

const config = (extra: Partial<S3Config> = {}): S3Config => ({ bucket: 'klang', region: 'eu-central-1', endpoint: null, prefix: 'sounds', ...extra });

function provider(s3: FakeS3, extra: Partial<S3Config> = {}) {
  return new S3StorageProvider(config(extra), { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY }, { createClient: () => s3, now: () => NOW });
}

async function rejection(promise: Promise<unknown>): Promise<StorageProviderError> {
  const err = await promise.then(
    () => {
      throw new Error('kein Fehler');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(StorageProviderError);
  expect((err as Error).message).not.toContain(SECRET_KEY);
  return err as StorageProviderError;
}

describe('S3: Eingaben (parseInput)', () => {
  const creds = { accessKeyId: ` ${ACCESS_KEY} `, secretAccessKey: SECRET_KEY };

  it('normalisiert Konfiguration und trennt Geheimes ab', () => {
    const parsed = parseS3Input({ bucket: 'klang', region: '', endpoint: 'https://s3.eu-central-1.wasabisys.com/', prefix: '/soundboard/musik/' }, creds, false);
    expect(parsed.config).toEqual({ bucket: 'klang', region: 'us-east-1', endpoint: 'https://s3.eu-central-1.wasabisys.com', prefix: 'soundboard/musik' });
    expect(parsed.credentials).toEqual({ accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY });
    expect(JSON.stringify(parsed.config)).not.toContain(SECRET_KEY);
    expect(parseS3Input({ bucket: 'klang', region: 'auto' }, creds, false).config).toEqual({ bucket: 'klang', region: 'auto', endpoint: null, prefix: '' });
  });

  it.each([
    [{ bucket: '' }, creds, 'Bucket-Name ist ungültig'],
    [{ bucket: 'Gross_Buchstaben' }, creds, 'Bucket-Name ist ungültig'],
    [{ bucket: 'klang', region: 'eu central' }, creds, 'Region ist ungültig'],
    [{ bucket: 'klang', prefix: 'a/../b' }, creds, 'Prefix'],
    [{ bucket: 'klang', prefix: 'a//b' }, creds, 'Prefix'],
    [{ bucket: 'klang', endpoint: 'kein url' }, creds, 'keine gültige URL'],
    [{ bucket: 'klang', endpoint: 'http://s3.example.com' }, creds, 'https://'],
    [{ bucket: 'klang', endpoint: 'https://key:secret@s3.example.com' }, creds, 'keine Zugangsdaten'],
    [{ bucket: 'klang', endpoint: 'https://s3.example.com/klang' }, creds, 'Protokoll, Host'],
    [{ bucket: 42 }, creds, 'muss ein Text sein'],
    [{ bucket: 'klang' }, { accessKeyId: '', secretAccessKey: SECRET_KEY }, 'Access Key ID fehlt'],
    [{ bucket: 'klang' }, { accessKeyId: ACCESS_KEY }, 'Secret Access Key fehlt'],
  ])('lehnt %j ab', (cfg, cr, message) => {
    expect(() => parseS3Input(cfg, cr, false)).toThrow(message);
    try {
      parseS3Input(cfg, cr, false);
    } catch (err) {
      expect((err as StorageProviderError).kind).toBe('invalid');
      expect((err as Error).message).not.toContain(SECRET_KEY);
    }
  });

  it('sperrt Endpoints im privaten Netz (SSRF), außer es ist ausdrücklich erlaubt', () => {
    for (const host of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.0.10', '172.20.0.1', '169.254.169.254', '[::1]', '[fd00::1]', '[::ffff:127.0.0.1]', 'minio', 'nas.local']) {
      expect(() => parseEndpoint(`https://${host}:9000`, false), host).toThrow('privaten Netz');
    }
    expect(parseEndpoint('https://abc123.r2.cloudflarestorage.com', false)).toBe('https://abc123.r2.cloudflarestorage.com');
    expect(parseEndpoint('https://8.8.8.8', false)).toBe('https://8.8.8.8');
    expect(parseEndpoint('http://localhost:9000', true)).toBe('http://localhost:9000');
    expect(parseEndpoint('', false)).toBeNull();
  });
});

describe('S3: Fehler übersetzen', () => {
  const cfg = config({ endpoint: 'https://s3.example.com' });
  it.each([
    [s3Error('InvalidAccessKeyId', 403), 'auth'],
    [s3Error('SignatureDoesNotMatch', 403), 'auth'],
    [s3Error('NoSuchBucket', 404), 'permission'],
    [s3Error('PermanentRedirect', 301), 'permission'],
    [s3Error('AccessDenied', 403), 'permission'],
    [s3Error('Forbidden', 403), 'permission'],
    [s3Error('NotFound', 404), 'not_found'],
    [s3Error('NoSuchKey', 404), 'not_found'],
    [Object.assign(new Error(`connect ECONNREFUSED ${SECRET_KEY}`), { code: 'ECONNREFUSED' }), 'unavailable'],
    [s3Error('InternalError', 500), 'unavailable'],
    [new Error(SECRET_KEY), 'unavailable'],
  ] as const)('%s → %s', (err, kind) => {
    const translated = translateS3Error(err, 'Dateien auflisten', cfg);
    expect(translated.kind).toBe(kind);
    expect(translated.message).not.toContain(SECRET_KEY);
    expect(translated.message).not.toContain(ACCESS_KEY);
  });

  it('nennt Bucket, Region und Endpoint verständlich', () => {
    expect(translateS3Error(s3Error('NoSuchBucket', 404), 'x', cfg).message).toBe('Bucket "klang" existiert nicht (oder liegt bei einem anderen Endpoint)');
    expect(translateS3Error(s3Error('AuthorizationHeaderMalformed', 400), 'x', cfg).message).toBe('Region "eu-central-1" passt nicht zum Bucket "klang"');
    expect(translateS3Error(s3Error('AccessDenied', 403), 'Dateien löschen (s3:DeleteObject)', cfg).message).toBe(
      'Zugriff verweigert: Die Zugangsdaten dürfen Dateien löschen (s3:DeleteObject) nicht',
    );
    expect(translateS3Error(Object.assign(new Error('x'), { code: 'ENOTFOUND' }), 'x', cfg).message).toBe('S3-Endpoint https://s3.example.com ist nicht erreichbar');
    expect(translateS3Error(s3Error('SlowDown', 503), 'x', cfg).message).toBe('S3 meldet einen unerwarteten Fehler (SlowDown)');
  });
});

describe('S3StorageProvider', () => {
  let s3: FakeS3;
  beforeEach(() => (s3 = new FakeS3()));

  describe('validate', () => {
    it('prüft Auflisten, Schreiben, Lesen und Löschen und räumt die Testdatei weg', async () => {
      await provider(s3).validate();
      expect(s3.calls.map((c) => c.command)).toEqual(['ListObjectsV2Command', 'PutObjectCommand', 'HeadObjectCommand', 'DeleteObjectCommand']);
      expect(s3.calls[0]!.input).toMatchObject({ Bucket: 'klang', Prefix: 'sounds/', MaxKeys: 1 });
      expect(s3.calls[1]!.input.Key).toMatch(/^sounds\/\.pnp-zugriffstest-[0-9a-f]{12}\.txt$/);
      expect(s3.objects.size).toBe(0);
    });

    it('nutzt ohne Prefix den ganzen Bucket', async () => {
      await provider(s3, { prefix: '' }).validate();
      expect(s3.calls[0]!.input.Prefix).toBe('');
      expect(s3.calls[1]!.input.Key).toMatch(/^\.pnp-zugriffstest-/);
    });

    it('meldet fehlende Rechte je Aktion', async () => {
      s3.failures.PutObjectCommand = s3Error('AccessDenied', 403);
      let err = await rejection(provider(s3).validate());
      expect(err.kind).toBe('permission');
      expect(err.message).toContain('Dateien hochladen (s3:PutObject)');

      s3 = new FakeS3();
      s3.failures.HeadObjectCommand = s3Error('Forbidden', 403);
      err = await rejection(provider(s3).validate());
      expect(err.message).toContain('Dateien lesen (s3:GetObject)');
      expect(s3.objects.size).toBe(0); // trotzdem aufgeräumt

      s3 = new FakeS3();
      s3.failures.DeleteObjectCommand = s3Error('AccessDenied', 403);
      err = await rejection(provider(s3).validate());
      expect(err.message).toContain('Dateien löschen (s3:DeleteObject)');
    });

    it('meldet falsche Schlüssel, fehlenden Bucket und Netzprobleme', async () => {
      s3.failures.ListObjectsV2Command = s3Error('InvalidAccessKeyId', 403);
      expect((await rejection(provider(s3).validate())).kind).toBe('auth');
      expect(s3.calls.map((c) => c.command)).toEqual(['ListObjectsV2Command']);

      expect((await rejection(provider(new FakeS3('anderer')).validate())).message).toContain('Bucket "klang" existiert nicht');

      s3.failures.ListObjectsV2Command = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
      expect((await rejection(provider(s3).validate())).kind).toBe('unavailable');
    });
  });

  describe('listFiles', () => {
    beforeEach(() => {
      for (const key of ['sounds/a.mp3', 'sounds/b.txt', 'sounds/kampf/', 'sounds/kampf/schwert.OGG', 'sounds/kampf/notiz.md', 'sounds/z.wav', 'andere/x.mp3', 'soundsalat.mp3']) {
        s3.add(key, 1234);
      }
    });

    it('liefert nur Audiodateien unter dem Prefix, auch aus Unterordnern', async () => {
      const page = await provider(s3).listFiles({ folder: '', limit: 100 });
      expect(page).toEqual({
        files: [
          { id: 'sounds/a.mp3', name: 'a.mp3', size: 1234, mimeType: 'audio/mpeg', updatedAt: NOW.toISOString() },
          { id: 'sounds/kampf/schwert.OGG', name: 'kampf/schwert.OGG', size: 1234, mimeType: 'audio/ogg', updatedAt: NOW.toISOString() },
          { id: 'sounds/z.wav', name: 'z.wav', size: 1234, mimeType: 'audio/wav', updatedAt: NOW.toISOString() },
        ],
        nextCursor: null,
      });
    });

    it('listet einen Unterordner mit Namen relativ zu ihm', async () => {
      const page = await provider(s3).listFiles({ folder: 'kampf', limit: 100 });
      expect(page.files.map((f) => [f.id, f.name])).toEqual([['sounds/kampf/schwert.OGG', 'schwert.OGG']]);
      expect(s3.calls[0]!.input.Prefix).toBe('sounds/kampf/');
    });

    it('blättert seitenweise per Cursor', async () => {
      const p = provider(s3);
      const first = await p.listFiles({ folder: '', limit: 2 });
      expect(first.files.map((f) => f.name)).toEqual(['a.mp3', 'kampf/schwert.OGG']);
      expect(first.nextCursor).toBe('sounds/kampf/schwert.OGG');
      const second = await p.listFiles({ folder: '', limit: 2, cursor: first.nextCursor! });
      expect(second).toMatchObject({ files: [{ name: 'z.wav' }], nextCursor: null });
      expect(s3.calls[1]!.input.StartAfter).toBe('sounds/kampf/schwert.OGG');
    });

    it('lädt weitere S3-Seiten nach, wenn viele Nicht-Audio-Dateien dazwischen liegen', async () => {
      s3.pageSize = 2;
      const page = await provider(s3).listFiles({ folder: '', limit: 3 });
      expect(page.files.map((f) => f.name)).toEqual(['a.mp3', 'kampf/schwert.OGG', 'z.wav']);
      expect(page.nextCursor).toBeNull();
      expect(s3.calls.length).toBe(3);
    });

    it('liefert nach höchstens 5 Anfragen eine Teilseite mit Cursor', async () => {
      s3 = new FakeS3();
      s3.pageSize = 1;
      for (let i = 0; i < 10; i++) s3.add(`sounds/notiz${i}.txt`);
      s3.add('sounds/zz.mp3');
      const p = provider(s3);
      const first = await p.listFiles({ folder: '', limit: 10 });
      expect(first).toEqual({ files: [], nextCursor: 'sounds/notiz4.txt' });
      const second = await p.listFiles({ folder: '', limit: 10, cursor: first.nextCursor! });
      expect(second).toEqual({ files: [], nextCursor: 'sounds/notiz9.txt' });
      const third = await p.listFiles({ folder: '', limit: 10, cursor: second.nextCursor! });
      expect(third.files.map((f) => f.id)).toEqual(['sounds/zz.mp3']);
      expect(third.nextCursor).toBeNull();
    });

    it('ignoriert Cursor außerhalb des Ordners', async () => {
      await provider(s3).listFiles({ folder: '', limit: 10, cursor: 'andere/x.mp3' });
      expect(s3.calls[0]!.input).not.toHaveProperty('StartAfter');
    });
  });

  describe('getPlaybackUrl', () => {
    it('erzeugt eine presigned GET-URL, 15 Minuten gültig', async () => {
      s3.add('sounds/kampf/schwert.ogg');
      const { url, expiresAt } = await provider(s3).getPlaybackUrl('sounds/kampf/schwert.ogg');
      const parsed = new URL(url);
      expect(parsed.origin + parsed.pathname).toBe('https://klang.s3.eu-central-1.amazonaws.com/sounds/kampf/schwert.ogg');
      expect(parsed.searchParams.get('X-Amz-Expires')).toBe('900');
      expect(parsed.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
      expect(url).not.toContain(SECRET_KEY);
      expect(expiresAt).toBe('2026-10-16T12:15:00.000Z');
      expect(s3.calls.map((c) => c.command)).toEqual(['HeadObjectCommand']);
    });

    it('nutzt bei eigenem Endpoint Pfad-Adressierung', async () => {
      s3.add('sounds/a.mp3');
      const { url } = await provider(s3, { endpoint: 'https://abc.r2.cloudflarestorage.com', region: 'auto' }).getPlaybackUrl('sounds/a.mp3');
      expect(url).toMatch(/^https:\/\/abc\.r2\.cloudflarestorage\.com\/klang\/sounds\/a\.mp3\?/);
    });

    it('verweigert Dateien außerhalb des Prefix, Nicht-Audio und Pfad-Tricks', async () => {
      for (const key of ['andere/x.mp3', 'soundsalat.mp3', 'sounds/', 'sounds/notiz.txt', 'sounds/../andere/x.mp3', 'sounds//a.mp3', 'sounds/./a.mp3']) {
        s3.add(key);
        expect((await rejection(provider(s3).getPlaybackUrl(key))).kind, key).toBe('not_found');
      }
      expect(s3.calls).toEqual([]);
    });

    it('meldet fehlende Dateien', async () => {
      expect((await rejection(provider(s3).getPlaybackUrl('sounds/fehlt.mp3'))).kind).toBe('not_found');
    });
  });

  describe('upload', () => {
    const request = { fileName: 'Drache brüllt.mp3', contentType: 'audio/mpeg', size: 4321 };

    it('erzeugt eine presigned PUT-URL mit signiertem Content-Type und signierter Größe', async () => {
      const target = await provider(s3).upload(request);
      expect(target).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'audio/mpeg' }, fields: {}, fileId: 'sounds/Drache brüllt.mp3', expiresAt: '2026-10-16T12:15:00.000Z' });
      const url = new URL(target.url);
      expect(url.pathname).toBe('/sounds/Drache%20br%C3%BCllt.mp3');
      expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
      expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
      // Keine SDK-Prüfsummen, die der Browser nicht mitschicken würde
      expect([...url.searchParams.keys()].filter((k) => /checksum/i.test(k))).toEqual([]);
      expect(target.url).not.toContain(SECRET_KEY);
      expect(s3.calls.map((c) => c.command)).toEqual(['HeadObjectCommand']);
    });

    it('überschreibt keine vorhandene Datei', async () => {
      s3.add('sounds/Drache brüllt.mp3');
      const err = await rejection(provider(s3).upload(request));
      expect(err.kind).toBe('invalid');
      expect(err.message).toContain('gibt es dort schon');
    });

    it('meldet fehlende Rechte statt eine URL zu liefern', async () => {
      s3.failures.HeadObjectCommand = s3Error('InvalidAccessKeyId', 403);
      expect((await rejection(provider(s3).upload(request))).kind).toBe('auth');
    });

    it('lädt ohne Prefix in die Bucket-Wurzel', async () => {
      expect((await provider(s3, { prefix: '' }).upload(request)).fileId).toBe('Drache brüllt.mp3');
    });
  });

  describe('delete', () => {
    it('löscht eine vorhandene Datei', async () => {
      s3.add('sounds/a.mp3');
      await provider(s3).delete('sounds/a.mp3');
      expect(s3.objects.has('sounds/a.mp3')).toBe(false);
      expect(s3.calls.map((c) => c.command)).toEqual(['HeadObjectCommand', 'DeleteObjectCommand']);
    });

    it('meldet fehlende Dateien und verweigert fremde Schlüssel', async () => {
      expect((await rejection(provider(s3).delete('sounds/fehlt.mp3'))).kind).toBe('not_found');
      s3.add('andere/x.mp3');
      expect((await rejection(provider(s3).delete('andere/x.mp3'))).kind).toBe('not_found');
      expect(s3.objects.has('andere/x.mp3')).toBe(true);
    });

    it('meldet fehlendes Löschrecht', async () => {
      s3.add('sounds/a.mp3');
      s3.failures.DeleteObjectCommand = s3Error('AccessDenied', 403);
      expect((await rejection(provider(s3).delete('sounds/a.mp3'))).message).toContain('s3:DeleteObject');
    });
  });

  it('gibt beim Serialisieren keine Zugangsdaten preis', () => {
    const json = JSON.stringify(provider(s3));
    expect(json).not.toContain(SECRET_KEY);
    expect(json).not.toContain(ACCESS_KEY);
  });

  it('nutzt die gemockten Befehle des echten SDK', () => {
    // Absicherung, dass der Fake auf die richtigen Klassennamen hört
    expect([ListObjectsV2Command, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand].map((c) => c.name)).toEqual([
      'ListObjectsV2Command',
      'PutObjectCommand',
      'HeadObjectCommand',
      'DeleteObjectCommand',
    ]);
  });
});

describe('S3 über die API', () => {
  it('verbindet, listet, spielt ab, lädt hoch und löscht – ohne Zugangsdaten preiszugeben', async () => {
    const s3 = new FakeS3();
    s3.add('sounds/a.mp3');
    const registry = new StorageProviderRegistry().register(s3Provider({ createClient: () => s3 }));
    const db = openDb(':memory:');
    const app = buildApp(db, { secretKey: randomBytes(32), storageProviders: registry });
    const alice = await loginAs(app, 'alice@test.de');

    const created = await alice.post('/api/storage/connections', {
      providerType: 's3',
      displayName: 'Mein Bucket',
      config: { bucket: 'klang', region: 'eu-central-1', prefix: 'sounds' },
      credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
    });
    expect(created.status).toBe(201);
    expect(created.body.config).toEqual({ bucket: 'klang', region: 'eu-central-1', endpoint: null, prefix: 'sounds' });
    const base = `/api/storage/connections/${created.body.id}`;

    const files = await alice.get(`${base}/files`);
    expect(files.body.files.map((f: { id: string }) => f.id)).toEqual(['sounds/a.mp3']);
    const playback = await alice.get(`${base}/playback-url?fileId=${encodeURIComponent('sounds/a.mp3')}`);
    expect(playback.body.url).toContain('X-Amz-Signature=');
    const upload = await alice.post(`${base}/uploads`, { fileName: 'b.ogg', contentType: 'audio/ogg', size: 10 });
    expect(upload.body).toMatchObject({ method: 'PUT', fileId: 'sounds/b.ogg' });
    expect((await alice.del(`${base}/files?fileId=${encodeURIComponent('sounds/a.mp3')}`)).status).toBe(200);

    // Rechtefehler landen verständlich im Status
    s3.failures.ListObjectsV2Command = s3Error('AccessDenied', 403);
    const denied = await alice.get(`${base}/files`);
    expect(denied).toEqual({ status: 409, body: { error: 'Zugriff verweigert: Die Zugangsdaten dürfen Dateien auflisten (s3:ListBucket) nicht' } });
    s3.failures.ListObjectsV2Command = s3Error('InvalidAccessKeyId', 403);
    expect((await alice.post(`${base}/test`)).status).toBe(409);
    const [connection] = (await alice.get('/api/storage/connections')).body;
    expect(connection.status).toBe('disconnected');

    for (const body of [created.body, files.body, playback.body, upload.body, denied.body, connection]) {
      expect(JSON.stringify(body)).not.toContain(SECRET_KEY);
    }
    const row = db.prepare('SELECT config, credentials FROM user_storage_connections').get() as { config: string; credentials: string };
    expect(row.config + row.credentials).not.toContain(SECRET_KEY);
    expect(row.config + row.credentials).not.toContain(ACCESS_KEY);
  });

  it('lehnt private Endpoints beim Anlegen ab', async () => {
    const app = buildApp(openDb(':memory:'), { secretKey: randomBytes(32), storageProviders: new StorageProviderRegistry().register(s3Provider({ createClient: () => new FakeS3() })) });
    const alice = await loginAs(app, 'alice@test.de');
    const res = await alice.post('/api/storage/connections', {
      providerType: 's3',
      displayName: 'Intern',
      config: { bucket: 'klang', endpoint: 'https://169.254.169.254' },
      credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
    });
    expect(res).toEqual({ status: 400, body: { error: 'Endpoints im lokalen oder privaten Netz sind auf diesem Server nicht erlaubt' } });
  });
});
