/**
 * Werkzeuge für Seitenbetreiber, die eigene Themes bauen:
 *
 *   npm run theme:create -- <id> [--name "Anzeigename"] [--dir <Zielordner>]
 *   npm run theme:validate -- [<Theme-Ordner oder theme.json> …]
 *
 * create kopiert die Vorlage themes/_template nach THEMES_DIR (Vorgabe data/themes) und setzt ID und Namen.
 * validate prüft Theme-Ordner genauso wie der Server (Schema, ID gleich Ordnername, Dateien vorhanden) und warnt
 * zusätzlich bei zu geringem Kontrast; ohne Pfad werden alle Themes in themes/ und THEMES_DIR geprüft.
 * Relative Pfade gelten ab dem Ordner, in dem npm aufgerufen wurde (INIT_CWD), nicht ab server/.
 */
import { cpSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import {
  BASE_THEME_ID,
  THEME_ID_PATTERN,
  THEME_LIMITS,
  THEME_TOKEN_NAMES,
  type ThemeManifest,
  type ThemeToken,
  type ThemeTokens,
} from '@pnp/shared';
import { builtinThemesDir, dbPath, themesDir } from './paths.ts';
import { MANIFEST_FILE, loadThemeDir, validateManifest } from './themes.ts';

/** Ordnername der Vorlage unter themes/ */
export const TEMPLATE_FOLDER = '_template';
/** ID der Vorlage; wird beim Anlegen in theme.json und im Zusatz-CSS ersetzt */
export const TEMPLATE_ID = 'mein-theme';

const ID_HINT = 'erlaubt sind Kleinbuchstaben a–z, Ziffern und Bindestriche, höchstens 40 Zeichen, am Anfang kein Bindestrich (z.B. „nachtwald“)';

// ---------------------------------------------------------------------------------------------------------------
// Kontrast (WCAG 2.x)

/** sRGB-Farbe mit Kanälen 0–255; undefined, wenn der Wert keine deckende, einfach lesbare Farbe ist */
export function parseColor(value: string): [number, number, number] | undefined {
  const v = value.trim().toLowerCase();
  const named: Record<string, string> = { white: '#ffffff', black: '#000000' };
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(named[v] ?? v)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
    if (full.length === 8 && full.slice(6) !== 'ff') return undefined; // durchscheinend
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(v);
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
    if (alpha < 1) return undefined;
    const channels = [rgb[1], rgb[2], rgb[3]].map(Number);
    return channels.every((c) => c <= 255) ? (channels as [number, number, number]) : undefined;
  }
  return undefined;
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Kontrastverhältnis zweier Farben (1 bis 21) */
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Ersetzt var(--token) bzw. var(--token, Ersatz) durch den Token-Wert (auch verschachtelt) */
function resolveVars(value: string, tokens: ThemeTokens, depth = 0): string {
  if (depth > 10) return value;
  return value.replace(/var\(\s*--([a-z0-9-]+)\s*(?:,\s*([^()]*))?\)/g, (_m, name: string, fallback?: string) => {
    const next = tokens[name as ThemeToken] ?? fallback;
    return next === undefined ? 'unbekannt' : resolveVars(next, tokens, depth + 1);
  });
}

/** Farbpaare, deren Kontrast geprüft wird: Vordergrund, Hintergrund, wo das Paar vorkommt */
export const CONTRAST_PAIRS: { fg: ThemeToken; bg: ThemeToken; where: string }[] = [
  { fg: 'color-text', bg: 'color-bg', where: 'Fließtext auf dem Seitenhintergrund' },
  { fg: 'color-text', bg: 'color-surface', where: 'Fließtext auf Karten und Feldern' },
  { fg: 'color-text', bg: 'color-surface-muted', where: 'Codeblöcke und Hover' },
  { fg: 'color-text-muted', bg: 'color-bg', where: 'Nebentext auf dem Seitenhintergrund' },
  { fg: 'color-text-muted', bg: 'color-surface', where: 'Nebentext und Abzeichen auf Karten' },
  { fg: 'color-link', bg: 'color-bg', where: 'Links auf dem Seitenhintergrund' },
  { fg: 'color-link', bg: 'color-surface', where: 'Links auf Karten' },
  { fg: 'color-accent', bg: 'color-surface', where: 'Akzent-Abzeichen und gewählter Ordner' },
  { fg: 'color-accent-text', bg: 'color-accent', where: 'Text auf Hauptknöpfen und aktivem Reiter' },
  { fg: 'color-danger', bg: 'color-surface', where: 'Fehlermeldungen und Löschen-Knöpfe' },
  { fg: 'sheet-ink', bg: 'sheet-paper', where: 'Text des Charakterbogens' },
  { fg: 'sheet-on-accent', bg: 'sheet-accent', where: 'Text auf den Balken des Charakterbogens' },
  { fg: 'sheet-paper', bg: 'sheet-logo', where: 'Logo des Charakterbogens' },
];
/** WCAG AA für normalen Text */
export const MIN_CONTRAST = 4.5;

export interface ContrastResult {
  warnings: string[];
  /** Paare, die nicht geprüft werden konnten (z.B. color-mix, durchscheinende Farben) */
  unchecked: string[];
}

/** Prüft die Farbpaare für vollständige Tokens (eigene plus die des Basis-Themes); label z.B. „hell“ */
export function checkContrast(tokens: ThemeTokens, label: string): ContrastResult {
  const result: ContrastResult = { warnings: [], unchecked: [] };
  for (const { fg, bg, where } of CONTRAST_PAIRS) {
    const [a, b] = [parseColor(resolveVars(tokens[fg] ?? '', tokens)), parseColor(resolveVars(tokens[bg] ?? '', tokens))];
    if (!a || !b) {
      result.unchecked.push(`${fg}/${bg}`);
      continue;
    }
    const ratio = contrastRatio(a, b);
    if (ratio < MIN_CONTRAST) {
      result.warnings.push(
        `Kontrast ${label}: ${fg} auf ${bg} ist nur ${ratio.toFixed(2)}:1 (${where}); für Text sind mindestens ${MIN_CONTRAST}:1 nötig (WCAG AA).`,
      );
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------------------------------
// Validieren

export interface ValidationReport {
  /** geprüfter Ordner */
  dir: string;
  id?: string;
  errors: string[];
  warnings: string[];
  notes: string[];
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined; // die genaue Meldung liefert loadThemeDir
  }
}

const isDir = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Prüft einen Theme-Ordner (oder dessen theme.json) wie der Server und ergänzt Warnungen (Kontrast, übersprungener
 * Ordner, ID schon vergeben). Vorlagen-Ordner („_…“) werden gegen die ID im Manifest statt gegen den Ordnernamen
 * geprüft. Wirft nie.
 */
export function validateTheme(path: string, opts: { builtinDir?: string } = {}): ValidationReport {
  const builtinDir = opts.builtinDir ?? builtinThemesDir();
  const dir = basename(path) === MANIFEST_FILE ? dirname(path) : path;
  const report: ValidationReport = { dir, errors: [], warnings: [], notes: [] };
  if (!existsSync(dir)) {
    report.errors.push(`Ordner „${dir}“ gibt es nicht.`);
    return report;
  }
  if (!isDir(dir)) {
    report.errors.push(`„${dir}“ ist kein Ordner. Bitte den Theme-Ordner oder seine ${MANIFEST_FILE} angeben.`);
    return report;
  }
  const folder = basename(resolve(dir));
  const skipped = folder.startsWith('_') || folder.startsWith('.');
  const raw = readJson(join(dir, MANIFEST_FILE)) as Partial<ThemeManifest> | undefined;
  const manifestId = typeof raw?.id === 'string' ? raw.id : undefined;
  const result = loadThemeDir(dir, skipped && manifestId ? manifestId : folder);
  if (skipped) {
    report.warnings.push(
      `Der Ordnername „${folder}“ beginnt mit „${folder[0]}“ – solche Ordner (Vorlagen) lädt der Server nicht. Zum Benutzen kopieren: npm run theme:create -- <id>`,
    );
  }
  if (!result.ok) {
    report.errors.push(...result.errors);
    if (manifestId) report.id = manifestId;
    if (raw !== undefined && !validateManifest(raw).ok) {
      report.notes.push('Weitere Prüfungen (ID gleich Ordnername, Dateien, Kontrast) folgen, sobald diese Fehler behoben sind.');
    }
    return report;
  }
  const { manifest } = result;
  report.id = manifest.id;

  // Basis-Theme ergänzt fehlende Tokens; ohne es kann der Kontrast nicht vollständig geprüft werden
  const baseResult = loadThemeDir(join(builtinDir, BASE_THEME_ID), BASE_THEME_ID);
  const baseTokens = baseResult.ok ? baseResult.manifest.tokens : {};
  const isBase = manifest.id === BASE_THEME_ID && resolve(dir) === resolve(builtinDir, BASE_THEME_ID);
  if (!isBase && !skipped) {
    const builtinTwin = join(builtinDir, manifest.id);
    if (resolve(builtinTwin) !== resolve(dir) && existsSync(join(builtinTwin, MANIFEST_FILE))) {
      report.errors.push(`Die ID „${manifest.id}“ hat bereits ein mitgeliefertes Theme (${builtinTwin}); bitte Ordner und ID umbenennen.`);
    }
  }
  if (!isBase) {
    const inherited = THEME_TOKEN_NAMES.filter((t) => manifest.tokens[t] === undefined);
    if (inherited.length) report.notes.push(`${inherited.length} von ${THEME_TOKEN_NAMES.length} Tokens kommen aus dem Basis-Theme „${BASE_THEME_ID}“.`);
  }

  const light = { ...baseTokens, ...manifest.tokens };
  const checks = [checkContrast(light, 'hell')];
  const dark = manifest.darkTokens ?? {};
  if (Object.keys(dark).length) checks.push(checkContrast({ ...light, ...dark }, 'dunkel'));
  else if (!isBase) report.notes.push('Keine darkTokens: das Theme sieht bei dunklem Farbschema genauso aus wie bei hellem.');
  for (const c of checks) report.warnings.push(...c.warnings);
  const unchecked = [...new Set(checks.flatMap((c) => c.unchecked))];
  if (unchecked.length) report.notes.push(`Kontrast nicht automatisch prüfbar (z.B. color-mix oder durchscheinend), bitte im Browser ansehen: ${unchecked.join(', ')}.`);
  return report;
}

/** Alle Theme-Ordner unter den Wurzeln (so wie der Server sie lädt) */
function allThemeDirs(roots: string[]): string[] {
  const dirs: string[] = [];
  for (const root of [...new Set(roots.map((r) => resolve(r)))]) {
    if (!isDir(root)) continue;
    for (const name of readdirSync(root).sort()) {
      if (!name.startsWith('_') && !name.startsWith('.') && isDir(join(root, name))) dirs.push(join(root, name));
    }
  }
  return dirs;
}

// ---------------------------------------------------------------------------------------------------------------
// Anlegen

/** gültige ID aus einem Namen, z.B. „Nacht Wald“ → „nacht-wald“; leer, wenn nichts übrig bleibt */
export function slugify(text: string): string {
  const umlauts: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };
  return text
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => umlauts[c]!)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

export interface CreateOptions {
  id: string;
  name?: string;
  /** Ordner, in dem der neue Theme-Ordner angelegt wird; Vorgabe THEMES_DIR bzw. data/themes */
  targetRoot?: string;
  builtinDir?: string;
}

/** Kopiert die Vorlage nach <targetRoot>/<id> und setzt ID, Namen und $schema. Wirft Error mit deutscher Meldung. */
export function createTheme(opts: CreateOptions): string {
  const builtinDir = opts.builtinDir ?? builtinThemesDir();
  const targetRoot = opts.targetRoot ?? themesDir(dbPath());
  const { id } = opts;
  if (!new RegExp(THEME_ID_PATTERN).test(id)) {
    const suggestion = slugify(id);
    throw new Error(`Die ID „${id}“ ist ungültig – ${ID_HINT}.${suggestion && suggestion !== id ? ` Vorschlag: „${suggestion}“` : ''}`);
  }
  const name = opts.name?.trim() || id.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  if (name.length > THEME_LIMITS.name) throw new Error(`Der Name darf höchstens ${THEME_LIMITS.name} Zeichen lang sein.`);
  if (id === BASE_THEME_ID || existsSync(join(builtinDir, id, MANIFEST_FILE))) {
    throw new Error(`Die ID „${id}“ hat bereits ein mitgeliefertes Theme; bitte eine andere wählen.`);
  }
  const target = join(targetRoot, id);
  if (existsSync(target)) throw new Error(`Der Ordner „${target}“ existiert bereits.`);
  const template = join(builtinDir, TEMPLATE_FOLDER);
  if (!existsSync(join(template, MANIFEST_FILE))) throw new Error(`Vorlage „${template}“ nicht gefunden.`);

  cpSync(template, target, { recursive: true });
  const manifestFile = join(target, MANIFEST_FILE);
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as ThemeManifest;
  // $schema relativ zum Schema im Repo, damit Editoren (z.B. VS Code) Autovervollständigung und Prüfung anbieten
  const schema = relative(target, join(builtinDir, 'theme.schema.json')).split(sep).join('/');
  const updated: ThemeManifest = { ...manifest, $schema: schema, id, name };
  writeFileSync(manifestFile, JSON.stringify(updated, null, 2) + '\n');
  if (manifest.css) {
    const cssFile = join(target, manifest.css);
    writeFileSync(cssFile, readFileSync(cssFile, 'utf8').replaceAll(TEMPLATE_ID, id));
  }
  return target;
}

// ---------------------------------------------------------------------------------------------------------------
// Kommandozeile

const USAGE = [
  'Aufruf:',
  '  npm run theme:create -- <id> [--name "Anzeigename"] [--dir <Zielordner>]',
  '  npm run theme:validate -- [<Theme-Ordner oder theme.json> …]',
  '',
  'Ohne Pfad prüft theme:validate alle Themes in themes/ und THEMES_DIR (Vorgabe data/themes).',
  'Anleitung: docs/themes.md',
].join('\n');

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
  /** Ordner, gegen den relative Pfade aufgelöst werden */
  cwd: string;
  builtinDir?: string;
  themesRoot?: string;
}

function formatReport(r: ValidationReport, cwd: string): string[] {
  const where = relative(cwd, r.dir) || '.';
  const label = r.id ? `„${r.id}“ (${where})` : where;
  const lines = [r.errors.length ? `✘ ${label}: ${r.errors.length} Fehler` : `✔ ${label}: gültig${r.warnings.length ? `, ${r.warnings.length} Warnung(en)` : ''}`];
  for (const e of r.errors) lines.push(`    Fehler:  ${e}`);
  for (const w of r.warnings) lines.push(`    Warnung: ${w}`);
  for (const n of r.notes) lines.push(`    Hinweis: ${n}`);
  return lines;
}

/** Führt ein Kommando aus und liefert den Exit-Code: 0 gültig/angelegt, 1 Fehler im Theme, 2 falscher Aufruf */
export function runCli(argv: string[], io: CliIo): number {
  const [command, ...rest] = argv;
  const builtinDir = io.builtinDir ?? builtinThemesDir();
  const themesRoot = io.themesRoot ?? themesDir(dbPath());

  if (command === 'create') {
    const positional: string[] = [];
    let name: string | undefined;
    let dir: string | undefined;
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i]!;
      if (arg === '--name' || arg === '--dir') {
        const value = rest[++i];
        if (value === undefined) {
          io.err(`Nach ${arg} fehlt ein Wert.\n\n${USAGE}`);
          return 2;
        }
        if (arg === '--name') name = value;
        else dir = resolve(io.cwd, value);
      } else if (arg.startsWith('--')) {
        io.err(`Unbekannte Option „${arg}“.\n\n${USAGE}`);
        return 2;
      } else positional.push(arg);
    }
    if (positional.length !== 1) {
      io.err(`Bitte genau eine Theme-ID angeben.\n\n${USAGE}`);
      return 2;
    }
    try {
      const target = createTheme({ id: positional[0]!, name, targetRoot: dir ?? themesRoot, builtinDir });
      const rel = relative(io.cwd, target) || target;
      io.out(`Theme angelegt: ${rel}`);
      io.out('');
      io.out('Nächste Schritte:');
      io.out(`  1. ${join(rel, MANIFEST_FILE)} öffnen: author, description und die Farben in "tokens" anpassen.`);
      io.out(`  2. Prüfen:  npm run theme:validate -- ${rel}`);
      io.out('  3. Seite neu laden – das Theme steht sofort ohne Neustart zur Auswahl (Anleitung: docs/themes.md).');
      if (dir && resolve(dir) !== resolve(themesRoot) && resolve(dir) !== resolve(builtinDir)) {
        io.out(`  Achtung: Der Server lädt eigene Themes aus ${themesRoot}; für ${dir} THEMES_DIR entsprechend setzen.`);
      }
      return 0;
    } catch (err) {
      io.err(`Fehler: ${(err as Error).message}`);
      return 1;
    }
  }

  if (command === 'validate') {
    const unknown = rest.find((a) => a.startsWith('--'));
    if (unknown) {
      io.err(`Unbekannte Option „${unknown}“.\n\n${USAGE}`);
      return 2;
    }
    const dirs = rest.length ? rest.map((p) => resolve(io.cwd, p)) : allThemeDirs([builtinDir, themesRoot]);
    if (!dirs.length) {
      io.err('Keine Themes gefunden.');
      return 1;
    }
    const reports = dirs.map((d) => validateTheme(d, { builtinDir }));
    for (const r of reports) for (const line of formatReport(r, io.cwd)) io.out(line);
    const failed = reports.filter((r) => r.errors.length).length;
    io.out('');
    io.out(failed ? `${failed} von ${reports.length} Theme(s) fehlerhaft.` : `Alle ${reports.length} Theme(s) gültig.`);
    return failed ? 1 : 0;
  }

  if (command === '--help' || command === '-h') {
    io.out(USAGE);
    return 0;
  }
  io.err(command ? `Unbekanntes Kommando „${command}“.\n\n${USAGE}` : USAGE);
  return 2;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  process.exitCode = runCli(process.argv.slice(2), {
    out: (l) => console.log(l),
    err: (l) => console.error(l),
    cwd: process.env.INIT_CWD ?? process.cwd(),
  });
}
