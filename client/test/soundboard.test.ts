import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { MAX_STORAGE_UPLOAD_BYTES, type UploadTarget } from '@pnp/shared';
import { ApiFailure } from '../src/lib/api.ts';
import {
  builtinToBoard,
  categoriesOf,
  checkUploadFile,
  createPlaybackUrlCache,
  describeStorageError,
  fileCategory,
  fileTitle,
  fileToBoard,
  filterSounds,
  groupByCategory,
  type BoardSound,
} from '../src/lib/soundboard.ts';
import { HOTKEYS, assignHotkeys, hotkeyAction, isTypingTarget, stepCategory } from '../src/lib/soundHotkeys.ts';
import { SOUND_SETTINGS_KEY, createSoundSettings } from '../src/lib/soundSettings.svelte.ts';
import { UploadError, uploadDirect } from '../src/lib/upload.ts';
import { createPlayer } from '../src/lib/soundPlayer.svelte.ts';
import { FakeXhr, builtinSound } from './soundHelpers.ts';

const putTarget = (over: Partial<UploadTarget> = {}): UploadTarget => ({
  method: 'PUT',
  url: 'https://bucket.example/k.mp3?sig=1',
  headers: {},
  fields: {},
  fileId: 'k.mp3',
  expiresAt: '2030-01-01T00:00:00Z',
  ...over,
});

describe('Soundboard-Logik', () => {
  const sounds = [
    builtinToBoard(builtinSound('fanfare', 'Fanfare', 'Musik')),
    builtinToBoard(builtinSound('glocke', 'Glocke', 'Effekte')),
    builtinToBoard(builtinSound('trommel', 'Trommelwirbel', 'Effekte')),
    fileToBoard(3, { id: 'ordner/Drachenkampf.mp3', name: 'Drachenkampf.mp3', size: 10, mimeType: 'audio/mpeg', updatedAt: null }),
  ];

  it('bildet Standard-Sounds und Nutzer-Dateien auf Kacheln ab', () => {
    expect(sounds[0]).toMatchObject({ key: 'builtin:fanfare', source: 'builtin', url: '/sounds/default/fanfare.wav', deletable: false });
    expect(sounds[3]).toMatchObject({ key: '3:ordner/Drachenkampf.mp3', source: 3, title: 'Drachenkampf', url: null, deletable: true });
    expect(fileTitle('a/b/Regen.Ogg')).toBe('Regen');
    expect(fileTitle('ohne-endung')).toBe('ohne-endung');
  });

  it('sucht im Titel ohne Groß-/Kleinschreibung und filtert nach Kategorie', () => {
    expect(filterSounds(sounds, 'trommel').map((s) => s.id)).toEqual(['trommel']);
    expect(filterSounds(sounds, '  DRACHEN ').map((s) => s.title)).toEqual(['Drachenkampf']);
    expect(filterSounds(sounds, '', 'Effekte').map((s) => s.id)).toEqual(['glocke', 'trommel']);
    expect(filterSounds(sounds, 'fanfare', 'Effekte')).toEqual([]);
    expect(categoriesOf(sounds)).toEqual(['Musik', 'Effekte']);
    expect(groupByCategory(sounds).map((g) => [g.category, g.sounds.length])).toEqual([
      [null, 1],
      ['Musik', 1],
      ['Effekte', 2],
    ]);
  });

  it('nimmt Unterordner der Nutzer-Dateien als Kategorie und sucht auch in Kategorie und Schlagwörtern', () => {
    expect(fileCategory('kampf.mp3')).toBeNull();
    expect(fileCategory('packs/regen/leise.mp3')).toBe('packs / regen');
    const rain = fileToBoard(3, { id: 'sb/packs/regen/leise.mp3', name: 'packs/regen/leise.mp3', size: 1, mimeType: null, updatedAt: null });
    expect(rain).toMatchObject({ title: 'leise', category: 'packs / regen', tags: [] });
    const tagged = builtinToBoard({ ...builtinSound('wind', 'Wind', 'Natur'), tags: ['Sturm', 'Draußen'] });
    const all = [...sounds, rain, tagged];
    expect(filterSounds(all, 'regen').map((s) => s.title)).toEqual(['leise']);
    expect(filterSounds(all, 'packs leise').map((s) => s.title)).toEqual(['leise']);
    expect(filterSounds(all, 'draußen').map((s) => s.title)).toEqual(['Wind']);
    expect(filterSounds(all, 'effekte glo').map((s) => s.id)).toEqual(['glocke']);
    expect(filterSounds(all, '', 'packs / regen').map((s) => s.title)).toEqual(['leise']);
    expect(categoriesOf(all)).toEqual(['Musik', 'Effekte', 'packs / regen', 'Natur']);
  });
});

