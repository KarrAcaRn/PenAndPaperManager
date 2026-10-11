import { describe, expect, it } from 'vitest';
import {
  MAX_PATH_LENGTH,
  PathError,
  baseName,
  isWithin,
  joinPath,
  normalizePath,
  normalizePathOrRaw,
  parentPath,
  pathPrefixes,
} from '../src/index.ts';

describe('normalizePath', () => {
  it('bringt Pfade in kanonische Form', () => {
    expect(normalizePath('')).toBe('');
    expect(normalizePath('/')).toBe('');
    expect(normalizePath('   ')).toBe('');
    expect(normalizePath('bar/foo')).toBe('bar/foo');
    expect(normalizePath(' /bar//  foo / ')).toBe('bar/foo');
    expect(normalizePath('Ödland/Über uns')).toBe('Ödland/Über uns');
  });

  it('lehnt ungültige Pfade ab', () => {
    expect(() => normalizePath('a/../b')).toThrow(PathError);
    expect(() => normalizePath('./a')).toThrow(PathError);
    expect(() => normalizePath('a\\b')).toThrow(PathError);
    expect(() => normalizePath('a\tb')).toThrow(PathError);
    expect(() => normalizePath('x'.repeat(61))).toThrow(PathError);
    expect(normalizePath('x'.repeat(60))).toHaveLength(60);
  });

  it('vereinheitlicht Unicode und lehnt unsichtbare Namen ab', () => {
    expect(normalizePath('Sta\u0308dte')).toBe('St\u00e4dte');
    expect(() => normalizePath('\u200b')).toThrow(PathError);
    expect(() => normalizePath('a/\u00a0\u200b/b')).toThrow(PathError);
    expect(() => normalizePath('a\u0085b')).toThrow(PathError);
    expect(normalizePath('bar')).not.toBe(normalizePath('Bar'));
  });

  it('begrenzt die Gesamtlänge', () => {
    const segment = 'x'.repeat(50);
    expect(() => normalizePath(Array(4).fill(segment).join('/'))).toThrow(PathError);
    expect(normalizePath(Array(3).fill(segment).join('/')).length).toBeLessThanOrEqual(MAX_PATH_LENGTH);
  });
});

describe('Pfad-Helfer', () => {
  it('pathPrefixes', () => {
    expect(pathPrefixes('')).toEqual([]);
    expect(pathPrefixes('a')).toEqual(['a']);
    expect(pathPrefixes('a/b/c')).toEqual(['a', 'a/b', 'a/b/c']);
  });

  it('parentPath, baseName, joinPath', () => {
    expect(parentPath('a/b/c')).toBe('a/b');
    expect(parentPath('a')).toBe('');
    expect(baseName('a/b/c')).toBe('c');
    expect(baseName('a')).toBe('a');
    expect(joinPath('', 'a')).toBe('a');
    expect(joinPath('a/b', 'c')).toBe('a/b/c');
  });

  it('isWithin', () => {
    expect(isWithin('a/b', 'a')).toBe(true);
    expect(isWithin('a', 'a')).toBe(true);
    expect(isWithin('a', '')).toBe(true);
    expect(isWithin('ab', 'a')).toBe(false);
    expect(isWithin('a', 'a/b')).toBe(false);
  });
});

describe('normalizePathOrRaw', () => {
  it('normalisiert gültige Pfade und lässt ungültige unverändert', () => {
    expect(normalizePathOrRaw(' Ba\u0308r / x/')).toBe('B\u00e4r/x');
    expect(normalizePathOrRaw('a/../b')).toBe('a/../b');
  });
});
