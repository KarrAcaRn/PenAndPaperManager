import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db.ts';
import { redactUrl } from '../src/app.ts';
import { SESSION_COOKIE } from '../src/auth.ts';
import { OAUTH_COOKIE } from '../src/routes/googleDrive.ts';
import { GOOGLE_DRIVE_SCOPE, LIST_MAX_DEPTH, LIST_MAX_FOLDERS, googleDriveOptionsFromEnv, googleDriveProvider } from '../src/storage/googleDrive.ts';
import { StorageProviderRegistry, defaultStorageProviders } from '../src/storage/registry.ts';
import { FAKE_CLIENT, fakeGoogleDrive, type FakeDriveFile } from './fakeGoogleDrive.ts';
import { loginWithCode, sidOf, testApp } from './helpers.ts';

type Fake = ReturnType<typeof fakeGoogleDrive>;

const BASE = '/api/storage/connections';
const DRIVE = '/api/storage/google-drive';

describe('Google Drive', () => {
  let fake: Fake;
  let db: Db;
  let app: FastifyInstance;
  let logs: string[];

  beforeEach(() => {
    fake = fakeGoogleDrive();
    db = openDb(':memory:');
    logs = [];
    const registry = new StorageProviderRegistry().register(googleDriveProvider({ ...FAKE_CLIENT, fetch: fake.fetch, now: () => fake.state.now }));
    app = testApp(db, { secretKey: randomBytes(32), storageProviders: registry, logStream: { write: (line) => void logs.push(line) } });
  });

  /** Login wie im Browser; liefert die Session-ID für eigene Requests mit weiteren Cookies */
  async function login(email = 'alice@test.de') {
    const sid = sidOf(await loginWithCode(app, email));
    const call = async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object, headers: Record<string, string> = {}) => {
      const r = await app.inject({ method, url, cookies: { [SESSION_COOKIE]: sid }, headers, ...(payload ? { payload } : {}) });
      return { status: r.statusCode, body: r.body ? (r.headers['content-type']?.toString().includes('json') ? r.json() : r.body) : null, raw: r };
    };
    return { sid, call };
  }

  type Session = Awaited<ReturnType<typeof login>>;

  async function startOAuth(session: Session, query = '') {
    const res = await app.inject({ url: `${DRIVE}/oauth/start${query}`, cookies: { [SESSION_COOKIE]: session.sid } });
    expect(res.statusCode).toBe(302);
    const location = new URL(res.headers.location as string);
    const cookie = res.cookies.find((c) => c.name === OAUTH_COOKIE)!;
    return { location, cookie };
  }

  async function callback(session: Session, oauthCookie: string | undefined, query: Record<string, string>) {
    const res = await app.inject({
      url: `${DRIVE}/oauth/callback?${new URLSearchParams(query)}`,
      cookies: { [SESSION_COOKIE]: session.sid, ...(oauthCookie ? { [OAUTH_COOKIE]: oauthCookie } : {}) },
    });
    expect(res.statusCode).toBe(302);
    const target = res.headers.location as string;
    expect(target.startsWith('/#/settings?')).toBe(true);
    return new URLSearchParams(target.slice(target.indexOf('?') + 1));
  }

  /** Kompletter OAuth-Flow; liefert die neue Verbindungs-ID */
  async function connectDrive(session: Session, query = '') {
    const { location, cookie } = await startOAuth(session, query);
    const code = fake.authorize(location.searchParams.get('code_challenge')!);
    const result = await callback(session, cookie.value, { code, state: location.searchParams.get('state')!, scope: GOOGLE_DRIVE_SCOPE });
    expect(result.get('storageError')).toBeNull();
    return Number(result.get('storageConnected'));
  }

  /** Verbindung mit neu angelegtem Ordner „Soundboard“ */
  async function connectWithFolder(session: Session) {
    const cid = await connectDrive(session);
    const res = await session.call('PUT', `${DRIVE}/connections/${cid}/folder`, { name: 'Soundboard' });
    expect(res.status).toBe(200);
    return { cid, folderId: res.body.config.folderId as string };
  }

  /** Alles, was die App nach außen gegeben hat: alle Antworten und Logs */
  const assertNoTokens = (...outputs: unknown[]) => {
    const text = [...outputs.map((o) => (typeof o === 'string' ? o : JSON.stringify(o))), ...logs].join('\n');
    expect(fake.state.issued.length).toBeGreaterThan(0);
    for (const token of fake.state.issued) expect(text).not.toContain(token);
  };

  describe('Registrierung', () => {
    it('ist nur verfügbar, wenn Client-ID, Secret und Redirect-URI gesetzt sind', () => {
      expect(defaultStorageProviders({}).list().map((p) => p.type)).toEqual(['s3']);
      const env = { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REDIRECT_URI: 'http://localhost:3000/cb' };
      expect(defaultStorageProviders(env).list()).toContainEqual({ type: 'google_drive', label: 'Google Drive', manualSetup: false });
      expect(googleDriveOptionsFromEnv({ ...env, GOOGLE_CLIENT_SECRET: ' ' })).toBeNull();
      expect(googleDriveOptionsFromEnv({ ...env, GOOGLE_APP_ORIGIN: 'https://pnp.example.org' })?.appOrigin).toBe('https://pnp.example.org');
    });

    it('lässt sich nicht per Formular anlegen', async () => {
      const alice = await login();
      const res = await alice.call('POST', BASE, { providerType: 'google_drive', displayName: 'x', config: {}, credentials: {} });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Dieser Anbieter wird über seine eigene Anmeldung verbunden');
    });

    it('meldet einen nicht eingerichteten Anbieter verständlich', async () => {
      const bare = testApp(openDb(':memory:'), { secretKey: randomBytes(32), storageProviders: new StorageProviderRegistry() });
      const sid = sidOf(await loginWithCode(bare, 'a@test.de'));
      const start = await bare.inject({ url: `${DRIVE}/oauth/start`, cookies: { [SESSION_COOKIE]: sid } });
      expect(start.statusCode).toBe(400);
      expect(start.json().error).toContain('nicht verfügbar');
    });
  });

  describe('OAuth', () => {
    it('leitet einen Callback ohne Login mit Hinweis zurück in die Einstellungen, statt nur 401 zu zeigen', async () => {
      const res = await app.inject({ url: `${DRIVE}/oauth/callback?code=x&state=y` });
      expect(res.statusCode).toBe(302);
      const target = res.headers.location as string;
      expect(target.startsWith('/#/settings?')).toBe(true);
      expect(new URLSearchParams(target.slice(target.indexOf('?') + 1)).get('storageError')).toContain('zuerst anmelden');
      // Andere Drive-Endpunkte bleiben hinter dem Login
      expect((await app.inject({ url: `${DRIVE}/connections/1/folders` })).statusCode).toBe(401);
    });

    it('Start verlangt einen Login und leitet mit drive.file, PKCE und state zu Google', async () => {
      expect((await app.inject({ url: `${DRIVE}/oauth/start` })).statusCode).toBe(401);
      const { location, cookie } = await startOAuth(await login());
      expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      const p = location.searchParams;
      expect(p.get('scope')).toBe(GOOGLE_DRIVE_SCOPE);
      expect(p.get('client_id')).toBe(FAKE_CLIENT.clientId);
      expect(p.get('redirect_uri')).toBe(FAKE_CLIENT.redirectUri);
      expect(p.get('response_type')).toBe('code');
      expect(p.get('access_type')).toBe('offline');
      expect(p.get('prompt')).toBe('consent');
      expect(p.get('code_challenge_method')).toBe('S256');
      expect(p.get('code_challenge')).toMatch(/^[\w-]{43}$/);
      expect(p.get('state')!.length).toBeGreaterThanOrEqual(32);
      expect(location.toString()).not.toContain(FAKE_CLIENT.clientSecret);
      // Verifier und state stehen nur verschlüsselt im Cookie
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.path).toBe(`${DRIVE}/oauth`);
      expect(cookie.value).not.toContain(p.get('state')!);
    });

    it('legt nach dem Callback eine Verbindung ohne Ordner an; Tokens nur verschlüsselt in der Datenbank', async () => {
      const alice = await login();
      const cid = await connectDrive(alice);
      const list = await alice.call('GET', BASE);
      expect(list.body).toEqual([
        expect.objectContaining({
          id: cid,
          providerType: 'google_drive',
          displayName: 'Google Drive (alice@gmail.com)',
          config: { folderId: null, folderName: null, accountEmail: 'alice@gmail.com' },
          status: 'connected',
        }),
      ]);
      const row = db.prepare('SELECT credentials, config FROM user_storage_connections').get() as { credentials: string; config: string };
      expect(row.credentials).toMatch(/^v1:/);
      for (const token of fake.state.issued) {
        expect(row.credentials).not.toContain(token);
        expect(row.config).not.toContain(token);
      }
      // Code mit PKCE-Verifier eingelöst, Tokens nie in einer URL an Google
      const exchange = fake.state.requests.find((r) => r.url === 'https://oauth2.googleapis.com/token')!;
      expect(new URLSearchParams(exchange.body).get('code_verifier')).toBeTruthy();
      for (const r of fake.state.requests) for (const token of fake.state.issued) expect(r.url).not.toContain(token);
      assertNoTokens(list.body);
    });

    it('übernimmt einen eigenen Anzeigenamen', async () => {
      const alice = await login();
      const cid = await connectDrive(alice, '?displayName=Musik');
      expect((await alice.call('GET', BASE)).body.find((c: { id: number }) => c.id === cid).displayName).toBe('Musik');
    });

    it('lehnt falschen state, fehlendes oder fremdes Cookie und abgebrochene Zustimmung ab', async () => {
      const alice = await login();
      const bob = await login('bob@test.de');
      const { location, cookie } = await startOAuth(alice);
      const state = location.searchParams.get('state')!;
      const code = () => fake.authorize(location.searchParams.get('code_challenge')!);
      const invalid = 'Die Anmeldung bei Google ist abgelaufen oder ungültig – bitte erneut verbinden';

      expect((await callback(alice, cookie.value, { code: code(), state: 'falsch' })).get('storageError')).toBe(invalid);
      expect((await callback(alice, undefined, { code: code(), state })).get('storageError')).toBe(invalid);
      // Cookie von Alice im Browser von Bob: an Alice gebunden, lässt sich nicht entschlüsseln
      expect((await callback(bob, cookie.value, { code: code(), state })).get('storageError')).toBe(invalid);
      expect((await callback(alice, cookie.value, { error: 'access_denied', state })).get('storageError')).toBe(
        'Die Verbindung mit Google Drive wurde abgebrochen',
      );
      // Code passt nicht zum Verifier (z.B. von einem anderen Start)
      expect((await callback(alice, cookie.value, { code: fake.authorize('anderer'), state })).get('storageError')).toMatch(/^Verbindung fehlgeschlagen/);
      expect((await alice.call('GET', BASE)).body).toEqual([]);
      expect((await bob.call('GET', BASE)).body).toEqual([]);
    });

    it('verlangt den Drive-Scope und ein Refresh-Token', async () => {
      const alice = await login();
      for (const [options, message] of [
        [{ scope: 'openid' }, 'Verbindung fehlgeschlagen: Bitte den Zugriff auf Google Drive erlauben'],
        [{ refreshToken: false }, 'Verbindung fehlgeschlagen: Google hat kein Refresh-Token geliefert – bitte erneut verbinden'],
      ] as const) {
        const { location, cookie } = await startOAuth(alice);
        const code = fake.authorize(location.searchParams.get('code_challenge')!, options);
        expect((await callback(alice, cookie.value, { code, state: location.searchParams.get('state')! })).get('storageError')).toBe(message);
      }
      expect((await alice.call('GET', BASE)).body).toEqual([]);
    });

    it('schreibt weder Code noch state noch Tokens ins Log', async () => {
      const alice = await login();
      const { location, cookie } = await startOAuth(alice);
      const state = location.searchParams.get('state')!;
      const code = fake.authorize(location.searchParams.get('code_challenge')!);
      await callback(alice, cookie.value, { code, state });
      const text = logs.join('\n');
      expect(text).toContain('/oauth/callback');
      expect(text).not.toContain(code);
      expect(text).not.toContain(encodeURIComponent(code));
      expect(text).not.toContain(state);
      assertNoTokens();
      expect(redactUrl('/a?code=x&state=y&folder=z&t=abc')).toBe('/a?code=%5Bentfernt%5D&state=%5Bentfernt%5D&folder=z&t=%5Bentfernt%5D');
    });
  });

  describe('Ordnerauswahl', () => {
    it('legt den Ordner „Soundboard“ an und speichert die Folder-ID', async () => {
      const alice = await login();
      const cid = await connectDrive(alice);
      const res = await alice.call('PUT', `${DRIVE}/connections/${cid}/folder`, { name: ' Soundboard ' });
      expect(res.status).toBe(200);
      const folder = fake.state.files.get(res.body.config.folderId)!;
      expect(folder).toMatchObject({ name: 'Soundboard', mimeType: 'application/vnd.google-apps.folder' });
      expect(res.body.config).toEqual({ folderId: folder.id, folderName: 'Soundboard', accountEmail: 'alice@gmail.com' });
      expect((await alice.call('POST', `${BASE}/${cid}/test`)).body.status).toBe('connected');
    });

    it('listet sichtbare Ordner und wählt einen vorhandenen', async () => {
      const alice = await login();
      const cid = await connectDrive(alice);
      const existing = fake.addFile({ name: 'Musik', mimeType: 'application/vnd.google-apps.folder' });
      fake.addFile({ name: 'Privat', mimeType: 'application/vnd.google-apps.folder', appVisible: false });
      fake.addFile({ name: 'lied.mp3' });
      const folders = await alice.call('GET', `${DRIVE}/connections/${cid}/folders`);
      expect(folders.body).toEqual({ folders: [{ id: existing.id, name: 'Musik' }], nextCursor: null });

      const res = await alice.call('PUT', `${DRIVE}/connections/${cid}/folder`, { folderId: existing.id });
      expect(res.body.config).toMatchObject({ folderId: existing.id, folderName: 'Musik' });
    });

    it('lehnt unbekannte, unsichtbare und ungültige Ordner sowie fremde Verbindungen ab', async () => {
      const alice = await login();
      const bob = await login('bob@test.de');
      const cid = await connectDrive(alice);
      const hidden = fake.addFile({ name: 'Privat', mimeType: 'application/vnd.google-apps.folder', appVisible: false });
      const audio = fake.addFile({ name: 'lied.mp3' });
      expect((await alice.call('PUT', `${DRIVE}/connections/${cid}/folder`, { folderId: hidden.id })).status).toBe(404);
      expect((await alice.call('PUT', `${DRIVE}/connections/${cid}/folder`, { folderId: audio.id })).status).toBe(404);
      expect((await alice.call('PUT', `${DRIVE}/connections/${cid}/folder`, { folderId: '../x' })).status).toBe(400);
      expect((await alice.call('PUT', `${DRIVE}/connections/${cid}/folder`, {})).status).toBe(400);
      expect((await alice.call('PUT', `${DRIVE}/connections/${cid}/folder`, { folderId: audio.id, name: 'x' })).status).toBe(400);
      expect((await bob.call('PUT', `${DRIVE}/connections/${cid}/folder`, { name: 'x' })).status).toBe(404);
      expect((await bob.call('GET', `${DRIVE}/connections/${cid}/folders`)).status).toBe(404);
      expect((await alice.call('GET', BASE)).body[0].config.folderId).toBeNull();
    });

    it('verlangt vor Dateiaktionen einen Ordner', async () => {
      const alice = await login();
      const cid = await connectDrive(alice);
      const res = await alice.call('GET', `${BASE}/${cid}/files`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Bitte zuerst einen Google-Drive-Ordner wählen');
      expect((await alice.call('GET', BASE)).body[0].status).toBe('connected');
    });

    it('markiert die Verbindung als gestört, wenn der Ordner gelöscht wurde', async () => {
      const alice = await login();
      const { cid, folderId } = await connectWithFolder(alice);
      fake.state.files.get(folderId)!.trashed = true;
      const res = await alice.call('POST', `${BASE}/${cid}/test`);
      expect(res.status).toBe(409);
      expect((await alice.call('GET', BASE)).body[0]).toMatchObject({ status: 'error', statusMessage: expect.stringContaining('existiert nicht mehr') });
    });
  });

  describe('Dateien', () => {
    it('listet nur Audiodateien des Ordners, seitenweise', async () => {
      const alice = await login();
      const { cid, folderId } = await connectWithFolder(alice);
      for (const name of ['a.mp3', 'b.ogg', 'c.wav', 'd.m4a']) fake.addFile({ name, parents: [folderId] });
      fake.addFile({ name: 'ohne-endung', mimeType: 'audio/ogg', parents: [folderId] });
      fake.addFile({ name: 'notizen.txt', mimeType: 'text/plain', parents: [folderId] });
      fake.addFile({ name: 'bild.png', mimeType: 'image/png', parents: [folderId] });
      fake.addFile({ name: 'woanders.mp3', parents: ['root'] });
      fake.addFile({ name: 'geloescht.mp3', parents: [folderId], trashed: true });

      const first = await alice.call('GET', `${BASE}/${cid}/files?limit=3`);
      expect(first.status).toBe(200);
      expect(first.body.files.map((f: { name: string }) => f.name)).toEqual(['a.mp3', 'b.ogg', 'c.wav']);
      expect(first.body.files[0]).toMatchObject({ mimeType: 'audio/mpeg', size: 'Inhalt von a.mp3'.length, updatedAt: '2030-01-01T00:00:00.000Z' });
      expect(first.body.nextCursor).toBe('3');
      const second = await alice.call('GET', `${BASE}/${cid}/files?limit=3&cursor=${first.body.nextCursor}`);
      expect(second.body).toEqual({ files: [expect.objectContaining({ name: 'd.m4a' }), expect.objectContaining({ name: 'ohne-endung' })], nextCursor: null });
      const list = fake.state.requests.find((r) => r.url.includes('/drive/v3/files?') && r.url.includes('audio'))!;
      expect(new URL(list.url).searchParams.get('q')).toBe(`'${folderId}' in parents and trashed = false and (mimeType contains 'audio/' or mimeType = 'application/ogg')`);
    });

    it('löst Unterordner per Namen auf', async () => {
      const alice = await login();
      const { cid, folderId } = await connectWithFolder(alice);
      const sub = fake.addFile({ name: "Kampf 'laut'", mimeType: 'application/vnd.google-apps.folder', parents: [folderId] });
      fake.addFile({ name: 'trommel.mp3', parents: [sub.id] });
      const res = await alice.call('GET', `${BASE}/${cid}/files?folder=${encodeURIComponent("Kampf 'laut'")}`);
      expect(res.body.files.map((f: { name: string }) => f.name)).toEqual(['trommel.mp3']);
      expect((await alice.call('GET', `${BASE}/${cid}/files?folder=fehlt`)).status).toBe(404);
    });

    it('listet Unterordner mit, Namen als Pfad relativ zum Ordner (Kategorien wie bei S3)', async () => {
      const alice = await login();
      const { cid, folderId } = await connectWithFolder(alice);
      const folder = (name: string, parent: string, extra: Partial<FakeDriveFile> = {}) =>
        fake.addFile({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent], ...extra });
      const packs = folder('packs', folderId);
      const rain = folder('regen', packs.id);
      const slash = folder('Tag/Nacht', folderId);
      const trashed = folder('alt', folderId, { trashed: true });
      fake.addFile({ name: 'a-oben.mp3', parents: [folderId] });
      fake.addFile({ name: 'b-pack.mp3', parents: [packs.id] });
      fake.addFile({ name: 'c-tropfen.ogg', parents: [rain.id] });
      fake.addFile({ name: 'd-eule.mp3', parents: [slash.id] });
      fake.addFile({ name: 'e-weg.mp3', parents: [trashed.id] });
      fake.addFile({ name: 'f-notiz.txt', mimeType: 'text/plain', parents: [rain.id] });

      const all = await alice.call('GET', `${BASE}/${cid}/files`);
      expect(all.status).toBe(200);
      expect(all.body.files.map((f: { name: string }) => f.name)).toEqual([
        'a-oben.mp3',
        'packs/b-pack.mp3',
        'packs/regen/c-tropfen.ogg',
        'Tag-Nacht/d-eule.mp3',
      ]);

      // seitenweise über mehrere Ordner hinweg
      const first = await alice.call('GET', `${BASE}/${cid}/files?limit=2`);
      expect(first.body.files.map((f: { name: string }) => f.name)).toEqual(['a-oben.mp3', 'packs/b-pack.mp3']);
      const second = await alice.call('GET', `${BASE}/${cid}/files?limit=2&cursor=${first.body.nextCursor}`);
      expect(second.body).toEqual({
        files: [expect.objectContaining({ name: 'packs/regen/c-tropfen.ogg' }), expect.objectContaining({ name: 'Tag-Nacht/d-eule.mp3' })],
        nextCursor: null,
      });

      // Unterordner als Ausgangspunkt: Pfade relativ dazu
      const sub = await alice.call('GET', `${BASE}/${cid}/files?folder=packs`);
      expect(sub.body.files.map((f: { name: string }) => f.name)).toEqual(['b-pack.mp3', 'regen/c-tropfen.ogg']);

      // Dateien aus Unterordnern lassen sich abspielen
      const deep = all.body.files.find((f: { name: string }) => f.name === 'packs/regen/c-tropfen.ogg');
      expect((await alice.call('GET', `${BASE}/${cid}/playback-url?fileId=${deep.id}`)).status).toBe(200);
    });

    it('begrenzt Tiefe und Anzahl der durchsuchten Unterordner', async () => {
      const alice = await login();
      const { cid, folderId } = await connectWithFolder(alice);
      const FOLDER_MIME = 'application/vnd.google-apps.folder';
      // Kette tiefer als LIST_MAX_DEPTH
      let parent = folderId;
      for (let depth = 1; depth <= LIST_MAX_DEPTH + 2; depth++) {
        parent = fake.addFile({ name: `e${depth}`, mimeType: FOLDER_MIME, parents: [parent] }).id;
        fake.addFile({ name: `tiefe${depth}.mp3`, parents: [parent] });
      }
      const deep = await alice.call('GET', `${BASE}/${cid}/files?limit=100`);
      expect(deep.body.files.map((f: { name: string }) => f.name.split('/').length - 1).sort()).toEqual(
        Array.from({ length: LIST_MAX_DEPTH }, (_, i) => i + 1),
      );

      // viele Geschwisterordner: höchstens LIST_MAX_FOLDERS Ordner in der Dateianfrage
      for (let i = 0; i < LIST_MAX_FOLDERS + 10; i++) {
        const sibling = fake.addFile({ name: `z${String(i).padStart(3, '0')}`, mimeType: FOLDER_MIME, parents: [folderId] });
        fake.addFile({ name: `geschwister${i}.mp3`, parents: [sibling.id] });
      }
      fake.state.requests.length = 0;
      const wide = await alice.call('GET', `${BASE}/${cid}/files?limit=100`);
      expect(wide.status).toBe(200);
      const fileQuery = fake.state.requests.map((r) => new URL(r.url).searchParams.get('q') ?? '').find((q) => q.includes('audio'))!;
      expect(fileQuery.match(/ in parents/g)).toHaveLength(LIST_MAX_FOLDERS);
      expect(wide.body.files.length).toBeLessThan(LIST_MAX_FOLDERS + 10 + LIST_MAX_DEPTH);
    });

    it('liefert eine kurzlebige Wiedergabe-URL ohne Token und streamt die Datei inklusive Range', async () => {
      const alice = await login();
      const { cid, folderId } = await connectWithFolder(alice);
      const file = fake.addFile({ name: 'lied.mp3', parents: [folderId], content: Buffer.from('0123456789') });
      const res = await alice.call('GET', `${BASE}/${cid}/playback-url?fileId=${file.id}`);
      expect(res.status).toBe(200);
      expect(res.body.url).toMatch(/^\/api\/storage\/google-drive\/stream\?t=/);
      expect(Date.parse(res.body.expiresAt) - fake.state.now).toBe(60 * 60 * 1000);

      // Das Ticket genügt (kein Session-Cookie nötig, damit <audio> es auch fremd laden könnte)
      const full = await app.inject({ url: res.body.url });
      expect(full.statusCode).toBe(200);
      expect(full.body).toBe('0123456789');
      expect(full.headers['content-type']).toBe('audio/mpeg');
      expect(full.headers['x-content-type-options']).toBe('nosniff');
      const part = await app.inject({ url: res.body.url, headers: { range: 'bytes=2-4' } });
      expect(part.statusCode).toBe(206);
      expect(part.body).toBe('234');
      expect(part.headers['content-range']).toBe('bytes 2-4/10');
      expect((await app.inject({ url: res.body.url, headers: { range: 'bytes=50-' } })).statusCode).toBe(416);
      assertNoTokens(res.body, full.body, part.headers);
    });

    it('lehnt manipulierte und abgelaufene Wiedergabe-Tickets ab', async () => {
      const alice = await login();
      const { cid, folderId } = await connectWithFolder(alice);
      const file = fake.addFile({ name: 'lied.mp3', parents: [folderId] });
      const other = fake.addFile({ name: 'fremd.mp3', parents: ['root'] });
      const { url } = (await alice.call('GET', `${BASE}/${cid}/playback-url?fileId=${file.id}`)).body;
      const token = decodeURIComponent(url.split('t=')[1]);
      const [payload, sig] = token.split('.');
      const forged = Buffer.from(Buffer.from(payload, 'base64url').toString().replace(file.id, other.id)).toString('base64url');
      for (const bad of [`${forged}.${sig}`, `${payload}.AAAA`, 'kaputt', `${payload}.${sig}.x`]) {
        expect((await app.inject({ url: `${DRIVE}/stream?t=${encodeURIComponent(bad)}` })).statusCode).toBe(403);
      }
      fake.state.now += 60 * 60 * 1000 + 1;
      expect((await app.inject({ url })).statusCode).toBe(403);
    });

    it('akzeptiert nur Datei-IDs aus dem verbundenen Ordner (auch in Unterordnern)', async () => {
      const alice = await login();
      const { cid, folderId } = await connectWithFolder(alice);
      const sub = fake.addFile({ name: 'Sub', mimeType: 'application/vnd.google-apps.folder', parents: [folderId] });
      const deep = fake.addFile({ name: 'tief.mp3', parents: [sub.id] });
      const outside = fake.addFile({ name: 'fremd.mp3', parents: ['root'] });
      const hidden = fake.addFile({ name: 'privat.mp3', parents: [folderId], appVisible: false });
      const text = fake.addFile({ name: 'notiz.txt', mimeType: 'text/plain', parents: [folderId] });
      expect((await alice.call('GET', `${BASE}/${cid}/playback-url?fileId=${deep.id}`)).status).toBe(200);
      for (const id of [outside.id, hidden.id, 'gibtsnicht']) {
        expect((await alice.call('GET', `${BASE}/${cid}/playback-url?fileId=${id}`)).status).toBe(404);
        expect((await alice.call('DELETE', `${BASE}/${cid}/files?fileId=${id}`)).status).toBe(404);
      }
      expect((await alice.call('GET', `${BASE}/${cid}/playback-url?fileId=${text.id}`)).status).toBe(400);
      expect((await alice.call('GET', `${BASE}/${cid}/playback-url?fileId=${encodeURIComponent('a/../b')}`)).status).toBe(400);
      expect(fake.state.files.get(outside.id)!.trashed).toBe(false);
    });

    it('startet eine Resumable-Upload-Session, die der Browser direkt nutzt', async () => {
      const alice = await login();
      const { cid, folderId } = await connectWithFolder(alice);
      const res = await alice.call('POST', `${BASE}/${cid}/uploads`, { fileName: 'neu.mp3', contentType: 'audio/mpeg', size: 1234 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'audio/mpeg' }, fields: {}, fileId: null });
      expect(res.body.url).toMatch(/^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?uploadType=resumable&upload_id=/);
      expect(Date.parse(res.body.expiresAt) - fake.state.now).toBe(7 * 24 * 60 * 60 * 1000);
      const session = fake.state.requests.find((r) => r.url.startsWith('https://www.googleapis.com/upload/'))!;
      expect(session.method).toBe('POST');
      expect(session.headers).toMatchObject({ 'x-upload-content-type': 'audio/mpeg', 'x-upload-content-length': '1234', origin: 'http://localhost:5173' });
      expect(JSON.parse(session.body)).toEqual({ name: 'neu.mp3', parents: [folderId], mimeType: 'audio/mpeg' });
      assertNoTokens(res.body);
    });

    it('verschiebt gelöschte Dateien in den Drive-Papierkorb', async () => {
      const alice = await login();
      const { cid, folderId } = await connectWithFolder(alice);
      const file = fake.addFile({ name: 'weg.mp3', parents: [folderId] });
      expect((await alice.call('DELETE', `${BASE}/${cid}/files?fileId=${file.id}`)).body).toEqual({ ok: true });
      expect(fake.state.files.get(file.id)!.trashed).toBe(true);
      expect((await alice.call('GET', `${BASE}/${cid}/files`)).body.files).toEqual([]);
    });
  });

  describe('Tokens', () => {
    it('erneuert abgelaufene Access-Tokens automatisch und speichert das neue', async () => {
      const alice = await login();
      const { cid } = await connectWithFolder(alice);
      const calls = fake.state.tokenEndpointCalls;
      await alice.call('GET', `${BASE}/${cid}/files`);
      expect(fake.state.tokenEndpointCalls).toBe(calls); // Token noch gültig

      fake.state.now += 2 * 60 * 60 * 1000;
      expect((await alice.call('GET', `${BASE}/${cid}/files`)).status).toBe(200);
      expect(fake.state.tokenEndpointCalls).toBe(calls + 1);
      expect((await alice.call('GET', `${BASE}/${cid}/files`)).status).toBe(200);
      expect(fake.state.tokenEndpointCalls).toBe(calls + 1); // neues Token wurde gespeichert und wiederverwendet
    });

    it('erneuert bei 401 einmal und wiederholt die Anfrage', async () => {
      const alice = await login();
      const { cid } = await connectWithFolder(alice);
      fake.state.accessTokens.clear(); // Google hat die Tokens vorzeitig verworfen
      expect((await alice.call('GET', `${BASE}/${cid}/files`)).status).toBe(200);
      expect((await alice.call('GET', BASE)).body[0].status).toBe('connected');
    });

    it('markiert die Verbindung bei widerrufenem Zugriff als disconnected', async () => {
      const alice = await login();
      const { cid, folderId } = await connectWithFolder(alice);
      const file = fake.addFile({ name: 'lied.mp3', parents: [folderId] });
      const { url } = (await alice.call('GET', `${BASE}/${cid}/playback-url?fileId=${file.id}`)).body;
      // Nutzer entzieht der App in seinem Google-Konto den Zugriff
      fake.state.refreshTokens.clear();
      fake.state.accessTokens.clear();

      const res = await alice.call('GET', `${BASE}/${cid}/files`);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Der Zugriff auf Google Drive wurde widerrufen oder ist abgelaufen – bitte neu verbinden');
      expect((await alice.call('GET', BASE)).body[0]).toMatchObject({ status: 'disconnected', statusMessage: res.body.error });
      expect((await app.inject({ url })).statusCode).toBe(409);
      assertNoTokens(res.body);
    });

    it('übersetzt sonstige Drive-Fehler in Status und Meldung', async () => {
      const alice = await login();
      const { cid } = await connectWithFolder(alice);
      fake.state.driveStatus = { status: 403, reason: 'userRateLimitExceeded' };
      expect((await alice.call('GET', `${BASE}/${cid}/files`)).status).toBe(502);
      fake.state.driveStatus = { status: 403, reason: 'insufficientPermissions' };
      expect((await alice.call('GET', `${BASE}/${cid}/files`)).status).toBe(409);
      expect((await alice.call('GET', BASE)).body[0].status).toBe('disconnected');
      fake.state.driveStatus = { status: 500, reason: 'backendError' };
      expect((await alice.call('GET', `${BASE}/${cid}/files`)).status).toBe(502);
      expect((await alice.call('GET', BASE)).body[0].status).toBe('error');
      fake.state.driveStatus = null;
      expect((await alice.call('GET', `${BASE}/${cid}/files`)).status).toBe(200);
      expect((await alice.call('GET', BASE)).body[0].status).toBe('connected');
    });
  });
});
