import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db.ts';
import { getUserSettings, updateUserSettings } from '../src/settings.ts';
import { loginAs, makeApp, testApp } from './helpers.ts';

const MIGRATIONS = join(import.meta.dirname, '../src/migrations');
const SETTINGS_MIGRATION = '005_user_settings.sql';

describe('Benutzereinstellungen (Modell)', () => {
  const userIn = (db: ReturnType<typeof openDb>, email: string) =>
    Number(db.prepare('INSERT INTO users (email) VALUES (?)').run(email).lastInsertRowid);

  it('liefert ohne gespeicherte Zeile die Vorgaben', () => {
    const db = openDb(':memory:');
    expect(getUserSettings(db, userIn(db, 'a@test.de'))).toEqual({ theme: 'system' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM user_settings').get()!.n).toBe(0);
  });

  it('speichert je Benutzer getrennt und ändert nur die genannten Felder', () => {
    const db = openDb(':memory:');
    const a = userIn(db, 'a@test.de');
    const b = userIn(db, 'b@test.de');
    expect(updateUserSettings(db, a, { theme: 'dark' })).toEqual({ theme: 'dark' });
    expect(updateUserSettings(db, a, {})).toEqual({ theme: 'dark' });
    expect(getUserSettings(db, a)).toEqual({ theme: 'dark' });
    expect(getUserSettings(db, b)).toEqual({ theme: 'system' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM user_settings').get()!.n).toBe(1);
  });

  it('verträgt kaputte oder veraltete gespeicherte Daten', () => {
    const db = openDb(':memory:');
    const a = userIn(db, 'a@test.de');
    db.prepare(`INSERT INTO user_settings (user_id, data) VALUES (?, '{"theme":"pink","alt":1}')`).run(a);
    expect(getUserSettings(db, a)).toEqual({ theme: 'system' });
    expect(updateUserSettings(db, a, { theme: 'light' })).toEqual({ theme: 'light' });
    expect(JSON.parse(db.prepare('SELECT data FROM user_settings').get()!.data as string)).toEqual({ theme: 'light' });
  });

  it('lässt nur JSON-Objekte zu und löscht die Einstellungen mit dem Benutzer', () => {
    const db = openDb(':memory:');
    const a = userIn(db, 'a@test.de');
    expect(() => db.prepare(`INSERT INTO user_settings (user_id, data) VALUES (?, 'kaputt')`).run(a)).toThrow();
    expect(() => db.prepare(`INSERT INTO user_settings (user_id, data) VALUES (?, '[1]')`).run(a)).toThrow();
    expect(() => db.prepare(`INSERT INTO user_settings (user_id, data) VALUES (999, '{}')`).run()).toThrow();
    updateUserSettings(db, a, { theme: 'dark' });
    db.prepare('DELETE FROM users WHERE id = ?').run(a);
    expect(db.prepare('SELECT COUNT(*) AS n FROM user_settings').get()!.n).toBe(0);
  });
});

describe('Migration 005_user_settings', () => {
  let dir: string | undefined;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it('läuft auf einer bestehenden DB mit Benutzern hoch, die dann die Vorgaben bekommen', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pnp-'));
    const file = join(dir, 'app.db');
    const old = new DatabaseSync(file);
    old.exec('PRAGMA foreign_keys = ON');
    old.exec('CREATE TABLE schema_migrations (version TEXT PRIMARY KEY)');
    for (const name of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && f < SETTINGS_MIGRATION).sort()) {
      old.exec(readFileSync(join(MIGRATIONS, name), 'utf8'));
      old.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(name);
    }
    old.exec(`INSERT INTO users (email) VALUES ('alt@test.de')`);
    old.close();

    const db = openDb(file);
    expect(db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(SETTINGS_MIGRATION)).toBeDefined();
    const client = await loginAs(testApp(db), 'alt@test.de');
    expect((await client.get('/api/me/settings')).body).toEqual({ theme: 'system' });
    db.close();
  });

  it('lässt sich zurückbauen, ohne andere Tabellen zu berühren', () => {
    const db = openDb(':memory:');
    db.exec(`INSERT INTO users (email) VALUES ('a@test.de')`);
    db.exec(`INSERT INTO user_settings (user_id, data) VALUES (1, '{"theme":"dark"}')`);
    // Rückbau laut Kommentar in der Migration
    db.exec(`DROP TABLE user_settings; DELETE FROM schema_migrations WHERE version = '${SETTINGS_MIGRATION}';`);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'user_settings'`).get()).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()!.n).toBe(1);
  });
});

describe('API /api/me/settings', () => {
  it('verlangt einen Login', async () => {
    const app = makeApp();
    expect((await app.inject({ url: '/api/me/settings' })).statusCode).toBe(401);
    const res = await app.inject({ method: 'PATCH', url: '/api/me/settings', payload: { theme: 'dark' } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Nicht eingeloggt' });
  });

  it('liefert neuen Benutzern die Vorgaben', async () => {
    const client = await loginAs(makeApp(), 'neu@test.de');
    expect(await client.get('/api/me/settings')).toEqual({ status: 200, body: { theme: 'system' } });
  });

  it('speichert Änderungen dauerhaft', async () => {
    const client = await loginAs(makeApp(), 'a@test.de');
    expect(await client.patch('/api/me/settings', { theme: 'dark' })).toEqual({ status: 200, body: { theme: 'dark' } });
    expect((await client.get('/api/me/settings')).body).toEqual({ theme: 'dark' });
    // leerer Patch ändert nichts
    expect((await client.patch('/api/me/settings', {})).body).toEqual({ theme: 'dark' });
  });

  it('weist ungültige Werte mit 400 ab und behält den alten Stand', async () => {
    const client = await loginAs(makeApp(), 'a@test.de');
    await client.patch('/api/me/settings', { theme: 'light' });
    for (const body of [{ theme: 'pink' }, { theme: null }, { theme: 1 }, []]) {
      const res = await client.patch('/api/me/settings', body);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/^Ungültige Eingabe/);
    }
    expect((await client.get('/api/me/settings')).body).toEqual({ theme: 'light' });
  });

  it('ignoriert unbekannte Felder', async () => {
    const client = await loginAs(makeApp(), 'a@test.de');
    const res = await client.patch('/api/me/settings', { theme: 'dark', userId: 99, fontSize: 3 });
    expect(res).toEqual({ status: 200, body: { theme: 'dark' } });
  });

  it('trennt die Einstellungen verschiedener Benutzer', async () => {
    const app = makeApp();
    const alice = await loginAs(app, 'alice@test.de');
    const bob = await loginAs(app, 'bob@test.de');
    await alice.patch('/api/me/settings', { theme: 'dark' });
    expect((await bob.get('/api/me/settings')).body).toEqual({ theme: 'system' });
    await bob.patch('/api/me/settings', { theme: 'light', userId: alice.userId });
    expect((await alice.get('/api/me/settings')).body).toEqual({ theme: 'dark' });
    expect((await bob.get('/api/me/settings')).body).toEqual({ theme: 'light' });
    // es gibt keine Route, um fremde Einstellungen per ID anzusprechen
    expect((await bob.get(`/api/users/${alice.userId}/settings`)).status).toBe(404);
  });

  it('gilt für alle Sessions desselben Benutzers', async () => {
    const app = makeApp();
    const laptop = await loginAs(app, 'a@test.de');
    const handy = await loginAs(app, 'A@Test.de');
    await laptop.patch('/api/me/settings', { theme: 'dark' });
    expect((await handy.get('/api/me/settings')).body).toEqual({ theme: 'dark' });
  });
});
