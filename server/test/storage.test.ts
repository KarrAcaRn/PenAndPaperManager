import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_STORAGE_UPLOAD_BYTES } from '@pnp/shared';
import { openDb, type Db } from '../src/db.ts';
import { buildApp } from '../src/app.ts';
import { createSecretBox, loadSecretKey, secretKeyFile } from '../src/secrets.ts';
import { StorageProviderError } from '../src/storage/provider.ts';
import { defaultStorageProviders } from '../src/storage/registry.ts';
import { fakeStorage, type FakeState } from './fakeStorage.ts';
import { loginAs, makeApp, type Client } from './helpers.ts';

const SECRET = 'GEHEIMES-TOKEN-123';
const BASE = '/api/storage/connections';
const input = (extra: Record<string, unknown> = {}) => ({
  providerType: 's3',
  displayName: 'Meine Sounds',
  config: { bucket: 'klang' },
  credentials: { token: SECRET },
  ...extra,
});

const file = (id: string, mimeType: string | null = null) => ({ id, name: id, size: 1, mimeType, updatedAt: null });

describe('Verschlüsselung (secrets.ts)', () => {
  const box = createSecretBox(randomBytes(32));

  it('entschlüsselt, was sie verschlüsselt hat, und verrät den Klartext nicht', () => {
    const sealed = box.encrypt(SECRET, 'a');
    expect(sealed).not.toContain(SECRET);
    expect(box.encrypt(SECRET, 'a')).not.toBe(sealed);
    expect(box.decrypt(sealed, 'a')).toBe(SECRET);
  });

  it('lehnt veränderten Geheimtext, falschen Zweck und falschen Schlüssel ab', () => {
    const sealed = box.encrypt(SECRET, 'a');
    const [v, iv, tag, data] = sealed.split(':');
    const flipped = Buffer.from(data!, 'base64');
    flipped[0]! ^= 1;
    expect(() => box.decrypt([v, iv, tag, flipped.toString('base64')].join(':'), 'a')).toThrow();
    expect(() => box.decrypt(sealed, 'b')).toThrow();
    expect(() => createSecretBox(randomBytes(32)).decrypt(sealed, 'a')).toThrow();
    expect(() => box.decrypt('kaputt', 'a')).toThrow();
    expect(() => createSecretBox(randomBytes(16))).toThrow();
  });

  describe('Schlüssel laden', () => {
    let dir: string;
    beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'pnp-key-'))));
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('legt ohne APP_SECRET_KEY eine nur für den Besitzer lesbare Schlüsseldatei an und nutzt sie wieder', () => {
      const db = join(dir, 'sub/app.db');
      const key = loadSecretKey(db, '');
      expect(key).toHaveLength(32);
      expect(statSync(secretKeyFile(db)).mode & 0o777).toBe(0o600);
      expect(loadSecretKey(db, '')).toEqual(key);
    });

    it('nimmt APP_SECRET_KEY vorrangig und prüft die Länge', () => {
      const key = randomBytes(32);
      expect(loadSecretKey(join(dir, 'app.db'), key.toString('base64'))).toEqual(key);
      expect(() => loadSecretKey(join(dir, 'app.db'), 'zu-kurz')).toThrow('APP_SECRET_KEY');
    });
  });
});

