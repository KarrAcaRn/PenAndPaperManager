import { describe, expect, it } from 'vitest';
import { href, navigate, parseHash, router } from '../src/lib/router.svelte.ts';

describe('parseHash', () => {
  it('fällt auf die Gruppenauswahl zurück', () => {
    for (const hash of ['', '#', '#/', '#/quatsch', '#/g/abc/notes']) {
      expect(parseHash(hash)).toEqual({ name: 'groups' });
    }
  });

  it('stürzt bei kaputten %-Sequenzen nicht ab', () => {
    expect(parseHash('#/g/1/characters/f/50%')).toEqual({ name: 'folder', gid: 1, section: 'characters', path: '50%' });
    expect(parseHash('#/g/1/%E0%A4%A/x')).toMatchObject({ name: 'folder', gid: 1 });
  });

  it('erkennt Ordner', () => {
    // Lesezeichen aus der Zeit vor "Notizen"
    expect(parseHash('#/g/3/npcs')).toEqual({ name: 'folder', gid: 3, section: 'notes', path: 'NPCs' });
    expect(parseHash('#/g/3/locations/f/Stadt')).toEqual({ name: 'folder', gid: 3, section: 'notes', path: 'Orte/Stadt' });
    expect(parseHash('#/g/3/npcs/new')).toEqual({ name: 'new', gid: 3, section: 'notes', path: 'NPCs' });
    expect(parseHash('#/g/3/npcs/a/5/edit')).toEqual({ name: 'article', gid: 3, section: 'notes', id: 5, edit: true });
    expect(parseHash('#/g/3/notes')).toEqual({ name: 'folder', gid: 3, section: 'notes', path: '' });
    expect(parseHash('#/g/3/notes/f/bar/foo')).toEqual({ name: 'folder', gid: 3, section: 'notes', path: 'bar/foo' });
    expect(parseHash('#/g/3')).toEqual({ name: 'folder', gid: 3, section: 'characters', path: '' });
    expect(parseHash('#/g/3/unbekannt')).toEqual({ name: 'folder', gid: 3, section: 'characters', path: '' });
  });

  it('erkennt Artikel, Editor, Neu und Verwaltung', () => {
    expect(parseHash('#/g/3/gm/a/7')).toEqual({ name: 'article', gid: 3, section: 'gm', id: 7, edit: false });
    expect(parseHash('#/g/3/gm/a/7/edit')).toEqual({ name: 'article', gid: 3, section: 'gm', id: 7, edit: true });
    expect(parseHash('#/g/3/notes/new/bar/foo')).toEqual({ name: 'new', gid: 3, section: 'notes', path: 'bar/foo' });
    expect(parseHash('#/g/3/notes/new')).toEqual({ name: 'new', gid: 3, section: 'notes', path: '' });
    expect(parseHash('#/g/3/manage')).toEqual({ name: 'manage', gid: 3 });
    expect(parseHash('#/g/3/skills')).toEqual({ name: 'skills', gid: 3 });
    expect(parseHash('#/admin')).toEqual({ name: 'admin' });
    expect(parseHash(href.skills(3))).toEqual({ name: 'skills', gid: 3 });
    expect(parseHash(href.rules(3))).toEqual({ name: 'rules', gid: 3 });
    expect(parseHash(href.admin())).toEqual({ name: 'admin' });
    expect(parseHash('#/settings')).toEqual({ name: 'settings' });
    expect(parseHash(href.settings())).toEqual({ name: 'settings' });
  });
});

describe('href', () => {
  it('ist die Umkehrung von parseHash, auch mit Sonderzeichen', () => {
    const path = 'Über uns/50% & mehr/a#b?c';
    expect(parseHash(href.folder(3, 'notes', path))).toEqual({ name: 'folder', gid: 3, section: 'notes', path });
    expect(parseHash(href.newArticle(3, 'notes', path))).toEqual({ name: 'new', gid: 3, section: 'notes', path });
    expect(parseHash(href.article(3, 'notes', 9))).toMatchObject({ name: 'article', id: 9, edit: false });
    expect(parseHash(href.edit(3, 'notes', 9))).toMatchObject({ name: 'article', id: 9, edit: true });
    expect(parseHash(href.manage(3))).toEqual({ name: 'manage', gid: 3 });
    expect(parseHash(href.groups())).toEqual({ name: 'groups' });
    expect(parseHash(href.group(3))).toEqual({ name: 'folder', gid: 3, section: 'characters', path: '' });
  });
});

describe('router', () => {
  it('folgt Hash-Änderungen', async () => {
    navigate(href.folder(5, 'notes', 'x'));
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(router.route).toEqual({ name: 'folder', gid: 5, section: 'notes', path: 'x' });
  });
});
