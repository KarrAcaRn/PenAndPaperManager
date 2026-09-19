import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, transaction } from '../src/db.ts';
import { buildApp } from '../src/app.ts';
import { SESSION_COOKIE } from '../src/auth.ts';
import { loginAs, makeApp } from './helpers.ts';

describe('Datenbank', () => {
  let dir: string | undefined;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it('legt die Datei samt Verzeichnis an und migriert nur einmal', () => {
    dir = mkdtempSync(join(tmpdir(), 'pnp-'));
    const file = join(dir, 'sub/app.db');
    const first = openDb(file);
    first.prepare(`INSERT INTO users (email) VALUES ('a@test.de')`).run();
    first.close();

    const second = openDb(file);
    expect(second.prepare('SELECT COUNT(*) AS n FROM users').get()!.n).toBe(1);
    expect(second.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()!.n).toBe(1);
    second.close();
  });

  it('rollt Transaktionen bei Fehlern zurück', () => {
    const db = openDb(':memory:');
    expect(() =>
      transaction(db, () => {
        db.prepare(`INSERT INTO users (email) VALUES ('a@test.de')`).run();
        throw new Error('kaputt');
      }),
    ).toThrow('kaputt');
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()!.n).toBe(0);
    expect(transaction(db, () => 42)).toBe(42);
  });

  it('erzwingt Fremdschlüssel', () => {
    const db = openDb(':memory:');
    expect(() => db.prepare(`INSERT INTO memberships (group_id, user_id, role) VALUES (9, 9, 'gm')`).run()).toThrow();
  });
});

describe('Sessions', () => {
  it('me liefert den Nutzer, nach Logout null', async () => {
    const app = makeApp();
    expect((await app.inject({ url: '/api/auth/me' })).json()).toEqual({ user: null });
    const client = await loginAs(app, 'a@test.de');
    expect((await client.get('/api/auth/me')).body.user.email).toBe('a@test.de');
    expect((await client.post('/api/auth/logout')).status).toBe(200);
    expect((await client.get('/api/auth/me')).body).toEqual({ user: null });
    expect((await client.get('/api/groups')).status).toBe(401);
  });

  it('ignoriert abgelaufene und unbekannte Sessions', async () => {
    const db = openDb(':memory:');
    const app = buildApp(db);
    const client = await loginAs(app, 'a@test.de');
    db.exec(`UPDATE sessions SET expires_at = datetime('now', '-1 second')`);
    expect((await client.get('/api/groups')).status).toBe(401);
    const res = await app.inject({ url: '/api/groups', cookies: { [SESSION_COOKIE]: 'gibtsnicht' } });
    expect(res.statusCode).toBe(401);
  });

  it('beendet beim Logout nur die aktuelle Session', async () => {
    const app = makeApp();
    const laptop = await loginAs(app, 'a@test.de');
    const handy = await loginAs(app, 'a@test.de');
    await laptop.post('/api/auth/logout');
    expect((await handy.get('/api/groups')).status).toBe(200);
  });

  it('setzt ein httpOnly-Cookie', async () => {
    const res = await makeApp().inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'a@test.de' } });
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE)!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Lax');
    expect(cookie.value).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('Fehlerbehandlung', () => {
  it('antwortet auf unbekannte API-Routen mit JSON-404', async () => {
    const res = await makeApp().inject({ url: '/api/gibtsnicht' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Nicht gefunden' });
  });

  it('meldet kaputtes JSON und ungültige IDs als 400', async () => {
    const app = makeApp();
    const broken = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{kaputt',
    });
    expect(broken.statusCode).toBe(400);
    const client = await loginAs(app, 'a@test.de');
    expect((await client.get('/api/groups/abc/members')).status).toBe(400);
  });

  it('versteckt interne Fehler', async () => {
    const db = openDb(':memory:');
    const app = buildApp(db);
    const client = await loginAs(app, 'a@test.de');
    db.exec('DROP TABLE memberships');
    const res = await client.get('/api/groups');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Interner Fehler' });
  });
});