describe('Tastatur', () => {
  const key = (k: string, over: Partial<KeyboardEvent> = {}) =>
    ({ key: k, altKey: false, ctrlKey: false, metaKey: false, target: document.body, ...over }) as KeyboardEvent;

  it('vergibt 0–9, a–z, A–Z in Anzeigereihenfolge, höchstens 62', () => {
    expect(HOTKEYS).toHaveLength(62);
    const keys = Array.from({ length: 70 }, (_, i) => `s${i}`);
    const map = assignHotkeys(keys);
    expect(map.size).toBe(62);
    expect([map.get('s0'), map.get('s9'), map.get('s10'), map.get('s35'), map.get('s36'), map.get('s61')]).toEqual(['0', '9', 'a', 'z', 'A', 'Z']);
    expect(map.has('s62')).toBe(false);
  });

  it('wechselt die Kategorie ringsum, „alle“ eingeschlossen', () => {
    expect(stepCategory(['A', 'B'], '', 1)).toBe('A');
    expect(stepCategory(['A', 'B'], 'B', 1)).toBe('');
    expect(stepCategory(['A', 'B'], '', -1)).toBe('B');
    expect(stepCategory(['A', 'B'], 'weg', 1)).toBe('A');
  });

  it('übersetzt Tasten und schweigt beim Tippen, mit Strg/Cmd und bei offenem Dialog', () => {
    const map = assignHotkeys(['x', 'y']);
    expect(hotkeyAction(key('1'), map)).toEqual({ kind: 'sound', soundKey: 'y' });
    expect(hotkeyAction(key('5'), map)).toBeNull();
    expect(hotkeyAction(key('ArrowLeft'), map)).toEqual({ kind: 'category', step: -1 });
    expect(hotkeyAction(key('ArrowRight'), map)).toEqual({ kind: 'category', step: 1 });
    expect(hotkeyAction(key('ArrowUp'), map)).toEqual({ kind: 'volume', step: 0.01 });
    expect(hotkeyAction(key('ArrowDown'), map)).toEqual({ kind: 'volume', step: -0.01 });
    expect(hotkeyAction(key('Alt', { altKey: true }), map)).toEqual({ kind: 'search' });
    expect(hotkeyAction(key('Enter'), map)).toBeNull();
    expect(hotkeyAction(key('0', { ctrlKey: true }), map)).toBeNull();
    expect(hotkeyAction(key('0', { altKey: true }), map)).toBeNull();
    const input = document.createElement('input');
    expect(isTypingTarget(input)).toBe(true);
    expect(hotkeyAction(key('0', { target: input }), map)).toBeNull();
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.append(dialog);
    expect(hotkeyAction(key('0'), map)).toBeNull();
    dialog.remove();
    expect(hotkeyAction(key('0'), map)).toEqual({ kind: 'sound', soundKey: 'x' });
  });
});

