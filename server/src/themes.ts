/**
 * Theme-Registry: lädt die eingebauten Themes (themes/ im Repo) und die des Seitenbetreibers (THEMES_DIR,
 * Vorgabe data/themes). Jeder Unterordner mit einer theme.json ist ein Theme; Ordner, die mit „_“ oder „.“
 * beginnen (z.B. Vorlagen), werden übersprungen. Bei jedem Zugriff wird geprüft, ob sich in den Ordnern etwas
 * geändert hat (Dateinamen, Größen, Änderungszeiten); nur dann wird neu geladen. So erscheint ein abgelegtes
 * Theme ohne Neustart.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
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

/** Tokens, die in einer box-shadow-Liste stehen und deshalb kein „none“ oder CSS-weites Schlüsselwort sein dürfen */
const SHADOW_LIST_TOKENS: ThemeToken[] = ['shadow-surface', 'frame-line'];
const NOT_IN_LISTS = /^(none|inherit|initial|unset|revert|revert-layer)$/i;

/** Sind alle Klammern außerhalb von Strings geschlossen? (Offene Klammern verschlucken den Rest des Stylesheets) */
function parensBalanced(value: string): boolean {
  let depth = 0;
  let quote = '';
  for (const c of value) {
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === "'" || c === '"') quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

export interface Theme extends ThemeInfo {
  dir: string;
  /** Inhalt der Zusatz-CSS-Datei */
  extraCss?: string;
  /** erzeugtes Stylesheet */
  css: string;
  /** ETag des erzeugten Stylesheets */
  etag: string;
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
      const hint = isTokenMap(field.split('.')[0]) && field.includes('.') ? THEME_TOKEN_VALUE_HINT : parent?.description;
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

/** url(…) mit '…', "…" oder unquotiertem Ziel; das Ziel steht in Gruppe 1, 2 oder 3 */
const URL_RE = /url\(\s*(?:'([^']*)'|"([^"]*)"|([^'"()\s]*))\s*\)/gi;
const urlTarget = (m: RegExpMatchArray) => m[1] ?? m[2] ?? m[3] ?? '';
const isExternal = (target: string) => /^(data:|https?:|\/|#)/i.test(target);

/** Liegt ein relativer Pfad (auch nach Auflösen von Symlinks) im Theme-Ordner und ist eine auslieferbare Datei? */
export function themeFilePath(dir: string, rel: string): string | undefined {
  try {
    const root = realpathSync(dir);
    const file = realpathSync(resolve(root, rel));
    if (!file.startsWith(root + sep) || !(extname(file).toLowerCase() in THEME_FILE_TYPES)) return undefined;
    return statSync(file).isFile() ? file : undefined;
  } catch {
    return undefined;
  }
}

function decodeTarget(target: string): string | undefined {
  try {
    return decodeURI(target);
  } catch {
    return undefined;
  }
}

/** Prüft, dass jede relative url(…) auf eine vorhandene Datei im Theme-Ordner zeigt */
function checkUrls(dir: string, where: string, css: string, errors: string[]) {
  for (const m of css.matchAll(URL_RE)) {
    const target = urlTarget(m);
    if (!target || isExternal(target)) continue;
    const decoded = decodeTarget(target);
    if (decoded === undefined) errors.push(`${where}: „${target}“ ist keine gültige URL (Sonderzeichen wie % kodieren, z.B. %25).`);
    else if (!themeFilePath(dir, decoded)) {
      errors.push(`${where}: Datei „${target}“ fehlt im Theme-Ordner oder hat keinen erlaubten Typ (${Object.keys(THEME_FILE_TYPES).join(', ')}).`);
    }
  }
}

function readManifest(dir: string): unknown {
  const manifestPath = join(dir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) throw new Error(`${MANIFEST_FILE} fehlt.`);
  const text = readFileSync(manifestPath, 'utf8');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${MANIFEST_FILE} ist kein gültiges JSON: ${(err as Error).message}`);
  }
}

function checkThemeDir(dir: string, folderName: string): ThemeLoadResult {
  const checked = validateManifest(readManifest(dir));
  if (!checked.ok) return checked;
  const manifest = checked.manifest;
  const errors: string[] = [];
  if (manifest.id !== folderName) errors.push(`Die ID „${manifest.id}“ muss dem Ordnernamen „${folderName}“ entsprechen.`);
  for (const [field, map] of [['tokens', manifest.tokens], ['darkTokens', manifest.darkTokens ?? {}]] as const) {
    for (const [token, value] of Object.entries(map)) {
      if (!parensBalanced(value)) errors.push(`${field}.${token}: Klammern sind nicht geschlossen.`);
      checkUrls(dir, `${field}.${token}`, value, errors);
    }
    for (const token of SHADOW_LIST_TOKENS) {
      const value = map[token]?.trim();
      if (value && NOT_IN_LISTS.test(value)) errors.push(`${field}.${token}: „${value}“ ist hier nicht erlaubt, stattdessen „0 0 transparent“.`);
    }
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

/**
 * Lädt und prüft einen Theme-Ordner: Schema, ID gleich Ordnername, referenzierte Dateien vorhanden.
 * Wirft nie; auch Lesefehler werden als Fehlermeldung geliefert. Wird auch von Skripten (Validierung) genutzt.
 */
export function loadThemeDir(dir: string, folderName: string): ThemeLoadResult {
  try {
    return checkThemeDir(dir, folderName);
  } catch (err) {
    return { ok: false, errors: [(err as Error).message] };
  }
}

/** Relative url(…) in Token-Werten absolut machen – in Custom Properties würden sie sonst je nach Browser falsch aufgelöst */
const absolutizeUrls = (id: string, value: string) =>
  value.replace(URL_RE, (match: string, q1?: string, q2?: string, bare?: string) => {
    const target = q1 ?? q2 ?? bare ?? '';
    return !target || isExternal(target) ? match : `url("/themes/${id}/${target.replaceAll('"', '%22')}")`;
  });

function absolutizeTokens(id: string, tokens: ThemeTokens): ThemeTokens {
  return Object.fromEntries(Object.entries(tokens).map(([k, v]) => [k, absolutizeUrls(id, v)]));
}

type ThemeDraft = Omit<Theme, 'css' | 'etag'>;

function toTheme(dir: string, manifest: ThemeManifest, extraCss: string | undefined, base: Theme | undefined, builtin: boolean): Theme {
  const draft: ThemeDraft = {
    id: manifest.id,
    name: manifest.name,
    author: manifest.author,
    version: manifest.version,
    ...(manifest.description === undefined ? {} : { description: manifest.description }),
    ...(manifest.license === undefined ? {} : { license: manifest.license }),
    ...(manifest.preview === undefined ? {} : { preview: `/themes/${manifest.id}/${manifest.preview}` }),
    stylesheet: themeStylesheetUrl(manifest.id),
    // Fehlende Tokens aus dem Basis-Theme; dunkle Abweichungen nicht, sonst mischten sich fremde Farben ein
    tokens: { ...base?.tokens, ...absolutizeTokens(manifest.id, manifest.tokens) } as Record<ThemeToken, string>,
    darkTokens: absolutizeTokens(manifest.id, manifest.darkTokens ?? {}),
    builtin,
    dir,
    ...(extraCss === undefined ? {} : { extraCss }),
  };
  const css = themeCss(draft);
  return { ...draft, css, etag: `"${createHash('sha1').update(css).digest('base64url')}"` };
}

/** Theme-Ordner eines Wurzelordners; Lesefehler landen in problems */
function themeFolders(root: string, problems: ThemeProblem[]): string[] {
  try {
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => (e.isDirectory() || (e.isSymbolicLink() && isDir(join(root, e.name)))) && !e.name.startsWith('_') && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort();
  } catch (err) {
    problems.push({ dir: root, errors: [`Ordner nicht lesbar: ${(err as Error).message}`] });
    return [];
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Fingerabdruck der Theme-Dateien unter den Wurzelordnern; ändert sich bei jedem Anlegen, Löschen oder Speichern.
 * Übersprungen werden Einträge mit „.“ (z.B. .git) und Vorlagenordner mit „_“ direkt unter der Wurzel.
 */
function fingerprint(roots: string[]): string {
  const parts: string[] = [];
  const walk = (dir: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      parts.push(`${dir}:?`);
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || (depth === 0 && e.name.startsWith('_'))) continue;
      const path = join(dir, e.name);
      try {
        const st = statSync(path);
        parts.push(`${path}:${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`);
        if (st.isDirectory() && depth < 4) walk(path, depth + 1);
      } catch {
        parts.push(`${path}:?`);
      }
    }
  };
  for (const root of roots) walk(root, 0);
  return parts.sort().join('\n');
}

const realOrResolved = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

export interface ThemeRegistryOptions {
  /** Ordner der mitgelieferten Themes; muss das Basis-Theme enthalten */
  builtinDir: string;
  /** Ordner des Seitenbetreibers (darf fehlen) */
  extraDir?: string;
  /** wird nach jedem Neuladen mit den abgelehnten Themes aufgerufen (z.B. fürs Log) */
  onProblems?: (problems: ThemeProblem[]) => void;
}

export interface ThemeSnapshot {
  themes: Map<string, Theme>;
  problems: ThemeProblem[];
}

export interface ThemeRegistry {
  /** aktueller Stand; lädt nur neu, wenn sich in den Ordnern etwas geändert hat */
  scan(): ThemeSnapshot;
  listThemes(): Theme[];
  getTheme(id: string): Theme | undefined;
  /** abgelehnte Theme-Ordner mit Begründung */
  problems(): ThemeProblem[];
}

export function createThemeRegistry(opts: ThemeRegistryOptions): ThemeRegistry {
  // Zeigt THEMES_DIR auf die eingebauten Themes (z.B. DB_PATH relativ zum Repo), nicht doppelt laden
  const extraDir = opts.extraDir && realOrResolved(opts.extraDir) !== realOrResolved(opts.builtinDir) ? opts.extraDir : undefined;
  const roots = [opts.builtinDir, ...(extraDir ? [extraDir] : [])];
  let cache: { key: string; snapshot: ThemeSnapshot } | undefined;

  function load(): ThemeSnapshot {
    const problems: ThemeProblem[] = [];
    const baseDir = join(opts.builtinDir, BASE_THEME_ID);
    const baseResult = loadThemeDir(baseDir, BASE_THEME_ID);
    if (!baseResult.ok) throw new Error(`Basis-Theme „${BASE_THEME_ID}“ (${baseDir}) ist ungültig: ${baseResult.errors.join(' ')}`);
    const missing = THEME_TOKEN_NAMES.filter((t) => baseResult.manifest.tokens[t] === undefined);
    if (missing.length) throw new Error(`Basis-Theme „${BASE_THEME_ID}“ muss alle Tokens setzen, es fehlen: ${missing.join(', ')}`);
    const base = toTheme(baseDir, baseResult.manifest, baseResult.extraCss, undefined, true);
    const themes = new Map<string, Theme>([[base.id, base]]);

    for (const root of roots) {
      const builtin = root === opts.builtinDir;
      for (const name of themeFolders(root, problems)) {
        const dir = join(root, name);
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

  function scan(): ThemeSnapshot {
    const key = fingerprint(roots);
    if (cache?.key === key) return cache.snapshot;
    let snapshot: ThemeSnapshot;
    try {
      snapshot = load();
    } catch (err) {
      // Basis-Theme zur Laufzeit kaputt: beim Start abbrechen, danach mit dem letzten gültigen Stand weiterarbeiten
      if (!cache) throw err;
      snapshot = { themes: cache.snapshot.themes, problems: [{ dir: join(opts.builtinDir, BASE_THEME_ID), errors: [(err as Error).message] }] };
    }
    cache = { key, snapshot };
    if (snapshot.problems.length) opts.onProblems?.(snapshot.problems);
    return snapshot;
  }

  return {
    scan,
    listThemes: () => [...scan().themes.values()],
    getTheme: (id) => scan().themes.get(id),
    problems: () => scan().problems,
  };
}

const declarations = (tokens: ThemeTokens, indent: string) =>
  THEME_TOKEN_NAMES.filter((t) => tokens[t] !== undefined).map((t) => `${indent}--${t}: ${tokens[t]};`).join('\n');

/**
 * Theme für alle ohne eigene Wahl: das vom Seitenbetreiber konfigurierte (DEFAULT_THEME), solange es existiert,
 * sonst das Basis-Theme. Wird bei jedem Aufruf neu bestimmt, weil Themes ohne Neustart verschwinden können.
 */
export function defaultThemeId(registry: Pick<ThemeRegistry, 'getTheme'>, configured: string | undefined): string {
  return configured && registry.getTheme(configured) ? configured : BASE_THEME_ID;
}

/**
 * Stylesheet eines Themes: Tokens auf :root, danach die dunklen Abweichungen, danach das Zusatz-CSS.
 * Die dunklen Werte gelten bei dunklem System-Farbschema, außer der Benutzer hat „Hell“ gewählt
 * (data-color-scheme="light" am <html>), und immer bei „Dunkel“ (data-color-scheme="dark").
 * :where() hält die Spezifität bei der von :root, damit ein später geladenes Theme weiterhin gewinnt.
 */
export function themeCss(theme: Pick<Theme, 'id' | 'version' | 'tokens' | 'darkTokens' | 'extraCss'>): string {
  // nur ID und Version in den Kommentar – beide sind per Schema frei von */
  const parts = [`/* Theme ${theme.id} ${theme.version} – automatisch erzeugt */`, `:root {\n${declarations(theme.tokens, '  ')}\n}`];
  if (Object.keys(theme.darkTokens).length) {
    parts.push(
      `@media (prefers-color-scheme: dark) {\n  :root:where(:not([data-color-scheme='light'])) {\n${declarations(theme.darkTokens, '    ')}\n  }\n}`,
      `:root:where([data-color-scheme='dark']) {\n${declarations(theme.darkTokens, '  ')}\n}`,
    );
  }
  if (theme.extraCss !== undefined) parts.push(`/* Zusatz-CSS des Themes */\n${theme.extraCss}`);
  return parts.join('\n\n') + '\n';
}

/** Theme-Datei (Grafik, Schrift, CSS) zum Ausliefern; theme.json und andere Typen werden nicht herausgegeben */
export function themeAsset(theme: Theme, rel: string): { path: string; type: string; etag: string } | undefined {
  const path = themeFilePath(theme.dir, rel);
  if (path === undefined) return undefined;
  try {
    const st = statSync(path);
    const etag = `"${[st.ino, st.size, st.mtimeMs, st.ctimeMs].map((n) => Math.round(n * 1000).toString(36)).join('-')}"`;
    return { path, type: THEME_FILE_TYPES[extname(path).toLowerCase()]!, etag };
  } catch {
    return undefined; // inzwischen gelöscht
  }
}
