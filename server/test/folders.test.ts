import { describe, expect, it } from 'vitest';
import type { Visibility } from '@pnp/shared';
import { article, makeApp, setupGroup } from './helpers.ts';

const paths = (res: { body: { path: string }[] }) => res.body.map((f) => f.path);

describe('Ordner', () => {
  it('legt Elternordner mit an und behält leere Ordner', async () => {
    const { base, alice, bob } = await setupGroup(makeApp());
    expect((await alice.post(`${base}/folders`, { section: 'locations', path: 'bar/foo' })).status).toBe(201);
    expect(paths(await bob.get(`${base}/folders?section=locations`))).toEqual(['bar', 'bar/foo']);
    expect(paths(await bob.get(`${base}/folders?section=npcs`))).toEqual([]);
  });

  it('filtert Artikel nach Ordner', async () => {
    const { base, alice } = await setupGroup(makeApp());
    const mk = (title: string, path: string) =>
      alice.post(`${base}/articles`, article('public', { section: 'locations', path, title }));
    await mk('Wurzel', '');
    await mk('Tief', 'bar/foo');
    const titles = async (q: string) => (await alice.get(`${base}/articles?section=locations${q}`)).body.map((a: any) => a.title);
    expect(await titles('')).toEqual(['Tief', 'Wurzel']);
    expect(await titles('&path=')).toEqual(['Wurzel']);
    expect(await titles('&path=bar')).toEqual([]);
    expect(await titles('&path=bar/foo')).toEqual(['Tief']);
  });

  it('verrät über private Artikel keine Ordnernamen', async () => {
    const { base, gm, alice, bob } = await setupGroup(makeApp());
    const mk = (path: string, visibility: Visibility) => alice.post(`${base}/articles`, article(visibility, { section: 'npcs', path }));
    await mk('geheim/x', 'private');
    await mk('halb/y', 'private_gm');
    expect(paths(await alice.get(`${base}/folders?section=npcs`))).toEqual(['geheim', 'geheim/x', 'halb', 'halb/y']);
    expect(paths(await gm.get(`${base}/folders?section=npcs`))).toEqual(['halb', 'halb/y']);
    expect(paths(await bob.get(`${base}/folders?section=npcs`))).toEqual([]);
    // Auch Löschversuche verraten nichts
    expect((await gm.del(`${base}/folders?section=npcs&path=geheim`)).status).toBe(404);
    expect((await gm.del(`${base}/folders?section=npcs&path=halb`)).status).toBe(409);
  });

  it('löscht nur leere Ordner und nur durch Ersteller oder Spielleiter', async () => {
    const { base, gm, alice, bob } = await setupGroup(makeApp());
    await alice.post(`${base}/folders`, { section: 'npcs', path: 'a/b' });
    expect((await bob.del(`${base}/folders?section=npcs&path=a/b`)).status).toBe(403);
    expect((await alice.del(`${base}/folders?section=npcs&path=a`)).status).toBe(409);
    expect((await alice.del(`${base}/folders?section=npcs&path=a/b`)).status).toBe(200);
    expect((await gm.del(`${base}/folders?section=npcs&path=a`)).status).toBe(200);
    expect((await gm.del(`${base}/folders?section=npcs&path=a`)).status).toBe(404);
  });

  it('zieht beim Umbenennen Unterordner und Artikel mit', async () => {
    const { base, gm, alice, bob } = await setupGroup(makeApp());
    await alice.post(`${base}/folders`, { section: 'npcs', path: 'alt/sub' });
    await alice.post(`${base}/folders`, { section: 'npcs', path: 'alt_x' });
    const id = (await bob.post(`${base}/articles`, article('private', { section: 'npcs', path: 'alt/sub' }))).body.id;

    expect((await bob.patch(`${base}/folders`, { section: 'npcs', path: 'alt', newPath: 'neu' })).status).toBe(403);
    expect((await alice.patch(`${base}/folders`, { section: 'npcs', path: 'alt', newPath: 'alt/drin' })).status).toBe(400);
    expect((await alice.patch(`${base}/folders`, { section: 'npcs', path: 'alt', newPath: 'alt_x' })).status).toBe(409);
    expect((await alice.patch(`${base}/folders`, { section: 'npcs', path: 'alt', newPath: 'welt/neu' })).status).toBe(200);

    expect(paths(await gm.get(`${base}/folders?section=npcs`))).toEqual(['alt_x', 'welt', 'welt/neu', 'welt/neu/sub']);
    expect((await bob.get(`${base}/articles/${id}`)).body.path).toBe('welt/neu/sub');
  });

  it('lässt Ersteller umbenennen; fremde Unterordner ziehen mit und behalten ihren Besitzer', async () => {
    const { base, alice, bob } = await setupGroup(makeApp());
    await alice.post(`${base}/folders`, { section: 'npcs', path: 'A' });
    await bob.post(`${base}/folders`, { section: 'npcs', path: 'A/bobs' });
    expect((await alice.patch(`${base}/folders`, { section: 'npcs', path: 'A', newPath: 'B' })).status).toBe(200);
    const folders = (await bob.get(`${base}/folders?section=npcs`)).body;
    expect(folders).toEqual([
      { path: 'B', explicit: true, canManage: false },
      { path: 'B/bobs', explicit: true, canManage: true },
    ]);
    expect((await alice.del(`${base}/folders?section=npcs&path=B/bobs`)).status).toBe(403);
  });

  it('behandelt Präfixe, %, _ und Groß-/Kleinschreibung in Ordnernamen exakt', async () => {
    const { base, gm } = await setupGroup(makeApp());
    for (const path of ['B', 'Bx/kind', 'b', '50%', '50%/sub', '500', 'a_c', 'abc']) {
      await gm.post(`${base}/folders`, { section: 'npcs', path });
    }
    expect((await gm.patch(`${base}/folders`, { section: 'npcs', path: 'B', newPath: 'By' })).status).toBe(200);
    expect((await gm.patch(`${base}/folders`, { section: 'npcs', path: '50%', newPath: 'Rabatt' })).status).toBe(200);
    expect((await gm.del(`${base}/folders?section=npcs&path=a_c`)).status).toBe(200);
    expect(paths(await gm.get(`${base}/folders?section=npcs`))).toEqual(
      ['500', 'abc', 'b', 'Bx', 'Bx/kind', 'By', 'Rabatt', 'Rabatt/sub'].sort((x, y) => x.localeCompare(y, 'de')),
    );
  });

  it('lehnt leere und ungültige Ordnerpfade ab, ohne die Wurzel anzufassen', async () => {
    const { base, gm } = await setupGroup(makeApp());
    await gm.post(`${base}/folders`, { section: 'npcs', path: 'a' });
    expect((await gm.post(`${base}/folders`, { section: 'npcs', path: ' / ' })).status).toBe(400);
    expect((await gm.post(`${base}/folders`, { section: 'npcs', path: '\u200b' })).status).toBe(400);
    expect((await gm.patch(`${base}/folders`, { section: 'npcs', path: '/', newPath: 'x' })).status).toBe(400);
    expect((await gm.patch(`${base}/folders`, { section: 'npcs', path: 'a', newPath: '/' })).status).toBe(400);
    expect((await gm.patch(`${base}/folders`, { section: 'npcs', path: 'a', newPath: 'a' })).status).toBe(400);
    expect((await gm.del(`${base}/folders?section=npcs&path=/`)).status).toBe(400);
    expect(paths(await gm.get(`${base}/folders?section=npcs`))).toEqual(['a']);
  });

  it('führt optisch gleiche Unicode-Namen zusammen', async () => {
    const { base, gm } = await setupGroup(makeApp());
    await gm.post(`${base}/folders`, { section: 'npcs', path: 'St\u00e4dte' });
    await gm.post(`${base}/folders`, { section: 'npcs', path: 'Sta\u0308dte' });
    expect(paths(await gm.get(`${base}/folders?section=npcs`))).toEqual(['St\u00e4dte']);
  });

  it('verweigert Umbenennen, wenn Pfade darunter zu lang würden', async () => {
    const { base, gm } = await setupGroup(makeApp());
    const deep = ['a', 'x'.repeat(60), 'y'.repeat(60), 'z'.repeat(60)].join('/');
    const id = (await gm.post(`${base}/articles`, article('public', { section: 'npcs', path: deep }))).body.id;
    await gm.post(`${base}/folders`, { section: 'npcs', path: 'a' });
    const res = await gm.patch(`${base}/folders`, { section: 'npcs', path: 'a', newPath: 'n'.repeat(60) });
    expect(res.status).toBe(400);
    expect((await gm.get(`${base}/articles/${id}`)).body.path).toBe(deep);
    expect((await gm.patch(`${base}/folders`, { section: 'npcs', path: 'a', newPath: 'kurz' })).status).toBe(200);
  });

  it('misst die Pfadlänge beim Umbenennen auch bei Emoji richtig', async () => {
    const { base, gm } = await setupGroup(makeApp());
    const deep = ['a', '😀'.repeat(30), '😁'.repeat(30), '😂'.repeat(30)].join('/');
    const id = (await gm.post(`${base}/articles`, article('public', { section: 'npcs', path: deep }))).body.id;
    expect((await gm.patch(`${base}/folders`, { section: 'npcs', path: 'a', newPath: 'b'.repeat(60) })).status).toBe(400);
    expect((await gm.get(`${base}/articles/${id}`)).body.path).toBe(deep);
  });

  it('macht implizite Ordner beim Umbenennen nicht für alle sichtbar', async () => {
    const { base, gm, bob } = await setupGroup(makeApp());
    await gm.post(`${base}/articles`, article('private_gm', { section: 'npcs', path: 'Verrat' }));
    const res = await gm.patch(`${base}/folders`, { section: 'npcs', path: 'Verrat', newPath: 'Verrat von Bob' });
    expect(res.body).toEqual({ path: 'Verrat von Bob', explicit: false, canManage: true });
    expect(paths(await bob.get(`${base}/folders?section=npcs`))).toEqual([]);
    expect(paths(await gm.get(`${base}/folders?section=npcs`))).toEqual(['Verrat von Bob']);
  });

  it('meldet Kollisionen mit sichtbaren Ordnern, verrät aber keine unsichtbaren', async () => {
    const { base, alice, bob } = await setupGroup(makeApp());
    await bob.post(`${base}/articles`, article('public', { section: 'npcs', path: 'pub' }));
    await bob.post(`${base}/articles`, article('private', { section: 'npcs', path: 'geheim' }));
    await alice.post(`${base}/folders`, { section: 'npcs', path: 'meins' });
    expect((await alice.patch(`${base}/folders`, { section: 'npcs', path: 'meins', newPath: 'pub' })).status).toBe(409);
    expect((await alice.patch(`${base}/folders`, { section: 'npcs', path: 'meins', newPath: 'geheim' })).status).toBe(200);
  });

  it('behandelt für den Anfragenden unsichtbare bzw. fremde implizite Ordner als 404 bzw. 403', async () => {
    const { base, gm, alice, bob } = await setupGroup(makeApp());
    await bob.post(`${base}/articles`, article('private', { section: 'npcs', path: 'geheim' }));
    await bob.post(`${base}/articles`, article('public', { section: 'npcs', path: 'pub' }));
    expect((await gm.patch(`${base}/folders`, { section: 'npcs', path: 'geheim', newPath: 'x' })).status).toBe(404);
    expect((await alice.patch(`${base}/folders`, { section: 'npcs', path: 'pub', newPath: 'x' })).status).toBe(403);
    expect((await alice.del(`${base}/folders?section=npcs&path=pub`)).status).toBe(403);
  });
});
