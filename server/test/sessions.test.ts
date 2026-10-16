import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { allRows, openDb, run, type Db } from '../src/db.ts';
import { createSession, deleteExpiredSessions, destroyAllSessions, getCurrentUser, requireAuth, SESSION_COOKIE, SESSION_DAYS } from '../src/auth.ts';
import { HttpError } from '../src/errors.ts';
import { loginAs, loginWithCode, sidOf, testApp } from './helpers.ts';

const DAY = 24 * 60 * 60 * 1000;
const LOGIN_TIME = new Date('2026-01-01T12:00:00Z');

function setup() {
  const db = openDb(':memory:');
  return { db, app: testApp(db) };
}

const me = (app: ReturnType<typeof testApp>, sid?: string) =>
  app.inject({ url: '/api/auth/me', ...(sid === undefined ? {} : { cookies: { [SESSION_COOKIE]: sid } }) });

async function loginSid(app: ReturnType<typeof testApp>, email = 'a@test.de'): Promise<string> {
  return sidOf(await loginWithCode(app, email));
}

afterEach(() => vi.useRealTimers());

describe('Sessions mit 30 Tagen Laufzeit', () => {
  it('akzeptiert eine gültige Session', async () => {
    const { app } = setup();
    const sid = await loginSid(app);
    const res = await me(app, sid);
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ email: 'a@test.de', isAdmin: false });
  });

  it('setzt das Cookie mit HttpOnly, SameSite=Lax und Max-Age 30 Tage', async () => {
    const { app } = setup();
    const res = await loginWithCode(app, 'a@test.de');
    const c = res.cookies.find((x) => x.name === SESSION_COOKIE)!;
    expect(c).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 24 * 60 * 60 });
    expect(c.secure).toBeFalsy(); // nur in Produktion
  });

  it('setzt das Cookie in Produktion mit Secure', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const { app } = setup();
      const res = await loginWithCode(app, 'a@test.de');
      expect(res.cookies.find((x) => x.name === SESSION_COOKIE)!.secure).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('speichert nur den Hash des Tokens mit absoluter Ablaufzeit', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: LOGIN_TIME });
    const { db, app } = setup();
    const sid = await loginSid(app);
    const rows = allRows<{ token_hash: string; created_at: string; expires_at: string }>(db, 'SELECT * FROM sessions');
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(sid);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]).toMatchObject({ created_at: '2026-01-01 12:00:00', expires_at: '2026-01-31 12:00:00' });
  });

  it('läuft genau 30 Tage nach dem Login ab, auch bei laufender Benutzung', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: LOGIN_TIME });
    const { app } = setup();
    const sid = await loginSid(app);
    // tägliche Benutzung verlängert nichts
    for (let day = 1; day < SESSION_DAYS; day++) {
      vi.setSystemTime(LOGIN_TIME.getTime() + day * DAY);
      expect((await me(app, sid)).statusCode).toBe(200);
    }
    vi.setSystemTime(LOGIN_TIME.getTime() + SESSION_DAYS * DAY - 1000);
    expect((await me(app, sid)).statusCode).toBe(200);
    vi.setSystemTime(LOGIN_TIME.getTime() + SESSION_DAYS * DAY);
    expect((await me(app, sid)).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/groups', cookies: { [SESSION_COOKIE]: sid } })).statusCode).toBe(401);
  });

  it('lehnt eine Session mit abgelaufenem expiresAt ab', async () => {
    const { db, app } = setup();
    const sid = await loginSid(app);
    run(db, `UPDATE sessions SET expires_at = datetime('now', '-1 second')`);
    expect((await me(app, sid)).statusCode).toBe(401);
  });

  it('beendet die Session beim Logout und löscht das Cookie', async () => {
    const { db, app } = setup();
    const sid = await loginSid(app);
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout', cookies: { [SESSION_COOKIE]: sid } });
    expect(res.statusCode).toBe(200);
    const cleared = res.cookies.find((c) => c.name === SESSION_COOKIE)!;
    expect(cleared.value).toBe('');
    expect(cleared.expires!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(allRows(db, 'SELECT * FROM sessions')).toHaveLength(0);
    // das alte Token bleibt ungültig, auch wenn es jemand aufbewahrt hat
    expect((await me(app, sid)).statusCode).toBe(401);
  });

  it('Logout ohne Session ist harmlos', async () => {
    const { app } = setup();
    expect((await app.inject({ method: 'POST', url: '/api/auth/logout' })).statusCode).toBe(200);
  });

  it('lehnt fehlende und ungültige Cookies mit 401 ab', async () => {
    const { app } = setup();
    await loginSid(app);
    expect((await me(app)).statusCode).toBe(401);
    expect((await me(app, '')).statusCode).toBe(401);
    expect((await me(app, 'gibtsnicht')).statusCode).toBe(401);
    expect((await me(app, 'f'.repeat(64))).statusCode).toBe(401);
    expect((await me(app, "' OR 1=1 --")).statusCode).toBe(401);
    expect((await me(app)).json()).toEqual({ error: 'Nicht eingeloggt' });
  });

  it('akzeptiert den gespeicherten Hash nicht als Cookie', async () => {
    const { db, app } = setup();
    await loginSid(app);
    const [{ token_hash }] = allRows<{ token_hash: string }>(db, 'SELECT token_hash FROM sessions');
    expect((await me(app, token_hash)).statusCode).toBe(401);
  });

  it('widerruft alle Sessions eines Nutzers', async () => {
    const { db, app } = setup();
    const laptop = await loginAs(app, 'a@test.de');
    const handy = await loginAs(app, 'a@test.de');
    const other = await loginAs(app, 'b@test.de');
    expect(destroyAllSessions(db, laptop.userId)).toBe(2);
    expect((await laptop.get('/api/auth/me')).status).toBe(401);
    expect((await handy.get('/api/auth/me')).status).toBe(401);
    expect((await other.get('/api/auth/me')).status).toBe(200);
  });

  it('räumt abgelaufene Sessions auf, beim Login auch automatisch', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: LOGIN_TIME });
    const { db, app } = setup();
    await loginSid(app, 'a@test.de');
    vi.setSystemTime(LOGIN_TIME.getTime() + 10 * DAY);
    await loginSid(app, 'b@test.de');
    expect(deleteExpiredSessions(db)).toBe(0);
    vi.setSystemTime(LOGIN_TIME.getTime() + 31 * DAY);
    await loginSid(app, 'c@test.de');
    expect(allRows<{ user_id: number }>(db, 'SELECT user_id FROM sessions')).toHaveLength(2);
    expect(deleteExpiredSessions(db, LOGIN_TIME.getTime() + 41 * DAY)).toBe(1);
  });
});

