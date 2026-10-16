import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { THEME_TOKEN_NAMES, THEME_TOKEN_VALUE_HINT } from '@pnp/shared';
import { openDb } from '../src/db.ts';
import { buildApp } from '../src/app.ts';
import { builtinThemesDir } from '../src/paths.ts';
import { createThemeRegistry, loadThemeDir, themeFilePath, validateManifest, type ThemeProblem } from '../src/themes.ts';
import { themeSchemaFile, themeSchemaJson } from '../src/write-theme-schema.ts';

const manifest = (extra: Record<string, unknown> = {}) => ({
  manifestVersion: 1,
  id: 'dunkel',
  name: 'Dunkel',
  author: 'Testerin',
  version: '1.0.0',
  tokens: { 'color-bg': '#000' },
  ...extra,
});

let root: string;
let builtin: string;
let extra: string;

/** legt einen Theme-Ordner mit theme.json (Objekt oder Rohtext) und weiteren Dateien an */
function addTheme(base: string, folder: string, json: unknown, files: Record<string, string> = {}) {
  const dir = join(base, folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'theme.json'), typeof json === 'string' ? json : JSON.stringify(json));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pnp-themes-'));
  builtin = join(root, 'builtin');
  extra = join(root, 'extra');
  // echtes Basis-Theme aus dem Repo
  cpSync(join(builtinThemesDir(), 'default'), join(builtin, 'default'), { recursive: true });
  mkdirSync(extra);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('validateManifest', () => {
  it('akzeptiert ein vollständiges Manifest', () => {
    const raw = JSON.parse(readFileSync(join(builtinThemesDir(), 'default/theme.json'), 'utf8'));
    expect(validateManifest(raw)).toEqual({ ok: true, manifest: raw });
    expect(validateManifest(manifest({ description: 'x', license: 'MIT', css: 'style.css', preview: 'img/p.png', darkTokens: {} })).ok).toBe(true);
  });

  it('meldet fehlende Pflichtfelder', () => {
    const { name: _n, tokens: _t, ...rest } = manifest();
    expect(validateManifest(rest)).toEqual({ ok: false, errors: ['Pflichtfeld „name“ fehlt.', 'Pflichtfeld „tokens“ fehlt.'] });
  });

  it('meldet unbekannte Tokens und Felder', () => {
    const result = validateManifest(manifest({ tokens: { 'color-bgg': 'red' }, darkTokens: { foo: 'x' }, colour: 'red' }));
    expect(result).toEqual({
      ok: false,
      errors: ['Unbekanntes Feld „colour“.', 'Unbekanntes Token „color-bgg“ in „tokens“.', 'Unbekanntes Token „foo“ in „darkTokens“.'],
    });
  });

  it('erklärt ungültige Werte', () => {
    const result = validateManifest(
      manifest({ id: 'Mein Theme', version: '1.0', manifestVersion: 2, name: '', tokens: { 'color-bg': 'red; } body { color: red', 'border-width': 3 } }),
    );
    expect(result.ok).toBe(false);
    const errors = (result as { errors: string[] }).errors;
    expect(errors).toContain('„manifestVersion“ muss 1 sein.');
    expect(errors).toContain('„name“ darf nicht leer sein.');
    expect(errors.find((e) => e.startsWith('„id“ ist ungültig'))).toMatch(/Kleinbuchstaben, Ziffern und Bindestriche/);
    expect(errors.find((e) => e.startsWith('„version“ ist ungültig'))).toMatch(/MAJOR\.MINOR\.PATCH/);
    expect(errors).toContain(`„tokens.color-bg“ ist ungültig – ${THEME_TOKEN_VALUE_HINT}.`);
    expect(errors).toContain('„tokens.border-width“ muss ein Text sein.');
  });

  it('erlaubt „;“ nur innerhalb von url(…)', () => {
    const ok = (value: string) => validateManifest(manifest({ tokens: { 'bg-image': value } })).ok;
    expect(ok('url(data:image/png;base64,AA)')).toBe(true);
    expect(ok(`url("data:image/svg+xml;utf8,%3Csvg%3E") , linear-gradient(red, blue)`)).toBe(true);
    expect(ok(`"Font; mit Semikolon", serif`)).toBe(true);
    expect(ok('calc(var(--frame-width) / 2)')).toBe(true);
    expect(ok('none; color: red')).toBe(false);
    expect(ok('url(a.png) /* Kommentar */')).toBe(false);
    // Umgehungen: ; nach geschlossenem String, Zeilenumbruch, offene Strings bzw. url(
    expect(ok(`'url(';--x:red;')`)).toBe(false);
    expect(ok('red\n/* x')).toBe(false);
    expect(ok(`'offen`)).toBe(false);
    expect(ok('url(offen')).toBe(false);
    // Formfeed beendet in CSS einen String
    expect(ok(`'\f' 'x;color:red;'`)).toBe(false);
  });

  it('prüft auch lange, verschachtelte Werte schnell (kein exponentielles Backtracking)', () => {
    const start = performance.now();
    for (const value of ['url(a)'.repeat(80) + ';', `'a'`.repeat(160) + ';', '('.repeat(490) + ';', 'u'.repeat(499) + ';']) {
      expect(validateManifest(manifest({ tokens: { 'bg-image': value } })).ok).toBe(false);
    }
    expect(performance.now() - start).toBeLessThan(500);
  });

  it('lehnt Dateipfade außerhalb des Theme-Ordners und falsche Typen ab', () => {
    for (const css of ['../x.css', '/etc/x.css', 'style.txt']) {
      expect(validateManifest(manifest({ css })).ok).toBe(false);
    }
    expect(validateManifest('kein Objekt')).toEqual({ ok: false, errors: ['„theme.json“ muss ein Objekt sein.'] });
  });
});

