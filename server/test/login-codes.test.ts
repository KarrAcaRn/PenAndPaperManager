import { describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db.ts';
import { buildApp } from '../src/app.ts';
import { SESSION_COOKIE } from '../src/auth.ts';
import { generateCode, MAX_FAILED_ATTEMPTS, RATE_LIMITS } from '../src/login-codes.ts';

/** App mit abgefangenem Mailversand: `sent` enthält alle verschickten Codes. */
function setup() {
  const db = openDb(':memory:');
  const sent: { email: string; code: string }[] = [];
  const app = buildApp(db, {
    sendLoginCodeEmail: async (email, code) => {
      sent.push({ email, code });
    },
  });
  const request = (email: string, ip = '10.0.0.1') =>
    app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { email }, remoteAddress: ip });
  const verify = (email: string, code: string) =>
    app.inject({ method: 'POST', url: '/api/auth/verify-code', payload: { email, code } });
  const lastCode = () => sent.at(-1)!.code;
  return { db, app, sent, request, verify, lastCode };
}

/** Rate-Limit-Fenster überspringen, indem die vorhandenen Codes zurückdatiert werden */
const age = (db: Db, modifier: string) => db.exec(`UPDATE login_codes SET created_at = datetime(created_at, '${modifier}')`);

const wrong = (code: string) => (code === '000000' ? '111111' : '000000');

