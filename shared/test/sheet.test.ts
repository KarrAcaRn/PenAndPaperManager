import { describe, expect, it } from 'vitest';
import {
  ASPECT_LABELS,
  MAX_SKILLS,
  STRESS_BOXES,
  DEFAULT_STRESS_BOXES,
  MAX_CONSEQUENCES,
  SkillListError,
  canHaveSheet,
  emptySheet,
  emptySheetState,
  hasControlChars,
  hasVisibleText,
  normalizeSheet,
  normalizeSheetState,
  normalizeSkillNames,
  replaceControlChars,
} from '../src/index.ts';

describe('normalizeSkillNames', () => {
  it('trimmt, vereinheitlicht Unicode und behält die Reihenfolge', () => {
    expect(normalizeSkillNames([' Kämpfen ', 'Kämpfen 2', 'Wille'])).toEqual(['Kämpfen', 'Kämpfen 2', 'Wille']);
    expect(normalizeSkillNames([])).toEqual([]);
  });

  it('lehnt leere, unsichtbare, doppelte und zu lange Namen ab', () => {
    for (const names of [[''], ['  '], ['​'], ['a\u0000b'], ['Wille', 'wille'], ['Ä', 'Ä'], ['x'.repeat(41)]]) {
      expect(() => normalizeSkillNames(names), JSON.stringify(names)).toThrow(SkillListError);
    }
    expect(normalizeSkillNames(['x'.repeat(40)])).toHaveLength(1);
  });

  it('begrenzt die Anzahl', () => {
    const names = Array.from({ length: MAX_SKILLS + 1 }, (_, i) => `Fertigkeit ${i}`);
    expect(() => normalizeSkillNames(names)).toThrow(SkillListError);
    expect(normalizeSkillNames(names.slice(1))).toHaveLength(MAX_SKILLS);
  });
});

describe('emptySheet', () => {
  it('liefert jedes Mal einen unabhängigen, vollständigen Bogen mit leichter, mittlerer und schwerer Konsequenz', () => {
    const a = emptySheet();
    const b = emptySheet();
    a.skills[1] = 2;
    expect(b.skills).toEqual({});
    expect(Object.keys(b.aspects)).toEqual(Object.keys(ASPECT_LABELS));
    expect(b.refresh).toBe('3');
    expect(b.stressBoxes).toEqual({ physical: DEFAULT_STRESS_BOXES, mental: DEFAULT_STRESS_BOXES });
    expect(b.consequences.map((c) => c.value)).toEqual([2, 4, 6]);
    // eindeutige Schlüssel, auch über Bögen hinweg
    const keys = [...a.consequences, ...b.consequences].map((c) => c.key);
    expect(new Set(keys).size).toBe(6);
  });

  it('liefert einen leeren, unabhängigen Zustand', () => {
    const a = emptySheetState();
    const b = emptySheetState();
    a.stress.physical[0] = true;
    expect(b.stress.physical).toEqual(Array(STRESS_BOXES).fill(false));
    expect(b.stress.mental).not.toBe(b.stress.physical);
    expect(b.consequences).toEqual({});
  });
});

describe('normalizeSheet', () => {
  it('lässt vollständige Bögen unverändert', () => {
    const sheet = emptySheet('Zoë');
    sheet.skills[7] = -1;
    sheet.stunts = 'a\nb';
    sheet.aspects.concept = 'mehr\nzeilig';
    sheet.stressBoxes.mental = 6;
    expect(normalizeSheet(sheet)).toEqual(sheet);
    expect(normalizeSheet(sheet)).not.toBe(sheet);
  });

  it('ersetzt alles Unbrauchbare durch die Vorgabe', () => {
    const plain = (s: ReturnType<typeof emptySheet>) => ({ ...s, consequences: s.consequences.map((c) => c.value) });
    for (const raw of [null, undefined, 'text', 5, [], [1]]) expect(plain(normalizeSheet(raw))).toEqual(plain(emptySheet()));
    // gleichbleibende Schlüssel, damit Texte zu ersetzten Zeilen beim nächsten Lesen noch passen
    expect(normalizeSheet({ consequences: 'kaputt' }).consequences).toEqual(normalizeSheet(null).consequences);
    expect(normalizeSheet(null).consequences.map((c) => c.key)).toEqual(['d0', 'd1', 'd2']);
    const sheet = normalizeSheet({
      name: 'x\ty',
      age: 31,
      junk: true,
      aspects: { concept: 'K', more: 'weg' },
      stressBoxes: { physical: 0, mental: 2.5 },
      skills: { 1: 2, 2: 'viel', 3: 1.5 },
    });
    expect(sheet).toMatchObject({ name: 'x y', age: '', aspects: { ...emptySheet().aspects, concept: 'K' }, skills: { 1: 2 } });
    expect(sheet.stressBoxes).toEqual({ physical: DEFAULT_STRESS_BOXES, mental: DEFAULT_STRESS_BOXES });
    expect('junk' in sheet).toBe(false);
  });

  it('übernimmt gültige Konsequenzzeilen und verwirft ungültige oder doppelte', () => {
    expect(normalizeSheet({ consequences: [] }).consequences).toEqual([]);
    expect(
      normalizeSheet({
        consequences: [{ key: 'a', value: 6, text: 'weg' }, { key: 'b', value: 3 }, 'kaputt', { value: 2 }, { key: 'a', value: 2 }, { key: 'c', value: 2 }],
      }).consequences,
    ).toEqual([
      { key: 'a', value: 6 },
      { key: 'c', value: 2 },
    ]);
    const many = Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, value: 4 }));
    expect(normalizeSheet({ consequences: many }).consequences).toHaveLength(MAX_CONSEQUENCES);
    expect(normalizeSheet({ consequences: [{ key: 'x'.repeat(21), value: 2 }] }).consequences).toEqual([]);
  });
});

describe('normalizeSheetState', () => {
  it('ergänzt Fehlendes und verwirft Texte zu unbekannten Zeilen', () => {
    for (const raw of [null, 'text', []]) expect(normalizeSheetState(raw)).toEqual(emptySheetState());
    const data = { ...emptySheet(), consequences: [{ key: 'a', value: 2 as const }] };
    expect(
      normalizeSheetState({ stress: { physical: [true, 'ja', 1], mental: 'kaputt' }, consequences: { a: 'x\ty', b: 'weg', c: 5, d: '' } }, data),
    ).toEqual({
      stress: { physical: [true, false, false, false, false, false], mental: Array(STRESS_BOXES).fill(false) },
      consequences: { a: 'x y' },
    });
    // ohne Bogen bleiben alle Texte
    expect(normalizeSheetState({ consequences: { a: '1', b: '2' } }).consequences).toEqual({ a: '1', b: '2' });
  });
});

describe('Helfer', () => {
  it('canHaveSheet gilt nur für Charaktere und Notizen', () => {
    expect(['characters', 'notes', 'gm'].map((s) => canHaveSheet(s as never))).toEqual([true, true, false]);
  });

  it('hasVisibleText und hasControlChars', () => {
    expect(hasVisibleText(' a ')).toBe(true);
    expect(hasVisibleText(' ​ ')).toBe(false);
    expect(hasControlChars('a\tb')).toBe(true);
    expect(hasControlChars('a b')).toBe(true);
    expect(hasControlChars('Zoë 😀')).toBe(false);
    expect(replaceControlChars('a\tb\u0000c\u2028d Zoë')).toBe('a b c d Zoë');
  });
});