describe('loadThemeDir', () => {
  it('meldet fehlende oder kaputte theme.json', () => {
    mkdirSync(join(extra, 'leer'));
    expect(loadThemeDir(join(extra, 'leer'), 'leer')).toEqual({ ok: false, errors: ['theme.json fehlt.'] });
    const dir = addTheme(extra, 'kaputt', '{ "id": ');
    const result = loadThemeDir(dir, 'kaputt');
    expect(result.ok).toBe(false);
    expect((result as { errors: string[] }).errors[0]).toMatch(/^theme\.json ist kein gültiges JSON: /);
  });

  it('verlangt, dass die ID dem Ordnernamen entspricht', () => {
    const dir = addTheme(extra, 'anders', manifest());
    expect(loadThemeDir(dir, 'anders')).toEqual({ ok: false, errors: ['Die ID „dunkel“ muss dem Ordnernamen „anders“ entsprechen.'] });
  });

  it('prüft referenzierte Dateien', () => {
    const dir = addTheme(
      extra,
      'dunkel',
      manifest({
        css: 'style.css',
        preview: 'preview.png',
        tokens: { 'frame-image': 'url("rahmen.svg")', 'bg-image': 'url(https://example.org/a.png)', 'surface-image': 'url(data:image/png;base64,AA)' },
      }),
      { 'style.css': '.card { background: url(img/textur.png); } .x { background: url("../geheim.svg"); }' },
    );
    expect(loadThemeDir(dir, 'dunkel')).toEqual({
      ok: false,
      errors: [
        expect.stringMatching(/^tokens\.frame-image: Datei „rahmen\.svg“ fehlt im Theme-Ordner/),
        'preview: Datei „preview.png“ fehlt im Theme-Ordner.',
        expect.stringMatching(/^css \(style\.css\): Datei „img\/textur\.png“ fehlt/),
        expect.stringMatching(/^css \(style\.css\): Datei „\.\.\/geheim\.svg“ fehlt/),
      ],
    });
    writeFileSync(join(dir, 'rahmen.svg'), '<svg/>');
    writeFileSync(join(dir, 'preview.png'), '');
    mkdirSync(join(dir, 'img'));
    writeFileSync(join(dir, 'img/textur.png'), '');
    writeFileSync(join(dir, 'style.css'), '.card { background: url(img/textur.png); }');
    expect(loadThemeDir(dir, 'dunkel')).toMatchObject({ ok: true, extraCss: '.card { background: url(img/textur.png); }' });
  });

  it('lehnt kaputte URLs, „none“ in Schattenlisten und Symlinks nach außen ab, ohne zu werfen', () => {
    writeFileSync(join(root, 'geheim.svg'), '<svg/>');
    const dir = addTheme(extra, 'dunkel', manifest({ tokens: { 'frame-image': `url('50%.svg')`, 'shadow-surface': 'none', 'frame-line': 'Inherit', 'bg-image': `url("x'y.svg")`, 'frame-width': 'calc(1px + (2px)' } }));
    symlinkSync(join(root, 'geheim.svg'), join(dir, 'link.svg'));
    writeFileSync(join(dir, "x'y.svg"), '<svg/>');
    expect(loadThemeDir(dir, 'dunkel')).toEqual({
      ok: false,
      errors: [
        'tokens.frame-image: „50%.svg“ ist keine gültige URL (Sonderzeichen wie % kodieren, z.B. %25).',
        'tokens.frame-width: Klammern sind nicht geschlossen.',
        'tokens.shadow-surface: „none“ ist hier nicht erlaubt, stattdessen „0 0 transparent“.',
        'tokens.frame-line: „Inherit“ ist hier nicht erlaubt, stattdessen „0 0 transparent“.',
      ],
    });
    expect(themeFilePath(dir, 'link.svg')).toBeUndefined();
    expect(themeFilePath(dir, "x'y.svg")).toBe(join(realpathSync(dir), "x'y.svg"));
  });
});

