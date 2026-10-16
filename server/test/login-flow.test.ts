import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDb, run } from '../src/db.ts';
import { buildApp } from '../src/app.ts';
import { SESSION_COOKIE, SESSION_DAYS } from '../src/auth.ts';
import { setMailSender, type MailMessage } from '../src/mail.ts';

/**
 * Ende-zu-Ende auf API-Ebene: echte App mit dem echten Versandweg aus mail.ts, nur der Transport ist per
 * setMailSender ersetzt – so greift der Test den Code aus der E-Mail ab wie ein Mensch aus seinem Postfach.
 */
const DAY = 24 * 60 * 60 * 1000;

function setup() {
  const db = openDb(':memory:');
  const inbox: MailMessage[] = [];
  setMailSender(async (m) => void inbox.push(m), { info() {}, warn() {}, error() {} });
  const app = buildApp(db);
  const codeFrom = (m: MailMessage) => /^\s+(\d{6})$/m.exec(m.text)![1];
  return { db, app, inbox, codeFrom };
}

afterEach(() => {
  setMailSender(undefined);
  vi.useRealTimers();
});

describe('Login per E-Mail-Code (Ende zu Ende)', () => {
  it('E-Mail eingeben, Code aus der Mail einlösen, eingeloggt, Logout', async () => {
    const { app, inbox, codeFrom } = setup();

    // 1. E-Mail eingeben
    const requested = await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { email: 'Held@Test.de' } });
    expect(requested.statusCode).toBe(204);

    // 2. Code aus der verschickten E-Mail abgreifen
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ to: 'held@test.de', subject: expect.stringMatching(/^Dein Login-Code: \d{6}$/) });
    const code = codeFrom(inbox[0]);
    expect(inbox[0].html).toContain(code);

    // 3. Code eingeben -> eingeloggt (Session-Cookie)
    const verified = await app.inject({ method: 'POST', url: '/api/auth/verify-code', payload: { email: 'held@test.de', code } });
    expect(verified.statusCode).toBe(200);
    expect(verified.json()).toEqual({ user: { id: expect.any(Number), email: 'held@test.de', isAdmin: false } });
    const cookie = verified.cookies.find((c) => c.name === SESSION_COOKIE)!;
    expect(cookie).toMatchObject({ httpOnly: true, maxAge: SESSION_DAYS * 24 * 60 * 60 });
    const cookies = { [SESSION_COOKIE]: cookie.value };

    // 4. /auth/me liefert den Nutzer, geschützte Routen sind erreichbar
    const me = await app.inject({ url: '/api/auth/me', cookies });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('held@test.de');
    expect((await app.inject({ url: '/api/groups', cookies })).statusCode).toBe(200);

    // Der Code ist danach verbraucht
    const again = await app.inject({ method: 'POST', url: '/api/auth/verify-code', payload: { email: 'held@test.de', code } });
    expect(again.statusCode).toBe(401);

    // 5. Logout -> wieder ausgeloggt
    expect((await app.inject({ method: 'POST', url: '/api/auth/logout', cookies })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/auth/me', cookies })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/groups', cookies })).statusCode).toBe(401);
  });

  it('eine Session gilt höchstens 30 Tage (manipulierte Zeit)', async () => {
    const start = new Date('2026-03-01T08:00:00Z');
    vi.useFakeTimers({ toFake: ['Date'], now: start });
    const { app, inbox, codeFrom } = setup();
    await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { email: 'a@test.de' } });
    const verified = await app.inject({ method: 'POST', url: '/api/auth/verify-code', payload: { email: 'a@test.de', code: codeFrom(inbox[0]) } });
    const cookies = { [SESSION_COOKIE]: verified.cookies.find((c) => c.name === SESSION_COOKIE)!.value };

    vi.setSystemTime(start.getTime() + 29 * DAY);
    expect((await app.inject({ url: '/api/auth/me', cookies })).statusCode).toBe(200);
    vi.setSystemTime(start.getTime() + SESSION_DAYS * DAY);
    expect((await app.inject({ url: '/api/auth/me', cookies })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/groups', cookies })).statusCode).toBe(401);
  });

  it('eine Session mit abgelaufenem expires_at gilt nicht mehr (manipulierte Datenbank)', async () => {
    const { db, app, inbox, codeFrom } = setup();
    await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { email: 'a@test.de' } });
    const verified = await app.inject({ method: 'POST', url: '/api/auth/verify-code', payload: { email: 'a@test.de', code: codeFrom(inbox[0]) } });
    const cookies = { [SESSION_COOKIE]: verified.cookies.find((c) => c.name === SESSION_COOKIE)!.value };
    expect((await app.inject({ url: '/api/auth/me', cookies })).statusCode).toBe(200);

    run(db, `UPDATE sessions SET expires_at = datetime('now', '-1 second')`);
    expect((await app.inject({ url: '/api/auth/me', cookies })).statusCode).toBe(401);
  });

  it('der frühere Login nur per E-Mail ist abgeschaltet', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'a@test.de' } });
    expect(res.statusCode).not.toBe(200);
    expect(res.cookies).toEqual([]);
  });

  it('alle API-Routen außer Login/Status/Logout verlangen eine Session', async () => {
    const { app } = setup();
    for (const [method, url] of [
      ['GET', '/api/groups'],
      ['POST', '/api/groups'],
      ['GET', '/api/presets'],
      ['GET', '/api/rulebooks'],
      ['GET', '/api/groups/1/articles'],
      ['GET', '/api/gibtsnicht'],
      // prozentkodiert: der Router dekodiert, der Guard muss es auch (sonst käme hier 400 aus der Validierung)
      ['POST', '/%61pi/groups'],
      ['GET', '/%61pi/gibtsnicht'],
    ] as const) {
      const res = await app.inject({ method, url });
      expect([url, res.statusCode]).toEqual([url, 401]);
      expect(res.json()).toEqual({ error: 'Nicht eingeloggt' });
    }
    // öffentlich: Seiten (SPA) und die Login-Endpunkte selbst
    expect((await app.inject({ method: 'POST', url: '/api/auth/logout' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/auth/me' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { email: 'x@test.de' } })).statusCode).toBe(204);
  });
});
