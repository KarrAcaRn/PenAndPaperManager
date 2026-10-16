import { BASE_THEME_ID, DEFAULT_USER_SETTINGS, isThemeId, type ColorScheme, type UserSettings } from '@pnp/shared';
import { api } from './api.ts';
import { applyTheme, cancelPendingThemes, currentTheme, themeCatalog } from './theme.ts';

/**
 * localStorage-Schlüssel. theme/colorScheme merken das zuletzt angewendete Aussehen, damit das Inline-Skript in
 * client/index.html es beim nächsten Seitenaufruf vor dem ersten Zeichnen setzt (gleiche Schlüssel dort!).
 * guestTheme ist die Theme-Wahl ohne Login (Anmeldeseite).
 */
export const STORAGE_KEYS = {
  theme: 'pnp-theme-id',
  colorScheme: 'pnp-color-scheme',
  guestTheme: 'pnp-guest-theme',
} as const;

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // localStorage gesperrt: dann eben ohne Merken
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // siehe readStorage
  }
}

/** Einstellungen des eingeloggten Benutzers; bis zum Laden (und nach dem Logout) die Vorgaben bzw. die Gast-Wahl */
export const userSettings = $state<{ value: UserSettings }>({ value: { ...DEFAULT_USER_SETTINGS } });

export interface ApplyOptions {
  /** für den nächsten Seitenaufruf merken (nicht bei der Vorschau in den Einstellungen) */
  remember?: boolean;
}

/** Hell/Dunkel: „system“ entfernt das Attribut, dann entscheidet prefers-color-scheme (siehe themeCss im Server) */
export function applyColorScheme(scheme: ColorScheme, { remember = true }: ApplyOptions = {}): void {
  const root = document.documentElement;
  if (scheme === 'system') delete root.dataset.colorScheme;
  else root.dataset.colorScheme = scheme;
  if (remember) writeStorage(STORAGE_KEYS.colorScheme, scheme === 'system' ? null : scheme);
}

let siteDefault: Promise<string | null> | null = null;

/** Vorgabe-Theme der Seite laut Server; null, wenn die Theme-Liste nicht lädt (dann beim nächsten Mal neu versuchen) */
function loadSiteDefaultTheme(): Promise<string | null> {
  siteDefault ??= themeCatalog().then(
    (catalog) => catalog.defaultTheme,
    () => {
      siteDefault = null;
      return null;
    },
  );
  return siteDefault;
}

/** Vorgabe-Theme der Seite (DEFAULT_THEME des Seitenbetreibers); schlägt das Laden fehl, das Basis-Theme */
export async function siteDefaultTheme(): Promise<string> {
  return (await loadSiteDefaultTheme()) ?? BASE_THEME_ID;
}

/** nur für Tests: zwischengespeichertes Vorgabe-Theme vergessen */
export function forgetSiteDefaultTheme(): void {
  siteDefault = null;
}

let themeRequest = 0;

/**
 * Wendet das gewünschte Theme an (null = Vorgabe der Seite). Gibt es das Theme nicht (mehr) oder lädt es nicht,
 * greift die Vorgabe der Seite, danach das Basis-Theme – ein gelöschtes Theme führt nie zu einem Fehler.
 * Liefert die ID des angewendeten Themes; null, wenn ein neuerer Aufruf übernommen hat oder gar nichts lädt
 * (dann bleibt das bisherige Theme).
 */
export async function applyPreferredTheme(id: string | null, { remember = true }: ApplyOptions = {}): Promise<string | null> {
  const own = ++themeRequest;
  const stale = () => own !== themeRequest;
  // ein neuer Wunsch macht alle noch ladenden Stylesheets älterer Aufrufe hinfällig
  cancelPendingThemes();
  const explicit = id !== null && isThemeId(id) ? id : null;
  if (explicit === null && currentTheme() === '') {
    // index.html hat das Vorgabe-Theme der Seite schon per Weiterleitung geladen: nur noch seine ID eintragen.
    // Lädt die Theme-Liste nicht, bleibt es einfach stehen (statt es durch das Basis-Theme zu ersetzen).
    const active = await loadSiteDefaultTheme();
    if (stale() || active === null || currentTheme() !== '') return null;
    document.documentElement.dataset.theme = active;
    if (remember) writeStorage(STORAGE_KEYS.theme, null);
    return active;
  }
  const tried = new Set<string>();
  let candidate: string | null = explicit ?? (await siteDefaultTheme());
  while (candidate !== null && !stale()) {
    tried.add(candidate);
    try {
      // schon aktiv (z.B. vom Inline-Skript in index.html gesetzt): nichts laden
      if (candidate !== currentTheme() && !(await applyTheme(candidate))) return null;
      if (stale()) return null;
      // Gemerkt wird nur eine ausdrückliche Wahl; sonst lädt index.html beim nächsten Mal das aktuelle
      // Vorgabe-Theme der Seite (/themes/site-default.css) – auch wenn der Seitenbetreiber es inzwischen ändert.
      if (remember) writeStorage(STORAGE_KEYS.theme, candidate === explicit ? candidate : null);
      return candidate;
    } catch {
      const fallback = await siteDefaultTheme();
      candidate = [fallback, BASE_THEME_ID].find((next) => !tried.has(next)) ?? null;
    }
  }
  return null;
}

/** Aussehen (Farbschema und Theme) auf die Seite anwenden, ohne die Einstellungen zu ändern */
export function applyAppearance(settings: UserSettings, options: ApplyOptions = {}): Promise<string | null> {
  applyColorScheme(settings.colorScheme, options);
  return applyPreferredTheme(settings.theme, options);
}

/** Übernimmt Einstellungen und wendet alles an, was direkt auf die App wirkt. */
export function setUserSettings(settings: UserSettings): void {
  userSettings.value = settings;
  void applyAppearance(settings);
}

/** Theme-Wahl ohne Login (nur in diesem Browser gespeichert); null = Vorgabe der Seite */
export function guestTheme(): string | null {
  const stored = readStorage(STORAGE_KEYS.guestTheme);
  return isThemeId(stored) ? stored : null;
}

export function setGuestTheme(id: string | null): Promise<string | null> {
  writeStorage(STORAGE_KEYS.guestTheme, id);
  userSettings.value = { ...userSettings.value, theme: id };
  return applyPreferredTheme(id);
}

/**
 * Jeder Lade-/Speichervorgang bekommt eine laufende Nummer. Eine Antwort wird nur übernommen, wenn seit ihrem
 * Start nichts Neueres übernommen bzw. zurückgesetzt wurde - sonst setzt z.B. eine späte Antwort nach dem Logout
 * das Theme des alten Benutzers wieder oder ein früher gestartetes Laden überschreibt gerade Gespeichertes.
 * Fehlgeschlagene Vorgänge zählen nicht.
 */
let counter = 0;
let applied = 0;

async function fetchAndApply(request: () => Promise<UserSettings>): Promise<UserSettings> {
  const own = ++counter;
  const settings = await request();
  if (own < applied) return userSettings.value;
  applied = own;
  setUserSettings(settings);
  return settings;
}

export function loadUserSettings(): Promise<UserSettings> {
  return fetchAndApply(() => api.settings());
}

export function saveUserSettings(changes: Partial<UserSettings>): Promise<UserSettings> {
  return fetchAndApply(() => api.updateSettings(changes));
}

/** Nach dem Logout bzw. ohne Session: nichts vom vorherigen Benutzer stehen lassen, es gilt die Gast-Wahl */
export function resetUserSettings(): void {
  applied = ++counter;
  setUserSettings({ ...DEFAULT_USER_SETTINGS, theme: guestTheme() });
}
