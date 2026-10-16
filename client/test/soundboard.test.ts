import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { MAX_STORAGE_UPLOAD_BYTES, type BuiltinSound, type UploadTarget } from '@pnp/shared';
import { ApiFailure } from '../src/lib/api.ts';
import {
  builtinToBoard,
  categoriesOf,
  checkUploadFile,
  createPlaybackUrlCache,
  describeStorageError,
  fileTitle,
  fileToBoard,
  filterSounds,
  groupByCategory,
  uploadedSound,
  type BoardSound,
} from '../src/lib/soundboard.ts';
import { UploadError, uploadDirect } from '../src/lib/upload.ts';
import { DEFAULT_SETTINGS, createPlayer, createSoundTypes, loadSettings } from '../src/lib/soundPlayer.svelte.ts';
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
      ['Musik', 1],
      ['Effekte', 2],
    ]);
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
  /** src vor dem Stoppen, damit Tests gestoppte Elemente wiederfinden */
  removedSrc = '';
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
    if (name === 'src') [this.removedSrc, this.src] = [this.src, ''];
  }
  failLoading() {
    this.error = { code: 4 };
    this.onerror?.();
  }
  end() {
    this.paused = true;
    this.onended?.();
  }
}

describe('Player', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const glocke: BoardSound = builtinToBoard(builtinSound('glocke', 'Glocke', 'Effekte'));
  const trommel: BoardSound = builtinToBoard(builtinSound('trommel', 'Trommelwirbel', 'Effekte'));
  const fanfare: BoardSound = builtinToBoard(builtinSound('fanfare', 'Fanfare', 'Musik'));
  const hymne: BoardSound = builtinToBoard(builtinSound('hymne', 'Hymne', 'Musik'));
  const userFile: BoardSound = fileToBoard(3, { id: 'kampf.mp3', name: 'kampf.mp3', size: 1, mimeType: null, updatedAt: null });
  const audioOf = (sound: BoardSound) => [...FakeAudio.all].reverse().find((a) => (a.src || a.removedSrc).endsWith(`/${sound.id}.wav`))!;

  beforeEach(() => {
    FakeAudio.all = [];
    localStorage.clear();
  });
  afterEach(() => localStorage.clear());

  const makePlayer = (
    resolveUrl = vi.fn(async (s: BoardSound, retry: boolean) => s.url ?? `https://signed/${s.id}?retry=${retry}`),
    options: Partial<Parameters<typeof createPlayer>[0]> = {},
  ) => ({
    resolveUrl,
    player: createPlayer({ resolveUrl, createAudio: () => new FakeAudio() as unknown as HTMLAudioElement, ...options }),
  });

  it('spielt per Klick ab und stoppt beim zweiten Klick', async () => {
    const { player } = makePlayer();
    await player.toggle(glocke);
    flushSync();
    expect(player.states[glocke.key]).toBe('playing');
    // Gesamt 80 % × Effekte 100 %
    expect(FakeAudio.all[0]).toMatchObject({ src: '/sounds/default/glocke.wav', paused: false, volume: 0.8, loop: false });
    await player.toggle(glocke);
    expect(player.isActive(glocke.key)).toBe(false);
    expect(FakeAudio.all[0].paused).toBe(true);
  });

  it('spielt Musik und mehrere Effekte gleichzeitig', async () => {
    const { player } = makePlayer();
    await player.play(fanfare);
    await player.play(glocke);
    await player.play(trommel);
    expect(Object.keys(player.states).sort()).toEqual([fanfare.key, glocke.key, trommel.key].sort());
    expect(player.channels).toEqual({ [fanfare.key]: 'music', [glocke.key]: 'sfx', [trommel.key]: 'sfx' });
    expect(FakeAudio.all.every((a) => !a.paused)).toBe(true);
    expect(player.music?.key).toBe(fanfare.key);
  });

  it('ein zweiter Musiktitel ersetzt den ersten, Effekte laufen weiter', async () => {
    const { player } = makePlayer();
    await player.play(fanfare);
    await player.play(glocke);
    await player.play(hymne);
    expect(audioOf(fanfare).paused).toBe(true);
    expect(audioOf(hymne).paused).toBe(false);
    expect(audioOf(glocke).paused).toBe(false);
    expect(Object.keys(player.states).sort()).toEqual([glocke.key, hymne.key].sort());
    expect(player.music?.title).toBe('Hymne');
  });

  it('verwirft einen noch ladenden Musiktitel, wenn ein anderer startet', async () => {
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const resolveUrl = vi.fn(async (s: BoardSound) => {
      if (s.key === fanfare.key) await slow;
      return s.url!;
    });
    const { player } = makePlayer(resolveUrl);
    const first = player.play(fanfare);
    expect(player.music?.key).toBe(fanfare.key);
    await player.play(hymne);
    release();
    await first;
    expect(FakeAudio.all.map((a) => a.src)).toEqual(['/sounds/default/hymne.wav']);
    expect(player.music?.key).toBe(hymne.key);
  });

  it('nimmt den Kanal aus typeOf (Typ des Nutzers) bzw. aus den Abspiel-Optionen', async () => {
    const { player } = makePlayer(undefined, { typeOf: (s) => (s.key === glocke.key ? 'music' : s.type) });
    await player.play(fanfare);
    await player.play(glocke);
    // Glocke gilt hier als Musik und ersetzt die Fanfare
    expect(player.isActive(fanfare.key)).toBe(false);
    expect(player.channels[glocke.key]).toBe('music');
    await player.play(trommel, { channel: 'music', loop: false });
    expect(player.music?.key).toBe(trommel.key);
    expect(audioOf(trommel).loop).toBe(false);
    // eine eigene Schleifen-Angabe beim Start bleibt, auch wenn „Musik wiederholen“ umgestellt wird
    player.setMusicLoop(false);
    player.setMusicLoop(true);
    expect(audioOf(trommel).loop).toBe(false);
  });

  it('Musik läuft je nach Einstellung in Schleife, Effekte nicht; meldet das Ende', async () => {
    const onEnded = vi.fn();
    const { player } = makePlayer(undefined, { onEnded });
    await player.play(fanfare);
    await player.play(glocke);
    expect(audioOf(fanfare).loop).toBe(true);
    expect(audioOf(glocke).loop).toBe(false);
    player.setMusicLoop(false);
    expect(audioOf(fanfare).loop).toBe(false);
    expect(audioOf(glocke).loop).toBe(false);

    audioOf(fanfare).end();
    expect(onEnded).toHaveBeenCalledWith(fanfare, 'music');
    expect(player.music).toBeNull();
    expect(player.isActive(glocke.key)).toBe(true);
    // nach dem Stoppen meldet ein verspätetes ended nichts mehr
    const glockeAudio = audioOf(glocke);
    player.stop(glocke.key);
    glockeAudio.end();
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it('stoppt Musik, Effekte oder alles', async () => {
    const { player } = makePlayer();
    await player.play(fanfare);
    await player.play(glocke);
    await player.play(trommel);
    expect(player.isChannelActive('music') && player.isChannelActive('sfx')).toBe(true);

    player.stopChannel('sfx');
    expect(Object.keys(player.states)).toEqual([fanfare.key]);
    expect(audioOf(glocke).paused && audioOf(trommel).paused).toBe(true);
    expect(player.isChannelActive('sfx')).toBe(false);

    await player.play(glocke);
    player.stopChannel('music');
    expect(Object.keys(player.states)).toEqual([glocke.key]);
    expect(player.music).toBeNull();

    await player.play(fanfare);
    player.stopAll();
    expect(player.states).toEqual({});
    expect(player.channels).toEqual({});
    expect(FakeAudio.all.every((a) => a.paused)).toBe(true);
  });

  it('regelt Gesamt-, Musik- und Effektlautstärke unabhängig und merkt sie sich', async () => {
    const { player } = makePlayer();
    expect(player.settings).toEqual({ volume: 0.8, musicVolume: 0.7, sfxVolume: 1, musicLoop: true });
    await player.play(fanfare);
    await player.play(glocke);
    expect(audioOf(fanfare).volume).toBeCloseTo(0.56);
    expect(audioOf(glocke).volume).toBeCloseTo(0.8);

    player.setVolume('music', 0.5);
    expect(audioOf(fanfare).volume).toBeCloseTo(0.4);
    expect(audioOf(glocke).volume).toBeCloseTo(0.8);

    player.setVolume('sfx', 0.25);
    expect(audioOf(fanfare).volume).toBeCloseTo(0.4);
    expect(audioOf(glocke).volume).toBeCloseTo(0.2);

    player.setVolume('master', 0.5);
    expect(audioOf(fanfare).volume).toBeCloseTo(0.25);
    expect(audioOf(glocke).volume).toBeCloseTo(0.125);
    await player.play(trommel);
    expect(audioOf(trommel).volume).toBeCloseTo(0.125);

    player.setVolume('sfx', 7);
    expect(player.settings.sfxVolume).toBe(1);
    player.setMusicLoop(false);
    const again = makePlayer().player;
    expect(again.settings).toEqual({ volume: 0.5, musicVolume: 0.5, sfxVolume: 1, musicLoop: false });
  });

  it('übernimmt die Lautstärke älterer Einstellungen als Gesamtlautstärke und ignoriert Unsinn', () => {
    localStorage.setItem('pnp.soundboard', JSON.stringify({ volume: 0.3, exclusive: true }));
    expect(loadSettings()).toEqual({ volume: 0.3, musicVolume: 0.7, sfxVolume: 1, musicLoop: true });
    localStorage.setItem('pnp.soundboard', JSON.stringify({ volume: 3, musicVolume: 'laut', sfxVolume: -1, musicLoop: 'ja' }));
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    localStorage.setItem('pnp.soundboard', '[kaputt');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
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

describe('Typen der Sounds', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  const glocke = builtinToBoard(builtinSound('glocke', 'Glocke', 'Effekte'));
  const fanfare = builtinToBoard(builtinSound('fanfare', 'Fanfare', 'Musik'));
  const datei = fileToBoard(3, { id: 'sb/Regen.mp3', name: 'Regen.mp3', size: 1, mimeType: null, updatedAt: null });

  it('nimmt die Vorgabe: Manifest-Typ, ältere Manifeste und eigene Dateien als Effekt', () => {
    expect(glocke.type).toBe('sfx');
    expect(fanfare.type).toBe('music');
    expect(datei.type).toBe('sfx');
    const { type: _omitted, ...legacy } = builtinSound('alt', 'Alt', 'Musik');
    expect(builtinToBoard(legacy as BuiltinSound).type).toBe('sfx');
  });

  it('merkt sich die Wahl des Nutzers über das Neuladen hinweg, speichert aber nur Abweichungen', () => {
    const types = createSoundTypes();
    types.set(datei, 'music');
    types.set(fanfare, 'sfx');
    types.set(glocke, 'sfx');
    expect(types.typeOf(datei)).toBe('music');
    expect(JSON.parse(localStorage.getItem('pnp.soundboard.types')!)).toEqual({ [datei.key]: 'music', [fanfare.key]: 'sfx' });

    const reloaded = createSoundTypes();
    expect(reloaded.typeOf(datei)).toBe('music');
    expect(reloaded.typeOf(fanfare)).toBe('sfx');
    expect(reloaded.typeOf(glocke)).toBe('sfx');
    reloaded.set(fanfare, 'music');
    reloaded.forget(datei.key);
    expect(JSON.parse(localStorage.getItem('pnp.soundboard.types')!)).toEqual({});
  });

  it('ignoriert kaputte oder unbekannte gespeicherte Typen', () => {
    localStorage.setItem('pnp.soundboard.types', JSON.stringify({ [datei.key]: 'ambience', [glocke.key]: 'music' }));
    const types = createSoundTypes();
    expect(types.typeOf(datei)).toBe('sfx');
    expect(types.typeOf(glocke)).toBe('music');
    localStorage.setItem('pnp.soundboard.types', 'nicht json');
    expect(createSoundTypes().typeOf(glocke)).toBe('sfx');
  });

  it('findet die Kachel einer hochgeladenen Datei über die ID oder einen eindeutigen neuen Namen', () => {
    const wind = fileToBoard(3, { id: 'drive-123', name: 'Wind.ogg', size: 1, mimeType: null, updatedAt: null });
    const sounds = [datei, wind];
    expect(uploadedSound(sounds, { name: 'Regen.mp3', fileId: 'sb/Regen.mp3' })).toBe(datei);
    expect(uploadedSound(sounds, { name: 'Wind.ogg', fileId: null })?.id).toBe('drive-123');
    expect(uploadedSound(sounds, { name: 'Fehlt.mp3', fileId: null })).toBeUndefined();
    // gleicher Titel wie eine ältere Datei (Drive erlaubt doppelte Namen, a.mp3/a.wav): nur die neue zählt
    const windNeu = fileToBoard(3, { id: 'drive-456', name: 'Wind.mp3', size: 1, mimeType: null, updatedAt: null });
    expect(uploadedSound([wind, windNeu], { name: 'Wind.mp3', fileId: null }, new Set([wind.key]))).toBe(windNeu);
    // nicht eindeutig: lieber keine Zuordnung als eine falsche
    expect(uploadedSound([wind, windNeu], { name: 'Wind.mp3', fileId: null })).toBeUndefined();
  });
});
