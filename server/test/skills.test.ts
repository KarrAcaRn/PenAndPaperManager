import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.ts';
import { buildApp } from '../src/app.ts';
import { ADMIN_EMAIL, article, loginAs, makeApp, setupGroup } from './helpers.ts';

const names = (res: { body: { name: string }[] }) => res.body.map((s) => s.name);

describe('Fertigkeiten einer Gruppe', () => {
  it('sind anfangs leer, für Mitglieder lesbar und nur vom Spielleiter änderbar', async () => {
    const app = makeApp();
    const { base, gm, alice } = await setupGroup(app);
    expect((await alice.get(`${base}/skills`)).body).toEqual([]);
    expect((await alice.put(`${base}/skills`, { skills: [{ name: 'Laufen' }] })).status).toBe(403);
    expect((await alice.post(`${base}/skills/from-preset`, { presetId: 1 })).status).toBe(403);
    expect((await (await loginAs(app, 'fremd@test.de')).get(`${base}/skills`)).status).toBe(403);
    expect(names(await gm.put(`${base}/skills`, { skills: [{ name: ' Laufen ' }, { name: 'Reden' }] }))).toEqual(['Laufen', 'Reden']);
    expect(names(await alice.get(`${base}/skills`))).toEqual(['Laufen', 'Reden']);
  });

  it('behalten beim Umbenennen, Umsortieren und Tauschen ihre ID', async () => {
    const { base, gm } = await setupGroup(makeApp());
    const [a, b, c] = (await gm.put(`${base}/skills`, { skills: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] })).body;
    const res = await gm.put(`${base}/skills`, {
      skills: [{ id: b.id, name: 'A' }, { id: a.id, name: 'B' }, { name: 'Neu' }],
    });
    expect(res.body).toEqual([
      { id: b.id, name: 'A' },
      { id: a.id, name: 'B' },
      { id: expect.any(Number), name: 'Neu' },
    ]);
    expect(res.body.map((s: any) => s.id)).not.toContain(c.id);
  });

  it('behalten ihre ID, wenn man sie entfernt und gleichnamig neu eintippt', async () => {
    const { base, gm } = await setupGroup(makeApp());
    const [kampf, wissen] = (await gm.put(`${base}/skills`, { skills: [{ name: 'Kämpfen' }, { name: 'Wissen' }] })).body;
    const res = await gm.put(`${base}/skills`, { skills: [{ id: wissen.id, name: 'Wissen' }, { name: 'KÄMPFEN' }] });
    expect(res.body).toEqual([wissen, { id: kampf.id, name: 'KÄMPFEN' }]);
    // Wird ein anderer Eintrag in den alten Namen umbenannt, behält er seine ID und der neue bekommt eine neue
    const swap = await gm.put(`${base}/skills`, { skills: [{ id: wissen.id, name: 'Kämpfen' }, { name: 'Wissen' }] });
    expect(swap.body[0]).toEqual({ id: wissen.id, name: 'Kämpfen' });
    expect([wissen.id, kampf.id]).not.toContain(swap.body[1].id);
  });

  it('melden 409, wenn sich die Liste seit dem Laden geändert hat', async () => {
    const app = makeApp();
    const { base, gm } = await setupGroup(app);
    const admin = await loginAs(app, ADMIN_EMAIL);
    const presetId = (await admin.post('/api/presets', { name: 'Test', skills: ['Reden'] })).body.id;
    const geladen = (await gm.put(`${base}/skills`, { skills: [{ name: 'A' }] })).body;
    // Ein zweiter Spielleiter fügt "Magie" hinzu ...
    const neu = (await gm.put(`${base}/skills`, { skills: [...geladen, { name: 'Magie' }], expected: geladen })).body;
    // ... der erste speichert mit seinem alten Stand: abgelehnt statt "Magie" still zu löschen
    for (const res of [
      await gm.put(`${base}/skills`, { skills: [{ ...geladen[0], name: 'B' }], expected: geladen }),
      await gm.post(`${base}/skills/from-preset`, { presetId, expected: geladen }),
    ]) {
      expect(res.status).toBe(409);
    }
    expect((await gm.get(`${base}/skills`)).body).toEqual(neu);
    // Auch eine andere Reihenfolge ist ein anderer Stand
    expect((await gm.put(`${base}/skills`, { skills: neu, expected: [...neu].reverse() })).status).toBe(409);
    expect((await gm.post(`${base}/skills/from-preset`, { presetId, expected: neu })).status).toBe(200);
  });

  it('lehnt ungültige Listen ab und lässt die alte unverändert', async () => {
    const app = makeApp();
    const { base, gm } = await setupGroup(app);
    const [a] = (await gm.put(`${base}/skills`, { skills: [{ name: 'A' }] })).body;
    const other = await loginAs(app, 'anderer-sl@test.de');
    const otherGid = (await other.post('/api/groups', { name: 'Andere' })).body.id;
    const [foreign] = (await other.put(`/api/groups/${otherGid}/skills`, { skills: [{ name: 'Fremd' }] })).body;

    for (const skills of [
      [{ name: 'x' }, { name: 'X' }],
      [{ name: '  ' }],
      [{ id: a.id, name: 'A' }, { id: a.id, name: 'B' }],
      [{ id: foreign.id, name: 'Geklaut' }],
      [{ id: 99999, name: 'Gibtsnicht' }],
      [{ name: 'x'.repeat(41) }],
      Array.from({ length: 41 }, (_, i) => ({ name: `s${i}` })),
    ]) {
      expect((await gm.put(`${base}/skills`, { skills })).status, JSON.stringify(skills).slice(0, 60)).toBe(400);
    }
    expect((await gm.get(`${base}/skills`)).body).toEqual([a]);
    expect(names(await other.get(`/api/groups/${otherGid}/skills`))).toEqual(['Fremd']);
    expect((await gm.put(`${base}/skills`, { skills: [] })).body).toEqual([]);
  });

  it('übernimmt eine Variante und behält gleichnamige Fertigkeiten', async () => {
    const app = makeApp();
    const { base, gm } = await setupGroup(app);
    const admin = await loginAs(app, ADMIN_EMAIL);
    const presetId = (await admin.post('/api/presets', { name: 'Test', skills: ['Reden', 'Laufen', 'Kochen'] })).body.id;
    const [laufen] = (await gm.put(`${base}/skills`, { skills: [{ name: 'laufen' }, { name: 'Weg' }] })).body;

    const res = await gm.post(`${base}/skills/from-preset`, { presetId });
    expect(names(res)).toEqual(['Reden', 'Laufen', 'Kochen']);
    expect(res.body[1].id).toBe(laufen.id);
    expect((await gm.post(`${base}/skills/from-preset`, { presetId: 99999 })).status).toBe(404);
  });

  it('können beim Anlegen einer Gruppe aus einer Variante kommen', async () => {
    const app = makeApp();
    const gm = await loginAs(app, 'gm@test.de');
    const [preset] = (await gm.get('/api/presets')).body;
    const gid = (await gm.post('/api/groups', { name: 'Mit Variante', presetId: preset.id })).body.id;
    expect(names(await gm.get(`/api/groups/${gid}/skills`))).toEqual(preset.skills);
    // Die Standardordner gibt es auch mit Variante
    const folders = (await gm.get(`/api/groups/${gid}/folders?section=notes`)).body.map((f: { path: string }) => f.path);
    expect(folders).toEqual(['NPCs', 'Orte', 'Sessions']);
    // Unbekannte Variante: Gruppe wird gar nicht erst angelegt
    expect((await gm.post('/api/groups', { name: 'Kaputt', presetId: 99999 })).status).toBe(404);
    expect((await gm.get('/api/groups')).body).toHaveLength(1);
  });
});