describe('Einstellungen je Sound', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('merkt sich nur Abweichungen vom Standard und verwirft kaputte Einträge', () => {
    const settings = createSoundSettings();
    expect(settings.get('a')).toEqual({ volume: 1, loop: false });
    settings.setVolume('a', 0.4);
    settings.setLoop('b', true);
    settings.setVolume('c', 9);
    expect(settings.get('c').volume).toBe(1);
    expect(JSON.parse(localStorage.getItem(SOUND_SETTINGS_KEY)!)).toEqual({ a: { volume: 0.4, loop: false }, b: { volume: 1, loop: true } });
    settings.setLoop('b', false);
    settings.forget('a');
    expect(JSON.parse(localStorage.getItem(SOUND_SETTINGS_KEY)!)).toEqual({});

    localStorage.setItem(SOUND_SETTINGS_KEY, JSON.stringify({ x: { volume: 'laut', loop: true }, y: null, z: { volume: -1 } }));
    const again = createSoundSettings();
    expect(again.get('x')).toEqual({ volume: 1, loop: true });
    expect(again.get('z')).toEqual({ volume: 0, loop: false });
    localStorage.setItem(SOUND_SETTINGS_KEY, '{kaputt');
    expect(createSoundSettings().get('x')).toEqual({ volume: 1, loop: false });
  });

  it('lässt nur Audiodateien bis zum Größenlimit hochladen', () => {
    expect(checkUploadFile({ name: 'a.mp3', type: 'audio/mpeg', size: 5 })).toEqual({ contentType: 'audio/mpeg' });
    // fehlender oder abweichender Browser-Typ: der übliche Typ der Endung
    expect(checkUploadFile({ name: 'a.m4a', type: '', size: 5 })).toEqual({ contentType: 'audio/mp4' });
    expect(checkUploadFile({ name: 'a.wav', type: 'audio/x-wav', size: 5 })).toEqual({ contentType: 'audio/x-wav' });
    expect(checkUploadFile({ name: 'bild.png', type: 'image/png', size: 5 })).toHaveProperty('error');
    expect(checkUploadFile({ name: 'a.mp3', type: 'application/x-msdownload', size: 5 })).toHaveProperty('error');
    expect(checkUploadFile({ name: 'a.mp3', type: 'audio/mpeg', size: 0 })).toHaveProperty('error');
    const big = checkUploadFile({ name: 'a.mp3', type: 'audio/mpeg', size: MAX_STORAGE_UPLOAD_BYTES + 1 });
    expect('error' in big && big.error).toMatch(/zu groß/);
  });

  it('formuliert Fehler der Speicher-Endpunkte verständlich', () => {
    expect(describeStorageError(new ApiFailure(409, 'Zugriff wurde widerrufen'))).toMatch(/widerrufen.*neu verbinden/);
    expect(describeStorageError(new ApiFailure(502, 'Zeitüberschreitung'))).toMatch(/nicht erreichbar: Zeitüberschreitung/);
    expect(describeStorageError(new ApiFailure(401, 'Nicht eingeloggt'))).toMatch(/Anmeldung ist abgelaufen/);
    expect(describeStorageError(new TypeError('Failed to fetch'))).toMatch(/Keine Verbindung zum Server/);
  });
});

describe('Playback-URL-Cache', () => {
  it('holt eine URL erst bei Bedarf, behält sie bis kurz vor Ablauf und holt dann eine neue', async () => {
    let now = Date.parse('2026-10-16T10:00:00Z');
    const fetchUrl = vi.fn(async (_cid: number, fileId: string) => ({
      url: `https://x/${fileId}?n=${fetchUrl.mock.calls.length}`,
      expiresAt: new Date(now + 5 * 60_000).toISOString(),
    }));
    const cache = createPlaybackUrlCache(fetchUrl, () => now);
    expect(fetchUrl).not.toHaveBeenCalled();
    expect(await cache.get(3, 'a')).toBe('https://x/a?n=1');
    expect(await cache.get(3, 'a')).toBe('https://x/a?n=1');
    expect(fetchUrl).toHaveBeenCalledTimes(1);
    now += 4.8 * 60_000; // weniger als 30 s Restlaufzeit
    expect(await cache.get(3, 'a')).toBe('https://x/a?n=2');
    cache.invalidate(3, 'a');
    expect(await cache.get(3, 'a')).toBe('https://x/a?n=3');
  });

  it('teilt gleichzeitige Anfragen und vergisst Fehler', async () => {
    const fetchUrl = vi.fn().mockRejectedValueOnce(new Error('weg')).mockResolvedValue({ url: 'u', expiresAt: '2099-01-01T00:00:00Z' });
    const cache = createPlaybackUrlCache(fetchUrl);
    await expect(cache.get(1, 'f')).rejects.toThrow('weg');
    const [a, b] = await Promise.all([cache.get(1, 'f'), cache.get(1, 'f')]);
    expect([a, b]).toEqual(['u', 'u']);
    expect(fetchUrl).toHaveBeenCalledTimes(2);
  });
});

