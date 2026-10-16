import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { afterRemove, firstTrack, moveItem, nextTrack, previousTrack, startAt, type Queue, type QueueMode } from '../src/lib/playlistQueue.ts';
import { MAX_PLAYLISTS, PLAYLISTS_KEY, createPlaylistPlayer, createPlaylists, loadPlaylists } from '../src/lib/playlists.svelte.ts';
import { createPlayer } from '../src/lib/soundPlayer.svelte.ts';
import { builtinToBoard, formatPlayTime, type BoardSound } from '../src/lib/soundboard.ts';
import { FakeAudio, builtinSound } from './soundHelpers.ts';

const IDS = ['a', 'b', 'c', 'd'];
const seq = (repeat: QueueMode['repeat'] = 'all'): QueueMode => ({ shuffle: false, repeat });
/** Zufall aus einer festen Folge (ringsum) */
const randomFrom = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

/** spielt die Warteschlange automatisch ab und liefert die Reihenfolge der aktuellen Einträge */
function run(mode: QueueMode, steps: number, auto = true): string[] {
  let queue: Queue | null = firstTrack(IDS, mode);
  const order: string[] = [];
  for (let i = 0; i < steps && queue; i++) {
    order.push(queue.current);
    queue = nextTrack(queue, IDS, mode, auto);
  }
  return order;
}

