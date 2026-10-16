/**
 * Themes: Design-Tokens, Manifest-Format (theme.json) und das zugehörige JSON-Schema.
 * Jedes Token wird als CSS Custom Property `--<name>` auf `:root` gesetzt; die Oberfläche bezieht Farben, Rahmen,
 * Schatten und Schriften ausschließlich daraus.
 */

export type ThemeTokenGroup = 'Farben' | 'Rahmen' | 'Schatten' | 'Zierrahmen' | 'Hintergründe' | 'Schriften' | 'Charakterbogen';

export interface ThemeTokenInfo {
  group: ThemeTokenGroup;
  /** wo das Token in der Oberfläche wirkt */
  description: string;
}

/** Alle Tokens in der Reihenfolge, in der sie im erzeugten CSS stehen. Das Basis-Theme muss jedes davon setzen. */
export const THEME_TOKENS = {
  'color-scheme': { group: 'Farben', description: 'Farbschema der nativen Bedienelemente (normal, light, dark, light dark)' },
  'color-bg': { group: 'Farben', description: 'Seitenhintergrund' },
  'color-surface': { group: 'Farben', description: 'Flächen: Karten, Kopfleiste, Eingabefelder, Knöpfe, Menüs' },
  'color-surface-muted': { group: 'Farben', description: 'zurückgenommene Flächen: Hover, Codeblöcke, Editor-Werkzeugleiste' },
  'color-border': { group: 'Farben', description: 'Rahmen- und Trennlinien' },
  'color-text': { group: 'Farben', description: 'Fließtext' },
  'color-text-muted': { group: 'Farben', description: 'Nebentext, Hinweise, Zitate, Abzeichen' },
  'color-link': { group: 'Farben', description: 'Links und Link-Knöpfe' },
  'color-accent': { group: 'Farben', description: 'Akzent: Hauptknöpfe, aktiver Reiter, gewählter Ordner, Hover-Rahmen' },
  'color-accent-text': { group: 'Farben', description: 'Text und Symbole auf Akzentflächen' },
  'color-accent-hover': { group: 'Farben', description: 'Hover-Überlagerung für Symbolknöpfe auf Akzentflächen' },
  'color-danger': { group: 'Farben', description: 'Fehlermeldungen, Löschen-Knöpfe, „privat“-Abzeichen' },
  'color-highlight': { group: 'Farben', description: 'Hervorhebung von Suchtreffern' },
  'color-selection': { group: 'Farben', description: 'Auswahl im Editor (z.B. markierte Tabellenzellen)' },
  'border-width': { group: 'Rahmen', description: 'Breite normaler Rahmen (Karten, Knöpfe, Felder, Trennlinien)' },
  'border-style': { group: 'Rahmen', description: 'Linienart normaler Rahmen (solid, dashed, …)' },
  'border-width-strong': { group: 'Rahmen', description: 'Breite betonter Linien (Zitatbalken, Markierung im Inhaltsverzeichnis)' },
  'outline-width': { group: 'Rahmen', description: 'Breite von Fokus- und Ablage-Markierungen' },
  'border-radius': { group: 'Rahmen', description: 'Eckenradius von Karten, Knöpfen, Feldern und Menüs' },
  'border-radius-small': { group: 'Rahmen', description: 'kleiner Eckenradius (Suchtreffer)' },
  'radius-pill': { group: 'Rahmen', description: 'Eckenradius der Abzeichen' },
  'shadow-surface': { group: 'Schatten', description: 'Schatten von Karten und Kopfleiste' },
  'shadow-popup': { group: 'Schatten', description: 'Schatten aufklappender Menüs' },
  'frame-image': { group: 'Zierrahmen', description: 'Rahmengrafik (border-image, 9-Slice) um Kopfleiste und Seitenleisten; none für keinen' },
  'frame-slice': { group: 'Zierrahmen', description: 'Slice-Wert der Rahmengrafik (border-image-slice)' },
  'frame-width': { group: 'Zierrahmen', description: 'Breite der Rahmengrafik; 0px ohne Grafik' },
  'frame-outset': { group: 'Zierrahmen', description: 'wie weit die Rahmengrafik über den Kasten hinausragt' },
  'frame-repeat': { group: 'Zierrahmen', description: 'Wiederholung der Rahmengrafik (round, repeat, stretch, space)' },
  'frame-line': { group: 'Zierrahmen', description: 'Kastenlinie innerhalb des Zierrahmens (box-shadow)' },
  'frame-padding': { group: 'Zierrahmen', description: 'Innenabstand gerahmter Kästen' },
  'bg-image': { group: 'Hintergründe', description: 'Hintergrundbild/Textur der Seite; none für keines' },
  'surface-image': { group: 'Hintergründe', description: 'Hintergrundbild/Textur von Karten und Kopfleiste; none für keines' },
  'font-body': { group: 'Schriften', description: 'Schrift für Fließtext und Bedienelemente' },
  'font-heading': { group: 'Schriften', description: 'Schrift der Überschriften' },
  'font-mono': { group: 'Schriften', description: 'Schrift für Markdown-Quelltext' },
  'sheet-paper': { group: 'Charakterbogen', description: 'Papierfarbe des FATE-Bogens (auch Druckhintergrund)' },
  'sheet-ink': { group: 'Charakterbogen', description: 'Schrift- und Linienfarbe des Bogens' },
  'sheet-line': { group: 'Charakterbogen', description: 'Schreiblinien des Bogens' },
  'sheet-faded': { group: 'Charakterbogen', description: 'deaktivierte Stresskästchen' },
  'sheet-focus': { group: 'Charakterbogen', description: 'Hintergrund fokussierter Bogenfelder' },
  'sheet-accent': { group: 'Charakterbogen', description: 'Balken, Kästchen und Trennlinie des Bogens' },
  'sheet-on-accent': { group: 'Charakterbogen', description: 'Text auf Bogen-Akzentflächen' },
  'sheet-logo': { group: 'Charakterbogen', description: 'Hintergrund des Logos oben rechts' },
  'sheet-shadow': { group: 'Charakterbogen', description: 'Schatten des Bogens auf der Seite' },
  'sheet-font': { group: 'Charakterbogen', description: 'Schrift des Bogens' },
  'sheet-font-heading': { group: 'Charakterbogen', description: 'Schrift der Bogen-Überschriften und Werte' },
} as const satisfies Record<string, ThemeTokenInfo>;

