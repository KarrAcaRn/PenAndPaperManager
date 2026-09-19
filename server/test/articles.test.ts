import { describe, expect, it } from 'vitest';
import { VISIBILITIES, type Visibility } from '@pnp/shared';
import { article, loginAs, makeApp, setupGroup } from './helpers.ts';

describe('Sichtbarkeit von Artikeln', () => {
  // Autor ist immer alice (Spielerin)
  const matrix: Record<Visibility, { gm: boolean; bob: boolean }> = {
    private: { gm: false, bob: false },
    private_gm: { gm: true, bob: false },
    public: { gm: true, bob: true },
  };

  for (const visibility of VISIBILITIES) {
    it(`${visibility}: Liste und Einzelabruf`, async () => {
      const { base, gm, alice, bob } = await setupGroup(makeApp());
      const id = (await alice.post(`${base}/articles`, article(visibility))).body.id;

      for (const [client, visible] of [[alice, true], [gm, matrix[visibility].gm], [bob, matrix[visibility].bob]] as const) {
        expect((await client.get(`${base}/articles/${id}`)).status).toBe(visible ? 200 : 404);
        expect((await client.get(`${base}/articles?section=characters`)).body).toHaveLength(visible ? 1 : 0);
      }
    });
  }

  it('lässt Autor und Spielleiter bearbeiten, andere Spieler nicht', async () => {
    const { base, gm, alice, bob } = await setupGroup(makeApp());
    const id = (await alice.post(`${base}/articles`, article('public'))).body.id;
    expect((await bob.get(`${base}/articles/${id}`)).body.canEdit).toBe(false);
    expect((await bob.put(`${base}/articles/${id}`, article('public', { title: 'Gekapert' }))).status).toBe(403);
    expect((await bob.del(`${base}/articles/${id}`)).status).toBe(403);
    expect((await gm.put(`${base}/articles/${id}`, article('public', { title: 'Vom SL' }))).body.title).toBe('Vom SL');
    // Der SL darf sich nicht selbst aussperren
    expect((await gm.put(`${base}/articles/${id}`, article('private'))).status).toBe(403);
    expect((await alice.put(`${base}/articles/${id}`, article('private'))).status).toBe(200);
    expect((await gm.del(`${base}/articles/${id}`)).status).toBe(404);
    expect((await alice.del(`${base}/articles/${id}`)).status).toBe(200);
  });

  it('validiert Eingaben', async () => {
    const { base, alice } = await setupGroup(makeApp());
    expect((await alice.post(`${base}/articles`, article('public', { title: '   ' }))).status).toBe(400);
    expect((await alice.post(`${base}/articles`, article('public', { section: 'quatsch' }))).status).toBe(400);
    expect((await alice.post(`${base}/articles`, article('public', { path: 'a/../b' }))).status).toBe(400);
    expect((await alice.post(`${base}/articles`, article('public', { title: 'a\u0000b' }))).status).toBe(400);
    expect((await alice.post(`${base}/articles`, article('public', { title: '\u200b' }))).status).toBe(400);
    expect((await alice.post(`${base}/articles`, article('public', { title: 'x\u2028y' }))).status).toBe(400);
    expect((await alice.post(`${base}/articles`, article('public', { title: ' Zoë 😀 Sta\u0308dte ' }))).body.title).toBe('Zoë 😀 Sta\u0308dte');
    expect((await alice.post(`${base}/articles`, article('public', { title: 'x'.repeat(201) }))).status).toBe(400);
    expect((await alice.get(`${base}/articles?section=npcs&path=a&path=b`)).status).toBe(400);
    expect((await alice.get(`${base}/articles/99999999999999999999`)).status).toBeLessThan(500);
  });

  it('liefert Artikel nicht über eine andere Gruppe aus', async () => {
    const app = makeApp();
    const { base, alice } = await setupGroup(app);
    const id = (await alice.post(`${base}/articles`, article('public'))).body.id;
    const fremd = await loginAs(app, 'fremd@test.de');
    const other = (await fremd.post('/api/groups', { name: 'Andere' })).body.id;
    expect((await fremd.get(`/api/groups/${other}/articles/${id}`)).status).toBe(404);
    expect((await fremd.put(`/api/groups/${other}/articles/${id}`, article('public'))).status).toBe(404);
    expect((await fremd.del(`/api/groups/${other}/articles/${id}`)).status).toBe(404);
  });

  it('lässt den Spielleiter fremde Artikel nicht in den SL-Bereich verschieben', async () => {
    const { base, gm, alice } = await setupGroup(makeApp());
    const id = (await alice.post(`${base}/articles`, article('private_gm'))).body.id;
    expect((await gm.put(`${base}/articles/${id}`, article('private_gm', { section: 'gm' }))).status).toBe(403);
    expect((await alice.get(`${base}/articles/${id}`)).status).toBe(200);
    // Ist die Autorin selbst Spielleiterin, geht es
    await gm.patch(`${base}/members/${alice.userId}`, { role: 'gm' });
    expect((await gm.put(`${base}/articles/${id}`, article('private_gm', { section: 'gm' }))).status).toBe(200);
    expect((await alice.get(`${base}/articles/${id}`)).status).toBe(200);
  });
});