describe('Direkter Upload', () => {
  const file = new Blob(['x'.repeat(10)], { type: 'audio/mpeg' });
  const run = (target: UploadTarget, opts: { online?: boolean; onProgress?: (p: number) => void } = {}) =>
    uploadDirect(target, file, 'audio/mpeg', {
      createXhr: () => new FakeXhr() as unknown as XMLHttpRequest,
      isOnline: () => opts.online ?? true,
      onProgress: opts.onProgress,
    });

  it('schickt die Datei per PUT direkt an die signierte URL und meldet den Fortschritt', async () => {
    const progress: number[] = [];
    const done = run(putTarget({ headers: { 'x-amz-acl': 'private' } }), { onProgress: (p) => progress.push(p) });
    const xhr = FakeXhr.last!;
    expect([xhr.method, xhr.url]).toEqual(['PUT', 'https://bucket.example/k.mp3?sig=1']);
    expect(xhr.headers).toEqual({ 'x-amz-acl': 'private', 'Content-Type': 'audio/mpeg' });
    expect(xhr.body).toBe(file);
    xhr.progress(5, 10);
    xhr.respond(200);
    await done;
    expect(progress).toEqual([0.5, 1]);
  });

  it('übernimmt einen vorgegebenen Content-Type und baut für presigned POST das Formular', async () => {
    const put = run(putTarget({ headers: { 'content-type': 'audio/mp3' } }));
    expect(FakeXhr.last!.headers).toEqual({ 'content-type': 'audio/mp3' });
    FakeXhr.last!.respond(201);
    await put;

    const post = run(putTarget({ method: 'POST', url: 'https://bucket.example/', fields: { key: 'k.mp3', policy: 'p' } }));
    const form = FakeXhr.last!.body as FormData;
    expect([...form.keys()]).toEqual(['key', 'policy', 'file']);
    expect(form.get('key')).toBe('k.mp3');
    FakeXhr.last!.respond(204);
    await post;
  });

  it('unterscheidet abgelaufene Links, CORS-Sperren und getrennte Verbindungen', async () => {
    const expired = run(putTarget());
    FakeXhr.last!.respond(403);
    await expect(expired).rejects.toMatchObject({ kind: 'expired', message: expect.stringMatching(/abgelaufen/) });

    const blocked = run(putTarget());
    FakeXhr.last!.fail();
    await expect(blocked).rejects.toMatchObject({ kind: 'blocked', message: expect.stringMatching(/CORS/) });

    const offline = run(putTarget(), { online: false });
    FakeXhr.last!.fail();
    await expect(offline).rejects.toMatchObject({ kind: 'offline', message: expect.stringMatching(/Keine Internetverbindung/) });

    const failed = run(putTarget());
    FakeXhr.last!.respond(500);
    await expect(failed).rejects.toBeInstanceOf(UploadError);
  });
});

/** Audio-Element ohne Wiedergabe: play() wartet, bis der Test es per resolvePlay/fail beendet */
class FakeAudio {
  static all: FakeAudio[] = [];
  src = '';
  volume = 1;
  loop = false;
  preload = '';
  paused = true;
  error: { code: number } | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  playResult: Promise<void> = Promise.resolve();
  constructor() {
    FakeAudio.all.push(this);
  }
  play() {
    this.paused = false;
    return this.playResult;
  }
  pause() {
    this.paused = true;
  }
  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }
  failLoading() {
    this.error = { code: 4 };
    this.onerror?.();
  }
}

