import { describe, expect, it } from 'vitest';
import type { ThemeToken } from '@pnp/shared';
import { builtinThemesDir } from '../src/paths.ts';
import { createThemeRegistry, type Theme } from '../src/themes.ts';

/** Mitgelieferte Themes außer dem Basis-Theme */
const BUILTIN = ['clean', 'fantasy', 'scifi'];

type Rgb = [number, number, number];

/** Token-Wert als Farbe; var(--…) wird über die anderen Tokens aufgelöst, nur deckende Hex-Farben zählen */
function color(theme: Theme, token: ThemeToken, depth = 0): Rgb {
  const value = theme.tokens[token].trim();
  const ref = /^var\(--([a-z0-9-]+)\)$/.exec(value);
  if (ref && depth < 5) return color(theme, ref[1] as ThemeToken, depth + 1);
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)?.[1];
  if (!hex) throw new Error(`${theme.id}: ${token} ist keine deckende Hex-Farbe (${value})`);
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
}

/** relative Leuchtdichte nach WCAG 2.x */
function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const mix = (a: Rgb, b: Rgb, share: number): Rgb => a.map((v, i) => Math.round(v * (1 - share) + b[i]! * share)) as Rgb;

/** Text-/Hintergrund-Paare, die als Fließtext vorkommen (WCAG AA: mindestens 4.5:1) */
const PAIRS: [ThemeToken, ThemeToken][] = [
  ['color-text', 'color-bg'],
  ['color-text', 'color-surface'],
  ['color-text', 'color-surface-muted'],
  ['color-text-muted', 'color-bg'],
  ['color-text-muted', 'color-surface'],
  ['color-text-muted', 'color-surface-muted'],
  ['color-link', 'color-bg'],
  ['color-link', 'color-surface'],
  ['color-accent', 'color-bg'],
  ['color-accent', 'color-surface'],
  ['color-accent-text', 'color-accent'],
  ['color-danger', 'color-bg'],
  ['color-danger', 'color-surface'],
  ['sheet-ink', 'sheet-paper'],
  ['sheet-ink', 'sheet-focus'],
  ['sheet-on-accent', 'sheet-accent'],
  ['sheet-paper', 'sheet-logo'],
];

describe('mitgelieferte Themes', () => {
  const registry = createThemeRegistry({ builtinDir: builtinThemesDir() });

  it('werden fehlerfrei geladen und tragen Lizenz und Vorschau', () => {
    expect(registry.problems()).toEqual([]);
    expect(registry.listThemes().map((t) => t.id).sort()).toEqual(['default', ...BUILTIN].sort());
    for (const id of BUILTIN) {
      const theme = registry.getTheme(id)!;
      expect(theme).toMatchObject({ builtin: true, stylesheet: `/themes/${id}/theme.css`, preview: `/themes/${id}/preview.svg` });
      expect(theme.license).toMatch(/selbst erstellt/);
      // Zusatz-CSS ist eingebunden
      expect(theme.css).toContain('/* Zusatz-CSS des Themes */');
    }
  });

  it.each(BUILTIN)('%s: Textkontrast erfüllt WCAG AA (4.5:1)', (id) => {
    const theme = registry.getTheme(id)!;
    const failures = PAIRS.map(([fg, bg]) => ({ fg, bg, ratio: contrast(color(theme, fg), color(theme, bg)) }))
      .filter((p) => p.ratio < 4.5)
      .map((p) => `${p.fg} auf ${p.bg}: ${p.ratio.toFixed(2)}`);
    expect(failures).toEqual([]);
  });

  it('fantasy: auch auf der dunkelsten Stelle der Pergament-Struktur lesbar', () => {
    const theme = registry.getTheme('fantasy')!;
    // parchment.svg legt höchstens rund 12 % Braun (#6b451a) über die Fläche
    const darkest = (token: ThemeToken) => mix(color(theme, token), [0x6b, 0x45, 0x1a], 0.12);
    for (const fg of ['color-text', 'color-text-muted', 'color-link', 'color-accent', 'color-danger'] as ThemeToken[]) {
      for (const bg of ['color-bg', 'color-surface'] as ThemeToken[]) {
        expect(contrast(color(theme, fg), darkest(bg)), `${fg} auf ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