describe('Login per E-Mail-Code', () => {
  it('erzeugt sechsstellige Codes', () => {
    for (let i = 0; i < 50; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });

  it('meldet sich mit dem verschickten Code an und legt den Nutzer an', async () => {
    const { app, db, sent, request, verify, lastCode } = setup();
    const res = await request('  Neu@Test.DE ');
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(sent).toEqual([{ email: 'neu@test.de', code: expect.stringMatching(/^\d{6}$/) }]);

    const ok = await verify('NEU@test.de', ` ${lastCode()} `);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ user: { id: expect.any(Number), email: 'neu@test.de', isAdmin: false } });
    const sid = ok.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
    const me = await app.inject({ url: '/api/auth/me', cookies: { [SESSION_COOKIE]: sid } });
    expect(me.json().user.email).toBe('neu@test.de');
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()!.n).toBe(1);
  });

  it('speichert nur einen Hash des Codes', async () => {
    const { db, request, lastCode } = setup();
    await request('a@test.de');
    const row = db.prepare('SELECT * FROM login_codes').get()!;
    expect(Object.values(row)).not.toContain(lastCode());
    expect(JSON.stringify(row)).not.toContain(lastCode());
    expect(row.email).toBe('a@test.de');
  });

  it('antwortet für bekannte und unbekannte Adressen gleich', async () => {
    const { db, request, verify, lastCode } = setup();
    await request('alt@test.de');
    await verify('alt@test.de', lastCode());
    age(db, '-2 minutes');
    const known = await request('alt@test.de', '10.0.0.2');
    const unknown = await request('unbekannt@test.de', '10.0.0.3');
    expect([known.statusCode, known.body]).toEqual([204, '']);
    expect([unknown.statusCode, unknown.body]).toEqual([204, '']);
  });

  it('antwortet auch bei Fehlern im Mailversand mit 204', async () => {
    const app = buildApp(openDb(':memory:'), {
      sendLoginCodeEmail: async () => {
        throw new Error('SMTP kaputt');
      },
    });
    const res = await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { email: 'a@test.de' } });
    expect(res.statusCode).toBe(204);
  });

  it('lehnt ungültige Adressen ab', async () => {
    const { request } = setup();
    expect((await request('keine-adresse')).statusCode).toBe(400);
  });

  it('lehnt einen falschen Code ab und setzt kein Cookie', async () => {
    const { request, verify, lastCode } = setup();
    await request('a@test.de');
    const res = await verify('a@test.de', wrong(lastCode()));
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Code ungültig oder abgelaufen' });
    expect(res.cookies).toEqual([]);
    // der richtige Code gilt danach weiterhin
    expect((await verify('a@test.de', lastCode())).statusCode).toBe(200);
  });

  it('lehnt einen Code für eine andere Adresse oder ohne angeforderten Code ab', async () => {
    const { request, verify, lastCode } = setup();
    expect((await verify('a@test.de', '123456')).statusCode).toBe(401);
    await request('a@test.de');
    expect((await verify('b@test.de', lastCode())).statusCode).toBe(401);
  });

  it('lehnt einen abgelaufenen Code ab', async () => {
    const { db, request, verify, lastCode } = setup();
    await request('a@test.de');
    db.exec(`UPDATE login_codes SET expires_at = datetime('now', '-1 second')`);
    const res = await verify('a@test.de', lastCode());
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Code ungültig oder abgelaufen' });
  });

  it('setzt die Ablaufzeit auf 10 Minuten', async () => {
    const { db, request } = setup();
    await request('a@test.de');
    const { minutes } = db
      .prepare(`SELECT ROUND((julianday(expires_at) - julianday(created_at)) * 24 * 60) AS minutes FROM login_codes`)
      .get()!;
    expect(minutes).toBe(10);
  });

  it('lässt einen Code nur einmal verwenden', async () => {
    const { request, verify, lastCode } = setup();
    await request('a@test.de');
    const code = lastCode();
    expect((await verify('a@test.de', code)).statusCode).toBe(200);
    expect((await verify('a@test.de', code)).statusCode).toBe(401);
  });

  it('macht ältere Codes durch einen neuen ungültig', async () => {
    const { db, request, verify, sent } = setup();
    await request('a@test.de');
    age(db, '-2 minutes');
    await request('a@test.de');
    const [first, second] = sent.map((s) => s.code);
    if (first !== second) expect((await verify('a@test.de', first!)).statusCode).toBe(401);
    expect((await verify('a@test.de', second!)).statusCode).toBe(200);
  });

  it(`sperrt den Code nach ${MAX_FAILED_ATTEMPTS} Fehlversuchen`, async () => {
    const { request, verify, lastCode } = setup();
    await request('a@test.de');
    const code = lastCode();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) expect((await verify('a@test.de', wrong(code))).statusCode).toBe(401);
    expect((await verify('a@test.de', code)).statusCode).toBe(401);
  });

  it('zählt auch Codes im falschen Format als Fehlversuch', async () => {
    const { request, verify, lastCode } = setup();
    await request('a@test.de');
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) expect((await verify('a@test.de', 'abc')).statusCode).toBe(401);
    expect((await verify('a@test.de', lastCode())).statusCode).toBe(401);
  });

  it('lässt pro Adresse nur einen Code pro Minute anfordern', async () => {
    const { db, request, sent } = setup();
    expect((await request('a@test.de')).statusCode).toBe(204);
    const limited = await request(' A@test.de', '10.0.0.9');
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toMatch(/Minute/);
    expect(sent).toHaveLength(1);
    // andere Adressen sind nicht betroffen
    expect((await request('b@test.de')).statusCode).toBe(204);
    age(db, '-61 seconds');
    expect((await request('a@test.de')).statusCode).toBe(204);
  });

  it(`lässt pro Adresse höchstens ${RATE_LIMITS.emailPerHour} Codes pro Stunde anfordern`, async () => {
    const { db, request } = setup();
    for (let i = 0; i < RATE_LIMITS.emailPerHour; i++) {
      expect((await request('a@test.de', `10.0.1.${i}`)).statusCode).toBe(204);
      age(db, '-61 seconds');
    }
    expect((await request('a@test.de', '10.0.2.1')).statusCode).toBe(429);
    age(db, '-1 hour');
    expect((await request('a@test.de', '10.0.2.1')).statusCode).toBe(204);
  });

  it(`lässt pro IP höchstens ${RATE_LIMITS.ipPerHour} Codes pro Stunde anfordern`, async () => {
    const { request } = setup();
    for (let i = 0; i < RATE_LIMITS.ipPerHour; i++) expect((await request(`u${i}@test.de`, '10.9.9.9')).statusCode).toBe(204);
    expect((await request('noch-einer@test.de', '10.9.9.9')).statusCode).toBe(429);
    expect((await request('noch-einer@test.de', '10.9.9.8')).statusCode).toBe(204);
  });

  it('räumt Codes älter als einen Tag auf', async () => {
    const { db, request } = setup();
    await request('a@test.de');
    age(db, '-2 days');
    await request('b@test.de');
    expect(db.prepare('SELECT email FROM login_codes').all()).toEqual([{ email: 'b@test.de' }]);
  });
});