describe('Player', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const glocke: BoardSound = builtinToBoard(builtinSound('glocke', 'Glocke', 'Effekte'));
  const fanfare: BoardSound = builtinToBoard(builtinSound('fanfare', 'Fanfare', 'Musik'));
  const userFile: BoardSound = fileToBoard(3, { id: 'kampf.mp3', name: 'kampf.mp3', size: 1, mimeType: null, updatedAt: null });

  beforeEach(() => {
    FakeAudio.all = [];
    localStorage.clear();
  });
  afterEach(() => localStorage.clear());

  const makePlayer = (resolveUrl = vi.fn(async (s: BoardSound, retry: boolean) => s.url ?? `https://signed/${s.id}?retry=${retry}`)) => ({
    resolveUrl,
    player: createPlayer({ resolveUrl, createAudio: () => new FakeAudio() as unknown as HTMLAudioElement }),
  });

  it('spielt per Klick ab und stoppt beim zweiten Klick', async () => {
    const { player } = makePlayer();
    await player.toggle(glocke);
    flushSync();
    expect(player.states[glocke.key]).toBe('playing');
    expect(FakeAudio.all[0]).toMatchObject({ src: '/sounds/default/glocke.wav', paused: false, volume: 0.8 });
    await player.toggle(glocke);
    expect(player.isActive(glocke.key)).toBe(false);
    expect(FakeAudio.all[0].paused).toBe(true);
  });

  it('spielt mehrere Sounds gleichzeitig oder – exklusiv – nur einen', async () => {
    const { player } = makePlayer();
    await player.play(glocke);
    await player.play(fanfare);
    expect(Object.keys(player.states).sort()).toEqual([fanfare.key, glocke.key].sort());
    player.setExclusive(true);
    await player.play(glocke);
    expect(Object.keys(player.states)).toEqual([glocke.key]);
    expect(JSON.parse(localStorage.getItem('pnp.soundboard')!)).toMatchObject({ exclusive: true });
  });

  it('wendet Lautstärke und Schleife je Sound an, auch nachträglich', async () => {
    const own: Record<string, { volume: number; loop: boolean }> = { [glocke.key]: { volume: 0.5, loop: true } };
    const player = createPlayer({
      resolveUrl: async (s) => s.url!,
      createAudio: () => new FakeAudio() as unknown as HTMLAudioElement,
      soundOptions: (key) => own[key] ?? { volume: 1, loop: false },
    });
    await player.play(glocke);
    await player.play(fanfare);
    expect(FakeAudio.all[0]).toMatchObject({ volume: 0.4, loop: true });
    expect(FakeAudio.all[1]).toMatchObject({ volume: 0.8, loop: false });
    own[fanfare.key] = { volume: 0.25, loop: true };
    player.refreshSound(fanfare.key);
    expect(FakeAudio.all[1]).toMatchObject({ volume: 0.2, loop: true });
    player.setVolume(0.4);
    expect(FakeAudio.all[0].volume).toBeCloseTo(0.2);
    expect(FakeAudio.all[1].volume).toBeCloseTo(0.1);
  });

  it('setzt die Lautstärke für laufende und neue Sounds und merkt sie sich', async () => {
    const { player } = makePlayer();
    await player.play(glocke);
    player.setVolume(0.3);
    expect(FakeAudio.all[0].volume).toBe(0.3);
    await player.play(fanfare);
    expect(FakeAudio.all[1].volume).toBe(0.3);
    player.setVolume(7);
    expect(player.settings.volume).toBe(1);
    const again = makePlayer().player;
    expect(again.settings.volume).toBe(1);
  });

  it('holt für Nutzer-Dateien bei einem Ladefehler einmal eine frische URL', async () => {
    const { player, resolveUrl } = makePlayer();
    await player.play(userFile);
    expect(FakeAudio.all[0].src).toBe('https://signed/kampf.mp3?retry=false');
    FakeAudio.all[0].failLoading();
    await tick();
    expect(resolveUrl).toHaveBeenLastCalledWith(userFile, true);
    expect(FakeAudio.all[1].src).toBe('https://signed/kampf.mp3?retry=true');
    // scheitert auch die frische URL, gibt es eine Meldung statt Endlosschleife
    FakeAudio.all[1].failLoading();
    await tick();
    expect(FakeAudio.all).toHaveLength(2);
    expect(player.errors[userFile.key]).toMatch(/nicht laden/);
    expect(player.isActive(userFile.key)).toBe(false);
  });

  it('meldet blockierte Wiedergabe und Fehler beim Holen der URL', async () => {
    const { player } = makePlayer(vi.fn().mockRejectedValue(new Error('Speicher getrennt')));
    await player.play(userFile);
    expect(player.errors[userFile.key]).toBe('Speicher getrennt');

    const blocked = makePlayer().player;
    const original = FakeAudio.prototype.play;
    FakeAudio.prototype.play = () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    try {
      await blocked.play(glocke);
    } finally {
      FakeAudio.prototype.play = original;
    }
    expect(blocked.errors[glocke.key]).toMatch(/blockiert/);
  });
});
