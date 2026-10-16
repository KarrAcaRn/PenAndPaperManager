import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { THEME_TOKEN_NAMES } from '@pnp/shared';
import { builtinThemesDir } from '../src/paths.ts';
import { createThemeRegistry } from '../src/themes.ts';
import {
  TEMPLATE_FOLDER,
  checkContrast,
  contrastRatio,
  createTheme,
  parseColor,
  runCli,
  slugify,
  validateTheme,
} from '../src/theme-cli.ts';

const repo = join(builtinThemesDir(), '..');

let root: string;
let builtin: string;
let extra: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pnp-theme-cli-'));
  builtin = join(root, 'builtin');
  extra = join(root, 'extra');
  // echtes Basis-Theme, echte Vorlage und Schema aus dem Repo
  for (const name of ['default', TEMPLATE_FOLDER, 'theme.schema.json']) cpSync(join(builtinThemesDir(), name), join(builtin, name), { recursive: true });
  mkdirSync(extra);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function addTheme(folder: string, manifest: unknown) {
  const dir = join(extra, folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'theme.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  return dir;
}

const manifest = (id: string, tokens: Record<string, string> = {}, extraFields: Record<string, unknown> = {}) => ({
  manifestVersion: 1,
  id,
  name: id,
  author: 'Testerin',
  version: '1.0.0',
  tokens,
  ...extraFields,
});

function cli(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = runCli(argv, { out: (l) => out.push(l), err: (l) => err.push(l), cwd: root, builtinDir: builtin, themesRoot: extra });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('Kontrast', () => {
  it('liest Farben und berechnet das Verhältnis nach WCAG', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor('#1D6B5A')).toEqual([29, 107, 90]);
    expect(parseColor('rgb(0, 0, 0)')).toEqual([0, 0, 0]);
    expect(parseColor('rgb(10 20 30 / 100%)')).toEqual([10, 20, 30]);
    expect(parseColor('white')).toEqual([255, 255, 255]);
    // durchscheinend oder nicht einfach lesbar: nicht prüfbar
    expect(parseColor('rgba(0, 0, 0, 0.5)')).toBeUndefined();
    expect(parseColor('#0008')).toBeUndefined();
    expect(parseColor('color-mix(in srgb, red 50%, blue)')).toBeUndefined();
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([119, 119, 119], [255, 255, 255])).toBeCloseTo(4.48, 2);
  });

  it('löst var(…) auf und meldet zu schwache Paare mit Ort', () => {
    const { warnings, unchecked } = checkContrast(
      { 'color-text': '#999', 'color-bg': '#aaa', 'color-surface': 'var(--color-bg)', 'color-link': 'var(--fehlt, #000)', 'color-accent': 'color-mix(in srgb, red, blue)' },
      'hell',
    );
    expect(warnings).toContain(
      'Kontrast hell: color-text auf color-bg ist nur 1.23:1 (Fließtext auf dem Seitenhintergrund); für Text sind mindestens 4.5:1 nötig (WCAG AA).',
    );
    expect(warnings.some((w) => w.includes('color-text auf color-surface '))).toBe(true);
    expect(warnings.some((w) => w.includes('color-link'))).toBe(false);
    expect(unchecked).toContain('color-accent/color-surface');
  });
});

describe('createTheme', () => {
  it('legt aus der Vorlage ein gültiges, sofort ladbares Theme an', () => {
    const dir = createTheme({ id: 'nachtwald', name: 'Nachtwald', targetRoot: extra, builtinDir: builtin });
    expect(dir).toBe(join(extra, 'nachtwald'));
    const json = JSON.parse(readFileSync(join(dir, 'theme.json'), 'utf8'));
    expect(json).toMatchObject({ id: 'nachtwald', name: 'Nachtwald', $schema: '../../builtin/theme.schema.json' });
    expect(existsSync(join(dir, json.$schema))).toBe(true);
    for (const file of ['frame.svg', 'texture.svg', 'preview.svg', 'theme.css']) expect(existsSync(join(dir, file))).toBe(true);

    // ohne Fehler und ohne Warnungen (Kontrast hell und dunkel in Ordnung)
    expect(validateTheme(dir, { builtinDir: builtin })).toMatchObject({ id: 'nachtwald', errors: [], warnings: [] });
    // der Server lädt es
    const registry = createThemeRegistry({ builtinDir: builtin, extraDir: extra });
    expect(registry.problems()).toEqual([]);
    const theme = registry.getTheme('nachtwald')!;
    expect(theme.tokens['frame-image']).toBe('url("/themes/nachtwald/frame.svg")');
    expect(theme.preview).toBe('/themes/nachtwald/preview.svg');
    expect(theme.css).toContain(':root h1');
  });

  it('leitet den Namen aus der ID ab', () => {
    const dir = createTheme({ id: 'dunkler-wald', targetRoot: extra, builtinDir: builtin });
    expect(JSON.parse(readFileSync(join(dir, 'theme.json'), 'utf8')).name).toBe('Dunkler Wald');
  });

  it('lehnt ungültige, vergebene und vorhandene IDs verständlich ab', () => {
    const create = (id: string) => () => createTheme({ id, targetRoot: extra, builtinDir: builtin });
    expect(create('Äther Grün')).toThrow(/Die ID „Äther Grün“ ist ungültig – erlaubt sind Kleinbuchstaben .* Vorschlag: „aether-gruen“/);
    expect(create('-x')).toThrow('ungültig');
    expect(create('default')).toThrow('Die ID „default“ hat bereits ein mitgeliefertes Theme');
    createTheme({ id: 'zweimal', targetRoot: extra, builtinDir: builtin });
    expect(create('zweimal')).toThrow(`Der Ordner „${join(extra, 'zweimal')}“ existiert bereits.`);
    expect(() => createTheme({ id: 'x', name: 'n'.repeat(61), targetRoot: extra, builtinDir: builtin })).toThrow('höchstens 60 Zeichen');
  });

  it('slugify macht aus Namen gültige IDs', () => {
    expect(slugify('Nacht Wald')).toBe('nacht-wald');
    expect(slugify('Café Größe!')).toBe('cafe-groesse');
    expect(slugify('---')).toBe('');
  });
});

