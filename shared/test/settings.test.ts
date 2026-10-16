import { describe, expect, it } from 'vitest';
import { COLOR_SCHEMES, DEFAULT_USER_SETTINGS, USER_SETTINGS, USER_SETTING_KEYS, normalizeUserSettings } from '../src/settings.ts';

describe('Benutzereinstellungen', () => {
  it('hat Vorgaben für jede Einstellung', () => {
    expect(DEFAULT_USER_SETTINGS).toEqual({ colorScheme: 'system', theme: null });
    for (const key of USER_SETTING_KEYS) expect(DEFAULT_USER_SETTINGS[key]).toBe(USER_SETTINGS[key].default);
    expect(USER_SETTINGS.colorScheme.schema).toEqual({ type: 'string', enum: COLOR_SCHEMES });
  });

  it('liefert für fehlende oder kaputte Daten die Vorgaben', () => {
    for (const raw of [undefined, null, 'dark', 42, [], {}]) expect(normalizeUserSettings(raw)).toEqual(DEFAULT_USER_SETTINGS);
  });

  it('übernimmt erlaubte Werte, verwirft ungültige und unbekannte', () => {
    expect(normalizeUserSettings({ colorScheme: 'dark', theme: 'wald' })).toEqual({ colorScheme: 'dark', theme: 'wald' });
    expect(normalizeUserSettings({ colorScheme: 'pink', theme: 'Kein Theme', fontSize: 3 })).toEqual(DEFAULT_USER_SETTINGS);
    expect(normalizeUserSettings({ theme: 42 })).toEqual(DEFAULT_USER_SETTINGS);
    expect(normalizeUserSettings({ theme: null })).toEqual(DEFAULT_USER_SETTINGS);
  });

  it('gibt nie das Vorgabe-Objekt selbst heraus', () => {
    const settings = normalizeUserSettings({});
    settings.colorScheme = 'dark';
    expect(DEFAULT_USER_SETTINGS.colorScheme).toBe('system');
  });
});
