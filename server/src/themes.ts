/**
 * Theme-Registry: lädt die eingebauten Themes (themes/ im Repo) und die des Seitenbetreibers (THEMES_DIR,
 * Vorgabe data/themes). Jeder Unterordner mit einer theme.json ist ein Theme; Ordner, die mit „_“ oder „.“
 * beginnen (z.B. Vorlagen), werden übersprungen. Die Ordner werden bei jedem Zugriff neu gelesen, damit ein
 * abgelegtes Theme ohne Neustart erscheint.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { Ajv, type ErrorObject } from 'ajv';
import {
  BASE_THEME_ID,
  THEME_TOKEN_NAMES,
  THEME_TOKEN_VALUE_HINT,
  themeManifestSchema,
  themeStylesheetUrl,
  type ThemeInfo,
  type ThemeManifest,
  type ThemeToken,
  type ThemeTokens,
} from '@pnp/shared';

export const MANIFEST_FILE = 'theme.json';
/** Name des erzeugten Stylesheets unter /themes/<id>/ */
export const STYLESHEET_FILE = 'theme.css';

/** Dateien, die aus einem Theme-Ordner ausgeliefert werden (Grafiken, Schriften, Zusatz-CSS) */
export const THEME_FILE_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

export interface Theme extends ThemeInfo {
  dir: string;
  /** Inhalt der Zusatz-CSS-Datei */
  extraCss?: string;
}

export interface ThemeProblem {
  /** Ordner des abgelehnten Themes */
  dir: string;
  errors: string[];
}

export type ThemeLoadResult = { ok: true; manifest: ThemeManifest; extraCss?: string } | { ok: false; errors: string[] };

const ajv = new Ajv({ allErrors: true, verbose: true, strict: true });
const validateSchema = ajv.compile<ThemeManifest>(themeManifestSchema());

const TYPE_NAMES: Record<string, string> = { string: 'ein Text', object: 'ein Objekt', number: 'eine Zahl', integer: 'eine ganze Zahl' };
const isTokenMap = (field: string) => field === 'tokens' || field === 'darkTokens';

/** „/tokens/color-bg“ → „tokens.color-bg“ */
const fieldName = (pointer: string) =>
  pointer.split('/').slice(1).map((p) => p.replaceAll('~1', '/').replaceAll('~0', '~')).join('.');
const join2 = (a: string, b: string) => (a ? `${a}.${b}` : b);

/** Schema-Fehler als verständlicher deutscher Satz */
function describeError(err: ErrorObject): string {
  const field = fieldName(err.instancePath);
  const params = err.params as Record<string, unknown>;
  const parent = err.parentSchema as { description?: string } | undefined;
  switch (err.keyword) {
    case 'required':
      return `Pflichtfeld „${join2(field, String(params.missingProperty))}“ fehlt.`;
    case 'additionalProperties':
      return isTokenMap(field)
        ? `Unbekanntes Token „${String(params.additionalProperty)}“ in „${field}“.`
        : `Unbekanntes Feld „${join2(field, String(params.additionalProperty))}“.`;
    case 'type':
      return `„${field || 'theme.json'}“ muss ${TYPE_NAMES[String(params.type)] ?? String(params.type)} sein.`;
    case 'const':
      return `„${field}“ muss ${JSON.stringify(params.allowedValue)} sein.`;
    case 'enum':
      return `„${field}“ muss einer der Werte ${(params.allowedValues as unknown[]).map((v) => JSON.stringify(v)).join(', ')} sein.`;
    case 'minLength':
      return `„${field}“ darf nicht leer sein.`;
    case 'maxLength':
      return `„${field}“ darf höchstens ${String(params.limit)} Zeichen lang sein.`;
    case 'pattern': {
      const parentField = field.split('.')[0];
      const hint = isTokenMap(parentField) && field.includes('.')
        ? THEME_TOKEN_VALUE_HINT
        : parent?.description;
      return `„${field}“ ist ungültig${hint ? ` – ${hint}` : ''}.`;
    }
    default:
      return `„${field || 'theme.json'}“: ${err.message ?? 'ungültig'}.`;
  }
}

/** Prüft ein Manifest gegen das JSON-Schema; liefert verständliche Fehlermeldungen */
export function validateManifest(raw: unknown): { ok: true; manifest: ThemeManifest } | { ok: false; errors: string[] } {
  if (validateSchema(raw)) return { ok: true, manifest: raw };
  // Doppelte Meldungen (z.B. type + pattern für dasselbe Feld) nur einmal
  return { ok: false, errors: [...new Set((validateSchema.errors ?? []).map(describeError))] };
}