describe('validateTheme', () => {
  it('meldet Schemafehler und weist auf weitere Prüfungen hin', () => {
    const dir = addTheme('kaputt', { manifestVersion: 1, id: 'kaputt', name: '', version: '1.0', tokens: { farbe: 'rot' } });
    const r = validateTheme(dir, { builtinDir: builtin });
    expect(r.errors).toEqual([
      'Pflichtfeld „author“ fehlt.',
      '„name“ darf nicht leer sein.',
      '„version“ ist ungültig – Versionsnummer im Format MAJOR.MINOR.PATCH, z.B. 1.0.0.',
      'Unbekanntes Token „farbe“ in „tokens“.',
    ]);
    expect(r.notes[0]).toMatch(/^Weitere Prüfungen/);
  });

  it('meldet kaputtes JSON, fehlende Dateien, falsche Ordnernamen und doppelte IDs', () => {
    expect(validateTheme(addTheme('json', '{"id": "json",}'), { builtinDir: builtin }).errors[0]).toMatch(/^theme\.json ist kein gültiges JSON/);
    const files = validateTheme(addTheme('files', manifest('files', { 'frame-image': "url('fehlt.svg')" }, { css: 'x.css' })), { builtinDir: builtin });
    expect(files.errors).toEqual([
      expect.stringContaining('tokens.frame-image: Datei „fehlt.svg“ fehlt im Theme-Ordner'),
      'css: Datei „x.css“ fehlt im Theme-Ordner.',
    ]);
    expect(validateTheme(addTheme('ordner', manifest('anders')), { builtinDir: builtin }).errors).toEqual([
      'Die ID „anders“ muss dem Ordnernamen „ordner“ entsprechen.',
    ]);
    expect(validateTheme(join(extra, 'gibtsnicht'), { builtinDir: builtin }).errors).toEqual([`Ordner „${join(extra, 'gibtsnicht')}“ gibt es nicht.`]);
    // eigenes Theme mit der ID eines mitgelieferten
    cpSync(join(builtin, 'default'), join(builtin, 'clean'), { recursive: true });
    writeFileSync(join(builtin, 'clean/theme.json'), JSON.stringify(manifest('clean')));
    expect(validateTheme(addTheme('clean', manifest('clean')), { builtinDir: builtin }).errors[0]).toMatch(/hat bereits ein mitgeliefertes Theme/);
  });

  it('akzeptiert den Pfad zur theme.json und warnt bei schwachem Kontrast, auch nur im dunklen Schema', () => {
    const dir = addTheme('grau', manifest('grau', { 'color-text': '#999', 'color-bg': '#aaa' }));
    const r = validateTheme(join(dir, 'theme.json'), { builtinDir: builtin });
    expect(r).toMatchObject({ dir, id: 'grau', errors: [] });
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.notes).toContain(`${THEME_TOKEN_NAMES.length - 2} von ${THEME_TOKEN_NAMES.length} Tokens kommen aus dem Basis-Theme „default“.`);
    expect(r.notes).toContain('Keine darkTokens: das Theme sieht bei dunklem Farbschema genauso aus wie bei hellem.');

    // hell gut, aber dunkler Hintergrund ohne passende Textfarbe
    const dark = validateTheme(addTheme('halb', manifest('halb', {}, { darkTokens: { 'color-bg': '#111111', 'color-surface': '#1a1a1a' } })), { builtinDir: builtin });
    // (hell erbt es die Werte des Standard-Themes; nur der dunkle Fall ist hier kaputt)
    expect(dark.warnings.some((w) => w.startsWith('Kontrast dunkel: color-text auf color-bg'))).toBe(true);
    expect(dark.warnings.filter((w) => w.startsWith('Kontrast hell:'))).toEqual(
      validateTheme(join(builtin, 'default'), { builtinDir: builtin }).warnings.filter((w) => w.startsWith('Kontrast hell:')),
    );
  });

  it('prüft die Vorlage gegen ihre eigene ID und warnt, dass der Server sie überspringt', () => {
    const r = validateTheme(join(builtin, TEMPLATE_FOLDER), { builtinDir: builtin });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([expect.stringContaining('beginnt mit „_“ – solche Ordner (Vorlagen) lädt der Server nicht')]);
  });

  it('die mitgelieferten Themes sind fehlerfrei', () => {
    for (const r of [validateTheme(join(builtinThemesDir(), 'default')), validateTheme(join(builtinThemesDir(), TEMPLATE_FOLDER))]) {
      expect(r.errors).toEqual([]);
    }
  });
});

