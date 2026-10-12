import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDb, type Db } from '../src/db.ts';
import { buildApp } from '../src/app.ts';
import { SESSION_COOKIE } from '../src/auth.ts';
import { cleanPageText, extractRulebook, ftsQuery, importRulebook, rulebookFile } from '../src/rulebooks.ts';
import { loginAs } from './helpers.ts';
import { makePdf } from './pdf.ts';

const BOOK = makePdf(
  [
    ['Inhalt'],
    ['Aspekte', 'Aspekte sind kurze Sätze über deinen Charakter.', 'Ein Aspekt ist immer wahr.'],
    ['Konflikte', 'Wer angreift, würfelt gegen die Verteidigung.', 'Konsequenzen fangen Stress ab.'],
  ],
  {
    firstLabel: 7,
    outline: [
      { title: 'Aspekte und Fate-Punkte', page: 2 },
      { title: 'Konflikte', page: 3 },
      { title: 'Angreifen', page: 3, level: 1 },
    ],
  },
);

describe('Regelwerk aus PDF lesen', () => {
  it('liest Text, gedruckte Seitenzahlen und Gliederung', async () => {
    const book = await extractRulebook(BOOK);
    expect(book.pageCount).toBe(3);
    expect(book.chapters).toEqual([
      { title: 'Aspekte und Fate-Punkte', page: 2, label: '8', level: 0 },
      { title: 'Konflikte', page: 3, label: '9', level: 0 },
      { title: 'Angreifen', page: 3, label: '9', level: 1 },
    ]);
    expect(book.pages.map((p) => [p.page, p.label, p.chapter])).toEqual([
      [1, '7', ''],
      [2, '8', 'Aspekte und Fate-Punkte'],
      [3, '9', 'Konflikte › Angreifen'],
    ]);
    expect(book.pages[1].body).toContain('Aspekte sind kurze Sätze über deinen Charakter.');
  });

  it('nimmt ohne Seitenzahlen und Gliederung die PDF-Seiten', async () => {
    const book = await extractRulebook(makePdf([['Eins'], ['Zwei']]));
    expect(book.chapters).toEqual([]);
    expect(book.pages.map((p) => p.label)).toEqual(['1', '2']);
  });

  it('fügt Silbentrennung zusammen und normalisiert Kapitälchen', () => {
    expect(cleanPageText('des Cha-\nrakters und Fate-\nPunkte')).toBe('des Charakters und Fate-Punkte');
    expect(cleanPageText('Eigenschaften des Cha -\nrakters')).toBe('Eigenschaften des Charakters');
    expect(cleanPageText('Ein-\nund Ausgang, Hin-\noder Rückweg')).toBe('Ein- und Ausgang, Hin- oder Rückweg');
    expect(cleanPageText('wie folgt: \u0007\u0007 Bei einem\u0001 Fehlschlag')).toBe('wie folgt: Bei einem Fehlschlag');
    expect(cleanPageText('NSCs und SLs')).toBe('NSCs und SLs');
    expect(cleanPageText('Aspekte sind wAhr, ein schArfschütze. BÖser Biss, AufhÖrt. Fate KOMPAKT, Überwinden-Aktion')).toBe(
      'Aspekte sind wahr, ein scharfschütze. Böser Biss, Aufhört. Fate KOMPAKT, Überwinden-Aktion',
    );
  });

  it('baut aus Eingaben eine sichere FTS-Abfrage', () => {
    expect(ftsQuery('  Konsequenz   Stress ')).toBe('"Konsequenz"* "Stress"*');
    expect(ftsQuery('"a" OR b* NEAR(')).toBe('"a"* "OR"* "b"* "NEAR"*');
    expect(ftsQuery(' -*" ')).toBeNull();
    // zerlegte Umlaute (NFD), wie sie manche Eingaben liefern
    expect(ftsQuery('u\u0308berwinden')).toBe('"überwinden"*');
  });
});