const URL_RE = /url\(\s*(['"]?)([^'")]*)\1\s*\)/g;
const isExternal = (target: string) => /^(data:|https?:|\/|#)/i.test(target);

/** Liegt ein relativer Pfad innerhalb des Theme-Ordners und ist eine auslieferbare Datei? */
export function themeFilePath(dir: string, rel: string): string | undefined {
  const root = resolve(dir);
  const file = resolve(root, rel);
  if (!file.startsWith(root + sep) || !(extname(file).toLowerCase() in THEME_FILE_TYPES)) return undefined;
  try {
    return statSync(file).isFile() ? file : undefined;
  } catch {
    return undefined;
  }
}

/** Prüft, dass jede relative url(…) auf eine vorhandene Datei im Theme-Ordner zeigt */
function checkUrls(dir: string, where: string, css: string, errors: string[]) {
  for (const [, , target] of css.matchAll(URL_RE)) {
    if (!target || isExternal(target)) continue;
    if (!themeFilePath(dir, decodeURI(target))) {
      errors.push(`${where}: Datei „${target}“ fehlt im Theme-Ordner oder hat keinen erlaubten Typ (${Object.keys(THEME_FILE_TYPES).join(', ')}).`);
    }
  }
}

/**
 * Lädt und prüft einen Theme-Ordner: Schema, ID gleich Ordnername, referenzierte Dateien vorhanden.
 * Wird auch von Skripten (Validierung) genutzt.
 */
export function loadThemeDir(dir: string, folderName: string): ThemeLoadResult {
  const manifestPath = join(dir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) return { ok: false, errors: [`${MANIFEST_FILE} fehlt.`] };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    return { ok: false, errors: [`${MANIFEST_FILE} ist kein gültiges JSON: ${(err as Error).message}`] };
  }
  const checked = validateManifest(raw);
  if (!checked.ok) return checked;
  const manifest = checked.manifest;
  const errors: string[] = [];
  if (manifest.id !== folderName) errors.push(`Die ID „${manifest.id}“ muss dem Ordnernamen „${folderName}“ entsprechen.`);
  for (const [field, map] of [['tokens', manifest.tokens], ['darkTokens', manifest.darkTokens ?? {}]] as const) {
    for (const [token, value] of Object.entries(map)) checkUrls(dir, `${field}.${token}`, value, errors);
  }
  if (manifest.preview && !themeFilePath(dir, manifest.preview)) errors.push(`preview: Datei „${manifest.preview}“ fehlt im Theme-Ordner.`);
  let extraCss: string | undefined;
  if (manifest.css) {
    const file = themeFilePath(dir, manifest.css);
    if (!file) errors.push(`css: Datei „${manifest.css}“ fehlt im Theme-Ordner.`);
    else {
      extraCss = readFileSync(file, 'utf8');
      checkUrls(dir, `css (${manifest.css})`, extraCss, errors);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, manifest, extraCss };
}

/** Relative url(…) in Token-Werten absolut machen – in Custom Properties würden sie sonst je nach Browser falsch aufgelöst */
const absolutizeUrls = (id: string, value: string) =>
  value.replace(URL_RE, (match, quote: string, target: string) =>
    !target || isExternal(target) ? match : `url(${quote || '"'}/themes/${encodeURIComponent(id)}/${target}${quote || '"'})`,
  );

function absolutizeTokens(id: string, tokens: ThemeTokens): ThemeTokens {
  return Object.fromEntries(Object.entries(tokens).map(([k, v]) => [k, absolutizeUrls(id, v)]));
}

function toTheme(dir: string, manifest: ThemeManifest, extraCss: string | undefined, base: Theme | undefined, builtin: boolean): Theme {
  const own = absolutizeTokens(manifest.id, manifest.tokens);
  return {
    id: manifest.id,
    name: manifest.name,
    author: manifest.author,
    version: manifest.version,
    ...(manifest.description === undefined ? {} : { description: manifest.description }),
    ...(manifest.license === undefined ? {} : { license: manifest.license }),
    ...(manifest.preview === undefined ? {} : { preview: `/themes/${encodeURIComponent(manifest.id)}/${manifest.preview}` }),
    stylesheet: themeStylesheetUrl(manifest.id),
    // Fehlende Tokens aus dem Basis-Theme; dunkle Abweichungen nicht, sonst mischten sich fremde Farben ein
    tokens: { ...base?.tokens, ...own } as Record<ThemeToken, string>,
    darkTokens: absolutizeTokens(manifest.id, manifest.darkTokens ?? {}),
    builtin,
    dir,
    ...(extraCss === undefined ? {} : { extraCss }),
  };
}

function themeFolders(root: string | undefined): string[] {
  if (!root || !existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
}

export interface ThemeRegistryOptions {
  /** Ordner der mitgelieferten Themes; muss das Basis-Theme enthalten */
  builtinDir: string;
  /** Ordner des Seitenbetreibers (darf fehlen) */
  extraDir?: string;
}

export interface ThemeSnapshot {
  themes: Map<string, Theme>;
  problems: ThemeProblem[];
}

export interface ThemeRegistry {
  scan(): ThemeSnapshot;
  listThemes(): Theme[];
  getTheme(id: string): Theme | undefined;
  /** erzeugtes Stylesheet eines Themes */
  stylesheet(id: string): string | undefined;
  /** abgelehnte Theme-Ordner mit Begründung */
  problems(): ThemeProblem[];
}

export function createThemeRegistry(opts: ThemeRegistryOptions): ThemeRegistry {
  function scan(): ThemeSnapshot {
    const problems: ThemeProblem[] = [];
    const baseDir = join(opts.builtinDir, BASE_THEME_ID);
    const baseResult = loadThemeDir(baseDir, BASE_THEME_ID);
    if (!baseResult.ok) throw new Error(`Basis-Theme „${BASE_THEME_ID}“ (${baseDir}) ist ungültig: ${baseResult.errors.join(' ')}`);
    const missing = THEME_TOKEN_NAMES.filter((t) => baseResult.manifest.tokens[t] === undefined);
    if (missing.length) throw new Error(`Basis-Theme „${BASE_THEME_ID}“ muss alle Tokens setzen, es fehlen: ${missing.join(', ')}`);
    const base = toTheme(baseDir, baseResult.manifest, baseResult.extraCss, undefined, true);
    const themes = new Map<string, Theme>([[base.id, base]]);

    for (const [root, builtin] of [[opts.builtinDir, true], [opts.extraDir, false]] as const) {
      for (const name of themeFolders(root)) {
        const dir = join(root!, name);
        if (builtin && name === BASE_THEME_ID) continue;
        if (themes.has(name)) {
          problems.push({ dir, errors: [`Ein Theme mit der ID „${name}“ ist bereits vorhanden (${themes.get(name)!.dir}).`] });
          continue;
        }
        const result = loadThemeDir(dir, name);
        if (result.ok) themes.set(name, toTheme(dir, result.manifest, result.extraCss, base, builtin));
        else problems.push({ dir, errors: result.errors });
      }
    }
    return { themes, problems };
  }

  return {
    scan,
    listThemes: () => [...scan().themes.values()],
    getTheme: (id) => scan().themes.get(id),
    stylesheet: (id) => {
      const theme = scan().themes.get(id);
      return theme && themeCss(theme);
    },
    problems: () => scan().problems,
  };
}

const declarations = (tokens: ThemeTokens, indent: string) =>
  THEME_TOKEN_NAMES.filter((t) => tokens[t] !== undefined).map((t) => `${indent}--${t}: ${tokens[t]};`).join('\n');

/** Stylesheet eines Themes: Tokens auf :root, dunkle Abweichungen per Media Query, danach das Zusatz-CSS */
export function themeCss(theme: Theme): string {
  const parts = [
    `/* Theme „${theme.name.replaceAll('*/', '')}“ (${theme.id} ${theme.version}) – automatisch erzeugt */`,
    `:root {\n${declarations(theme.tokens, '  ')}\n}`,
  ];
  if (Object.keys(theme.darkTokens).length) {
    parts.push(`@media (prefers-color-scheme: dark) {\n  :root {\n${declarations(theme.darkTokens, '    ')}\n  }\n}`);
  }
  if (theme.extraCss !== undefined) parts.push(`/* Zusatz-CSS des Themes */\n${theme.extraCss}`);
  return parts.join('\n\n') + '\n';
}

/** Theme-Datei (Grafik, Schrift, CSS) zum Ausliefern; theme.json und andere Typen werden nicht herausgegeben */
export function themeAsset(theme: Theme, rel: string): { path: string; type: string } | undefined {
  const path = themeFilePath(theme.dir, rel);
  return path === undefined ? undefined : { path, type: THEME_FILE_TYPES[extname(path).toLowerCase()]! };
}