describe('Bereich Spielleiter', () => {
  it('ist für Spieler komplett gesperrt', async () => {
    const { base, gm, alice } = await setupGroup(makeApp());
    const id = (await gm.post(`${base}/articles`, article('public', { section: 'gm' }))).body.id;
    expect((await alice.get(`${base}/articles?section=gm`)).status).toBe(403);
    expect((await alice.get(`${base}/folders?section=gm`)).status).toBe(403);
    expect((await alice.get(`${base}/articles/${id}`)).status).toBe(404);
    expect((await alice.post(`${base}/articles`, article('public', { section: 'gm' }))).status).toBe(403);
    expect((await alice.post(`${base}/folders`, { section: 'gm', path: 'x' })).status).toBe(403);
    // Eigenen Artikel in den SL-Bereich verschieben geht auch nicht
    const own = (await alice.post(`${base}/articles`, article('public'))).body.id;
    expect((await alice.put(`${base}/articles/${own}`, article('public', { section: 'gm' }))).status).toBe(403);
  });

  it('hält private Notizen auch unter Spielleitern privat', async () => {
    const { base, gm, alice } = await setupGroup(makeApp());
    await gm.patch(`${base}/members/${alice.userId}`, { role: 'gm' });
    await gm.post(`${base}/articles`, article('private', { section: 'gm' }));
    await gm.post(`${base}/articles`, article('private_gm', { section: 'gm' }));
    expect((await alice.get(`${base}/articles?section=gm`)).body).toHaveLength(1);
  });
});

describe('Artikel von Mitgliedern, die ihren Zugriff verlieren', () => {
  it('gehen beim Entfernen an die Spielleiter über, damit Ordner wieder leer werden können', async () => {
    const { base, gm, alice } = await setupGroup(makeApp());
    await alice.post(`${base}/folders`, { section: 'characters', path: 'ali' });
    const id = (await alice.post(`${base}/articles`, article('private', { path: 'ali' }))).body.id;
    expect((await gm.get(`${base}/articles/${id}`)).status).toBe(404);

    expect((await gm.del(`${base}/members/${alice.userId}`)).status).toBe(200);
    expect((await alice.get(`${base}/articles/${id}`)).status).toBe(403);
    expect((await gm.get(`${base}/articles/${id}`)).body.visibility).toBe('private_gm');
    expect((await gm.del(`${base}/articles/${id}`)).status).toBe(200);
    expect((await gm.del(`${base}/folders?section=characters&path=ali`)).status).toBe(200);
  });

  it('gehen beim Degradieren nur im SL-Bereich über', async () => {
    const { base, gm, alice } = await setupGroup(makeApp());
    await gm.patch(`${base}/members/${alice.userId}`, { role: 'gm' });
    const secret = (await alice.post(`${base}/articles`, article('private', { section: 'gm', path: 'plot' }))).body.id;
    const diary = (await alice.post(`${base}/articles`, article('private'))).body.id;

    await gm.patch(`${base}/members/${alice.userId}`, { role: 'player' });
    // Der Artikel bleibt im SL-Bereich und muss dort für die Spielleiter bearbeitbar bleiben
    const edited = await gm.put(`${base}/articles/${secret}`, article('private_gm', { section: 'gm', path: 'plot', title: 'Neu' }));
    expect(edited.body.title).toBe('Neu');
    expect((await alice.get(`${base}/articles/${secret}`)).status).toBe(404);
    expect((await gm.get(`${base}/articles/${secret}`)).body.visibility).toBe('private_gm');
    expect((await gm.get(`${base}/articles/${diary}`)).status).toBe(404);
    expect((await alice.get(`${base}/articles/${diary}`)).body.visibility).toBe('private');
  });
});
