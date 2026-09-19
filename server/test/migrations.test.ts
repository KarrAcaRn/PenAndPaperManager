import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { emptySheet } from '@pnp/shared';
import { openDb } from '../src/db.ts';
import { buildApp } from '../src/app.ts';
import { loginAs } from './helpers.ts';

const MIGRATIONS = join(import.meta.dirname, '../src/migrations');

/** Legt eine Datenbank auf dem Stand bestimmter Migrationen an, damit spätere Migrationen echte Altdaten sehen. */
function dbAtVersion(file: string, versions: string[], seed: string): void {
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE schema_migrations (version TEXT PRIMARY KEY)');
  for (const v of versions) {
    db.exec(readFileSync(join(MIGRATIONS, v), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(v);
  }
  db.exec(seed);
  db.close();
}

describe('Migration 002: NPCs und Orte werden zu Notizen', () => {
  let dir: string | undefined;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it('verschiebt Artikel und Ordner in Unterordner von "Notizen"', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pnp-'));
    const file = join(dir, 'app.db');
    dbAtVersion(
      file,
      ['001_init.sql'],
      `
      INSERT INTO users (id, email) VALUES (1, 'gm@test.de'), (2, 'alice@test.de');
      INSERT INTO groups (id, name) VALUES (1, 'Runde');
      INSERT INTO memberships VALUES (1, 1, 'gm'), (1, 2, 'player');
      INSERT INTO articles (id, group_id, section, path, title, visibility, author_id) VALUES
        (1, 1, 'npcs', '', 'Wirt', 'public', 1),
        (2, 1, 'npcs', 'Stadt/Adel', 'Graf', 'public', 1),
        (3, 1, 'locations', 'Stadt', 'Taverne', 'private', 2),
        (4, 1, 'characters', 'Helden', 'Alrik', 'public', 2),
        (5, 1, 'gm', '', 'Plan', 'private_gm', 1);
      INSERT INTO folders (group_id, section, path, created_by, created_at) VALUES
        (1, 'locations', 'Wald', 2, '2026-01-02 00:00:00'),
        (1, 'locations', 'Wald/Lichtung', 1, '2026-01-01 00:00:00'),
        (1, 'characters', 'Helden', 2, '2026-01-01 00:00:00');
      `,
    );

    const db = openDb(file);
    const articles = db.prepare('SELECT id, section, path FROM articles ORDER BY id').all();
    expect(articles.map((a) => ({ ...a }))).toEqual([
      { id: 1, section: 'notes', path: 'NPCs' },
      { id: 2, section: 'notes', path: 'NPCs/Stadt/Adel' },
      { id: 3, section: 'notes', path: 'Orte/Stadt' },
      { id: 4, section: 'characters', path: 'Helden' },
      { id: 5, section: 'gm', path: '' },
    ]);
    const folders = db.prepare('SELECT section, path, created_by FROM folders ORDER BY section, path').all();
    expect(folders.map((f) => ({ ...f }))).toEqual([
      { section: 'characters', path: 'Helden', created_by: 2 },
      { section: 'notes', path: 'Orte', created_by: 1 },
      { section: 'notes', path: 'Orte/Wald', created_by: 2 },
      { section: 'notes', path: 'Orte/Wald/Lichtung', created_by: 1 },
    ]);
    expect(() => db.prepare(`INSERT INTO folders (group_id, section, path, created_by) VALUES (1, 'npcs', 'x', 1)`).run()).toThrow();

    // Über die API sieht Alice ihre private Taverne weiterhin, jetzt unter Notizen/Orte/Stadt
    const app = buildApp(db);
    const alice = await loginAs(app, 'alice@test.de');
    const titles = (await alice.get('/api/groups/1/articles?section=notes&path=Orte/Stadt')).body.map((a: any) => a.title);
    expect(titles).toEqual(['Taverne']);
    db.close();
  });

  it('Migration 003 (FATE-Bögen) läuft danach auf alten Daten und erlaubt Bögen für ehemalige NPC-Artikel', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pnp-'));
    const file = join(dir, 'app.db');
    dbAtVersion(
      file,
      ['001_init.sql'],
      `
      INSERT INTO users (id, email) VALUES (1, 'gm@test.de');
      INSERT INTO groups (id, name) VALUES (1, 'Runde');
      INSERT INTO memberships VALUES (1, 1, 'gm');
      INSERT INTO articles (id, group_id, section, path, title, visibility, author_id) VALUES
        (1, 1, 'npcs', '', 'Wirt', 'public', 1);
      `,
    );

    const db = openDb(file);
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()!.n).toBe(3);
    const app = buildApp(db);
    const gm = await loginAs(app, 'gm@test.de');
    const sheet = (await gm.get('/api/groups/1/articles/1/sheet')).status;
    expect(sheet).toBe(404);
    const created = await gm.post('/api/groups/1/articles/1/sheet', emptySheet('Wirt'));
    expect(created.status).toBe(201);
    db.close();
  });
});
