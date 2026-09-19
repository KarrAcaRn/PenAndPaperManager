import { describe, expect, it } from 'vitest';
import { canEditArticle, canManageFolder, canSeeArticle } from '../src/access.ts';

const AUTHOR = 1;
const OTHER = 2;

describe('canSeeArticle / canEditArticle', () => {
  const cases = [
    // visibility, role des Betrachters, sehen, bearbeiten
    ['private', 'player', false, false],
    ['private', 'gm', false, false],
    ['private_gm', 'player', false, false],
    ['private_gm', 'gm', true, true],
    ['public', 'player', true, false],
    ['public', 'gm', true, true],
  ] as const;

  for (const [visibility, role, see, edit] of cases) {
    it(`${visibility} als fremder ${role}`, () => {
      const article = { authorId: AUTHOR, visibility };
      expect(canSeeArticle(OTHER, role, article)).toBe(see);
      expect(canEditArticle(OTHER, role, article)).toBe(edit);
    });
  }

  it('Autor darf immer sehen und bearbeiten', () => {
    for (const visibility of ['private', 'private_gm', 'public'] as const) {
      expect(canSeeArticle(AUTHOR, 'player', { authorId: AUTHOR, visibility })).toBe(true);
      expect(canEditArticle(AUTHOR, 'player', { authorId: AUTHOR, visibility })).toBe(true);
    }
  });
});

describe('canManageFolder', () => {
  it('Ersteller und Spielleiter', () => {
    expect(canManageFolder(AUTHOR, 'player', { createdBy: AUTHOR })).toBe(true);
    expect(canManageFolder(OTHER, 'player', { createdBy: AUTHOR })).toBe(false);
    expect(canManageFolder(OTHER, 'gm', { createdBy: AUTHOR })).toBe(true);
    expect(canManageFolder(OTHER, 'player', { createdBy: null })).toBe(false);
    expect(canManageFolder(OTHER, 'gm', { createdBy: null })).toBe(true);
  });
});