describe('Warteschlange der Playlist', () => {
  it('spielt der Reihe nach; „alle“ beginnt danach von vorn, „aus“ hört nach dem letzten auf', () => {
    expect(run(seq('all'), 6)).toEqual(['a', 'b', 'c', 'd', 'a', 'b']);
    expect(run(seq('off'), 10)).toEqual(['a', 'b', 'c', 'd']);
    expect(nextTrack(startAt('d'), IDS, seq('off'))).toBeNull();
  });

  it('„einen Titel“ wiederholt am Titelende, Weiterschalten geht trotzdem zum nächsten', () => {
    expect(run(seq('one'), 3)).toEqual(['a', 'a', 'a']);
    expect(nextTrack(startAt('b'), IDS, seq('one'), false)?.current).toBe('c');
    // am Ende der Liste schaltet „Weiter“ ringsum
    expect(nextTrack(startAt('d'), IDS, seq('one'), false)?.current).toBe('a');
  });

  it('Zufall spielt jeden Titel einmal je Durchgang und beginnt den neuen nicht mit dem letzten', () => {
    const mode: QueueMode = { shuffle: true, repeat: 'all', random: randomFrom([0.99, 0, 0.5, 0, 0]) };
    const order = run(mode, 8);
    expect([...order.slice(0, 4)].sort()).toEqual(IDS);
    expect([...order.slice(4, 8)].sort()).toEqual(IDS);
    expect(order[4]).not.toBe(order[3]);
    // ohne Wiederholen ist nach einem Durchgang Schluss
    expect(run({ shuffle: true, repeat: 'off', random: Math.random }, 10)).toHaveLength(4);
  });

  it('Zufall mit echtem Zufall: über viele Durchgänge immer vollständig', () => {
    const mode: QueueMode = { shuffle: true, repeat: 'all' };
    const order = run(mode, 40);
    for (let i = 0; i < 40; i += 4) expect([...order.slice(i, i + 4)].sort()).toEqual(IDS);
  });

  it('zurück: davor in der Liste, vor dem ersten der letzte (bzw. der erste ohne Wiederholen), bei Zufall der zuvor gespielte', () => {
    expect(previousTrack(startAt('c'), IDS, seq())?.current).toBe('b');
    expect(previousTrack(startAt('a'), IDS, seq('all'))?.current).toBe('d');
    expect(previousTrack(startAt('a'), IDS, seq('off'))?.current).toBe('a');
    const shuffled: Queue = { current: 'b', played: ['d', 'a', 'b'] };
    const back = previousTrack(shuffled, IDS, { shuffle: true, repeat: 'all' });
    expect(back).toEqual({ current: 'a', played: ['d', 'a'] });
    // erster des Durchgangs: beginnt von vorn
    expect(previousTrack({ current: 'd', played: ['d'] }, IDS, { shuffle: true, repeat: 'all' })?.current).toBe('d');
    // und nach „Zurück“ geht es mit den noch fehlenden weiter
    const next = nextTrack(back, IDS, { shuffle: true, repeat: 'all', random: () => 0 });
    expect(['b', 'c']).toContain(next?.current);
  });

  it('Entfernen: der laufende macht dem nächsten Platz, andere ändern nichts, ohne Titel ist Schluss', () => {
    expect(afterRemove(startAt('b'), 'c', IDS, seq())).toEqual({ queue: { current: 'b', played: ['b'] }, changed: false });
    expect(afterRemove(startAt('b'), 'b', IDS, seq())).toEqual({ queue: { current: 'c', played: ['c'] }, changed: true });
    // der letzte: ringsum zum ersten bzw. ohne Wiederholen Schluss
    expect(afterRemove(startAt('d'), 'd', IDS, seq('all')).queue?.current).toBe('a');
    expect(afterRemove(startAt('d'), 'd', IDS, seq('off')).queue).toBeNull();
    expect(afterRemove(startAt('a'), 'a', IDS, seq()).queue?.current).toBe('b');
    expect(afterRemove(startAt('a'), 'a', ['a'], seq())).toEqual({ queue: null, changed: true });
    // „einen Titel“: der Titel ist weg, also weiter
    expect(afterRemove(startAt('b'), 'b', IDS, seq('one')).queue?.current).toBe('c');
    // Zufall: der nächste noch nicht gespielte
    const removed = afterRemove({ current: 'b', played: ['a', 'b'] }, 'b', IDS, { shuffle: true, repeat: 'all', random: () => 0 });
    expect(removed.queue).toEqual({ current: 'c', played: ['a', 'c'] });
  });

  it('verschiebt Einträge, Unsinn ändert nichts', () => {
    expect(moveItem(IDS, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(IDS, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(IDS, 1, 9)).toEqual(IDS);
    expect(formatPlayTime(0)).toBe('0:00');
    expect(formatPlayTime(125.7)).toBe('2:05');
    expect(formatPlayTime(NaN)).toBe('0:00');
  });
});

const sound = (id: string, title: string, category = 'Musik'): BoardSound => builtinToBoard(builtinSound(id, title, category));
const fanfare = sound('fanfare', 'Fanfare');
const hymne = sound('hymne', 'Hymne');
const marsch = sound('marsch', 'Marsch');
const glocke = sound('glocke', 'Glocke', 'Effekte');

describe('Playlisten speichern', () => {
  beforeEach(() => localStorage.clear());

  it('legt an, benennt um, sortiert, entfernt und merkt sich alles über das Neuladen', () => {
    const lists = createPlaylists();
    const kampf = lists.create('  Kampf  ')!;
    expect(kampf.name).toBe('Kampf');
    expect(lists.create()!.name).toBe('Playlist 1');
    expect(lists.selectedId).not.toBe(kampf.id);
    lists.select(kampf.id);
    lists.add(kampf.id, fanfare);
    lists.add(kampf.id, hymne);
    lists.add(kampf.id, fanfare);
    lists.move(kampf.id, 2, 0);
    lists.rename(kampf.id, '');
    lists.rename(kampf.id, 'Boss');
    lists.setShuffle(true);
    lists.setRepeat('one');

    const again = createPlaylists();
    expect(again.list.map((p) => p.name)).toEqual(['Boss', 'Playlist 1']);
    expect(again.selectedId).toBe(kampf.id);
    expect(again.get(kampf.id)!.tracks.map((t) => t.title)).toEqual(['Fanfare', 'Fanfare', 'Hymne']);
    expect(again.shuffle).toBe(true);
    expect(again.repeat).toBe('one');
    expect(again.contains(hymne.key)).toBe(true);

    again.remove(kampf.id);
    expect(again.selected?.name).toBe('Playlist 1');
    expect(createPlaylists().list).toHaveLength(1);
  });

  it('nimmt einen gelöschten Sound aus allen Playlisten', () => {
    const lists = createPlaylists();
    const a = lists.create('A')!;
    const b = lists.create('B')!;
    lists.add(a.id, fanfare);
    lists.add(a.id, hymne);
    lists.add(b.id, fanfare);
    const removed = lists.forgetSound(fanfare.key);
    expect(removed.map((r) => r.playlistId)).toEqual([a.id, b.id]);
    expect(lists.contains(fanfare.key)).toBe(false);
    expect(createPlaylists().get(a.id)!.tracks.map((t) => t.sound)).toEqual([hymne.key]);
  });

  it('verwirft kaputte gespeicherte Daten', () => {
    const lists = createPlaylists();
    for (let i = 0; i < MAX_PLAYLISTS; i++) lists.create();
    expect(lists.full).toBe(true);
    expect(lists.create()).toBeNull();
    // Namen aus reinem Leerraum gelten als fehlend
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify({ playlists: [{ id: 'p', name: '   ', tracks: [{ id: 't', sound: 'k', title: '  ' }] }] }));
    expect(loadPlaylists().playlists[0]).toMatchObject({ name: 'Playlist 1', tracks: [{ title: 'k' }] });
    localStorage.setItem(PLAYLISTS_KEY, '{kaputt');
    expect(loadPlaylists()).toEqual({ playlists: [], selected: null, shuffle: false, repeat: 'all' });
    localStorage.setItem(
      PLAYLISTS_KEY,
      JSON.stringify({
        playlists: [null, { id: 'x', name: '', tracks: [{ id: 't', sound: 'builtin:a' }, { sound: 3 }, 'kaputt'] }, { id: 'x', tracks: 'nein' }],
        selected: 'fehlt',
        shuffle: 'ja',
        repeat: 'immer',
      }),
    );
    const loaded = loadPlaylists();
    expect(loaded.playlists).toHaveLength(2);
    expect(loaded.playlists[0]).toEqual({ id: 'x', name: 'Playlist 1', tracks: [{ id: 't', sound: 'builtin:a', title: 'builtin:a' }] });
    // doppelte ID bekommt eine neue
    expect(loaded.playlists[1].id).not.toBe('x');
    expect(loaded.selected).toBe('x');
    expect(loaded.shuffle).toBe(false);
    expect(loaded.repeat).toBe('all');
  });
});

describe('Wiedergabe einer Playlist', () => {
  const known = new Map([fanfare, hymne, marsch, glocke].map((s) => [s.key, s]));
  const audioOf = (s: BoardSound) => [...FakeAudio.all].reverse().find((a) => (a.src || a.removedSrc).endsWith(`/${s.id}.wav`))!;
  const tick = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    FakeAudio.all = [];
    localStorage.clear();
  });
  afterEach(() => localStorage.clear());

  function setup(tracks: BoardSound[] = [fanfare, hymne, marsch], random?: () => number) {
    const playlists = createPlaylists();
    const list = playlists.create('Abend')!;
    for (const t of tracks) playlists.add(list.id, t);
    const findSound = vi.fn((key: string) => known.get(key));
    let pp: ReturnType<typeof createPlaylistPlayer>;
    const player = createPlayer({
      resolveUrl: async (s) => s.url!,
      createAudio: () => new FakeAudio() as unknown as HTMLAudioElement,
      onEnded: (s, c) => pp.ended(s, c),
    });
    pp = createPlaylistPlayer({ player, playlists, findSound, random });
    return { player, playlists, list: playlists.get(list.id)!, pp, findSound };
  }
  const titles = (pp: ReturnType<typeof createPlaylistPlayer>) => pp.entry?.title;

  it('spielt alle Titel der Reihe nach auf dem Musikkanal, ohne Schleife, und beginnt danach von vorn', async () => {
    const { player, list, pp } = setup();
    await pp.play(list.id);
    flushSync();
    expect(pp.status).toBe('playing');
    expect(player.music?.key).toBe(fanfare.key);
    expect(player.channels[fanfare.key]).toBe('music');
    expect(audioOf(fanfare).loop).toBe(false);
    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      order.push(titles(pp)!);
      audioOf(player.music!).end();
      await tick();
    }
    expect(order).toEqual(['Fanfare', 'Hymne', 'Marsch', 'Fanfare']);
    expect(pp.index).toBe(1);
  });

  it('ohne Wiederholen ist nach dem letzten Titel Ruhe', async () => {
    const { player, playlists, list, pp } = setup([fanfare, hymne]);
    playlists.setRepeat('off');
    await pp.play(list.id);
    audioOf(fanfare).end();
    await tick();
    audioOf(hymne).end();
    await tick();
    expect(pp.status).toBe('stopped');
    expect(player.music).toBeNull();
  });

  it('„einen Titel“ spielt ihn erneut; Weiter/Zurück schalten um', async () => {
    const { player, playlists, list, pp } = setup();
    playlists.setRepeat('one');
    await pp.play(list.id);
    audioOf(fanfare).end();
    await tick();
    expect(titles(pp)).toBe('Fanfare');
    expect(player.isActive(fanfare.key)).toBe(true);
    await pp.next();
    expect(titles(pp)).toBe('Hymne');
    await pp.previous();
    expect(titles(pp)).toBe('Fanfare');
    expect(audioOf(hymne).paused).toBe(true);
  });

  it('Zufall: jeder Titel einmal je Durchgang', async () => {
    const { player, playlists, list, pp } = setup(undefined, randomFrom([0.7, 0.2, 0.9]));
    playlists.setShuffle(true);
    await pp.play(list.id);
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      seen.push(titles(pp)!);
      audioOf(player.music!).end();
      await tick();
    }
    expect(seen.sort()).toEqual(['Fanfare', 'Hymne', 'Marsch']);
  });

  it('Effekte laufen über der Playlist, ohne sie zu unterbrechen', async () => {
    const { player, list, pp } = setup();
    await pp.play(list.id);
    await player.play(glocke);
    expect(audioOf(fanfare).paused).toBe(false);
    expect(audioOf(glocke).paused).toBe(false);
    audioOf(glocke).end();
    await tick();
    // das Ende des Effekts schaltet die Playlist nicht weiter
    expect(titles(pp)).toBe('Fanfare');
    expect(pp.status).toBe('playing');
    audioOf(fanfare).end();
    await tick();
    expect(titles(pp)).toBe('Hymne');
  });

  it('hält an und setzt an derselben Stelle fort, spult', async () => {
    const { player, list, pp } = setup();
    await pp.play(list.id);
    const audio = audioOf(fanfare);
    audio.duration = 120;
    audio.currentTime = 30;
    await pp.toggle();
    expect(pp.status).toBe('paused');
    expect(audio.paused).toBe(true);
    player.seek(fanfare.key, 200);
    expect(player.position(fanfare.key)).toEqual({ current: 120, duration: 120 });
    player.seek(fanfare.key, 45);
    await pp.toggle();
    expect(pp.status).toBe('playing');
    expect(audio.paused).toBe(false);
    // dasselbe Element, also dieselbe Stelle
    expect(audioOf(fanfare)).toBe(audio);
    expect(audio.currentTime).toBe(45);
  });

  it('Musik per Kachel ersetzt den Titel; dessen Ende schaltet nicht weiter', async () => {
    const { player, list, pp } = setup();
    await pp.play(list.id);
    pp.release();
    await player.play(hymne);
    expect(pp.status).toBe('idle');
    audioOf(hymne).end();
    await tick();
    expect(player.music).toBeNull();
    expect(titles(pp)).toBe('Fanfare');
    // Abspielen setzt beim gemerkten Titel wieder ein
    await pp.toggle();
    expect(player.music?.key).toBe(fanfare.key);
  });

  it('überspringt Titel, deren Sound nicht verfügbar ist', async () => {
    const { list, pp, findSound } = setup();
    findSound.mockImplementation((key) => (key === fanfare.key ? undefined : known.get(key)));
    await pp.play(list.id);
    expect(titles(pp)).toBe('Hymne');
    findSound.mockImplementation(() => undefined);
    await pp.next();
    expect(pp.status).toBe('idle');
  });

  it('entfernt den laufenden Titel: der nächste spielt; angehalten bleibt angehalten', async () => {
    const { player, list, pp } = setup();
    await pp.play(list.id);
    pp.removeEntry(list.id, list.tracks[0].id);
    await tick();
    expect(titles(pp)).toBe('Hymne');
    expect(pp.status).toBe('playing');
    await pp.toggle();
    pp.removeEntry(list.id, list.tracks[0].id);
    expect(titles(pp)).toBe('Marsch');
    expect(pp.status).toBe('idle');
    expect(player.music).toBeNull();
    pp.removeEntry(list.id, list.tracks[0].id);
    expect(pp.status).toBe('stopped');
  });

  it('ein gelöschter Sound verschwindet aus allen Playlisten; läuft er gerade, geht es mit dem nächsten weiter', async () => {
    const { player, playlists, list, pp } = setup([fanfare, hymne, fanfare, marsch]);
    const other = playlists.create('Andere')!;
    playlists.add(other.id, fanfare);
    await pp.play(list.id);
    pp.forgetSound(fanfare.key);
    await tick();
    expect(playlists.get(list.id)!.tracks.map((t) => t.title)).toEqual(['Hymne', 'Marsch']);
    expect(playlists.get(other.id)!.tracks).toEqual([]);
    expect(titles(pp)).toBe('Hymne');
    expect(player.music?.key).toBe(hymne.key);
    // Umsortieren lässt den laufenden Titel laufen
    playlists.move(list.id, 0, 1);
    expect(titles(pp)).toBe('Hymne');
    expect(pp.index).toBe(1);
  });

  it('angehalten während des Ladens: spielt nicht los, Fortsetzen startet', async () => {
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const player = createPlayer({
      resolveUrl: async (s) => {
        await slow;
        return s.url!;
      },
      createAudio: () => new FakeAudio() as unknown as HTMLAudioElement,
    });
    const loading = player.play(fanfare, { channel: 'music', loop: false });
    player.pause(fanfare.key);
    await player.resume(fanfare.key);
    expect(player.states[fanfare.key]).toBe('loading');
    player.pause(fanfare.key);
    release();
    await loading;
    expect(player.states[fanfare.key]).toBe('paused');
    expect(audioOf(fanfare).paused).toBe(true);
    await player.resume(fanfare.key);
    expect(player.states[fanfare.key]).toBe('playing');
    expect(audioOf(fanfare).paused).toBe(false);
    // blockiert der Browser das Fortsetzen, steht es als Fehler am Sound
    player.pause(fanfare.key);
    audioOf(fanfare).playResult = Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    await player.resume(fanfare.key);
    expect(player.isActive(fanfare.key)).toBe(false);
    expect(player.errors[fanfare.key]).toMatch(/blockiert/);
  });

  it('Stopp und gelöschte Playlist beenden die Wiedergabe', async () => {
    const { player, list, pp } = setup();
    await pp.play(list.id);
    pp.stop();
    expect(pp.status).toBe('stopped');
    expect(player.music).toBeNull();
    await pp.play(list.id);
    pp.removePlaylist(list.id);
    expect(pp.status).toBe('stopped');
    expect(player.music).toBeNull();
  });
});
