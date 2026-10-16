import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ArticleInput, Visibility } from '@pnp/shared';
import { openDb } from '../src/db.ts';
import { buildApp, type AppOptions } from '../src/app.ts';
import { SESSION_COOKIE } from '../src/auth.ts';
import type { LoginRateLimits } from '../src/login-codes.ts';

type Call = (url: string, body?: unknown) => Promise<{ status: number; body: any }>;

export interface Client {
  userId: number;
  get: Call;
  post: Call;
  put: Call;
  patch: Call;
  del: Call;
}

/** Artikel-Payload; Standard ist ein Artikel in der Wurzel von "characters" */
export const article = (visibility: Visibility, extra: Partial<Record<keyof ArticleInput, unknown>> = {}) => ({
  section: 'characters',
  path: '',
  title: `Artikel ${visibility}`,
  bodyMd: 'Text',
  visibility,
  ...extra,
});

export const ADMIN_EMAIL = 'admin@test.de';

/** Abgefangene Login-Codes je Adresse (letzter gewinnt) – statt echter E-Mails */
export const outbox = new Map<string, string>();

/** Ohne Rate-Limits, damit Tests beliebig viele Logins machen können */
export const NO_RATE_LIMITS: LoginRateLimits = { emailPerMinute: Infinity, emailPerHour: Infinity, ipPerHour: Infinity };

/** buildApp mit abgefangenem Mailversand (siehe `outbox`), ohne Rate-Limits und mit Zufallsschlüssel */
export function testApp(db = openDb(':memory:'), opts: AppOptions = {}): FastifyInstance {
  return buildApp(db, {
    sendLoginCodeEmail: async (email, code) => void outbox.set(email, code),
    loginRateLimits: NO_RATE_LIMITS,
    secretKey: randomBytes(32),
    ...opts,
  });
}

export function makeApp(opts: AppOptions = {}): FastifyInstance {
  return testApp(openDb(':memory:'), { adminEmails: ADMIN_EMAIL, ...opts });
}

/**
 * Meldet sich wie im Browser an: Code anfordern, aus der `outbox` holen, einlösen. Liefert die Antwort von
 * verify-code (mit Session-Cookie). Die App muss mit `testApp`/`makeApp` gebaut sein.
 */
export async function loginWithCode(app: FastifyInstance, email: string) {
  const normalized = email.trim().toLowerCase();
  outbox.delete(normalized);
  const requested = await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { email } });
  if (requested.statusCode !== 204) throw new Error(`request-code: ${requested.statusCode} ${requested.body}`);
  const code = outbox.get(normalized);
  if (!code) throw new Error(`Kein Code für ${normalized} abgefangen – App nicht mit testApp gebaut?`);
  const verified = await app.inject({ method: 'POST', url: '/api/auth/verify-code', payload: { email, code } });
  if (verified.statusCode !== 200) throw new Error(`verify-code: ${verified.statusCode} ${verified.body}`);
  return verified;
}

/** Session-Cookie aus einer Antwort */
export const sidOf = (res: { cookies: { name: string; value: string }[] }): string =>
  res.cookies.find((c) => c.name === SESSION_COOKIE)!.value;

export async function loginAs(app: FastifyInstance, email: string): Promise<Client> {
  const res = await loginWithCode(app, email);
  const sid = sidOf(res);
  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE') => async (url: string, body?: unknown) => {
    const r = await app.inject({ method, url, cookies: { [SESSION_COOKIE]: sid }, ...(body === undefined ? {} : { payload: body as object }) });
    return { status: r.statusCode, body: r.body ? r.json() : null };
  };
  return { userId: res.json().user.id, get: call('GET'), post: call('POST'), put: call('PUT'), patch: call('PATCH'), del: call('DELETE') };
}

/** Gruppe mit Spielleiter "gm@test.de" und den Spielern "alice@test.de" und "bob@test.de". */
export async function setupGroup(app: FastifyInstance) {
  const gm = await loginAs(app, 'gm@test.de');
  const gid: number = (await gm.post('/api/groups', { name: 'Testrunde' })).body.id;
  await gm.post(`/api/groups/${gid}/members`, { email: 'alice@test.de' });
  await gm.post(`/api/groups/${gid}/members`, { email: 'bob@test.de' });
  const alice = await loginAs(app, 'alice@test.de');
  const bob = await loginAs(app, 'bob@test.de');
  return { gid, gm, alice, bob, base: `/api/groups/${gid}` };
}
