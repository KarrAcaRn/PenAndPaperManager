import type { FastifyInstance } from 'fastify';
import type { ArticleInput, Visibility } from '@pnp/shared';
import { openDb } from '../src/db.ts';
import { buildApp } from '../src/app.ts';
import { SESSION_COOKIE } from '../src/auth.ts';

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

export function makeApp(): FastifyInstance {
  return buildApp(openDb(':memory:'), { adminEmails: ADMIN_EMAIL });
}

export async function loginAs(app: FastifyInstance, email: string): Promise<Client> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email } });
  const sid = res.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE') => async (url: string, body?: unknown) => {
    const r = await app.inject({ method, url, cookies: { [SESSION_COOKIE]: sid }, ...(body === undefined ? {} : { payload: body as object }) });
    return { status: r.statusCode, body: r.body ? r.json() : null };
  };
  return { userId: res.json().id, get: call('GET'), post: call('POST'), put: call('PUT'), patch: call('PATCH'), del: call('DELETE') };
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
