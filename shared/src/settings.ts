/**
 * Benutzereinstellungen: gelten für einen Login, gruppenübergreifend.
 *
 * Neue Einstellung = Eintrag in UserSettings und USER_SETTINGS (Vorgabe, JSON-Schema für die Server-Validierung,
 * Prüfung gespeicherter Werte). Server-Validierung, Vorgaben und das Bereinigen gespeicherter Werte leiten sich
 * daraus ab; eine Schemaänderung ist nicht nötig, gespeichert wird ein JSON-Objekt (Tabelle user_settings).
 */
import { THEME_ID_PATTERN } from './theme.ts';

export const COLOR_SCHEMES = ['system', 'light', 'dark'] as const;
export type ColorScheme = (typeof COLOR_SCHEMES)[number];

export const COLOR_SCHEME_LABELS: Record<ColorScheme, string> = {
  system: 'Wie das System',
  light: 'Hell',
  dark: 'Dunkel',
};

export interface UserSettings {
  /** Hell/Dunkel; "system" folgt der Einstellung des Browsers. Wirkt bei Themes mit dunkler Variante. */
  colorScheme: ColorScheme;
  /** ID des gewählten Themes; null = Vorgabe der Seite (DEFAULT_THEME, sonst „default“) */
  theme: string | null;
}

interface SettingDef<T> {
  default: T;
  /** JSON-Schema eines Werts (PATCH /api/me/settings) */
  schema: Record<string, unknown>;
  /** gespeicherten bzw. empfangenen Wert prüfen */
  isValid(value: unknown): value is T;
}

const enumSetting = <T extends string>(values: readonly T[]): SettingDef<T> => ({
  default: values[0]!,
  schema: { type: 'string', enum: values },
  isValid: (value): value is T => (values as readonly unknown[]).includes(value),
});

const THEME_ID_RE = new RegExp(THEME_ID_PATTERN);
export const isThemeId = (value: unknown): value is string => typeof value === 'string' && THEME_ID_RE.test(value);

export const USER_SETTINGS: { readonly [K in keyof UserSettings]: SettingDef<UserSettings[K]> } = {
  colorScheme: enumSetting(COLOR_SCHEMES),
  theme: {
    default: null,
    // ob es das Theme gibt, prüft die Route gegen die Theme-Registry
    schema: { type: 'string', pattern: THEME_ID_PATTERN, nullable: true },
    isValid: (value): value is string | null => value === null || isThemeId(value),
  },
};

export const USER_SETTING_KEYS = Object.keys(USER_SETTINGS) as (keyof UserSettings)[];

export const DEFAULT_USER_SETTINGS: UserSettings = Object.fromEntries(
  USER_SETTING_KEYS.map((key) => [key, USER_SETTINGS[key].default]),
) as unknown as UserSettings;

/**
 * Gespeicherte Werte mit den Vorgaben zusammenführen: Unbekannte Schlüssel und nicht (mehr) erlaubte Werte
 * fallen weg, fehlende Einstellungen bekommen ihre Vorgabe.
 */
export function normalizeUserSettings(raw: unknown): UserSettings {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const result: Record<string, unknown> = { ...DEFAULT_USER_SETTINGS };
  for (const key of USER_SETTING_KEYS) {
    if (USER_SETTINGS[key].isValid(source[key])) result[key] = source[key];
  }
  return result as unknown as UserSettings;
}
