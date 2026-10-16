import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppOptions } from '../src/app.ts';
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
    expect(getUserSettings(db, userIn(db, 'a@test.de'))).toEqual({ colorScheme: 'system', theme: null });
    expect(db.prepare('SELECT COUNT(*) AS n FROM user_settings').get()!.n).toBe(0);
  });

  it('speichert je Benutzer getrennt und ändert nur die genannten Felder', () => {
    const db = openDb(':memory:');
    const a = userIn(db, 'a@test.de');
    const b = userIn(db, 'b@test.de');
    expect(updateUserSettings(db, a, { colorScheme: 'dark' })).toEqual({ colorScheme: 'dark', theme: null });
    expect(updateUserSettings(db, a, {})).toEqual({ colorScheme: 'dark', theme: null });
    expect(getUserSettings(db, a)).toEqual({ colorScheme: 'dark', theme: null });
    expect(getUserSettings(db, b)).toEqual({ colorScheme: 'system', theme: null });
    expect(db.prepare('SELECT COUNT(*) AS n FROM user_settings').get()!.n).toBe(1);
  });

  it('verträgt kaputte oder veraltete gespeicherte Daten', () => {
    const db = openDb(':memory:');
    const a = userIn(db, 'a@test.de');
    db.prepare(`INSERT INTO user_settings (user_id, data) VALUES (?, '{"colorScheme":"pink","theme":"Kein Theme!","alt":1}')`).run(a);
    expect(getUserSettings(db, a)).toEqual({ colorScheme: 'system', theme: null });
    expect(updateUserSettings(db, a, { colorScheme: 'light' })).toEqual({ colorScheme: 'light', theme: null });
    expect(JSON.parse(db.prepare('SELECT data FROM user_settings').get()!.data as string)).toEqual({ colorScheme: 'light', theme: null });
  });

  it('lässt nur JSON-Objekte zu und löscht die Einstellungen mit dem Benutzer', () => {
    const db = openDb(':memory:');
    const a = userIn(db, 'a@test.de');
    expect(() => db.prepare(`INSERT INTO user_settings (user_id, data) VALUES (?, 'kaputt')`).run(a)).toThrow();
    expect(() => db.prepare(`INSERT INTO user_settings (user_id, data) VALUES (?, '[1]')`).run(a)).toThrow();
    expect(() => db.prepare(`INSERT INTO user_settings (user_id, data) VALUES (999, '{}')`).run()).toThrow();
    updateUserSettings(db, a, { colorScheme: 'dark' });
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
    expect((await client.get('/api/me/settings')).body).toEqual({ colorScheme: 'system', theme: null });
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
    const res = await app.inject({ method: 'PATCH', url: '/api/me/settings', payload: { colorScheme: 'dark' } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Nicht eingeloggt' });
  });

  it('liefert neuen Benutzern die Vorgaben', async () => {
    const client = await loginAs(makeApp(), 'neu@test.de');
    expect(await client.get('/api/me/settings')).toEqual({ status: 200, body: { colorScheme: 'system', theme: null } });
  });

  it('speichert Änderungen dauerhaft', async () => {
    const client = await loginAs(makeApp(), 'a@test.de');
    expect(await client.patch('/api/me/settings', { colorScheme: 'dark' })).toEqual({ status: 200, body: { colorScheme: 'dark', theme: null } });
    expect((await client.get('/api/me/settings')).body).toEqual({ colorScheme: 'dark', theme: null });
    // leerer Patch ändert nichts
    expect((await client.patch('/api/me/settings', {})).body).toEqual({ colorScheme: 'dark', theme: null });
  });

  it('weist ungültige Werte mit 400 ab und behält den alten Stand', async () => {
    const client = await loginAs(makeApp(), 'a@test.de');
    await client.patch('/api/me/settings', { colorScheme: 'light' });
    for (const body of [{ colorScheme: 'pink' }, { colorScheme: null }, { colorScheme: 1 }, { theme: 'Nicht Gültig' }, { theme: {} }, []]) {
      const res = await client.patch('/api/me/settings', body);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/^Ungültige Eingabe/);
    }
    expect((await client.get('/api/me/settings')).body).toEqual({ colorScheme: 'light', theme: null });
  });

  it('ignoriert unbekannte Felder', async () => {
    const client = await loginAs(makeApp(), 'a@test.de');
    const res = await client.patch('/api/me/settings', { colorScheme: 'dark', userId: 99, fontSize: 3 });
    expect(res).toEqual({ status: 200, body: { colorScheme: 'dark', theme: null } });
  });

  it('trennt die Einstellungen verschiedener Benutzer', async () => {
    const app = makeApp();
    const alice = await loginAs(app, 'alice@test.de');
    const bob = await loginAs(app, 'bob@test.de');
    await alice.patch('/api/me/settings', { colorScheme: 'dark' });
    expect((await bob.get('/api/me/settings')).body).toEqual({ colorScheme: 'system', theme: null });
    await bob.patch('/api/me/settings', { colorScheme: 'light', userId: alice.userId });
    expect((await alice.get('/api/me/settings')).body).toEqual({ colorScheme: 'dark', theme: null });
    expect((await bob.get('/api/me/settings')).body).toEqual({ colorScheme: 'light', theme: null });
    // es gibt keine Route, um fremde Einstellungen per ID anzusprechen
    expect((await bob.get(`/api/users/${alice.userId}/settings`)).status).toBe(404);
  });

  it('gilt für alle Sessions desselben Benutzers', async () => {
    const app = makeApp();
    const laptop = await loginAs(app, 'a@test.de');
    const handy = await loginAs(app, 'A@Test.de');
    await laptop.patch('/api/me/settings', { colorScheme: 'dark' });
    expect((await handy.get('/api/me/settings')).body).toEqual({ colorScheme: 'dark', theme: null });
  });
});

