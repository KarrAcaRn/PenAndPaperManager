import { describe, expect, it } from 'vitest';
import type { Visibility } from '@pnp/shared';
import { article, makeApp, setupGroup } from './helpers.ts';

const paths = (res: { body: { path: string }[] }) => res.body.map((f) => f.path);

describe('Ordner', () => {
  it('legt Elternordner mit an und behält leere Ordner', async () => {
    const { base, alice, bob } = await setupGroup(makeApp());
    expect((await alice.post(`${base}/folders`, { section: 'characters', path: 'bar/foo' })).status).toBe(201);
    expect(paths(await bob.get(`${base}/folders?section=characters`))).toEqual(['bar', 'bar/foo']);
    expect(paths(await bob.get(`${base}/folders?section=notes`))).toEqual(['NPCs', 'Orte', 'Sessions']);
  });

  it('filtert Artikel nach Ordner', async () => {
    const { base, alice } = await setupGroup(makeApp());
    const mk = (title: string, path: string) =>
      alice.post(`${base}/articles`, article('public', { section: 'characters', path, title }));
    await mk('Wurzel', '');
    await mk('Tief', 'bar/foo');
    const titles = async (q: string) => (await alice.get(`${base}/articles?section=characters${q}`)).body.map((a: any) => a.title);
    expect(await titles('')).toEqual(['Tief', 'Wurzel']);
    expect(await titles('&path=')).toEqual(['Wurzel']);
    expect(await titles('&path=bar')).toEqual([]);
    expect(await titles('&path=bar/foo')).toEqual(['Tief']);
  });

  it('zeigt allen im Bereich alle Ordner; ausgeblendet werden nur die Artikel darin', async () => {
    const { base, gm, alice, bob } = await setupGroup(makeApp());
    const mk = (path: string, visibility: Visibility) => alice.post(`${base}/articles`, article(visibility, { section: 'characters', path }));
    await mk('geheim/x', 'private');
    await mk('halb/y', 'private_gm');
    for (const user of [alice, gm, bob]) {
      expect(paths(await user.get(`${base}/folders?section=characters`))).toEqual(['geheim', 'geheim/x', 'halb', 'halb/y']);
    }
    expect((await bob.get(`${base}/articles?section=characters&path=geheim/x`)).body).toEqual([]);
    // Ordner mit (auch unsichtbaren) Artikeln lassen sich nicht löschen
    expect((await gm.del(`${base}/folders?section=characters&path=geheim/x`)).status).toBe(409);
  });

  it('legt beim Speichern eines Artikels fehlende Ordner an und verschiebt Artikel zwischen Bereichen', async () => {
    const { base, gm, bob } = await setupGroup(makeApp());
    const created = await gm.post(`${base}/articles`, article('public', { section: 'characters', path: ' neu / tief ' }));
    expect(created.body.path).toBe('neu/tief');
    expect(paths(await bob.get(`${base}/folders?section=characters`))).toEqual(['neu', 'neu/tief']);
    const moved = await gm.put(`${base}/articles/${created.body.id}`, article('public', { section: 'notes', path: 'NPCs/Wirte' }));
    expect(moved.body).toMatchObject({ section: 'notes', path: 'NPCs/Wirte' });
    expect(paths(await bob.get(`${base}/folders?section=notes`))).toEqual(['NPCs', 'NPCs/Wirte', 'Orte', 'Sessions']);
    // der alte Ordner bleibt (leer) bestehen
    expect(paths(await bob.get(`${base}/folders?section=characters`))).toEqual(['neu', 'neu/tief']);
    const root = await gm.put(`${base}/articles/${created.body.id}`, article('public', { section: 'notes', path: '' }));
    expect(root.body.path).toBe('');
  });

  it('löscht nur leere Ordner und nur durch Ersteller oder Spielleiter', async () => {
    const { base, gm, alice, bob } = await setupGroup(makeApp());
    await alice.post(`${base}/folders`, { section: 'characters', path: 'a/b' });
    expect((await bob.del(`${base}/folders?section=characters&path=a/b`)).status).toBe(403);
    expect((await alice.del(`${base}/folders?section=characters&path=a`)).status).toBe(409);
    expect((await alice.del(`${base}/folders?section=characters&path=a/b`)).status).toBe(200);
    expect((await gm.del(`${base}/folders?section=characters&path=a`)).status).toBe(200);
    expect((await gm.del(`${base}/folders?section=characters&path=a`)).status).toBe(404);
  });

  it('zieht beim Umbenennen Unterordner und Artikel mit', async () => {
    const { base, gm, alice, bob } = await setupGroup(makeApp());
    await alice.post(`${base}/folders`, { section: 'characters', path: 'alt/sub' });
    await alice.post(`${base}/folders`, { section: 'characters', path: 'alt_x' });
    const id = (await bob.post(`${base}/articles`, article('private', { section: 'characters', path: 'alt/sub' }))).body.id;

    expect((await bob.patch(`${base}/folders`, { section: 'characters', path: 'alt', newPath: 'neu' })).status).toBe(403);
    expect((await alice.patch(`${base}/folders`, { section: 'characters', path: 'alt', newPath: 'alt/drin' })).status).toBe(400);
    expect((await alice.patch(`${base}/folders`, { section: 'characters', path: 'alt', newPath: 'alt_x' })).status).toBe(409);
    expect((await alice.patch(`${base}/folders`, { section: 'characters', path: 'alt', newPath: 'welt/neu' })).status).toBe(200);

    expect(paths(await gm.get(`${base}/folders?section=characters`))).toEqual(['alt_x', 'welt', 'welt/neu', 'welt/neu/sub']);
    expect((await bob.get(`${base}/articles/${id}`)).body.path).toBe('welt/neu/sub');
  });

  it('lässt Ersteller umbenennen; fremde Unterordner ziehen mit und behalten ihren Besitzer', async () => {
    const { base, alice, bob } = await setupGroup(makeApp());
    await alice.post(`${base}/folders`, { section: 'characters', path: 'A' });
    await bob.post(`${base}/folders`, { section: 'characters', path: 'A/bobs' });
    expect((await alice.patch(`${base}/folders`, { section: 'characters', path: 'A', newPath: 'B' })).status).toBe(200);
    const folders = (await bob.get(`${base}/folders?section=characters`)).body;
    expect(folders).toEqual([
      { path: 'B', canManage: false },
      { path: 'B/bobs', canManage: true },
    ]);
    expect((await alice.del(`${base}/folders?section=characters&path=B/bobs`)).status).toBe(403);
  });

  it('behandelt Präfixe, %, _ und Groß-/Kleinschreibung in Ordnernamen exakt', async () => {
    const { base, gm } = await setupGroup(makeApp());
    for (const path of ['B', 'Bx/kind', 'b', '50%', '50%/sub', '500', 'a_c', 'abc']) {
      await gm.post(`${base}/folders`, { section: 'characters', path });
    }
    expect((await gm.patch(`${base}/folders`, { section: 'characters', path: 'B', newPath: 'By' })).status).toBe(200);
    expect((await gm.patch(`${base}/folders`, { section: 'characters', path: '50%', newPath: 'Rabatt' })).status).toBe(200);
    expect((await gm.del(`${base}/folders?section=characters&path=a_c`)).status).toBe(200);
    expect(paths(await gm.get(`${base}/folders?section=characters`))).toEqual(
      ['500', 'abc', 'b', 'Bx', 'Bx/kind', 'By', 'Rabatt', 'Rabatt/sub'].sort((x, y) => x.localeCompare(y, 'de')),
    );
  });

  it('lehnt leere und ungültige Ordnerpfade ab, ohne die Wurzel anzufassen', async () => {
    const { base, gm } = await setupGroup(makeApp());
    await gm.post(`${base}/folders`, { section: 'characters', path: 'a' });
    expect((await gm.post(`${base}/folders`, { section: 'characters', path: ' / ' })).status).toBe(400);
    expect((await gm.post(`${base}/folders`, { section: 'characters', path: '\u200b' })).status).toBe(400);
    expect((await gm.patch(`${base}/folders`, { section: 'characters', path: '/', newPath: 'x' })).status).toBe(400);
    expect((await gm.patch(`${base}/folders`, { section: 'characters', path: 'a', newPath: '/' })).status).toBe(400);
    expect((await gm.patch(`${base}/folders`, { section: 'characters', path: 'a', newPath: 'a' })).status).toBe(400);
    expect((await gm.del(`${base}/folders?section=characters&path=/`)).status).toBe(400);
    expect(paths(await gm.get(`${base}/folders?section=characters`))).toEqual(['a']);
  });

  it('führt optisch gleiche Unicode-Namen zusammen', async () => {
    const { base, gm } = await setupGroup(makeApp());
    await gm.post(`${base}/folders`, { section: 'characters', path: 'St\u00e4dte' });
    await gm.post(`${base}/folders`, { section: 'characters', path: 'Sta\u0308dte' });
    expect(paths(await gm.get(`${base}/folders?section=characters`))).toEqual(['St\u00e4dte']);
  });

  it('verweigert Umbenennen, wenn Pfade darunter zu lang würden', async () => {
    const { base, gm } = await setupGroup(makeApp());
    const deep = ['a', 'x'.repeat(60), 'y'.repeat(60), 'z'.repeat(60)].join('/');
    const id = (await gm.post(`${base}/articles`, article('public', { section: 'characters', path: deep }))).body.id;
    await gm.post(`${base}/folders`, { section: 'characters', path: 'a' });
    const res = await gm.patch(`${base}/folders`, { section: 'characters', path: 'a', newPath: 'n'.repeat(60) });
    expect(res.status).toBe(400);
    expect((await gm.get(`${base}/articles/${id}`)).body.path).toBe(deep);
    expect((await gm.patch(`${base}/folders`, { section: 'characters', path: 'a', newPath: 'kurz' })).status).toBe(200);
  });

  it('misst die Pfadlänge beim Umbenennen auch bei Emoji richtig', async () => {
    const { base, gm } = await setupGroup(makeApp());
    const deep = ['a', '😀'.repeat(30), '😁'.repeat(30), '😂'.repeat(30)].join('/');
    const id = (await gm.post(`${base}/articles`, article('public', { section: 'characters', path: deep }))).body.id;
    expect((await gm.patch(`${base}/folders`, { section: 'characters', path: 'a', newPath: 'b'.repeat(60) })).status).toBe(400);
    expect((await gm.get(`${base}/articles/${id}`)).body.path).toBe(deep);
  });

  it('lässt Artikel beim Speichern ohne Ordnerangabe im (inzwischen umbenannten) Ordner', async () => {
    const { base, gm, alice } = await setupGroup(makeApp());
    const id = (await alice.post(`${base}/articles`, article('public', { section: 'characters', path: 'alt' }))).body.id;
    await gm.patch(`${base}/folders`, { section: 'characters', path: 'alt', newPath: 'neu' });
    const { path: _, ...withoutPath } = article('public', { section: 'characters', title: 'Geändert' });
    expect((await alice.put(`${base}/articles/${id}`, withoutPath)).body).toMatchObject({ path: 'neu', title: 'Geändert' });
    expect(paths(await alice.get(`${base}/folders?section=characters`))).toEqual(['neu']);
    // ohne Ordner in einen anderen Bereich: unklar, wohin
    expect((await alice.put(`${base}/articles/${id}`, { ...withoutPath, section: 'notes' })).status).toBe(400);
  });

  it('meldet beim Anlegen eines vorhandenen fremden Ordners, dass man ihn nicht verwalten darf', async () => {
    const { base, alice, bob } = await setupGroup(makeApp());
    expect((await alice.post(`${base}/folders`, { section: 'characters', path: 'A' })).body).toEqual({ path: 'A', canManage: true });
    expect((await bob.post(`${base}/folders`, { section: 'characters', path: 'A' })).body).toEqual({ path: 'A', canManage: false });
  });

  it('meldet Kollisionen beim Umbenennen und Verschieben', async () => {
    const { base, alice, bob } = await setupGroup(makeApp());
    await bob.post(`${base}/articles`, article('private', { section: 'characters', path: 'geheim' }));
    await alice.post(`${base}/folders`, { section: 'characters', path: 'meins' });
    // auch Ordner mit nur unsichtbaren Artikeln sind sichtbar, eine Kollision verrät also nichts
    expect((await alice.patch(`${base}/folders`, { section: 'characters', path: 'meins', newPath: 'geheim' })).status).toBe(409);
    expect((await alice.patch(`${base}/folders`, { section: 'characters', path: 'meins', newPath: 'geheim/meins' })).status).toBe(200);
    expect((await alice.patch(`${base}/folders`, { section: 'characters', path: 'fehlt', newPath: 'x' })).status).toBe(404);
    // fremder Elternordner, eigener Unterordner: verschieben darf der Ersteller des Unterordners
    expect(paths(await bob.get(`${base}/folders?section=characters`))).toEqual(['geheim', 'geheim/meins']);
    expect((await alice.patch(`${base}/folders`, { section: 'characters', path: 'geheim', newPath: 'x' })).status).toBe(403);
  });

  it('trennt Ordner nach Gruppe und Bereich', async () => {
    const app = makeApp();
    const { base, gm } = await setupGroup(app);
    const other = (await gm.post('/api/groups', { name: 'Andere' })).body.id;
    await gm.post(`${base}/folders`, { section: 'characters', path: 'Gleich' });
    expect((await gm.post(`/api/groups/${other}/folders`, { section: 'characters', path: 'Gleich' })).status).toBe(201);
    expect((await gm.post(`${base}/folders`, { section: 'gm', path: 'Gleich' })).status).toBe(201);
    await gm.del(`/api/groups/${other}/folders?section=characters&path=Gleich`);
    expect(paths(await gm.get(`${base}/folders?section=characters`))).toEqual(['Gleich']);
    expect(paths(await gm.get(`${base}/folders?section=gm`))).toContain('Gleich');
  });
});