export type ThemeToken = keyof typeof THEME_TOKENS;
export const THEME_TOKEN_NAMES = Object.keys(THEME_TOKENS) as ThemeToken[];
export type ThemeTokens = Partial<Record<ThemeToken, string>>;

/** Version des Manifest-Formats; wird bei inkompatiblen Änderungen hochgezählt */
export const THEME_MANIFEST_VERSION = 1;
/** ID des Basis-Themes; seine Tokens füllen fehlende Werte aller anderen Themes auf */
export const BASE_THEME_ID = 'default';
export const THEME_ID_PATTERN = '^[a-z0-9][a-z0-9-]{0,39}$';
export const THEME_LIMITS = { name: 60, author: 100, description: 500, license: 200, tokenValue: 500, file: 200 } as const;
/** Erklärung der erlaubten Token-Werte (Schema-Beschreibung und Fehlermeldung) */
export const THEME_TOKEN_VALUE_HINT = 'erlaubt ist ein CSS-Wert ohne { } < > \\ und ohne Kommentare, „;“ nur innerhalb von url(…)';

/** Inhalt einer theme.json */
export interface ThemeManifest {
  $schema?: string;
  manifestVersion: typeof THEME_MANIFEST_VERSION;
  id: string;
  name: string;
  author: string;
  version: string;
  description?: string;
  license?: string;
  /** Vorschaubild (Datei im Theme-Ordner) für die Theme-Auswahl */
  preview?: string;
  /** Zusatz-CSS (Datei im Theme-Ordner), wird nach den Tokens eingebunden */
  css?: string;
  tokens: ThemeTokens;
  /** Abweichungen bei dunklem Farbschema des Systems (prefers-color-scheme: dark) */
  darkTokens?: ThemeTokens;
}