describe('FATE-Bogen', () => {
  const sheet = (extra: object = {}) => ({
    name: 'Zoë',
    age: '31',
    pronouns: 'sie',
    aspects: { concept: 'Schmugglerin', trouble: '', relationship: '', free1: '', free2: '' },
    stunts: 'Schnellziehen',
    refresh: '3',
    stress: { physical: [true, false, false, false, false, false], mental: Array(6).fill(false) },
    consequences: { mild: '', moderate: 'Gebrochener Arm', severe: '', mild2: '' },
    skills: {},
    ...extra,
  });

  it('folgt der Sichtbarkeit und den Bearbeitungsrechten des Artikels', async () => {
    const { base, gm, alice, bob } = await setupGroup(makeApp());
    const id = (await alice.post(`${base}/articles`, article('private_gm'))).body.id;
    expect((await alice.get(`${base}/articles/${id}/sheet`)).status).toBe(404);
    expect((await alice.put(`${base}/articles/${id}/sheet`, { data: sheet(), version: 1 })).status).toBe(404);
    expect((await alice.post(`${base}/articles/${id}/sheet`, sheet())).body).toMatchObject({ version: 1, data: { name: 'Zoë' } });
    expect((await alice.get(`${base}/articles/${id}`)).body.hasSheet).toBe(true);
    expect((await alice.get(`${base}/articles?section=characters`)).body[0].hasSheet).toBe(true);

    expect((await gm.get(`${base}/articles/${id}/sheet`)).body.data.aspects.concept).toBe('Schmugglerin');
    expect((await gm.put(`${base}/articles/${id}/sheet`, { data: sheet({ name: 'vom SL' }), version: 1 })).body.version).toBe(2);
    expect((await bob.get(`${base}/articles/${id}/sheet`)).status).toBe(404);
    expect((await bob.put(`${base}/articles/${id}/sheet`, { data: sheet(), version: 2 })).status).toBe(404);
    expect((await bob.post(`${base}/articles/${id}/sheet`, sheet())).status).toBe(404);

    await alice.put(`${base}/articles/${id}`, article('public'));
    expect((await bob.get(`${base}/articles/${id}/sheet`)).body.data.name).toBe('vom SL');
    expect((await bob.put(`${base}/articles/${id}/sheet`, { data: sheet(), version: 2 })).status).toBe(403);
    expect((await bob.post(`${base}/articles/${id}/sheet`, sheet())).status).toBe(403);
    expect((await bob.del(`${base}/articles/${id}/sheet`)).status).toBe(403);

    expect((await alice.del(`${base}/articles/${id}/sheet`)).status).toBe(200);
    expect((await alice.get(`${base}/articles/${id}`)).body.hasSheet).toBe(false);
  });

  it('schützt vor gegenseitigem Überschreiben', async () => {
    const { base, gm, alice } = await setupGroup(makeApp());
    const id = (await alice.post(`${base}/articles`, article('private_gm'))).body.id;
    const url = `${base}/articles/${id}/sheet`;
    await alice.post(url, sheet());
    // Anlegen auf einer veralteten Seite darf den ausgefüllten Bogen nicht leeren
    expect((await gm.post(url, sheet({ name: '' }))).status).toBe(409);

    expect((await alice.put(url, { data: sheet({ name: 'Alice 1' }), version: 1 })).body.version).toBe(2);
    expect((await gm.put(url, { data: sheet({ name: 'SL veraltet' }), version: 1 })).status).toBe(409);
    expect((await gm.get(url)).body).toMatchObject({ version: 2, data: { name: 'Alice 1' } });
    expect((await gm.put(url, { data: sheet({ name: 'SL aktuell' }), version: 2 })).body.version).toBe(3);
  });

  it('gibt es nur in Charaktere und Notizen', async () => {
    const { base, gm } = await setupGroup(makeApp());
    const ort = (await gm.post(`${base}/articles`, article('public', { section: 'gm' }))).body.id;
    expect((await gm.post(`${base}/articles/${ort}/sheet`, sheet())).status).toBe(400);
    const npc = (await gm.post(`${base}/articles`, article('public', { section: 'notes' }))).body.id;
    expect((await gm.post(`${base}/articles/${npc}/sheet`, sheet())).status).toBe(201);
    // Mit Bogen nicht in einen Bereich ohne Bögen verschiebbar, zwischen Charaktere/Notizen schon
    expect((await gm.put(`${base}/articles/${npc}`, article('public', { section: 'gm' }))).status).toBe(400);
    expect((await gm.put(`${base}/articles/${npc}`, article('public', { section: 'characters' }))).status).toBe(200);
  });

  it('speichert Fertigkeitswerte und verwirft Werte gelöschter oder fremder Fertigkeiten', async () => {
    const { base, gm, alice } = await setupGroup(makeApp());
    const [kampf, wissen] = (await gm.put(`${base}/skills`, { skills: [{ name: 'Kämpfen' }, { name: 'Wissen' }] })).body;
    const id = (await alice.post(`${base}/articles`, article('public'))).body.id;
    const saved = await alice.post(`${base}/articles/${id}/sheet`, sheet({ skills: { [kampf.id]: 3, [wissen.id]: 0, 99999: 4, abc: 1 } }));
    expect(saved.body.data.skills).toEqual({ [kampf.id]: 3, [wissen.id]: 0 });

    await gm.put(`${base}/skills`, { skills: [{ id: kampf.id, name: 'Nahkampf' }] });
    const stale = (await alice.get(`${base}/articles/${id}/sheet`)).body;
    expect(stale.data.skills[kampf.id]).toBe(3);
    expect((await alice.put(`${base}/articles/${id}/sheet`, stale)).body.data.skills).toEqual({ [kampf.id]: 3 });
  });

  it('speichert die Zahl der nutzbaren Stresskästchen; ohne Angabe gilt die Vorgabe', async () => {
    const { base, alice } = await setupGroup(makeApp());
    const id = (await alice.post(`${base}/articles`, article('public'))).body.id;
    const url = `${base}/articles/${id}/sheet`;
    expect((await alice.post(url, sheet())).body.data.stressBoxes).toEqual({ physical: 4, mental: 4 });
    const saved = await alice.put(url, { data: sheet({ stressBoxes: { physical: 6, mental: 2 } }), version: 1 });
    expect(saved.body.data.stressBoxes).toEqual({ physical: 6, mental: 2 });
    expect((await alice.get(url)).body.data.stressBoxes).toEqual({ physical: 6, mental: 2 });
    // eine noch offene ältere Seite schickt das Feld nicht mit: der gespeicherte Wert bleibt
    const old = await alice.put(url, { data: sheet(), version: 2 });
    expect(old.body.data.stressBoxes).toEqual({ physical: 6, mental: 2 });
  });

  it('validiert den Bogen', async () => {
    const { base, alice } = await setupGroup(makeApp());
    const id = (await alice.post(`${base}/articles`, article('public'))).body.id;
    const url = `${base}/articles/${id}/sheet`;
    await alice.post(url, sheet());
    const put = (data: object) => alice.put(url, { data, version: 1 });
    expect((await put(sheet({ stress: { physical: [true], mental: Array(6).fill(false) } }))).status).toBe(400);
    expect((await put(sheet({ skills: { 1: 99 } }))).status).toBe(400);
    expect((await put(sheet({ stressBoxes: { physical: 0, mental: 3 } }))).status).toBe(400);
    expect((await put(sheet({ stressBoxes: { physical: 7, mental: 3 } }))).status).toBe(400);
    expect((await put(sheet({ stressBoxes: { physical: 3 } }))).status).toBe(400);
    expect((await put(sheet({ skills: { 1: 1.5 } }))).status).toBe(400);
    expect((await put(sheet({ name: 'x'.repeat(301) }))).status).toBe(400);
    expect((await put(sheet({ stunts: 'x'.repeat(5001) }))).status).toBe(400);
    expect((await put(sheet({ name: { kein: 'Text' } }))).status).toBe(400);
    expect((await put({ name: 'unvollständig' })).status).toBe(400);
    expect((await alice.put(url, { data: sheet() })).status).toBe(400);
    expect((await alice.post(`${base}/articles/99999/sheet`, sheet())).status).toBe(404);
  });

  it('ersetzt Steuerzeichen in einzeiligen Feldern, statt das Speichern zu verweigern', async () => {
    const { base, alice } = await setupGroup(makeApp());
    const id = (await alice.post(`${base}/articles`, article('public'))).body.id;
    // z.B. ein aus einer Tabelle mitkopierter Tab
    const saved = await alice.post(
      `${base}/articles/${id}/sheet`,
      sheet({
        name: 'Zoë\tWashburne',
        stunts: 'Zeile 1\nZeile 2',
        aspects: { concept: 'mehr\nzeilig', trouble: '', relationship: '', free1: '', free2: '' },
        consequences: { mild: 'a\u0000b', moderate: '', severe: '', mild2: '' },
      }),
    );
    expect(saved.body.data).toMatchObject({
      name: 'Zoë Washburne',
      stunts: 'Zeile 1\nZeile 2',
      aspects: { concept: 'mehr\nzeilig' },
      consequences: { mild: 'a b' },
    });
  });

  it('speichert keine unbekannten Felder', async () => {
    const { base, alice } = await setupGroup(makeApp());
    const id = (await alice.post(`${base}/articles`, article('public'))).body.id;
    const url = `${base}/articles/${id}/sheet`;
    const junk = { ...sheet(), junk: 'x'.repeat(50_000), aspects: { ...sheet().aspects, more: 'y' } };
    expect((await alice.post(url, junk)).status).toBe(201);
    const stored = (await alice.get(url)).body.data;
    expect(stored.junk).toBeUndefined();
    expect(stored.aspects.more).toBeUndefined();
    expect(stored.name).toBe('Zoë');
  });

  it('verschwindet mit dem Artikel', async () => {
    const { base, alice } = await setupGroup(makeApp());
    const id = (await alice.post(`${base}/articles`, article('public'))).body.id;
    await alice.post(`${base}/articles/${id}/sheet`, sheet());
    await alice.del(`${base}/articles/${id}`);
    expect((await alice.get(`${base}/articles/${id}/sheet`)).status).toBe(404);
  });

  it('übersteht kaputte Daten in der Datenbank', async () => {
    const db = openDb(':memory:');
    const app = buildApp(db, { adminEmails: ADMIN_EMAIL });
    const { base, alice } = await setupGroup(app);
    const id = (await alice.post(`${base}/articles`, article('public'))).body.id;
    await alice.post(`${base}/articles/${id}/sheet`, sheet());
    const sheetUrl = `${base}/articles/${id}/sheet`;
    db.exec(`UPDATE character_sheets SET data = '{kaputt'`);
    expect((await alice.get(sheetUrl)).body.data.name).toBe('');
    // Gültiges JSON in falscher Form wird ebenfalls zu einem vollständigen Bogen
    db.exec(`UPDATE character_sheets SET data = '{"name":"x","stress":{"physical":[true]},"skills":{"1":"viel"}}'`);
    const repaired = (await alice.get(sheetUrl)).body;
    expect(repaired.data).toMatchObject({ name: 'x', refresh: '3', skills: {}, aspects: { concept: '' } });
    expect(repaired.data.stress).toEqual({ physical: [true, false, false, false, false, false], mental: Array(6).fill(false) });
    expect((await alice.put(sheetUrl, repaired)).status).toBe(200);
  });

  it('wendet beschädigte oder leere Varianten nicht an', async () => {
    const db = openDb(':memory:');
    const app = buildApp(db, { adminEmails: ADMIN_EMAIL });
    const { base, gm } = await setupGroup(app);
    const [skill] = (await gm.put(`${base}/skills`, { skills: [{ name: 'Bleibt' }] })).body;
    for (const broken of ['kaputt', '{"a":1}', '[1,2]', '[]']) {
      db.prepare('UPDATE skill_presets SET skills = ? WHERE id = 1').run(broken);
      expect((await gm.get('/api/presets')).body.find((p: any) => p.id === 1).skills, broken).toEqual([]);
      expect((await gm.post(`${base}/skills/from-preset`, { presetId: 1 })).status, broken).toBe(409);
      expect((await gm.post('/api/groups', { name: 'Neu', presetId: 1 })).status, broken).toBe(409);
    }
    expect((await gm.get(`${base}/skills`)).body).toEqual([skill]);
    expect((await gm.get('/api/groups')).body).toHaveLength(1);
  });
});
