import { beforeEach, describe, expect, it } from 'vitest';
import { EFFECT_LIST_KEY, MAX_EFFECT_ENTRIES, createEffectList, entryIdOf, entryKey, loadEffectList } from '../src/lib/effectList.svelte.ts';
import { builtinToBoard } from '../src/lib/soundboard.ts';
import { builtinSound } from './soundHelpers.ts';

const glocke = builtinToBoard(builtinSound('glocke', 'Glocke', 'Effekte'));

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
