import { mkdtempSync, mkdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../src/db.ts';
import { buildApp } from '../src/app.ts';
import { soundsDir } from '../src/paths.ts';
import { createSoundLibrary, loadSoundManifest, parseSoundManifest, soundBaseUrl } from '../src/sounds.ts';
import { makeApp } from './helpers.ts';

const entry = (extra: Record<string, unknown> = {}) => ({
  id: 'glocke',
  title: 'Glocke',
  category: 'Effekte',
  file: 'effekte/glocke.wav',
  ...extra,
});
const manifest = (...sounds: unknown[]) => ({ version: 1, sounds });

describe('Standard-Sounds: mitgelieferte Bibliothek', () => {
  it('das Manifest im Repository ist gültig und verweist nur auf vorhandene Dateien', () => {
    const sounds = loadSoundManifest(soundsDir())!;
    expect(sounds.length).toBeGreaterThan(0);
    expect(new Set(sounds.map((s) => s.category))).toEqual(new Set(['Musik', 'Effekte']));
    for (const s of sounds) expect(s.license).toBeTruthy();
  });

  it('liefert das Manifest ohne Login im gemeinsamen Format', async () => {
    const res = await makeApp().inject({ url: '/api/sounds/builtin' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
    const { sounds } = res.json();
    expect(sounds.find((s: { id: string }) => s.id === 'glocke')).toEqual({
      source: 'builtin',
      id: 'glocke',
      title: 'Glocke',
      url: '/sounds/default/effekte/glocke.wav',
      category: 'Effekte',
      type: 'sfx',
      durationSec: 2,
      tags: ['Signal', 'Stadt'],
      license: expect.stringContaining('CC0'),
      mimeType: 'audio/wav',
    });
  });

  it('liefert die Dateien statisch mit Cache-Header und Audio-Typ aus', async () => {
    const app = makeApp();
    const { sounds } = (await app.inject({ url: '/api/sounds/builtin' })).json();
    for (const s of sounds) {
      const res = await app.inject({ url: s.url });
      expect(res.statusCode, s.url).toBe(200);
      expect(res.headers['content-type']).toMatch(/^audio\/(wav|wave|x-wav)/);
      expect(res.headers['cache-control']).toBe('public, max-age=86400');
      expect(res.rawPayload.subarray(0, 4).toString()).toBe('RIFF');
    }
    // Teilabruf, wie ihn <audio> zum Spulen nutzt
    const range = await app.inject({ url: sounds[0].url, headers: { range: 'bytes=0-9' } });
    expect(range.statusCode).toBe(206);
    expect(range.rawPayload.length).toBe(10);
  });

  it('liefert nur Audio-Dateien aus dem Manifest und nichts außerhalb des Ordners', async () => {
    const app = makeApp();
    for (const url of [
      '/sounds/default/sounds.json',
      '/sounds/default/fehlt.wav',
      '/sounds/default/.versteckt.wav',
      '/sounds/default/',
      '/sounds/default',
    ]) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).toBe(404);
      expect(res.json(), url).toEqual({ error: 'Nicht gefunden' });
    }
    // Hochladen ist nicht vorgesehen
    expect((await app.inject({ method: 'PUT', url: '/sounds/default/neu.wav', payload: 'x' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/sounds/builtin', payload: {} })).statusCode).toBe(404);
  });

  it('weist „..“ im rohen Pfad ab', async () => {
    // inject (wie fetch) normalisiert „..“ schon vorher; nur ein echter Request schickt den Pfad unverändert
    const app = makeApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    const rawGet = (path: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        httpGet({ host: '127.0.0.1', port, path }, (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ status: res.statusCode!, body }));
        }).on('error', reject);
      });
    try {
      for (const path of [
        '/sounds/default/../../package.json',
        '/sounds/default/effekte/../../../src/app.ts',
        '/sounds/default/%2e%2e/%2e%2e/package.json',
        '/sounds/default/effekte/..%2f..%2f..%2fpackage.json',
      ]) {
        const res = await rawGet(path);
        expect(res.status, path).toBe(404);
        expect(JSON.parse(res.body), path).toEqual({ error: 'Nicht gefunden' });
      }
    } finally {
      await app.close();
    }
  });
});

describe('Standard-Sounds: Konfiguration', () => {
  let dir: string;
  let outside: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    if (outside) rmSync(outside, { recursive: true, force: true });
  });
  const setup = (content: unknown) => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = mkdtempSync(join(tmpdir(), 'pnp-sounds-'));
    mkdirSync(join(dir, 'effekte'));
    writeFileSync(join(dir, 'effekte/glocke.wav'), 'RIFF');
    writeFileSync(join(dir, 'effekte/tür knarrt.mp3'), 'ID3');
    if (content !== undefined) writeManifest(content);
    return dir;
  };
  const writeManifest = (content: unknown, time?: number) => {
    const file = join(dir, 'sounds.json');
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
    if (time !== undefined) utimesSync(file, time, time);
  };
  const app = (opts: { soundsBaseUrl?: string } = {}) => buildApp(openDb(':memory:'), { soundsDir: dir, ...opts });

  it('setzt die URLs auf ein CDN und kodiert Dateinamen', async () => {
    setup(manifest(entry(), entry({ id: 'tuer', title: 'Tür', file: 'effekte/tür knarrt.mp3' })));
    const { sounds } = (await app({ soundsBaseUrl: 'https://cdn.example.org/pnp' }).inject({ url: '/api/sounds/builtin' })).json();
    expect(sounds.map((s: { url: string; mimeType: string }) => [s.url, s.mimeType])).toEqual([
      ['https://cdn.example.org/pnp/effekte/glocke.wav', 'audio/wav'],
      ['https://cdn.example.org/pnp/effekte/t%C3%BCr%20knarrt.mp3', 'audio/mpeg'],
    ]);
    expect(sounds[0]).toMatchObject({ durationSec: null, tags: [], license: null });
  });

  it('liefert kodierte Dateinamen aus, Dateien außerhalb des Manifests aber nicht', async () => {
    setup(undefined);
    writeFileSync(join(dir, 'effekte/100% laut (ä).mp3'), 'LAUT');
    writeManifest(manifest(
      entry({ id: 'tuer', title: 'Tür', file: 'effekte/tür knarrt.mp3' }),
      entry({ id: 'laut', title: 'Laut', file: 'effekte/100% laut (ä).mp3' }),
    ));
    const server = app();
    const { sounds } = (await server.inject({ url: '/api/sounds/builtin' })).json();
    const bodies = await Promise.all(sounds.map(async (s: { url: string }) => (await server.inject({ url: s.url })).body));
    expect(bodies).toEqual(['ID3', 'LAUT']);
    expect((await server.inject({ url: '/sounds/default/effekte/glocke.wav' })).statusCode).toBe(404);
  });

  it('folgt keinen Symlinks aus dem Ordner heraus', async () => {
    setup(undefined);
    outside = mkdtempSync(join(tmpdir(), 'pnp-outside-'));
    writeFileSync(join(outside, 'geheim.wav'), 'GEHEIM');
    symlinkSync(join(outside, 'geheim.wav'), join(dir, 'effekte/leck.wav'));
    symlinkSync(join(dir, 'effekte/glocke.wav'), join(dir, 'effekte/innen.wav'));
    writeManifest(manifest(entry({ file: 'effekte/leck.wav' })));
    expect(() => app()).toThrow(/Datei effekte\/leck.wav nicht gefunden/);
    // Ein Symlink innerhalb des Ordners ist in Ordnung, der nach außen wird ohne Manifest-Eintrag nicht ausgeliefert
    writeManifest(manifest(entry({ file: 'effekte/innen.wav' })));
    const server = app();
    expect((await server.inject({ url: '/sounds/default/effekte/innen.wav' })).body).toBe('RIFF');
    expect((await server.inject({ url: '/sounds/default/effekte/leck.wav' })).statusCode).toBe(404);
  });

  it('ohne Manifest ist die Bibliothek leer', async () => {
    setup(undefined);
    expect((await app().inject({ url: '/api/sounds/builtin' })).json()).toEqual({ sounds: [] });
  });

  it('ein fehlerhaftes Manifest, ein fehlender Ordner oder eine falsche Basis-URL verhindern den Start', () => {
    setup('{ kaputt');
    expect(() => app()).toThrow(/kein gültiges JSON/);
    setup(manifest(entry({ file: 'effekte/fehlt.wav' })));
    expect(() => app()).toThrow(/Datei effekte\/fehlt.wav nicht gefunden/);
    setup(manifest(entry()));
    expect(() => app({ soundsBaseUrl: 'cdn.example.org/' })).toThrow(/SOUNDS_BASE_URL muss mit/);
    expect(() => buildApp(openDb(':memory:'), { soundsDir: join(dir, 'gibtsnicht') })).toThrow(/Sound-Ordner .* nicht gefunden/);
  });

  it('liest ein geändertes Manifest neu ein und behält bei Fehlern die letzte gültige Liste', () => {
    setup(manifest(entry()));
    const onError = vi.fn();
    const library = createSoundLibrary(dir, soundBaseUrl(undefined), onError);
    const titles = () => library.list().map((s) => s.title);
    expect(titles()).toEqual(['Glocke']);

    writeManifest(manifest(entry({ title: 'Kirchenglocke' })), 1000);
    expect(titles()).toEqual(['Kirchenglocke']);

    writeManifest(manifest(entry({ id: 'Falsch Geschrieben' })), 2000);
    expect(titles()).toEqual(['Kirchenglocke']);
    expect(titles()).toEqual(['Kirchenglocke']);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0].message).toMatch(/„id“ darf nur/);

    // Gelöschtes Manifest: alte Liste bleibt, Fehler wird gemeldet
    rmSync(join(dir, 'sounds.json'));
    expect(titles()).toEqual(['Kirchenglocke']);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls[1][0].message).toMatch(/sounds.json fehlt/);
  });

  it('übernimmt ein Manifest, sobald die fehlende Datei nachgereicht ist', () => {
    setup(manifest(entry()));
    const onError = vi.fn();
    const library = createSoundLibrary(dir, soundBaseUrl(undefined), onError);
    writeManifest(manifest(entry(), entry({ id: 'neu', title: 'Neu', file: 'effekte/neu.ogg' })), 1000);
    expect(library.list().map((s) => s.id)).toEqual(['glocke']);
    expect(library.hasFile('effekte/neu.ogg')).toBe(false);
    expect(onError).toHaveBeenCalledOnce();

    writeFileSync(join(dir, 'effekte/neu.ogg'), 'OggS');
    expect(library.list().map((s) => s.id)).toEqual(['glocke', 'neu']);
    expect(library.hasFile('effekte/neu.ogg')).toBe(true);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('normalisiert die Basis-URL', () => {
    expect(soundBaseUrl(undefined)).toBe('/sounds/default/');
    expect(soundBaseUrl('  ')).toBe('/sounds/default/');
    expect(soundBaseUrl('/cdn')).toBe('/cdn/');
    expect(soundBaseUrl('https://cdn.example.org/a/')).toBe('https://cdn.example.org/a/');
  });
});