describe('createSession und requireAuth', () => {
  /** Mini-App, wie sie der Code-Login nutzt: createSession nach erfolgreicher Prüfung, requireAuth als Guard */
  function guardedApp(db: Db) {
    const app = Fastify();
    app.register(cookie);
    app.setErrorHandler((err: Error, _req, reply) =>
      reply.code(err instanceof HttpError ? err.statusCode : 500).send({ error: err.message }),
    );
    app.post('/api/verify', (_req, reply) => {
      createSession(db, 1, reply);
      return { ok: true };
    });
    app.get('/api/secret', { preHandler: requireAuth(db) }, (req) => ({ user: getCurrentUser(db, req) }));
    app.get('/seite', { preHandler: requireAuth(db) }, () => 'geheim');
    return app;
  }

  it('lässt eingeloggte Nutzer durch und weist andere ab bzw. leitet auf die Login-Seite um', async () => {
    const db = openDb(':memory:');
    run(db, `INSERT INTO users (id, email) VALUES (1, 'a@test.de')`);
    const app = guardedApp(db);

    expect((await app.inject({ url: '/api/secret' })).statusCode).toBe(401);
    const page = await app.inject({ url: '/seite?x=1' });
    expect(page.statusCode).toBe(302);
    expect(page.headers.location).toBe('/#/login');

    const login = await app.inject({ method: 'POST', url: '/api/verify' });
    const sid = login.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
    const cookies = { [SESSION_COOKIE]: sid };
    expect((await app.inject({ url: '/api/secret', cookies })).json()).toEqual({ user: { id: 1, email: 'a@test.de' } });
    expect((await app.inject({ url: '/seite', cookies })).body).toBe('geheim');
  });
});
