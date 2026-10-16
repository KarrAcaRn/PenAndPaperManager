import { beforeEach, describe, expect, it } from 'vitest';
import { EFFECT_LIST_KEY, MAX_EFFECT_ENTRIES, createEffectList, createEffectListPlayer, entryIdOf, entryKey, loadEffectList } from '../src/lib/effectList.svelte.ts';
import { createPlayer } from '../src/lib/soundPlayer.svelte.ts';
import { builtinToBoard } from '../src/lib/soundboard.ts';
import { FakeAudio, builtinSound } from './soundHelpers.ts';

const glocke = builtinToBoard(builtinSound('glocke', 'Glocke', 'Effekte'));

describe('Wiedergabe der Effekt-Liste', () => {
  let resolvers: (() => void)[] = [];

  beforeEach(() => {
    localStorage.clear();
    FakeAudio.all = [];
    resolvers = [];
  });

  /** Player mit FakeAudio; URLs kommen erst, wenn der Test `resolvers` aufruft */
  function setup() {
    const list = createEffectList();
    let effects: ReturnType<typeof createEffectListPlayer>;
    const player = createPlayer({
      resolveUrl: (sound) => new Promise((resolve) => resolvers.push(() => resolve(sound.url!))),
      createAudio: () => new FakeAudio() as unknown as HTMLAudioElement,
      soundOptions: (key) => effects.soundOptions(key) ?? { volume: 1, loop: false },
    });
    effects = createEffectListPlayer({ player, list, findSound: (key) => (key === glocke.key ? glocke : undefined) });
    return { list, player, effects };
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('entfernt einen noch ladenden Eintrag, ohne dass er danach doch noch startet', async () => {
    const { effects, player } = setup();
    const entry = effects.add(glocke)!;
    expect(effects.state(entry.id)).toBe('loading');
    effects.remove(entry.id);
    resolvers.forEach((r) => r());
    await settle();
    expect(FakeAudio.all).toHaveLength(0);
    expect(player.isChannelActive('sfx')).toBe(false);
    expect(effects.error(entry.id)).toBeUndefined();
  });

  it('ohne Schleife gilt der Eintrag nach dem Ende als gestoppt; Ladefehler verschwinden mit dem Eintrag', async () => {
    const { effects, list } = setup();
    const entry = effects.add(glocke)!;
    effects.setLoop(entry.id, false);
    resolvers.shift()!();
    await settle();
    const audio = FakeAudio.all[0];
    expect(audio.loop).toBe(false);
    expect(audio.volume).toBe(0);
    expect(effects.state(entry.id)).toBe('playing');
    audio.end();
    expect(effects.isPlaying(entry.id)).toBe(false);
    expect(list.entries).toHaveLength(1);

    effects.play(entry.id);
    resolvers.shift()!();
    await settle();
    FakeAudio.all[1].failLoading();
    // Standard-Sounds bekommen keinen zweiten Versuch
    expect(effects.error(entry.id)).toMatch(/ließ sich nicht laden/);
    effects.remove(entry.id);
    expect(effects.error(entry.id)).toBeUndefined();
  });
});

describe('Effekt-Liste speichern', () => {
  beforeEach(() => localStorage.clear());

  it('startet leer und verträgt kaputte oder fremde Daten', () => {
    expect(loadEffectList()).toEqual([]);
    localStorage.setItem(EFFECT_LIST_KEY, '{kaputt');
    expect(loadEffectList()).toEqual([]);
    localStorage.setItem(EFFECT_LIST_KEY, JSON.stringify({ entries: 'nein' }));
    expect(loadEffectList()).toEqual([]);
  });

  it('übernimmt gültige Einträge; fehlende Werte bekommen die Vorgabe, doppelte IDs neue', () => {
    localStorage.setItem(
      EFFECT_LIST_KEY,
      JSON.stringify({
        entries: [
          { id: 'a', sound: 'builtin:glocke', title: 'Glocke', volume: 0.4, loop: false },
          { id: 'a', sound: 'builtin:trommel', volume: 7 },
          { id: 'c' },
          null,
        ],
      }),
    );
    const entries = loadEffectList();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ id: 'a', sound: 'builtin:glocke', title: 'Glocke', volume: 0.4, loop: false });
    expect(entries[1]).toMatchObject({ sound: 'builtin:trommel', title: 'builtin:trommel', volume: 0, loop: true });
    expect(entries[1].id).not.toBe('a');
  });

  it('legt Einträge bei Lautstärke 0 mit Schleife an, erlaubt Duplikate und begrenzt die Länge', () => {
    const list = createEffectList();
    const first = list.add(glocke)!;
    expect(first).toMatchObject({ sound: 'builtin:glocke', title: 'Glocke', volume: 0, loop: true });
    expect(list.add(glocke)!.id).not.toBe(first.id);
    list.setVolume(first.id, 3);
    expect(list.get(first.id)!.volume).toBe(1);
    while (!list.full) list.add(glocke);
    expect(list.entries).toHaveLength(MAX_EFFECT_ENTRIES);
    expect(list.add(glocke)).toBeNull();
    expect(list.forgetSound('builtin:glocke')).toHaveLength(MAX_EFFECT_ENTRIES);
    expect(createEffectList().entries).toEqual([]);
  });

  it('trennt die Player-Schlüssel der Einträge von denen der Kacheln', () => {
    expect(entryIdOf(entryKey('abc'))).toBe('abc');
    expect(entryIdOf('builtin:glocke')).toBeNull();
  });
});
