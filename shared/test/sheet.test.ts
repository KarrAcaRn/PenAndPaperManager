import { describe, expect, it } from 'vitest';
import {
  ASPECT_LABELS,
  CONSEQUENCES,
  MAX_SKILLS,
  STRESS_BOXES,
  SkillListError,
  canHaveSheet,
  emptySheet,
  hasControlChars,
  hasVisibleText,
  normalizeSkillNames,
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
  it('liefert jedes Mal einen unabhängigen, vollständigen Bogen', () => {
    const a = emptySheet();
    const b = emptySheet();
    a.stress.physical[0] = true;
    a.skills[1] = 2;
    expect(b.stress.physical).toEqual(Array(STRESS_BOXES).fill(false));
    expect(b.stress.mental).not.toBe(b.stress.physical);
    expect(b.skills).toEqual({});
    expect(Object.keys(b.aspects)).toEqual(Object.keys(ASPECT_LABELS));
    expect(Object.keys(b.consequences)).toEqual(CONSEQUENCES.map((c) => c.key));
    expect(b.refresh).toBe('3');
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
  });
});
