import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SECTION,
  ROLES,
  ROLE_LABELS,
  SECTIONS,
  SECTION_LABELS,
  VISIBILITIES,
  VISIBILITY_LABELS,
  accessibleSections,
  canAccessSection,
} from '../src/index.ts';

describe('canAccessSection', () => {
  it('sperrt nur den Bereich Spielleiter für Spieler', () => {
    for (const section of SECTIONS) {
      expect(canAccessSection('gm', section)).toBe(true);
      expect(canAccessSection('player', section)).toBe(section !== 'gm');
    }
  });
});

describe('accessibleSections', () => {
  it('liefert Spielern alles außer dem Bereich Spielleiter', () => {
    expect(accessibleSections('gm')).toEqual([...SECTIONS]);
    expect(accessibleSections('player')).toEqual(['characters', 'npcs', 'locations']);
    expect(accessibleSections('player')).toContain(DEFAULT_SECTION);
  });
});

describe('Labels', () => {
  it('sind für alle Werte vorhanden', () => {
    expect(Object.keys(SECTION_LABELS)).toEqual([...SECTIONS]);
    expect(Object.keys(VISIBILITY_LABELS)).toEqual([...VISIBILITIES]);
    expect(Object.keys(ROLE_LABELS)).toEqual([...ROLES]);
  });
});
