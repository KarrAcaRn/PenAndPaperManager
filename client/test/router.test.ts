import { describe, expect, it } from 'vitest';
import { href, navigate, parseHash, router } from '../src/lib/router.svelte.ts';

describe('parseHash', () => {
  it('fällt auf die Gruppenauswahl zurück', () => {
    for (const hash of ['', '#', '#/', '#/quatsch', '#/g/abc/npcs']) {
      expect(parseHash(hash)).toEqual({ name: 'groups' });
    }
  });

  it('stürzt bei kaputten %-Sequenzen nicht ab', () => {
    expect(parseHash('#/g/1/characters/f/50%')).toEqual({ name: 'folder', gid: 1, section: 'characters', path: '50%' });
    expect(parseHash('#/g/1/%E0%A4%A/x')).toMatchObject({ name: 'folder', gid: 1 });
  });

  it('erkennt Ordner', () => {
    expect(parseHash('#/g/3/npcs')).toEqual({ name: 'folder', gid: 3, section: 'npcs', path: '' });
    expect(parseHash('#/g/3/npcs/f/bar/foo')).toEqual({ name: 'folder', gid: 3, section: 'npcs', path: 'bar/foo' });
    expect(parseHash('#/g/3')).toEqual({ name: 'folder', gid: 3, section: 'characters', path: '' });
    expect(parseHash('#/g/3/unbekannt')).toEqual({ name: 'folder', gid: 3, section: 'characters', path: '' });
  });

  it('erkennt Artikel, Editor, Neu und Verwaltung', () => {
    expect(parseHash('#/g/3/gm/a/7')).toEqual({ name: 'article', gid: 3, section: 'gm', id: 7, edit: false });
    expect(parseHash('#/g/3/gm/a/7/edit')).toEqual({ name: 'article', gid: 3, section: 'gm', id: 7, edit: true });
    expect(parseHash('#/g/3/locations/new/bar/foo')).toEqual({ name: 'new', gid: 3, section: 'locations', path: 'bar/foo' });
    expect(parseHash('#/g/3/locations/new')).toEqual({ name: 'new', gid: 3, section: 'locations', path: '' });
    expect(parseHash('#/g/3/manage')).toEqual({ name: 'manage', gid: 3 });
  });
});

describe('href', () => {
  it('ist die Umkehrung von parseHash, auch mit Sonderzeichen', () => {
    const path = 'Über uns/50% & mehr/a#b?c';
    expect(parseHash(href.folder(3, 'npcs', path))).toEqual({ name: 'folder', gid: 3, section: 'npcs', path });
    expect(parseHash(href.newArticle(3, 'npcs', path))).toEqual({ name: 'new', gid: 3, section: 'npcs', path });
    expect(parseHash(href.article(3, 'npcs', 9))).toMatchObject({ name: 'article', id: 9, edit: false });
    expect(parseHash(href.edit(3, 'npcs', 9))).toMatchObject({ name: 'article', id: 9, edit: true });
    expect(parseHash(href.manage(3))).toEqual({ name: 'manage', gid: 3 });
    expect(parseHash(href.groups())).toEqual({ name: 'groups' });
    expect(parseHash(href.group(3))).toEqual({ name: 'folder', gid: 3, section: 'characters', path: '' });
  });
});

describe('router', () => {
  it('folgt Hash-Änderungen', async () => {
    navigate(href.folder(5, 'locations', 'x'));
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(router.route).toEqual({ name: 'folder', gid: 5, section: 'locations', path: 'x' });
  });
});