describe('Standard-Sounds: Manifest prüfen', () => {
  const parse = (...sounds: unknown[]) => parseSoundManifest(manifest(...sounds));

  it('übernimmt optionale Felder und trimmt Texte', () => {
    expect(parse(entry({ title: ' Glocke ', durationSec: 2.5, tags: [' Stadt '], license: 'CC0' }))).toEqual([
      { id: 'glocke', title: 'Glocke', category: 'Effekte', file: 'effekte/glocke.wav', type: 'sfx', durationSec: 2.5, tags: ['Stadt'], license: 'CC0' },
    ]);
    expect(parse(entry({ tags: null, durationSec: null, license: null }))[0]).toMatchObject({ tags: [], durationSec: null, license: null });
    expect(parse(entry({ tags: ['Stadt', ' Stadt', 'Nacht'] }))[0].tags).toEqual(['Stadt', 'Nacht']);
  });

  it('übernimmt den Typ und macht ältere Einträge ohne Typ zu Effekten', () => {
    expect(parse(entry({ type: 'music' }))[0].type).toBe('music');
    expect(parse(entry())[0].type).toBe('sfx');
    expect(parse(entry({ type: null }))[0].type).toBe('sfx');
  });

  it.each([
    [null, /JSON-Objekt/],
    [{ sounds: [] }, /„version“ muss 1/],
    [{ version: 1 }, /„sounds“ muss eine Liste/],
    [manifest('glocke'), /Sound 1: muss ein Objekt/],
  ])('lehnt ein falsch aufgebautes Manifest ab: %j', (raw, message) => {
    expect(() => parseSoundManifest(raw)).toThrow(message);
  });

  it.each([
    [{ id: undefined }, /„id“ fehlt/],
    [{ id: 'Glocke 1' }, /„id“ darf nur/],
    [{ title: '  ' }, /„title“ fehlt/],
    [{ title: 'a\tb' }, /Steuerzeichen/],
    [{ title: 'x'.repeat(121) }, /„title“ ist länger als 120/],
    [{ category: undefined }, /„category“ fehlt/],
    [{ type: 'ambience' }, /„type“ muss sfx oder music sein/],
    [{ file: '../geheim.wav' }, /relativer Pfad/],
    [{ file: '/etc/glocke.wav' }, /relativer Pfad/],
    [{ file: 'effekte\\glocke.wav' }, /relativer Pfad/],
    [{ file: '.versteckt/glocke.wav' }, /relativer Pfad/],
    [{ file: 'effekte/glocke.txt' }, /muss auf \.mp3, \.wav, \.ogg, \.m4a enden/],
    [{ file: 'effekte/rock & roll.mp3' }, /darf keines der Zeichen/],
    [{ file: 'effekte/a#b.mp3' }, /darf keines der Zeichen/],
    [{ file: 'effekte/a+b,c.mp3' }, /darf keines der Zeichen/],
    [{ durationSec: 0 }, /positive Zahl/],
    [{ durationSec: '2' }, /positive Zahl/],
    [{ tags: 'Stadt' }, /„tags“ muss eine Liste/],
    [{ tags: Array(11).fill('a') }, /höchstens 10/],
    [{ tags: [''] }, /„tags\[0\]“ fehlt/],
    [{ license: '' }, /„license“ fehlt/],
    [{ dauer: 2 }, /unbekannte Felder dauer/],
  ])('lehnt fehlerhafte Einträge ab: %j', (extra, message) => {
    expect(() => parse(entry(extra))).toThrow(message);
  });

  it('lehnt doppelte IDs und fehlende Dateien ab', () => {
    expect(() => parse(entry(), entry({ title: 'Noch eine' }))).toThrow(/Sound „glocke“: „id“ kommt doppelt vor/);
    expect(() => parseSoundManifest(manifest(entry()), () => false)).toThrow(/nicht gefunden/);
  });
});
