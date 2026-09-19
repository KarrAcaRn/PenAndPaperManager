import { describe, expect, it } from 'vitest';
import { normalizeSkillNames } from '@pnp/shared';
import { openDb } from '../src/db.ts';
import { buildApp } from '../src/app.ts';
import { parseAdminEmails } from '../src/auth.ts';
import { DEFAULT_PRESETS } from '../src/presets/defaults.ts';
import { ADMIN_EMAIL, loginAs, makeApp } from './helpers.ts';

const preset = (extra: object = {}) => ({ name: 'Testspiel', description: 'Quelle', skills: ['Laufen', 'Reden'], ...extra });

describe('DEFAULT_PRESETS', () => {
  it('enthält nur gültige, eindeutig benannte Varianten', () => {
    const names = DEFAULT_PRESETS.map((p) => p.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const p of DEFAULT_PRESETS) {
      expect(p.skills.length, p.name).toBeGreaterThan(0);
      expect(normalizeSkillNames(p.skills), p.name).toEqual(p.skills);
    }
  });
});

describe('Admins', () => {
  it('kommen aus der Konfiguration', () => {
    expect([...parseAdminEmails(' A@x.de, b@y.de ,,')]).toEqual(['a@x.de', 'b@y.de']);
    expect(parseAdminEmails(undefined).size).toBe(0);
  });

  it('sind in login und me markiert', async () => {
    const app = makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: ADMIN_EMAIL.toUpperCase() } });
    expect(res.json().isAdmin).toBe(true);
    const admin = await loginAs(app, ADMIN_EMAIL);
    expect((await admin.get('/api/auth/me')).body.user.isAdmin).toBe(true);
    const normal = await loginAs(app, 'normal@test.de');
    expect((await normal.get('/api/auth/me')).body.user.isAdmin).toBe(false);
  });
});

describe('Varianten', () => {
  it('werden genau einmal eingespielt - gelöschte kommen nicht zurück', async () => {
    const db = openDb(':memory:');
    const admin = await loginAs(buildApp(db, { adminEmails: ADMIN_EMAIL }), ADMIN_EMAIL);
    const seeded = (await admin.get('/api/presets')).body;
    expect(seeded.map((p: any) => p.name).sort()).toEqual(DEFAULT_PRESETS.map((p) => p.name).sort());
    for (const p of seeded) await admin.del(`/api/presets/${p.id}`);

    const restarted = await loginAs(buildApp(db, { adminEmails: ADMIN_EMAIL }), ADMIN_EMAIL);
    expect((await restarted.get('/api/presets')).body).toEqual([]);
  });

  it('kann jeder Eingeloggte lesen, aber nur ein Admin ändern', async () => {
    const app = makeApp();
    expect((await app.inject({ url: '/api/presets' })).statusCode).toBe(401);
    const normal = await loginAs(app, 'normal@test.de');
    const [first] = (await normal.get('/api/presets')).body;
    expect(first.skills.length).toBeGreaterThan(0);
    expect((await normal.post('/api/presets', preset())).status).toBe(403);
    expect((await normal.put(`/api/presets/${first.id}`, preset())).status).toBe(403);
    expect((await normal.del(`/api/presets/${first.id}`)).status).toBe(403);
  });

  it('lassen sich anlegen, ändern und löschen', async () => {
    const admin = await loginAs(makeApp(), ADMIN_EMAIL);
    const created = await admin.post('/api/presets', preset({ name: '  Testspiel ', skills: [' Laufen ', 'Reden'] }));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Testspiel', description: 'Quelle', skills: ['Laufen', 'Reden'] });

    const id = created.body.id;
    const updated = await admin.put(`/api/presets/${id}`, preset({ name: 'testspiel', skills: ['Reden'] }));
    expect(updated.body).toMatchObject({ name: 'testspiel', skills: ['Reden'] });
    expect((await admin.del(`/api/presets/${id}`)).status).toBe(200);
    expect((await admin.del(`/api/presets/${id}`)).status).toBe(404);
    expect((await admin.put(`/api/presets/${id}`, preset())).status).toBe(404);
  });

  it('validiert Namen und Fertigkeiten', async () => {
    const admin = await loginAs(makeApp(), ADMIN_EMAIL);
    expect((await admin.post('/api/presets', preset())).status).toBe(201);
    expect((await admin.post('/api/presets', preset({ name: 'TESTSPIEL' }))).status).toBe(409);
    expect((await admin.post('/api/presets', preset({ name: ' ' }))).status).toBe(400);
    expect((await admin.post('/api/presets', preset({ name: 'A', skills: [] }))).status).toBe(400);
    expect((await admin.post('/api/presets', preset({ name: 'B', skills: ['x', 'X'] }))).status).toBe(400);
    expect((await admin.post('/api/presets', preset({ name: 'C', skills: ['​'] }))).status).toBe(400);
    expect((await admin.post('/api/presets', preset({ name: 'D', skills: Array.from({ length: 41 }, (_, i) => `s${i}`) }))).status).toBe(400);
    const other = (await admin.post('/api/presets', preset({ name: 'Anderes' }))).body.id;
    expect((await admin.put(`/api/presets/${other}`, preset())).status).toBe(409);
  });
});