describe('Theme-Registry', () => {
  it('lädt das Basis-Theme mit allen Tokens', () => {
    const registry = createThemeRegistry({ builtinDir: builtinThemesDir() });
    const base = registry.getTheme('default')!;
    expect(base).toMatchObject({ id: 'default', builtin: true, stylesheet: '/themes/default/theme.css' });
    expect(Object.keys(base.tokens).sort()).toEqual([...THEME_TOKEN_NAMES].sort());
    expect(base.tokens['frame-image']).toBe('url("/themes/default/vine-frame.svg")');
    expect(registry.problems()).toEqual([]);
  });

  it('ergänzt fehlende Tokens aus dem Basis-Theme, dunkle Abweichungen aber nicht', () => {
    addTheme(extra, 'dunkel', manifest({ darkTokens: { 'color-text': '#fff' } }));
    const registry = createThemeRegistry({ builtinDir: builtin, extraDir: extra });
    const base = registry.getTheme('default')!;
    const theme = registry.getTheme('dunkel')!;
    expect(theme.builtin).toBe(false);
    expect(theme.tokens['color-bg']).toBe('#000');
    expect(theme.tokens['color-accent']).toBe(base.tokens['color-accent']);
    expect(theme.tokens['frame-image']).toBe('url("/themes/default/vine-frame.svg")');
    expect(theme.darkTokens).toEqual({ 'color-text': '#fff' });
  });

  it('findet neu abgelegte Themes ohne Neustart und überspringt Vorlagen', () => {
    const registry = createThemeRegistry({ builtinDir: builtin, extraDir: join(root, 'fehlt-noch') });
    expect(registry.listThemes().map((t) => t.id)).toEqual(['default']);
    addTheme(join(root, 'fehlt-noch'), 'dunkel', manifest());
    addTheme(join(root, 'fehlt-noch'), '_template', manifest({ id: '_template' }));
    addTheme(join(root, 'fehlt-noch'), '.versteckt', manifest());
    expect(registry.listThemes().map((t) => t.id)).toEqual(['default', 'dunkel']);
    expect(registry.problems()).toEqual([]);
  });

  it('lädt nur bei Änderungen neu und meldet Probleme dabei', () => {
    const reports: ThemeProblem[][] = [];
    const registry = createThemeRegistry({ builtinDir: builtin, extraDir: extra, onProblems: (p) => reports.push(p) });
    const first = registry.getTheme('default');
    expect(registry.getTheme('default')).toBe(first);
    addTheme(extra, 'falsch', manifest({ id: 'falsch', version: 'x' }));
    expect(registry.getTheme('default')).not.toBe(first);
    expect(registry.getTheme('default')).toBe(registry.getTheme('default'));
    expect(reports).toEqual([[{ dir: join(extra, 'falsch'), errors: [expect.stringMatching(/^„version“ ist ungültig/)] }]]);
  });

  it('arbeitet mit dem letzten gültigen Stand weiter, wenn das Basis-Theme zur Laufzeit kaputtgeht', () => {
    addTheme(extra, 'dunkel', manifest());
    const reports: ThemeProblem[][] = [];
    const registry = createThemeRegistry({ builtinDir: builtin, extraDir: extra, onProblems: (p) => reports.push(p) });
    expect(registry.listThemes().map((t) => t.id)).toEqual(['default', 'dunkel']);
    writeFileSync(join(builtin, 'default/theme.json'), '{');
    expect(registry.listThemes().map((t) => t.id)).toEqual(['default', 'dunkel']);
    expect(registry.problems()).toEqual([{ dir: join(builtin, 'default'), errors: [expect.stringMatching(/Basis-Theme „default“ .* kein gültiges JSON/)] }]);
    expect(reports).toHaveLength(1);
  });

  it('übersteht einen nicht lesbaren Theme-Ordner und lädt die eingebauten nicht doppelt', () => {
    writeFileSync(join(root, 'datei'), '');
    const registry = createThemeRegistry({ builtinDir: builtin, extraDir: join(root, 'datei') });
    expect(registry.listThemes().map((t) => t.id)).toEqual(['default']);
    expect(registry.problems()).toEqual([{ dir: join(root, 'datei'), errors: [expect.stringMatching(/^Ordner nicht lesbar: /)] }]);
    addTheme(builtin, 'dunkel', manifest());
    const same = createThemeRegistry({ builtinDir: builtin, extraDir: `${builtin}/` });
    expect(same.listThemes().map((t) => t.id)).toEqual(['default', 'dunkel']);
    expect(same.problems()).toEqual([]);
  });

  it('lehnt ungültige und doppelte Themes mit Begründung ab, die übrigen bleiben nutzbar', () => {
    addTheme(builtin, 'dunkel', manifest());
    addTheme(extra, 'dunkel', manifest({ name: 'Kopie' }));
    addTheme(extra, 'default', manifest({ id: 'default' }));
    addTheme(extra, 'falsch', manifest({ id: 'falsch', tokens: { 'color-bgg': 'red' } }));
    const registry = createThemeRegistry({ builtinDir: builtin, extraDir: extra });
    expect(registry.listThemes().map((t) => t.id)).toEqual(['default', 'dunkel']);
    expect(registry.getTheme('dunkel')!.name).toBe('Dunkel');
    expect(registry.problems()).toEqual([
      { dir: join(extra, 'default'), errors: [`Ein Theme mit der ID „default“ ist bereits vorhanden (${join(builtin, 'default')}).`] },
      { dir: join(extra, 'dunkel'), errors: [`Ein Theme mit der ID „dunkel“ ist bereits vorhanden (${join(builtin, 'dunkel')}).`] },
      { dir: join(extra, 'falsch'), errors: ['Unbekanntes Token „color-bgg“ in „tokens“.'] },
    ]);
  });

  it('bricht ab, wenn das Basis-Theme fehlt oder unvollständig ist', () => {
    expect(() => createThemeRegistry({ builtinDir: extra }).listThemes()).toThrow(/Basis-Theme „default“ .* ist ungültig: theme\.json fehlt/);
    addTheme(extra, 'default', manifest({ id: 'default' }));
    expect(() => createThemeRegistry({ builtinDir: extra }).listThemes()).toThrow(/muss alle Tokens setzen, es fehlen: color-scheme, color-surface/);
  });

  it('erzeugt das Stylesheet aus Tokens, dunklen Abweichungen und Zusatz-CSS', () => {
    addTheme(
      extra,
      'dunkel',
      manifest({ css: 'style.css', tokens: { 'color-bg': '#000', 'bg-image': 'url(img/stein.png)' }, darkTokens: { 'color-text': '#fff' } }),
      { 'style.css': 'h1 { letter-spacing: 0.1em; }', 'img/stein.png': '' },
    );
    const css = createThemeRegistry({ builtinDir: builtin, extraDir: extra }).getTheme('dunkel')!.css;
    expect(css).toContain(':root {\n  --color-scheme: light;\n  --color-bg: #000;\n');
    expect(css).toContain('  --bg-image: url("/themes/dunkel/img/stein.png");\n');
    // dunkle Werte nach System-Farbschema (außer „Hell“ ist gewählt) und bei gewähltem „Dunkel“
    expect(css).toContain(
      "@media (prefers-color-scheme: dark) {\n  :root:where(:not([data-color-scheme='light'])) {\n    --color-text: #fff;\n  }\n}",
    );
    expect(css).toContain(":root:where([data-color-scheme='dark']) {\n  --color-text: #fff;\n}");
    expect(css.trimEnd().endsWith('h1 { letter-spacing: 0.1em; }')).toBe(true);
    // jedes Token genau einmal im :root-Block
    const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('\n}', css.indexOf(':root {')));
    for (const token of THEME_TOKEN_NAMES) expect(rootBlock.split(`\n  --${token}:`).length).toBe(2);
  });
});