describe('Regelwerk-API', () => {
  let dir: string;
  let db: Db;
  let app: FastifyInstance;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pnp-rules-'));
    db = openDb(':memory:');
    app = buildApp(db, { rulebookDir: dir });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** Regelwerke sieht nur, wer in mindestens einer Gruppe ist */
  async function member(email = 'alice@test.de') {
    const user = await loginAs(app, email);
    await user.post('/api/groups', { name: 'Runde' });
    return user;
  }

  it('verlangt einen Login und die Mitgliedschaft in einer Gruppe', async () => {
    await importRulebook(db, dir, 'Fate Kompakt', BOOK);
    const urls = ['/api/rulebooks', '/api/rulebooks/search?q=x', '/api/rulebooks/1/pdf'];
    for (const url of urls) expect((await app.inject({ url })).statusCode).toBe(401);
    const loner = await loginAs(app, 'fremd@test.de');
    for (const url of urls) expect(await loner.get(url)).toEqual({ status: 403, body: { error: 'Nur für Mitglieder einer Gruppe' } });
  });

  it('wartet auf Sperren anderer Verbindungen (Import neben dem laufenden Server)', () => {
    const file = join(dir, 'app.db');
    expect(openDb(file).prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 5000 });
  });

  it('listet Regelwerke mit Inhaltsverzeichnis und liefert das PDF aus', async () => {
    const book = await importRulebook(db, dir, 'Fate Kompakt (2022)', BOOK);
    const user = await member();
    const list = await user.get('/api/rulebooks');
    expect(list.body).toEqual([expect.objectContaining({ id: book.id, title: 'Fate Kompakt (2022)', pageCount: 3 })]);
    expect(list.body[0].chapters).toHaveLength(3);

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'alice@test.de' } });
    const sid = login.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
    // Cache-Parameter ?v= wird ignoriert
    const pdf = await app.inject({ url: `/api/rulebooks/${book.id}/pdf?v=x`, cookies: { [SESSION_COOKIE]: sid } });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toBe("inline; filename*=UTF-8''Fate%20Kompakt%20%282022%29.pdf");
    expect(new Uint8Array(pdf.rawPayload)).toEqual(BOOK);

    expect((await user.get('/api/rulebooks/999/pdf')).status).toBe(404);
    rmSync(rulebookFile(dir, book.id));
    expect((await user.get(`/api/rulebooks/${book.id}/pdf`)).body).toEqual({ error: 'Die PDF-Datei des Regelwerks fehlt' });
  });

  it('sucht im Text mit Präfixen, Umlauten und Kapiteln und markiert die Treffer', async () => {
    const book = await importRulebook(db, dir, 'Fate Kompakt', BOOK);
    const user = await member();
    const search = async (q: string, rulebookId?: number) =>
      (await user.get(`/api/rulebooks/search?q=${encodeURIComponent(q)}${rulebookId ? `&rulebookId=${rulebookId}` : ''}`)).body;

    const hits = await search('konseq');
    expect(hits).toEqual([
      {
        rulebookId: book.id,
        page: 3,
        label: '9',
        chapter: 'Konflikte › Angreifen',
        snippet: expect.arrayContaining([{ text: 'Konsequenzen', mark: true }]),
      },
    ]);
    // Treffer in Seitenreihenfolge, auch wenn eine spätere Seite besser passt
    const other = await importRulebook(db, dir, 'Stressbuch', makePdf([
      ['Eine Randnotiz zu Stress zwischen vielen anderen Wörtern, die mit der Suche nichts zu tun haben.'],
      ['Nichts'],
      ['Stress, Stress und noch mehr Stress.'],
    ]));
    expect((await search('Stress', other.id)).map((h: { page: number }) => h.page)).toEqual([1, 3]);
    expect((await search('Stress')).map((h: { rulebookId: number; page: number }) => [h.rulebookId, h.page])).toEqual([
      [book.id, 3],
      [other.id, 1],
      [other.id, 3],
    ]);
    // ohne Umlaut, mehrere Wörter müssen alle vorkommen
    expect((await search('uber charakter')).map((h: { page: number }) => h.page)).toEqual([2]);
    expect(await search('Aspekt Stress')).toEqual([]);
    // Kapiteltitel zählen mit: "Fate-Punkte" steht nur in der Gliederung
    expect((await search('Fate Punkte')).map((h: { page: number }) => h.page)).toEqual([2]);
    // FTS-Syntax in der Eingabe führt nicht zu Fehlern
    expect(await search('"( NEAR *')).toEqual([]);
    expect(await search('   ')).toEqual([]);
    expect(await search('konseq', 999)).toEqual([]);
    expect(await search('konseq', book.id)).toHaveLength(1);
    expect((await user.get(`/api/rulebooks/search?q=${'x'.repeat(201)}`)).status).toBe(400);
  });

  it('ersetzt beim erneuten Einspielen Text und Datei, die ID bleibt', async () => {
    const first = await importRulebook(db, dir, 'Fate Kompakt', BOOK);
    const newer = makePdf([['Neue Fassung mit Zuständen']]);
    const second = await importRulebook(db, dir, 'Fate Kompakt', newer);
    expect(second).toEqual(expect.objectContaining({ id: first.id, pageCount: 1, chapters: [] }));
    expect(readFileSync(rulebookFile(dir, first.id))).toEqual(Buffer.from(newer));
    expect(existsSync(`${rulebookFile(dir, first.id)}.tmp`)).toBe(false);

    const user = await member();
    expect((await user.get('/api/rulebooks/search?q=Konsequenzen')).body).toEqual([]);
    expect((await user.get('/api/rulebooks/search?q=Zustand')).body).toHaveLength(1);
  });
});