describe('Speicher-Verbindungen', () => {
  let state: FakeState;
  let db: Db;
  let alice: Client;
  let bob: Client;

  beforeEach(async () => {
    const fake = fakeStorage();
    state = fake.state;
    db = openDb(':memory:');
    const app = buildApp(db, { secretKey: randomBytes(32), storageProviders: fake.registry });
    alice = await loginAs(app, 'alice@test.de');
    bob = await loginAs(app, 'bob@test.de');
  });

  const create = async (client = alice, extra: Record<string, unknown> = {}) => {
    const res = await client.post(BASE, input(extra));
    expect(res.status).toBe(201);
    return res.body as { id: number };
  };

  it('verlangt einen Login', async () => {
    const app = makeApp();
    expect((await app.inject({ url: BASE })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/storage/providers' })).statusCode).toBe(401);
  });

  it('listet die verfügbaren Anbieter', async () => {
    expect((await alice.get('/api/storage/providers')).body).toEqual([{ type: 's3', label: 'S3 (oder kompatibel)', manualSetup: true }]);
    // Noch sind keine echten Adapter eingetragen
    expect(defaultStorageProviders().list()).toEqual([]);
  });

  it('legt eine Verbindung nach erfolgreicher Prüfung an und liefert nie die Zugangsdaten', async () => {
    const res = await alice.post(BASE, input({ displayName: '  Meine Sounds ' }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ providerType: 's3', displayName: 'Meine Sounds', config: { bucket: 'klang' }, status: 'connected', statusMessage: '' });
    expect(res.body).not.toHaveProperty('credentials');
    expect(state.calls.map(([name]) => name)).toEqual(['validate']);

    const list = await alice.get(BASE);
    expect(list.body).toEqual([res.body]);
    for (const body of [res.body, list.body]) expect(JSON.stringify(body)).not.toContain(SECRET);

    // In der Datenbank nur verschlüsselt
    const row = db.prepare('SELECT credentials FROM user_storage_connections').get() as { credentials: string };
    expect(row.credentials).not.toContain(SECRET);
    expect(row.credentials).toMatch(/^v1:/);
  });

  it('erlaubt mehrere Verbindungen je Nutzer', async () => {
    await create();
    await create(alice, { displayName: 'Zweiter Bucket', config: { bucket: 'b2' } });
    expect((await alice.get(BASE)).body.map((c: { displayName: string }) => c.displayName)).toEqual(['Meine Sounds', 'Zweiter Bucket']);
  });

  it('speichert nichts, wenn Eingabe oder Prüfung scheitern', async () => {
    expect((await alice.post(BASE, input({ config: {} }))).body).toEqual({ error: 'Bucket fehlt' });
    expect((await alice.post(BASE, input({ providerType: 'ftp' }))).status).toBe(400);
    expect((await alice.post(BASE, input({ displayName: '  ' }))).status).toBe(400);
    expect((await alice.post(BASE, { ...input(), credentials: undefined })).status).toBe(400);

    state.revoked.add(SECRET);
    const res = await alice.post(BASE, input());
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Verbindung fehlgeschlagen: Zugriff wurde widerrufen');

    state.revoked.clear();
    state.failNext = new StorageProviderError('unavailable', 'Anbieter nicht erreichbar');
    expect((await alice.post(BASE, input())).status).toBe(502);
    expect((await alice.get(BASE)).body).toEqual([]);
  });

  it('meldet nicht eingetragene Anbieter verständlich', async () => {
    const res = await alice.post(BASE, input({ providerType: 'google_drive' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Google Drive');
  });

  it('versteckt fremde Verbindungen', async () => {
    const { id } = await create();
    expect((await bob.get(BASE)).body).toEqual([]);
    expect((await bob.del(`${BASE}/${id}`)).status).toBe(404);
    expect((await bob.post(`${BASE}/${id}/test`)).status).toBe(404);
    expect((await bob.get(`${BASE}/${id}/files`)).status).toBe(404);
    expect((await bob.get(`${BASE}/${id}/playback-url?fileId=a.mp3`)).status).toBe(404);
    expect((await bob.post(`${BASE}/${id}/uploads`, { fileName: 'a.mp3', contentType: 'audio/mpeg', size: 1 })).status).toBe(404);
    expect((await bob.del(`${BASE}/${id}/files?fileId=a.mp3`)).status).toBe(404);
    // nur der Prüfaufruf beim Anlegen erreichte den Anbieter
    expect(state.calls).toHaveLength(1);
  });

  it('löscht nur die Verknüpfung', async () => {
    const { id } = await create();
    state.files = [file('a.mp3')];
    expect((await alice.del(`${BASE}/${id}`)).body).toEqual({ ok: true });
    expect((await alice.get(BASE)).body).toEqual([]);
    expect((await alice.del(`${BASE}/${id}`)).status).toBe(404);
    expect(state.files).toHaveLength(1);
    expect(state.calls.map(([name]) => name)).toEqual(['validate']);
  });

  it('listet nur Audiodateien und reicht Ordner, Cursor und Limit durch', async () => {
    const { id } = await create();
    state.files = [file('a.mp3'), file('notiz.txt', 'text/plain'), file('drive-datei', 'audio/ogg'), file('b.WAV')];
    const first = await alice.get(`${BASE}/${id}/files?folder=/Kampf/Bosse/&limit=10`);
    expect(first.body).toEqual({ files: [file('a.mp3'), file('drive-datei', 'audio/ogg'), file('b.WAV')], nextCursor: 'seite2' });
    expect(state.calls.at(-1)).toEqual(['listFiles', { folder: 'Kampf/Bosse', limit: 10 }]);

    const second = await alice.get(`${BASE}/${id}/files?cursor=seite2`);
    expect(second.body.nextCursor).toBeNull();
    expect(state.calls.at(-1)).toEqual(['listFiles', { folder: '', limit: 100, cursor: 'seite2' }]);
  });

  it('lehnt Ordner ab, die aus dem verbundenen Ordner herausführen', async () => {
    const { id } = await create();
    for (const folder of ['..', 'a/../b', 'a//b', 'a\\b', './a']) {
      expect((await alice.get(`${BASE}/${id}/files?folder=${encodeURIComponent(folder)}`)).status).toBe(400);
    }
    expect((await alice.get(`${BASE}/${id}/files?limit=0`)).status).toBe(400);
  });

  it('liefert Playback-URLs des Anbieters', async () => {
    const { id } = await create();
    state.files = [file('ordner/a.mp3')];
    const res = await alice.get(`${BASE}/${id}/playback-url?fileId=${encodeURIComponent('ordner/a.mp3')}`);
    expect(res.body).toEqual({ url: 'https://fake.example/klang/ordner%2Fa.mp3?sig=x', expiresAt: '2030-01-01T00:00:00.000Z' });
    expect((await alice.get(`${BASE}/${id}/playback-url?fileId=fehlt.mp3`)).status).toBe(404);
    expect((await alice.get(`${BASE}/${id}/playback-url`)).status).toBe(400);
  });

  it('vergibt Upload-URLs nur für Audiodateien bis zum Größenlimit', async () => {
    const { id } = await create();
    const upload = (body: object) => alice.post(`${BASE}/${id}/uploads`, { fileName: 'kampf.mp3', contentType: 'audio/mpeg', size: 1000, ...body });

    const ok = await upload({ contentType: 'Audio/MPEG' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ method: 'PUT', url: 'https://fake.example/klang/kampf.mp3?sig=up', fileId: 'kampf.mp3' });
    expect(state.calls.at(-1)).toEqual(['upload', { fileName: 'kampf.mp3', contentType: 'audio/mpeg', size: 1000 }]);

    expect((await upload({ fileName: 'virus.exe' })).status).toBe(400);
    expect((await upload({ contentType: 'audio/ogg' })).status).toBe(400);
    expect((await upload({ fileName: '../kampf.mp3' })).status).toBe(400);
    expect((await upload({ fileName: 'a\\kampf.mp3' })).status).toBe(400);
    expect((await upload({ size: MAX_STORAGE_UPLOAD_BYTES + 1 })).status).toBe(400);
    expect((await upload({ size: 0 })).status).toBe(400);
    expect(state.calls.filter(([name]) => name === 'upload')).toHaveLength(1);
  });

  it('löscht Dateien über den Anbieter', async () => {
    const { id } = await create();
    state.files = [file('a.mp3'), file('b.mp3')];
    expect((await alice.del(`${BASE}/${id}/files?fileId=a.mp3`)).body).toEqual({ ok: true });
    expect(state.files.map((f) => f.id)).toEqual(['b.mp3']);
    expect((await alice.del(`${BASE}/${id}/files?fileId=a.mp3`)).status).toBe(404);
  });

  it('markiert widerrufenen Zugriff als getrennt und nach erfolgreichem Test wieder als verbunden', async () => {
    const { id } = await create();
    state.revoked.add(SECRET);
    const res = await alice.get(`${BASE}/${id}/files`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Zugriff wurde widerrufen');
    expect((await alice.get(BASE)).body[0]).toMatchObject({ status: 'disconnected', statusMessage: 'Zugriff wurde widerrufen' });

    expect((await alice.post(`${BASE}/${id}/test`)).status).toBe(409);
    state.revoked.clear();
    const tested = await alice.post(`${BASE}/${id}/test`);
    expect(tested.body).toMatchObject({ id, status: 'connected', statusMessage: '' });
  });

  it('merkt sich Fehler wie fehlende Rechte oder Ausfälle als Status "error"', async () => {
    const { id } = await create();
    state.failNext = new StorageProviderError('permission', 'Keine Schreibrechte im Bucket');
    expect((await alice.post(`${BASE}/${id}/test`)).status).toBe(409);
    expect((await alice.get(BASE)).body[0]).toMatchObject({ status: 'error', statusMessage: 'Keine Schreibrechte im Bucket' });

    state.failNext = new StorageProviderError('unavailable', 'Zeitüberschreitung');
    expect((await alice.get(`${BASE}/${id}/files`)).status).toBe(502);
    expect((await alice.get(BASE)).body[0]).toMatchObject({ status: 'error', statusMessage: 'Zeitüberschreitung' });

    // "Datei fehlt" sagt nichts über die Verbindung, erst ein Erfolg setzt den Status zurück
    expect((await alice.get(`${BASE}/${id}/playback-url?fileId=fehlt.mp3`)).status).toBe(404);
    expect((await alice.get(BASE)).body[0].status).toBe('error');
    expect((await alice.get(`${BASE}/${id}/files`)).status).toBe(200);
    expect((await alice.get(BASE)).body[0]).toMatchObject({ status: 'connected', statusMessage: '' });
  });

  it('speichert erneuerte Zugangsdaten verschlüsselt', async () => {
    const { id } = await create();
    const before = (db.prepare('SELECT credentials FROM user_storage_connections').get() as { credentials: string }).credentials;
    state.refreshTokens = true;
    await alice.get(`${BASE}/${id}/files`);
    await alice.get(`${BASE}/${id}/files`);
    expect(state.lastCredentials).toEqual({ token: SECRET, refreshed: 1 });
    const after = (db.prepare('SELECT credentials FROM user_storage_connections').get() as { credentials: string }).credentials;
    expect(after).not.toBe(before);
    expect(after).not.toContain(SECRET);
  });

  it('speichert beim Anlegen die während der Prüfung erneuerten Zugangsdaten', async () => {
    state.refreshTokens = true;
    const { id } = await create();
    await alice.get(`${BASE}/${id}/files`);
    expect(state.lastCredentials).toEqual({ token: SECRET, refreshed: 1 });
  });

  it('meldet unlesbare Zugangsdaten nach Schlüsselwechsel als getrennt', async () => {
    const { id } = await create();
    const fake = fakeStorage();
    const other = await loginAs(buildApp(db, { secretKey: randomBytes(32), storageProviders: fake.registry }), 'alice@test.de');
    const res = await other.get(`${BASE}/${id}/files`);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('neu verbinden');
    expect((await other.get(BASE)).body[0].status).toBe('disconnected');
    expect(fake.state.calls).toEqual([]);
  });

  it('lässt Geheimtext nicht in die Verbindung eines anderen Nutzers kopieren', async () => {
    await create();
    const { id: bobsId } = await create(bob, { credentials: { token: 'bobs-token' } });
    db.prepare(`UPDATE user_storage_connections SET credentials = (SELECT credentials FROM user_storage_connections WHERE id <> ?) WHERE id = ?`).run(bobsId, bobsId);
    expect((await bob.get(`${BASE}/${bobsId}/files`)).status).toBe(409);
    expect(state.lastCredentials).toEqual({ token: 'bobs-token' });
  });

  it('entfernt die Verbindungen mit dem Nutzer', async () => {
    await create();
    db.prepare(`DELETE FROM users WHERE email = 'alice@test.de'`).run();
    expect((db.prepare('SELECT COUNT(*) AS n FROM user_storage_connections').get() as { n: number }).n).toBe(0);
  });
});
