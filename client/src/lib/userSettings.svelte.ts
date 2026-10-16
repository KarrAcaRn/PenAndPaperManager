import { DEFAULT_USER_SETTINGS, THEMES, type Theme, type UserSettings } from '@pnp/shared';
import { api } from './api.ts';

/** Zuletzt gewähltes Theme, damit es beim nächsten Seitenaufruf schon vor dem Laden der Einstellungen greift */
const THEME_STORAGE_KEY = 'pnp-theme';

/** Einstellungen des eingeloggten Benutzers; bis zum Laden (und nach dem Logout) die Vorgaben */
export const userSettings = $state<{ value: UserSettings }>({ value: { ...DEFAULT_USER_SETTINGS } });

/**
 * Theme auf die Seite anwenden: "system" entfernt das Attribut, dann entscheidet prefers-color-scheme (app.css).
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    if (theme === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ohne localStorage (z.B. gesperrt) gilt das Theme eben erst nach dem Laden der Einstellungen.
  }
}

/** Beim Start: zuletzt verwendetes Theme sofort setzen, damit die Seite nicht erst hell aufblitzt */
export function applyStoredTheme(): void {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // siehe applyTheme
  }
  applyTheme((THEMES as readonly string[]).includes(stored ?? '') ? (stored as Theme) : 'system');
}

/** Übernimmt Einstellungen und wendet alles an, was direkt auf die App wirkt. */
export function setUserSettings(settings: UserSettings): void {
  userSettings.value = settings;
  applyTheme(settings.theme);
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

/** Nach dem Logout bzw. ohne Session: nichts vom vorherigen Benutzer stehen lassen */
export function resetUserSettings(): void {
  applied = ++counter;
  setUserSettings({ ...DEFAULT_USER_SETTINGS });
}