describe('Migration 006_settings_color_scheme', () => {
  it('benennt das bisherige Farbschema „theme“ in „colorScheme“ um', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pnp-'));
    try {
      const file = join(dir, 'app.db');
      const old = new DatabaseSync(file);
      old.exec('PRAGMA foreign_keys = ON');
      old.exec('CREATE TABLE schema_migrations (version TEXT PRIMARY KEY)');
      for (const name of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && f < '006').sort()) {
        old.exec(readFileSync(join(MIGRATIONS, name), 'utf8'));
        old.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(name);
      }
      old.exec(`INSERT INTO users (email) VALUES ('a@test.de'), ('b@test.de'), ('c@test.de')`);
      old.exec(`INSERT INTO user_settings (user_id, data) VALUES (1, '{"theme":"dark"}'), (2, '{}'), (3, '{"theme":"light","x":1}')`);
      old.close();

      const db = openDb(file);
      const data = (id: number) => JSON.parse(db.prepare('SELECT data FROM user_settings WHERE user_id = ?').get(id)!.data as string);
      expect(data(1)).toEqual({ colorScheme: 'dark' });
      expect(data(2)).toEqual({});
      expect(data(3)).toEqual({ x: 1, colorScheme: 'light' });
      expect(getUserSettings(db, 1)).toEqual({ colorScheme: 'dark', theme: null });
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Theme-Wahl in den Einstellungen', () => {
  let dir: string;
  let extra: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pnp-themes-'));
    extra = join(dir, 'extra');
    for (const id of ['wald', 'nacht']) {
      mkdirSync(join(extra, id), { recursive: true });
      writeFileSync(
        join(extra, id, 'theme.json'),
        JSON.stringify({ manifestVersion: 1, id, name: id, author: 'Testerin', version: '1.0.0', tokens: {} }),
      );
    }
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const app = (opts: AppOptions = {}) => testApp(openDb(':memory:'), { themesDir: extra, ...opts });

  it('speichert das gewählte Theme dauerhaft und für alle Sessions (Geräte)', async () => {
    const a = app();
    const laptop = await loginAs(a, 'a@test.de');
    expect(await laptop.patch('/api/me/settings', { theme: 'wald' })).toEqual({
      status: 200,
      body: { colorScheme: 'system', theme: 'wald' },
    });
    const handy = await loginAs(a, 'a@test.de');
    expect((await handy.get('/api/me/settings')).body).toEqual({ colorScheme: 'system', theme: 'wald' });
    // Farbschema ändern lässt das Theme stehen, null setzt auf die Vorgabe der Seite zurück
    expect((await handy.patch('/api/me/settings', { colorScheme: 'dark' })).body).toEqual({ colorScheme: 'dark', theme: 'wald' });
    expect((await handy.patch('/api/me/settings', { theme: null })).body).toEqual({ colorScheme: 'dark', theme: null });
    expect((await laptop.get('/api/me/settings')).body).toEqual({ colorScheme: 'dark', theme: null });
  });

  it('lehnt unbekannte Themes ab', async () => {
    const client = await loginAs(app(), 'a@test.de');
    const res = await client.patch('/api/me/settings', { theme: 'gibtsnicht' });
    expect(res).toEqual({ status: 400, body: { error: 'Das Theme „gibtsnicht“ gibt es nicht.' } });
    expect((await client.get('/api/me/settings')).body.theme).toBeNull();
  });

  it('meldet ein gelöschtes Theme als Vorgabe (null), ohne Fehler, und nimmt es zurück, wenn es wiederkommt', async () => {
    const client = await loginAs(app(), 'a@test.de');
    await client.patch('/api/me/settings', { theme: 'nacht' });
    rmSync(join(extra, 'nacht'), { recursive: true });
    expect(await client.get('/api/me/settings')).toEqual({ status: 200, body: { colorScheme: 'system', theme: null } });
    // andere Änderungen funktionieren weiter
    expect((await client.patch('/api/me/settings', { colorScheme: 'light' })).status).toBe(200);
    mkdirSync(join(extra, 'nacht'));
    writeFileSync(
      join(extra, 'nacht', 'theme.json'),
      JSON.stringify({ manifestVersion: 1, id: 'nacht', name: 'Nacht', author: 'T', version: '1.0.1', tokens: {} }),
    );
    expect((await client.get('/api/me/settings')).body).toEqual({ colorScheme: 'light', theme: 'nacht' });
  });

  it('liefert Themes und Vorgabe-Theme auch ohne Login', async () => {
    const a = app();
    const res = await a.inject({ url: '/api/themes' });
    expect(res.statusCode).toBe(200);
    expect(res.json().defaultTheme).toBe('default');
    expect(res.json().themes.map((t: { id: string }) => t.id).sort()).toEqual(['default', 'nacht', 'wald']);
    expect((await a.inject({ url: '/api/themes/wald' })).statusCode).toBe(200);
    expect((await a.inject({ url: '/themes/wald/theme.css' })).statusCode).toBe(200);
    // der öffentliche Bereich reicht nicht tiefer
    expect((await a.inject({ url: '/api/themes/wald/x' })).statusCode).toBe(401);
    expect((await a.inject({ url: '/api/themes/../me/settings' })).statusCode).toBe(401);
  });

  it('nimmt das vom Seitenbetreiber konfigurierte Vorgabe-Theme, solange es existiert', async () => {
    const a = app({ defaultTheme: 'wald' });
    expect((await a.inject({ url: '/api/themes' })).json().defaultTheme).toBe('wald');
    rmSync(join(extra, 'wald'), { recursive: true });
    expect((await a.inject({ url: '/api/themes' })).json().defaultTheme).toBe('default');
    expect((await app({ defaultTheme: 'gibtsnicht' }).inject({ url: '/api/themes' })).json().defaultTheme).toBe('default');
  });
});