describe('Theme-API', () => {
  const app = () => buildApp(openDb(':memory:'), { builtinThemesDir: builtin, themesDir: extra });

  it('listet Themes öffentlich und liefert einzelne', async () => {
    addTheme(extra, 'dunkel', manifest({ description: 'Nachts' }));
    const a = app();
    const list = await a.inject({ url: '/api/themes' });
    expect(list.statusCode).toBe(200);
    expect(list.json().themes.map((t: { id: string }) => t.id)).toEqual(['default', 'dunkel']);
    expect(list.json().themes[1]).not.toHaveProperty('dir');
    const one = await a.inject({ url: '/api/themes/dunkel' });
    expect(one.json().theme).toMatchObject({ id: 'dunkel', name: 'Dunkel', description: 'Nachts', author: 'Testerin', version: '1.0.0' });
    expect((await a.inject({ url: '/api/themes/gibtsnicht' })).json()).toEqual({ error: 'Theme „gibtsnicht“ nicht gefunden' });
    expect((await a.inject({ url: '/api/themes/Böse' })).statusCode).toBe(400);
  });

  it('liefert Stylesheet und Theme-Dateien, aber weder theme.json noch Dateien außerhalb', async () => {
    const a = app();
    const css = await a.inject({ url: '/themes/default/theme.css' });
    expect(css.statusCode).toBe(200);
    expect(css.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(css.body).toContain('--frame-image: url("/themes/default/vine-frame.svg");');
    const svg = await a.inject({ url: '/themes/default/vine-frame.svg' });
    expect(svg.statusCode).toBe(200);
    expect(svg.headers['content-type']).toBe('image/svg+xml');
    // unverändert: 304 ohne Inhalt (auch schwach oder in einer Liste), veraltet: 200
    for (const [url, res] of [['/themes/default/theme.css', css], ['/themes/default/vine-frame.svg', svg]] as const) {
      const etag = String(res.headers.etag);
      for (const header of [etag, `W/${etag}`, `"alt", ${etag}`]) {
        const again = await a.inject({ url, headers: { 'if-none-match': header } });
        expect(again.statusCode, header).toBe(304);
        expect(again.body).toBe('');
      }
      expect((await a.inject({ url, headers: { 'if-none-match': '"alt"' } })).statusCode).toBe(200);
    }
    // geänderte Dateien bekommen ein neues ETag
    writeFileSync(join(builtin, 'default/vine-frame.svg'), '<svg>neu</svg>');
    const changed = await a.inject({ url: '/themes/default/vine-frame.svg', headers: { 'if-none-match': String(svg.headers.etag) } });
    expect(changed.statusCode).toBe(200);
    expect(changed.body).toBe('<svg>neu</svg>');
    writeFileSync(join(root, 'geheim.svg'), '<svg>geheim</svg>');
    for (const url of ['/themes/default/theme.json', '/themes/default/../../geheim.svg', '/themes/default/%2e%2e/%2e%2e/geheim.svg', '/themes/gibtsnicht/theme.css']) {
      const res = await a.inject({ url });
      // je nach Build-Zustand 404 oder die index.html des Frontends – nie die Datei
      expect(res.statusCode === 404 || res.headers['content-type'] === 'text/html; charset=utf-8', url).toBe(true);
      expect(res.body, url).not.toMatch(/geheim|manifestVersion/);
    }
  });
});

describe('JSON-Schema-Datei', () => {
  it('entspricht dem Schema aus dem Code (sonst npm run theme:schema -w server)', () => {
    expect(readFileSync(themeSchemaFile(), 'utf8')).toBe(themeSchemaJson());
  });
});