describe('Kommandozeile', () => {
  it('create legt an und nennt die nächsten Schritte', () => {
    const r = cli(['create', 'nachtwald', '--name', 'Nachtwald']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Theme angelegt: extra/nachtwald');
    expect(r.out).toContain('npm run theme:validate -- extra/nachtwald');
    expect(existsSync(join(extra, 'nachtwald/theme.json'))).toBe(true);
  });

  it('create mit --dir legt relativ zum Aufrufordner an und warnt, wenn der Server dort nicht sucht', () => {
    const r = cli(['create', 'woanders', '--dir', 'anderswo']);
    expect(r.code).toBe(0);
    expect(existsSync(join(root, 'anderswo/woanders/theme.json'))).toBe(true);
    expect(r.out).toContain('THEMES_DIR');
  });

  it('create meldet Fehler und falsche Aufrufe', () => {
    expect(cli(['create', 'Groß'])).toMatchObject({ code: 1, err: expect.stringContaining('Fehler: Die ID „Groß“ ist ungültig') });
    expect(cli(['create'])).toMatchObject({ code: 2, err: expect.stringContaining('Bitte genau eine Theme-ID angeben.') });
    expect(cli(['create', 'a', '--name'])).toMatchObject({ code: 2, err: expect.stringContaining('Nach --name fehlt ein Wert.') });
    expect(cli(['create', 'a', '--farbe', 'rot'])).toMatchObject({ code: 2, err: expect.stringContaining('Unbekannte Option „--farbe“') });
  });

  it('validate prüft ohne Pfad alle Themes und liefert Exit-Code 1 bei Fehlern', () => {
    createTheme({ id: 'gut', targetRoot: extra, builtinDir: builtin });
    expect(cli(['validate'])).toMatchObject({ code: 0, out: expect.stringContaining('Alle 2 Theme(s) gültig.') });

    addTheme('kaputt', { id: 'kaputt' });
    addTheme('_entwurf', { id: 'kaputt' }); // Vorlagen-Ordner werden nicht mitgeprüft
    const r = cli(['validate']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('✔ „gut“ (extra/gut): gültig');
    expect(r.out).toContain('✘ „kaputt“ (extra/kaputt): 5 Fehler');
    expect(r.out).toContain('    Fehler:  Pflichtfeld „manifestVersion“ fehlt.');
    expect(r.out).toContain('1 von 3 Theme(s) fehlerhaft.');
  });

  it('validate mit Pfad relativ zum Aufrufordner; Warnungen allein sind kein Fehler', () => {
    addTheme('grau', manifest('grau', { 'color-text': '#999' }));
    const r = cli(['validate', 'extra/grau']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/✔ „grau“ \(extra\/grau\): gültig, \d+ Warnung\(en\)/);
    expect(r.out).toContain('    Warnung: Kontrast hell: color-text auf');
  });

  it('Hilfe und unbekannte Kommandos', () => {
    expect(cli(['--help'])).toMatchObject({ code: 0, out: expect.stringContaining('npm run theme:create') });
    expect(cli([])).toMatchObject({ code: 2 });
    expect(cli(['loeschen'])).toMatchObject({ code: 2, err: expect.stringContaining('Unbekanntes Kommando „loeschen“') });
    expect(cli(['validate', '--strict'])).toMatchObject({ code: 2 });
  });
});

describe('Dokumentation', () => {
  const docs = readFileSync(join(repo, 'docs/themes.md'), 'utf8');

  it('die Token-Referenz nennt jedes Token', () => {
    const missing = THEME_TOKEN_NAMES.filter((t) => !docs.includes(`| \`${t}\` |`));
    expect(missing).toEqual([]);
  });

  it('das kommentierte Manifest in der Vorlage stimmt mit theme.json überein', () => {
    const readme = readFileSync(join(builtinThemesDir(), TEMPLATE_FOLDER, 'README.md'), 'utf8');
    const block = /```jsonc\n([\s\S]*?)```/.exec(readme)![1]!;
    const annotated = JSON.parse(block.replace(/^\s*\/\/.*$/gm, ''));
    const actual = JSON.parse(readFileSync(join(builtinThemesDir(), TEMPLATE_FOLDER, 'theme.json'), 'utf8'));
    expect(annotated.tokens).toEqual(actual.tokens);
    expect(annotated.darkTokens).toEqual(actual.darkTokens);
    expect(Object.keys(annotated)).toEqual(Object.keys(actual));
  });
});
