/**
 * Benutzereinstellungen: gelten für einen Login, gruppenübergreifend.
 *
 * Neue Einstellung = Eintrag in USER_SETTING_OPTIONS (erlaubte Werte, der erste ist die Vorgabe) und
 * in UserSettings. Server-Validierung, Vorgaben und das Bereinigen gespeicherter Werte leiten sich daraus ab;
 * eine Schemaänderung ist nicht nötig, gespeichert wird ein JSON-Objekt (Tabelle user_settings).
 */

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABELS: Record<Theme, string> = {
  system: 'Wie das System',
  light: 'Hell',
  dark: 'Dunkel',
};

export interface UserSettings {
  /** Farbschema der Oberfläche; "system" folgt der Einstellung des Browsers */
  theme: Theme;
}

/** Erlaubte Werte je Einstellung; der erste Wert ist die Vorgabe. */
export const USER_SETTING_OPTIONS: { readonly [K in keyof UserSettings]: readonly UserSettings[K][] } = {
  theme: THEMES,
};

export const USER_SETTING_KEYS = Object.keys(USER_SETTING_OPTIONS) as (keyof UserSettings)[];

export const DEFAULT_USER_SETTINGS: UserSettings = Object.fromEntries(
  USER_SETTING_KEYS.map((key) => [key, USER_SETTING_OPTIONS[key][0]]),
) as unknown as UserSettings;

/**
 * Gespeicherte Werte mit den Vorgaben zusammenführen: Unbekannte Schlüssel und nicht (mehr) erlaubte Werte
 * fallen weg, fehlende Einstellungen bekommen ihre Vorgabe.
 */
export function normalizeUserSettings(raw: unknown): UserSettings {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const result: Record<string, unknown> = { ...DEFAULT_USER_SETTINGS };
  for (const key of USER_SETTING_KEYS) {
    if ((USER_SETTING_OPTIONS[key] as readonly unknown[]).includes(source[key])) result[key] = source[key];
  }
  return result as unknown as UserSettings;
}
