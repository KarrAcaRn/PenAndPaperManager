import { describe, expect, it } from 'vitest';
import { loginAs, makeApp, setupGroup } from './helpers.ts';

describe('Login und Gruppen', () => {
  it('verlangt einen Login', async () => {
    const app = makeApp();
    expect((await app.inject({ url: '/api/groups' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'kaputt' } })).statusCode).toBe(400);
  });

  it('behandelt E-Mails unabhängig von Groß-/Kleinschreibung', async () => {
    const app = makeApp();
    const a = await loginAs(app, 'Jemand@Test.de');
    const b = await loginAs(app, ' jemand@test.de ');
    expect(a.userId).toBe(b.userId);
  });

  it('macht den Ersteller zum Spielleiter und Eingeladene zu Spielern', async () => {
    const app = makeApp();
    const { gid, gm, alice } = await setupGroup(app);
    expect((await gm.get('/api/groups')).body).toEqual([{ id: gid, name: 'Testrunde', role: 'gm' }]);
    expect((await alice.get('/api/groups')).body).toEqual([{ id: gid, name: 'Testrunde', role: 'player' }]);
  });

  it('legt in Notizen und Spielleiter die Standardordner an', async () => {
    const { base, gm, alice } = await setupGroup(makeApp());
    for (const section of ['notes', 'gm']) {
      const folders = (await gm.get(`${base}/folders?section=${section}`)).body;
      expect(folders).toEqual(['NPCs', 'Orte', 'Sessions'].map((path) => ({ path, explicit: true, canManage: true })));
    }
    expect((await gm.get(`${base}/folders?section=characters`)).body).toEqual([]);
    // Spieler sehen die Ordner, dürfen sie aber nicht umbauen
    const notes = (await alice.get(`${base}/folders?section=notes`)).body;
    expect(notes.map((f: { canManage: boolean }) => f.canManage)).toEqual([false, false, false]);
    expect((await alice.del(`${base}/folders?section=notes&path=NPCs`)).status).toBe(403);
    expect((await alice.post(`${base}/folders`, { section: 'notes', path: 'NPCs/Händler' })).status).toBe(201);
  });

  it('zeigt eine Einladung an eine unbekannte E-Mail nach deren erstem Login', async () => {
    const app = makeApp();
    const { base, gm } = await setupGroup(app);
    expect((await gm.post(`${base}/members`, { email: 'neu@test.de' })).status).toBe(201);
    expect((await gm.post(`${base}/members`, { email: 'NEU@test.de' })).status).toBe(409);
    const neu = await loginAs(app, 'neu@test.de');
    expect((await neu.get('/api/groups')).body).toHaveLength(1);
  });

  it('sperrt Nicht-Mitglieder aus', async () => {
    const app = makeApp();
    const { base } = await setupGroup(app);
    const fremd = await loginAs(app, 'fremd@test.de');
    expect((await fremd.get(`${base}/members`)).status).toBe(403);
    expect((await fremd.get(`${base}/articles?section=notes`)).status).toBe(403);
    expect((await fremd.post(`${base}/folders`, { section: 'notes', path: 'x' })).status).toBe(403);
  });

  it('lässt nur Spielleiter einladen und befördern', async () => {
    const app = makeApp();
    const { base, alice, bob } = await setupGroup(app);
    expect((await alice.post(`${base}/members`, { email: 'x@test.de' })).status).toBe(403);
    expect((await alice.patch(`${base}/members/${alice.userId}`, { role: 'gm' })).status).toBe(403);
    expect((await alice.del(`${base}/members/${bob.userId}`)).status).toBe(403);
  });

  it('behält immer mindestens einen Spielleiter', async () => {
    const app = makeApp();
    const { base, gm, alice } = await setupGroup(app);
    expect((await gm.patch(`${base}/members/${gm.userId}`, { role: 'player' })).status).toBe(409);
    expect((await gm.del(`${base}/members/${gm.userId}`)).status).toBe(409);

    expect((await gm.patch(`${base}/members/${alice.userId}`, { role: 'gm' })).status).toBe(200);
    expect((await gm.patch(`${base}/members/${gm.userId}`, { role: 'player' })).status).toBe(200);
    expect((await alice.del(`${base}/members/${alice.userId}`)).status).toBe(409);
  });

  it('verrät Spielern nicht, welche Mitglieder es gibt, und meldet Spielleitern unbekannte', async () => {
    const { base, gm, alice } = await setupGroup(makeApp());
    expect((await alice.del(`${base}/members/9999`)).status).toBe(403);
    expect((await gm.del(`${base}/members/9999`)).status).toBe(404);
    expect((await gm.patch(`${base}/members/9999`, { role: 'gm' })).status).toBe(404);
    expect((await gm.patch(`${base}/members/9999`, { role: 'player' })).status).toBe(404);
    expect((await gm.patch(`${base}/members/${alice.userId}`, { role: 'chef' })).status).toBe(400);
  });

  it('sperrt entfernte Mitglieder sofort aus und erkennt sie bei erneuter Einladung wieder', async () => {
    const { base, gm, alice } = await setupGroup(makeApp());
    await gm.del(`${base}/members/${alice.userId}`);
    expect((await alice.get(`${base}/members`)).status).toBe(403);
    const again = await gm.post(`${base}/members`, { email: ' ALICE@test.de ' });
    expect(again.body).toEqual({ userId: alice.userId, email: 'alice@test.de', role: 'player' });
    expect((await alice.get(`${base}/members`)).status).toBe(200);
  });

  it('kommt mit riesigen Gruppen-IDs zurecht', async () => {
    const { gm } = await setupGroup(makeApp());
    expect((await gm.get('/api/groups/99999999999999999999/members')).status).toBeLessThan(500);
    expect((await gm.post('/api/groups', { name: 'a\nb' })).status).toBe(400);
    expect((await gm.post('/api/groups', { name: '\u200b \u00a0' })).status).toBe(400);
  });

  it('erlaubt Spielern den Austritt', async () => {
    const app = makeApp();
    const { base, bob } = await setupGroup(app);
    expect((await bob.del(`${base}/members/${bob.userId}`)).status).toBe(200);
    expect((await bob.get('/api/groups')).body).toEqual([]);
  });
});