/** Ein geladenes Theme, wie es die API liefert */
export interface ThemeInfo {
  id: string;
  name: string;
  author: string;
  version: string;
  description?: string;
  license?: string;
  /** URL des Vorschaubilds */
  preview?: string;
  /** URL des erzeugten Stylesheets */
  stylesheet: string;
  /** vollständige Tokens (fehlende aus dem Basis-Theme ergänzt) */
  tokens: Record<ThemeToken, string>;
  darkTokens: ThemeTokens;
  builtin: boolean;
}

/** URL des erzeugten Stylesheets eines Themes */
export const themeStylesheetUrl = (id: string) => `/themes/${encodeURIComponent(id)}/theme.css`;

const fileSchema = (description: string, ext: string) => ({
  type: 'string',
  maxLength: THEME_LIMITS.file,
  pattern: `^(?!/)(?!.*\\.\\.)[A-Za-z0-9._/-]+\\.(${ext})$`,
  description,
});

function tokensSchema(description: string) {
  const value = {
    type: 'string',
    minLength: 1,
    maxLength: THEME_LIMITS.tokenValue,
    // „;“ nur innerhalb von url(…) (data:-URLs), sonst könnte ein Wert die Deklaration beenden
    pattern: '^(?!.*/\\*)(?:url\\((?:\'[^\'{}<>\\\\]*\'|"[^"{}<>\\\\]*"|[^\'"()\\s{}<>\\\\]*)\\)|[^;{}<>\\\\])*$',
    description: THEME_TOKEN_VALUE_HINT,
  };
  return {
    type: 'object',
    description,
    additionalProperties: false,
    properties: Object.fromEntries(THEME_TOKEN_NAMES.map((t) => [t, { ...value, description: THEME_TOKENS[t].description }])),
  };
}

/** JSON-Schema (Draft 07) des Manifests; liegt zusätzlich als themes/theme.schema.json im Repo */
export function themeManifestSchema() {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://github.com/KarrAcaRn/PenAndPaperManager/themes/theme.schema.json',
    title: 'Pen & Paper Manager – Theme-Manifest (theme.json)',
    type: 'object',
    additionalProperties: false,
    required: ['manifestVersion', 'id', 'name', 'author', 'version', 'tokens'],
    properties: {
      $schema: { type: 'string' },
      manifestVersion: { const: THEME_MANIFEST_VERSION, description: `Version des Manifest-Formats, derzeit ${THEME_MANIFEST_VERSION}` },
      id: {
        type: 'string',
        pattern: THEME_ID_PATTERN,
        description: 'Kleinbuchstaben, Ziffern und Bindestriche (höchstens 40 Zeichen, nicht mit Bindestrich beginnend); gleich dem Ordnernamen',
      },
      name: { type: 'string', minLength: 1, maxLength: THEME_LIMITS.name, description: 'Anzeigename' },
      author: { type: 'string', minLength: 1, maxLength: THEME_LIMITS.author, description: 'Autor bzw. Herausgeber' },
      version: {
        type: 'string',
        pattern: '^\\d+\\.\\d+\\.\\d+$',
        description: 'Versionsnummer im Format MAJOR.MINOR.PATCH, z.B. 1.0.0',
      },
      description: { type: 'string', maxLength: THEME_LIMITS.description, description: 'kurze Beschreibung' },
      license: { type: 'string', maxLength: THEME_LIMITS.license, description: 'Lizenz des Themes und seiner Grafiken' },
      preview: fileSchema('relativer Pfad eines Bildes (png, jpg, jpeg, webp, gif, svg) im Theme-Ordner', 'png|jpg|jpeg|webp|gif|svg'),
      css: fileSchema('relativer Pfad einer .css-Datei im Theme-Ordner', 'css'),
      tokens: tokensSchema('Token-Werte; fehlende werden aus dem Basis-Theme übernommen'),
      darkTokens: tokensSchema('Abweichende Token-Werte bei dunklem Farbschema des Systems'),
    },
  };
}
